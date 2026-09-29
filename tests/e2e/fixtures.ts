import { type BrowserContext, test as base, chromium } from '@playwright/test';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXT = path.resolve('.output/chrome-mv3');

/**
 * The extension's ID, fixed by the public key in its manifest (see wxt.config.ts): read from the build instead of
 * waiting for its service worker to start, which a loaded machine can delay past the test's setup time.
 */
function extensionId(): string {
  const { key } = JSON.parse(readFileSync(path.join(EXT, 'manifest.json'), 'utf8')) as { key: string };
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((d) => String.fromCharCode(97 + parseInt(d, 16))).join('');
}

/** Port of the local HTTPS server standing in for the carrier's PDF host (labels.example): one per test worker. */
export const LABEL_PORT = 47443 + Number(process.env.TEST_WORKER_INDEX ?? 0);

/** Test fixture only: the fake carrier's self-signed certificate, made once, and its SPKI pin. */
const LABEL_CERT = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'era-labels-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=labels.example', '-addext', 'subjectAltName=DNS:labels.example', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`], { stdio: 'ignore' });
  const spki = execSync(`openssl x509 -pubkey -noout -in ${dir}/c.pem | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).toString().trim();
  return { key: readFileSync(`${dir}/k.pem`), cert: readFileSync(`${dir}/c.pem`), spki };
})();

/**
 * Test fixture only: a fake carrier serving PDF labels over HTTPS, because Chrome's download manager is not
 * routed by Playwright. Returns a closer.
 */
export async function fakeLabelServer(): Promise<() => Promise<void>> {
  const server = createServer({ key: LABEL_CERT.key, cert: LABEL_CERT.cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end('%PDF-1.4\n%fake label\n%%EOF\n');
  });
  await new Promise<void>((resolve) => server.listen(LABEL_PORT, '127.0.0.1', resolve));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

export const test = base.extend<{ context: BrowserContext; extId: string; base: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      // Everything the tests need is local (routed pages, fake carrier): no outbound proxy for the test browser.
      env: Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !/proxy/i.test(k) && v !== undefined)) as Record<string, string>,
      viewport: { width: 1440, height: 900 },
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        // Test browser only: files the browser itself downloads (shipping labels) come from a local fake carrier.
        // Vinted, its images and the map tiles resolve nowhere: a request the tests' fakes did not catch fails at
        // once instead of reaching the real site.
        `--host-resolver-rules=MAP labels.example:443 127.0.0.1:${LABEL_PORT}, MAP www.vinted.fr 127.0.0.1:1, MAP images1.vinted.net 127.0.0.1:1, MAP tile.openstreetmap.org 127.0.0.1:1`,
        // Trust only the fake carrier's own self-signed certificate (a blanket flag would change page behaviour).
        `--ignore-certificate-errors-spki-list=${LABEL_CERT.spki}`,
      ],
    });
    await use(context);
    await context.close();
  },
  // Depends on the context so the browser (and the extension) is up before the ID is used.
  extId: async ({ context: _context }, use) => use(extensionId()),
  base: async ({ extId }, use) => use(`chrome-extension://${extId}/dashboard.html`),
});

export const expect = test.expect;

export async function loadDemo(page: import('@playwright/test').Page, base: string) {
  await page.goto(`${base}#/onboarding`);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Explorer la démo/ }).click();
  // Onboarding advances to step 3 only once the demo is fully loaded.
  await expect(page.getByRole('heading', { name: 'Renseignez vos coûts' })).toBeVisible({ timeout: 15_000 });
}
