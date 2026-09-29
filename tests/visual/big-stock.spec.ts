import { existsSync } from 'node:fs';
import { loadDemo, test } from '../e2e/fixtures';

// The Stock table on a very large synthetic account (test data, flagged demo — `npm run perf -- big-backup` writes
// it): restored through Réglages, then timed as a seller would use it. Median of RUNS for each figure (ms).
const FILE = process.env.BIG_BACKUP ?? '.output/big-backup.json';
const RUNS = Number(process.env.RUNS ?? 3);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const T0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)} s] ${s}`);

test('stock table, large account', async ({ context, base }) => {
  test.skip(!existsSync(FILE), `${FILE} missing: run npm run perf -- big-backup first`);
  test.setTimeout(600_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}#/settings`);
  const card = page.getByTestId('backup');
  await card.getByLabel('Restaurer…').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Remplacer par cette sauvegarde' }).click();
  step('restore asked');
  await page.getByText('Sauvegarde restaurée').waitFor({ timeout: 120_000 });
  step('restored');

  const r: Record<string, number[]> = { todayOpen: [], stockOpen: [], sort: [], search: [], scrollWorstFrame: [], scrollLongFrames: [] };
  for (let i = 0; i < RUNS; i++) {
    // By hash, in the page: a goto to the URL already open (after the restore) would wait for a load that never comes.
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.locator('[data-testid="backup"]').waitFor();
    await page.waitForTimeout(500);
    let t0 = Date.now();
    await page.locator('.sidebar a[href="#/today"]').first().click();
    await page.waitForFunction(() => /\d/.test(document.querySelector('.cockpit__hero')?.textContent ?? ''), null, { timeout: 60_000 });
    r.todayOpen!.push(Date.now() - t0);
    step(`today ${r.todayOpen!.at(-1)}`);

    t0 = Date.now();
    await page.locator('.sidebar a[href="#/stock"]').first().click();
    await page.locator('tbody tr[aria-rowindex]').first().waitFor({ timeout: 60_000 });
    r.stockOpen!.push(Date.now() - t0);
    step(`stock ${r.stockOpen!.at(-1)}`);
    await page.waitForTimeout(400);

    // Sort by price: until the first row is another article.
    const first = () => page.locator('tbody tr[aria-rowindex]').first().innerText();
    const before = await first();
    t0 = Date.now();
    await page.locator('th').filter({ hasText: /^Prix/ }).locator('button').click();
    await page.waitForFunction((b) => document.querySelector('tbody tr[aria-rowindex]')?.textContent !== b, before.replace(/\n/g, '').replace(/\t/g, ''));
    r.sort!.push(Date.now() - t0);
    step(`sort ${r.sort!.at(-1)}`);

    // Search: until every visible row matches.
    t0 = Date.now();
    await page.getByPlaceholder('Rechercher un article, une marque…').fill('Ralph');
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('tbody tr[aria-rowindex]')];
      return rows.length > 0 && rows.every((x) => /Ralph/i.test(x.textContent ?? ''));
    });
    r.search!.push(Date.now() - t0);
    step(`search ${r.search!.at(-1)}`);
    await page.getByPlaceholder('Rechercher un article, une marque…').fill('');
    await page.waitForTimeout(400);

    // Scroll the whole table, 60 px per frame: the worst gap between two frames and the frames over 50 ms.
    const s = await page.evaluate(async () => {
      const wrap = document.querySelector<HTMLElement>('.table-wrap')!;
      wrap.scrollTop = 0;
      let prev = performance.now();
      let worst = 0;
      let long = 0;
      for (let k = 0; k < 240 && wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight - 1; k++) {
        wrap.scrollTop += 60;
        await new Promise((res) => requestAnimationFrame(res));
        const now = performance.now();
        const gap = now - prev;
        worst = Math.max(worst, gap);
        if (gap > 50) long++;
        prev = now;
      }
      return { worst: Math.round(worst), long };
    });
    r.scrollWorstFrame!.push(s.worst);
    r.scrollLongFrames!.push(s.long);
  }
  const rows = await page.evaluate(() => document.querySelector('tbody tr[aria-rowindex]')?.getAttribute('aria-rowindex'));
  console.log(JSON.stringify({ firstRowIndex: rows, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { median: median(v), runs: v }])) }));
});
