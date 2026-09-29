import { loadDemo, test } from '../e2e/fixtures';

const OUT = process.env.SHOTS ?? '.output/screens';

// Visual QA of the screens added lately (demo data): not assertions, pictures to look at.
test('recent screens', async ({ context, base }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  await loadDemo(page, base);

  // Item with a price step due: plan de baisse, title words.
  await page.goto(`${base}#/stock?filter=markdown`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/r1-item.png`, fullPage: true });

  // Workshop: templates modal, title words after an analysis.
  await page.goto(`${base}#/workshop`);
  await page.waitForTimeout(800);
  const tw = page.getByTestId('title-words');
  await tw.getByRole('button', { name: 'Analyser le marché' }).click().catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/r2-workshop.png`, fullPage: true });
  await page.getByTestId('desc-templates').getByRole('button').last().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/r3-templates.png` });
  await page.keyboard.press('Escape');

  // Accounting with expenses.
  await page.goto(`${base}#/accounting`);
  const card = page.getByTestId('expenses');
  for (const [cat, amount, note] of [['PACKAGING', '12,50', '50 enveloppes'], ['BOOST', '2,45', 'vitrine'], ['TRAVEL', '8', 'Emmaüs']] as const) {
    await card.getByLabel('Catégorie').selectOption(cat);
    await card.getByLabel('Montant').fill(amount);
    await card.getByLabel('Note').fill(note);
    await card.getByRole('button', { name: 'Ajouter' }).click();
  }
  await page.waitForTimeout(600);
  await card.screenshot({ path: `${OUT}/r4-expenses.png` });

  // Settings: backup card.
  await page.goto(`${base}#/settings`);
  await page.waitForTimeout(800);
  await page.getByTestId('backup').screenshot({ path: `${OUT}/r5-backup.png` });

  // Narrow screen: item and workshop.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}#/stock?filter=markdown`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/r6-item-mobile.png`, fullPage: true });
  await page.goto(`${base}#/workshop`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/r7-workshop-mobile.png`, fullPage: true });
});
