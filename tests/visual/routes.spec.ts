import { loadDemo, test } from '../e2e/fixtures';

// Full-page captures of any screens (demo data): pictures to look at, not assertions.
// ROUTES=sales,insights WIDTHS=1440,390 THEMES=dark,light SHOTS=dir
const OUT = process.env.SHOTS ?? '.output/screens';
const ROUTES = (process.env.ROUTES ?? 'sales,insights,workshop,market,capital,settings').split(',');
const WIDTHS = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'dark,light').split(',') as ('dark' | 'light')[];

test('route captures', async ({ context, base }) => {
  test.setTimeout(900_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  for (const p of context.pages()) if (p !== page) await p.close();
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
      for (const r of ROUTES) {
        await page.evaluate((h) => (location.hash = h), `#/${r}`);
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/${r.replace(/[?=&/]/g, '_')}-${theme}-${w}.png`, fullPage: true });
      }
    }
  }
});
