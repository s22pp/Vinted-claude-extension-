import { loadDemo, test } from '../e2e/fixtures';

// How long each screen freezes the page when it opens: the longest gap between two frames in the 1.5 s after the
// route changes (a smooth opening never goes much above 16-33 ms). ROUTES=today,stock,…
test('frame gaps', async ({ context, base }) => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  // Other tabs (the onboarding one opened at install) would leave this one in the background, its frames throttled.
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.bringToFront();
  const routes = (process.env.ROUTES ?? 'today,stock?filter=listed,workshop,buy,insights,sales,capital,settings').split(',');
  const out: Record<string, number> = {};
  for (let pass = 0; pass < 2; pass++) {
    for (const r of routes) {
      await page.goto(`${base}#/settings`);
      await page.waitForTimeout(600);
      const gap = await page.evaluate(async (hash) => {
        location.hash = hash;
        const t0 = performance.now();
        let prev = t0;
        let worst = 0;
        while (performance.now() - t0 < 1500) {
          await new Promise((res) => requestAnimationFrame(res));
          const now = performance.now();
          worst = Math.max(worst, now - prev);
          prev = now;
        }
        return Math.round(worst);
      }, `#/${r}`);
      // Second pass: screens already loaded once (their code cached), the usual case.
      if (pass === 1) out[r] = gap;
    }
  }
  console.log(JSON.stringify(out));
});
