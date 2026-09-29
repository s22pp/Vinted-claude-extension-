import { loadDemo, test } from '../e2e/fixtures';

// Does a data refresh replay entrance animations? Each screen is left open and settled; another tab then changes the
// data (an article marked reserved, then back), and every animation that starts on the watched screen is counted.
// A screen that stays still prints 0; what is really new (the status line the toggle adds, the advice that comes back
// once the article is no longer reserved) may enter once. ROUTES=today,stock,…
test('no replay on refresh', async ({ context, base }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await page.waitForTimeout(600);
  const itemHash = new URL(page.url()).hash;
  const writer = await context.newPage();
  await writer.goto(`${base}${itemHash}`);
  const toggle = writer.getByRole('button', { name: /Marquer réservé|Annuler la réservation/ });
  await toggle.waitFor();

  const out: Record<string, { count: number; classes: string[] }> = {};
  for (const r of (process.env.ROUTES ?? `today,stock,insights,sales,${itemHash.slice(2)}`).split(',')) {
    await page.bringToFront();
    await page.goto(`${base}#/${r}`);
    await page.waitForTimeout(2500);
    // One listener for the whole run (the screens change by hash, in one document), reset for each screen.
    await page.evaluate(() => {
      const w = window as unknown as { __anims: string[]; __listening?: boolean };
      w.__anims = [];
      if (w.__listening) return;
      w.__listening = true;
      document.addEventListener('animationstart', (e) => {
        const el = e.target as Element;
        if (el.closest('.toast, .toasts')) return;
        w.__anims.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}:${e.animationName}:${el.textContent?.slice(0, 24)}`);
      });
    });
    await toggle.click();
    await page.waitForTimeout(1200);
    await toggle.click();
    await page.waitForTimeout(1500);
    const anims = await page.evaluate(() => (window as unknown as { __anims: string[] }).__anims);
    const classes = [...new Set(anims)];
    out[r] = { count: anims.length, classes: classes.slice(0, 12) };
  }
  console.log(JSON.stringify(out, null, 1));
});
