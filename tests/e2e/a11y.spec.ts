import AxeBuilder from '@axe-core/playwright';
import { expect, loadDemo, test } from './fixtures';

const SCREENS = ['today', 'stock', 'workshop', 'sales', 'parcels', 'accounting', 'buy', 'market', 'insights', 'report', 'settings', 'quality', 'tools', 'automations'];

test('accessibility: no serious or critical WCAG A/AA violation on the main screens', async ({ context, base }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  // Contrast is read on the colours as they end up: the app's reduced-motion mode (transitions at 0 ms), never a colour
  // caught mid-transition after a theme change (under load, a 120 ms fade can still be running when the scan reads it).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadDemo(page, base);
  const found: string[] = [];
  const scan = async (where: string) => {
    await page.waitForTimeout(700);
    // Colours read once they are still: transitions and entrances finished (a theme change fades the colours), at
    // most 3 s; endless animations (spinners) are left aside.
    await page.evaluate(() =>
      Promise.race([
        Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => undefined))),
        new Promise((res) => setTimeout(res, 3000)),
      ]),
    );
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.leaflet-container').analyze();
    for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
      found.push(`${where} · ${v.id} (${v.impact}) × ${v.nodes.length} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  for (const s of SCREENS) {
    await page.goto(`${base}#/${s}`);
    await scan(s);
  }
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await scan('item');
  // The printable sheets (always light): a sale's dispute file.
  await page.goto(`${base}#/sales`);
  await page.waitForTimeout(700);
  const dossier = page.getByRole('button', { name: /Dossier d’envoi/ });
  if (await dossier.count()) {
    await dossier.first().click();
    await scan('dossier');
  }
  // Light theme too: its colours are different, so is their contrast.
  // Switched with the app's own button, like a seller (saved, then applied by the app): never a theme forced under the
  // app, which would re-apply its own while the scan reads colours mid-transition.
  await page.goto(`${base}#/today`);
  await page.getByRole('button', { name: /^Thème : Sombre/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Thème : Clair' })).toBeVisible();
  for (const s of ['today', 'stock', 'workshop', 'sales', 'accounting', 'settings']) {
    await page.goto(`${base}#/${s}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await scan(`${s} (clair)`);
  }
  if (found.length) console.log(found.join('\n'));
  expect(found).toEqual([]);
});
