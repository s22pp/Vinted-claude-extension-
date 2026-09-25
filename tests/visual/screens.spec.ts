import { expect, loadDemo, test } from '../e2e/fixtures';

const OUT = process.env.SHOTS ?? '.output/screens';

test('visual QA screenshots', async ({ context, base }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  await page.getByLabel('Montant de l’objectif').fill('2000');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-today.png`, fullPage: true });

  await page.goto(`${base}#/stock`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/02-stock.png`, fullPage: false });

  await page.goto(`${base}#/automations`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/02a-automations.png`, fullPage: true });

  await page.goto(`${base}#/stock?focus=STAGNANT`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/03-stock-focus.png`, fullPage: false });

  await page.goto(`${base}#/workshop`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04w-workshop.png`, fullPage: true });
  await page.goto(`${base}#/sales?refunds=1`);
  await page.waitForTimeout(1500);
  await page.locator('#refunds').screenshot({ path: `${OUT}/04r-refunds.png` });

  await page.goto(`${base}#/accounting`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04a-accounting.png`, fullPage: true });
  await page.getByRole('button', { name: 'Facture', exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/04b-invoice.png`, fullPage: true });

  await page.goto(`${base}#/capital`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-capital.png`, fullPage: true });

  await page.goto(`${base}#/buy`);
  await page.waitForTimeout(600);
  await page.getByLabel('Marque').fill('Ralph Lauren');
  await page.getByLabel('Modèle', { exact: false }).first().fill('Harrington');
  await page.getByLabel('Prix d’achat', { exact: false }).first().fill('22');
  await page.getByRole('button', { name: /Analyser/ }).first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/05-buy.png`, fullPage: true });
  await page.locator('.dual').first().screenshot({ path: `${OUT}/05b-buy-dual.png` });

  // an analysed, listed item
  await page.goto(`${base}#/stock?filter=listed`);
  await page.waitForTimeout(800);
  const ids: string[] = await page.evaluate(async () => {
    const req = indexedDB.open('era-intelligence');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = db.transaction('analyses');
    const all: { inventoryItemId: string | null }[] = await new Promise((r) => {
      const q = tx.objectStore('analyses').getAll();
      q.onsuccess = () => r(q.result);
    });
    return all.filter((a) => a.inventoryItemId).map((a) => a.inventoryItemId!) as string[];
  });
  await page.goto(`${base}#/item/${ids[0]}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/06-item.png`, fullPage: true });
  await page.locator('.dual').first().screenshot({ path: `${OUT}/06b-item-dual.png` });

  await page.goto(`${base}#/insights`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/07-insights-patterns.png`, fullPage: true });
  await page.goto(`${base}#/insights?tab=you`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/08-insights-you.png`, fullPage: true });
  await page.goto(`${base}#/insights?tab=precision`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/09-insights-precision.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/09b-precision-top.png` });
  await page.goto(`${base}#/insights?tab=niches`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/10-insights-niches.png`, fullPage: true });
  await page.goto(`${base}#/settings`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/11-settings.png`, fullPage: true });
  await page.goto(`${base}#/market`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/12-market.png`, fullPage: true });

  // light theme
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.goto(`${base}#/today`);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/13-today-light.png`, fullPage: false });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  // small width
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, route] of [
    ['14-sm-today', 'today'],
    ['15-sm-buy', 'buy'],
    ['16-sm-item', `item/${ids[0]}`],
    ['17-sm-capital', 'capital'],
    ['18-sm-workshop', 'workshop'],
  ]) {
    await page.goto(`${base}#/${route}`);
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(name, 'overflow', overflow);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
  console.log('ERRORS', JSON.stringify(errors.slice(0, 20)));
  expect(true).toBe(true);
});
