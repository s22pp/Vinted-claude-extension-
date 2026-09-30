import { type BrowserContext, test as base, chromium } from '@playwright/test';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ERA_EXT: another build to load (the source-mapped one of `npm run analyze`, to profile).
const EXT = path.resolve(process.env.ERA_EXT ?? '.output/chrome-mv3');

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

/**
 * Test fixture only: Google's Gemini API as its documentation describes it (models list, generateContent), with a key
 * made up for the tests. It proves ERA's logic around the model, not what the real model writes.
 */
export async function fakeGemini(context: BrowserContext, opts: { reply: string; badKey?: boolean }) {
  const seen: { method: string; url: string; key: string | null; body: unknown }[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-goog-api-key', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    seen.push({ method: req.method(), url: req.url(), key: (await req.headerValue('x-goog-api-key')) ?? null, body: req.postData() ? JSON.parse(req.postData()!) : null });
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (opts.badKey) return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    if (/\/v1beta\/models\?/.test(req.url()))
      return json(200, {
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    if (/:generateContent$/.test(new URL(req.url()).pathname)) return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: opts.reply }] }, finishReason: 'STOP' }] });
    return json(404, { error: { code: 404, message: 'not found' } });
  });
  return seen;
}

/** Test fixture only: a made-up key (never a real one). */
export const TEST_GEMINI_KEY = 'era-test-key-0000-wxyz';

/** Réglages → the made-up key saved and tested against the fake Gemini. */
export async function setGeminiKey(page: import('@playwright/test').Page, base: string) {
  await page.goto(`${base}#/settings`);
  const card = page.getByTestId('gemini-card');
  await card.getByLabel('Clé API Gemini').fill(TEST_GEMINI_KEY);
  await card.getByRole('button', { name: 'Enregistrer et tester' }).click();
  await expect(card).toContainText('Clé enregistrée …wxyz');
}
