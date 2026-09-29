import type { Page } from '@playwright/test';
import { loadDemo, test } from '../e2e/fixtures';

const OUT = process.env.SHOTS ?? '.output/screens';
const WIDTHS = (process.env.WIDTHS ?? '1440,1366,390').split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'dark,light').split(',') as ('dark' | 'light')[];

// Visual QA of the five priority screens (demo data): pictures to look at, not assertions.
test('priority screens', async ({ context, base, extId }) => {
  test.setTimeout(600_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  // Buy Analyzer with an answer on screen: one demo analysis each time (its result lives in the screen).
  const analyze = async (p: Page) => {
    await p.goto(`${base}#/buy`);
    await p.fill('#b-brand', 'Ralph Lauren');
    await p.fill('#b-model', 'Harrington');
    await p.fill('#b-price', '22');
    await p.getByRole('button', { name: 'Analyser l’achat' }).click();
    await p.getByText('Prix d’achat max conseillé').waitFor({ timeout: 15_000 });
  };
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await page.waitForTimeout(600);
  const itemHash = new URL(page.url()).hash;

  const shots: [string, (p: Page) => Promise<void>][] = [
    ['today', (p) => p.goto(`${base}#/today`).then(() => undefined)],
    ['stock', (p) => p.goto(`${base}#/stock`).then(() => undefined)],
    ['buy', analyze],
    ['item', (p) => p.goto(`${base}${itemHash}`).then(() => undefined)],
  ];
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
      for (const [name, open] of shots) {
        await open(page);
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/${name}-${theme}-${w}.png`, fullPage: true });
      }
    }
    // The toolbar popup, at its own size.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await popup.waitForTimeout(900);
    await popup.screenshot({ path: `${OUT}/popup-${theme}.png`, fullPage: true });
    await popup.close();
  }
});
