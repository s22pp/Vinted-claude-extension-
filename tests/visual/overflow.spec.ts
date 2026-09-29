import { loadDemo, test } from '../e2e/fixtures';

// At a phone's width, which elements stick out past the screen's right edge (the ones that cause sideways scroll).
test('overflow at 390', async ({ context, base }) => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.setViewportSize({ width: Number(process.env.W ?? 390), height: 844 });
  for (const r of (process.env.ROUTES ?? 'today,stock,buy,insights,sales,settings').split(',')) {
    await page.goto(`${base}#/${r}`);
    await page.waitForTimeout(800);
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const doc = { scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw };
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        // Only the outermost offender: skip it when its parent already sticks out.
        const pr = el.parentElement?.getBoundingClientRect();
        if (pr && pr.right > vw + 1) continue;
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const o = getComputedStyle(a).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { clipped = true; break; }
        }
        if (clipped) continue;
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      }
      return { doc, out: out.slice(0, 12) };
    });
    console.log(r, JSON.stringify(res));
  }
});
