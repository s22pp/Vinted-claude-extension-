import { expect, loadDemo, test } from './fixtures';

test('first run shows onboarding, never fake data', async ({ context, base }) => {
  const page = await context.newPage();
  await page.goto(`${base}#/today`);
  await expect(page.getByRole('heading', { name: 'Bienvenue dans ERA' })).toBeVisible();
  await expect(page.getByText('DÉMO')).toHaveCount(0);
});

test('onboarding → demo → Today answers "what now?"', async ({ context, base }) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  await expect(page.getByRole('heading', { name: /Ce qui mérite/ })).toBeVisible();
  await expect(page.locator('.prio__item').first()).toBeVisible();
  await expect(page.getByText('Capital investi', { exact: true })).toBeVisible();
  // Unknown costs are surfaced as partial, never as zero.
  await expect(page.getByText(/Partiel · \d+ inconnus/).first()).toBeVisible();
  // One recommendation carries all five parts.
  const reco = page.locator('.reco').first();
  for (const k of ['Pourquoi', 'Confiance', 'Impact attendu']) await expect(reco.getByText(k)).toBeVisible();
  expect(errors).toEqual([]);
});

test('stock: search, filter and open an item with its timeline', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/stock`);
  const rows = page.locator('tbody tr[aria-rowindex]');
  await expect(rows.first()).toBeVisible();
  await page.getByRole('searchbox').fill('Carhartt');
  await expect(rows.first()).toContainText('Carhartt');
  await page.getByRole('button', { name: /Coût manquant/ }).click();
  await page.getByRole('searchbox').fill('');
  await rows.first().click();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.locator('.tl').first()).toBeVisible();
  await expect(page.getByText('Non renseigné').first()).toBeVisible();
});

test('market: filtered comparables and three strategies', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/market`);
  await page.getByRole('button', { name: 'Analyser', exact: true }).first().click();
  await expect(page.getByText('Échantillon effectif').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Vente rapide').first()).toBeVisible();
  await expect(page.getByText('Marge maximale').first()).toBeVisible();
  await page.getByRole('tab', { name: /Exclus/ }).click();
  await expect(page.getByText(/Lot \/ enfant \/ copie|Marque absente/).first()).toBeVisible();
});

test('buy analyzer explains its deal score', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/buy`);
  await page.fill('#b-brand', 'Ralph Lauren');
  await page.fill('#b-model', 'Harrington');
  await page.fill('#b-price', '22');
  await page.getByRole('button', { name: 'Analyser l’achat' }).click();
  await expect(page.getByText('Prix d’achat max conseillé')).toBeVisible({ timeout: 10_000 });
  for (const d of ['Marge', 'Demande', 'Vitesse', 'Risque', 'Rareté', 'Revente', 'Capital']) {
    await expect(page.locator('.score-bars').getByText(d, { exact: true })).toBeVisible();
  }
});

test('offer calculator answers an offer', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  const input = page.getByLabel('Offre reçue');
  await input.fill('1');
  await expect(page.getByText('Refuser', { exact: true })).toBeVisible();
});

test('theme: dark ↔ light', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: 'Clair' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('narrow viewport: bottom navigation, no horizontal scroll', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const r of ['today', 'stock', 'buy', 'insights']) {
    await page.goto(`${base}#/${r}`);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, r).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('companion reads the open vinted.fr item page (no API call)', async ({ context, extId }) => {
  let apiCalls = 0;
  await context.route('https://www.vinted.fr/**', (route) => {
    if (route.request().url().includes('/api/')) apiCalls++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<html><head><script type="application/ld+json">{"@type":"Product","name":"Veste Harrington Ralph Lauren","brand":{"name":"Ralph Lauren"},"offers":{"price":"24.00"}}</script></head><body></body></html>`,
    });
  });
  const tab = await context.newPage();
  await tab.goto('https://www.vinted.fr/items/42-veste');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await expect(panel.getByText('Veste Harrington Ralph Lauren')).toBeVisible();
  await expect(panel.getByText('Coût réel d’achat :')).toBeVisible();
  expect(apiCalls).toBe(0);
});
