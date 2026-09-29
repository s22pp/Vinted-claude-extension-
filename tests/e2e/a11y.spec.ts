import AxeBuilder from '@axe-core/playwright';
import { expect, loadDemo, test } from './fixtures';

const SCREENS = ['today', 'stock', 'workshop', 'sales', 'parcels', 'accounting', 'buy', 'market', 'insights', 'report', 'settings', 'quality', 'tools', 'automations'];

test('accessibility: no serious or critical WCAG A/AA violation on the main screens', async ({ context, base }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  const found: string[] = [];
  const scan = async (where: string) => {
    await page.waitForTimeout(700);
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
  // Light theme too: its colours are different, so is their contrast.
  for (const s of ['today', 'stock', 'workshop', 'sales', 'accounting', 'settings']) {
    await page.goto(`${base}#/${s}`);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await scan(`${s} (clair)`);
  }
  if (found.length) console.log(found.join('\n'));
  expect(found).toEqual([]);
});
