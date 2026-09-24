import { type BrowserContext, test as base, chromium } from '@playwright/test';
import path from 'node:path';

const EXT = path.resolve('.output/chrome-mv3');

/** Loads the built extension (run `npm run build` first) and exposes its dashboard URL. */
export const test = base.extend<{ context: BrowserContext; extId: string; base: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
  },
  extId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(sw.url()).host);
  },
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
