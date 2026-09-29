import { writeFileSync } from 'node:fs';
import { loadDemo, test } from '../e2e/fixtures';

// Opening and navigation times on the built extension (demo data), median of RUNS: numbers to compare before/after,
// measured the same way each time. Wall-clock from the action to the first useful content on screen.
const RUNS = Number(process.env.RUNS ?? 5);
const OUT = process.env.TIMING_OUT ?? '.output/timing.json';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test('timings', async ({ context, base, extId }) => {
  test.setTimeout(600_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  const r: Record<string, number[]> = { dashboardOpen: [], toStock: [], toBuy: [], toInsights: [], toItem: [], popupOpen: [] };
  for (let i = 0; i < RUNS; i++) {
    // Dashboard, from a fresh tab to Today's figures. Only that tab open, in front: a background tab's frames are
    // throttled by the browser, which would time the throttling, not ERA.
    for (const p of context.pages()) if (p !== page) await p.close();
    const tab = await context.newPage();
    await tab.bringToFront();
    let t0 = Date.now();
    await tab.goto(`${base}#/today`);
    await tab.locator('.cockpit__hero').first().waitFor();
    await tab.waitForFunction(() => /\d/.test(document.querySelector('.cockpit__hero')?.textContent ?? ''));
    r.dashboardOpen!.push(Date.now() - t0);
    // Screen to screen through the menu.
    for (const [key, name, ready] of [
      ['toStock', 'Stock', 'tbody tr[aria-rowindex]'],
      ['toBuy', 'Buy', '#b-brand'],
      ['toInsights', 'Insights', '[data-testid="business-review"]'],
    ] as const) {
      t0 = Date.now();
      await tab.locator('.sidebar').getByRole('link', { name, exact: true }).first().click();
      await tab.locator(ready).first().waitFor();
      r[key]!.push(Date.now() - t0);
    }
    await tab.goto(`${base}#/stock?filter=listed`);
    await tab.locator('tbody tr[aria-rowindex]').first().waitFor();
    // Let the page settle first: this measures opening the article, not the Stock page's own entrance.
    await tab.waitForTimeout(400);
    t0 = Date.now();
    await tab.locator('tbody tr[aria-rowindex]').first().click();
    await tab.locator('#main a.btn[href="#/stock"]').first().waitFor();
    r.toItem!.push(Date.now() - t0);
    await tab.close();
    // The toolbar popup, to its pulse line.
    const popup = await context.newPage();
    await popup.bringToFront();
    await popup.setViewportSize({ width: 380, height: 600 });
    t0 = Date.now();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.getByTestId('pulse').waitFor();
    r.popupOpen!.push(Date.now() - t0);
    await popup.close();
  }
  const out = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { median: median(v), runs: v }]));
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.median]))));
});
