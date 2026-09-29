import { loadDemo, test } from '../e2e/fixtures';

const OUT = process.env.SHOTS ?? '.output/screens';

// Visual QA of Pilotage (demo data): pictures to look at, wide and narrow, dark and light.
test('pilotage', async ({ context, base }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/insights`);
  const review = page.getByTestId('business-review');
  await review.getByLabel('Montant de l’objectif').fill('2000');
  await review.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/p1-wide.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/p2-narrow.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/p3-light.png`, fullPage: true });
});
