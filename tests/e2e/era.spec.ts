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

test('each Today priority opens exactly the items it counts', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  // Stock-backed priority (the first one may open the workshop instead).
  const first = page.locator('.prio__item', { hasText: /stagne/ }).first();
  const n = Number(await first.locator('.prio__go .num').innerText());
  await first.click();
  await expect(page).toHaveURL(/#\/stock\?focus=/);
  await expect(page.locator('.focus-banner')).toBeVisible();
  await expect(page.locator('.focus-banner')).toContainText(`${n} articles`);
  await page.getByRole('button', { name: 'Tout le stock' }).click();
  await expect(page.locator('.focus-banner')).toHaveCount(0);
  // Capital: where the money is stuck, one click from Stock.
  await page.getByRole('link', { name: 'Capital' }).first().click();
  await expect(page.getByRole('heading', { name: 'Où est mon argent' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pièges à capital' })).toBeVisible();
});

test('listing workshop: a sheet in Vinted form order, published by hand, then awaiting import', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  await page.locator('.prio__item', { hasText: /pas encore en ligne|pas en ligne/ }).first().click();
  await expect(page).toHaveURL(/#\/workshop/);
  await expect(page.getByRole('heading', { name: 'Mise en ligne' })).toBeVisible();
  const queued = await page.locator('.wq__row[href^="#/workshop/"]').count();
  expect(queued).toBeGreaterThan(0);
  // The 11 steps, in the order of the Vinted form.
  const steps = page.locator('.wstep__title');
  await expect(steps).toHaveCount(11);
  await expect(steps.first()).toHaveText('Catégorie');
  await expect(page.locator('.wcopy__text')).toContainText(/· E[0-9A-Z]{4}$/);
  await page.getByRole('button', { name: 'Publié quand même' }).click();
  await expect(page.locator('.wq__row[href^="#/workshop/"]')).toHaveCount(queued - 1);
  await expect(page.getByText('Publiés, en attente d’import')).toBeVisible();
});

test('refunds: one click per reason, rules feed the workshop', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/sales?refunds=1`);
  const card = page.locator('#refunds');
  await expect(card.getByText('Taux de remboursement')).toBeVisible();
  await expect(card.getByText('Règles actives dans l’atelier')).toBeVisible();
});

test('accounting: sales ledger, DAC7 threshold, a numbered printable invoice', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/sales`);
  await page.getByRole('link', { name: 'Comptabilité' }).click();
  await expect(page.getByRole('heading', { name: 'Seuil DAC7' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Livre des recettes' })).toBeVisible();
  await page.getByRole('button', { name: 'Facture', exact: true }).first().click();
  await expect(page.getByText('FACTURE', { exact: true })).toBeVisible();
  await expect(page.locator('.invoice__meta')).toContainText(/N° \d{4}-0001/);
  await expect(page.locator('.sidebar')).toHaveCount(0);
});

test('monthly goal and reply templates: set a goal, copy a filled reply', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  await page.getByLabel('Montant de l’objectif').fill('2000');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByText(/Au rythme actuel : ≈/)).toBeVisible();
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await expect(page.getByRole('heading', { name: 'Réponses types' })).toBeVisible();
  await expect(page.locator('.reply-text')).toContainText('Bonjour');
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
  await expect(page.getByText('Somme des sous-scores')).toBeVisible();
  await expect(page.getByText('Vitesse probable')).toBeVisible();
  // Asking prices and realised prices are shown as two separate distributions.
  await expect(page.locator('.dual').first().getByText(/Médiane demandée/)).toBeVisible();
  await expect(page.locator('.dual').first().getByText(/Médiane encaissée/)).toBeVisible();
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

test('shopping list: niches to rebuy from your own sales, with the most to pay on Vinted', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/buy?tab=list`);
  await expect(page.getByRole('tab', { name: 'Liste de courses' })).toHaveAttribute('aria-selected', 'true');
  const buy = page.getByTestId('shopping-buy');
  await expect(buy.locator('tbody tr').first()).toBeVisible();
  // Every line carries its sample and a maximum price in euros.
  await expect(buy.locator('tbody tr').first()).toContainText('€');
  await page.getByRole('tab', { name: 'Analyser un achat' }).click();
  await expect(page).toHaveURL(/#\/buy$/);
});

test('deal scanner: one click searches the best niches and lists only what fits under the maximum', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/buy?tab=scan`);
  await page.getByRole('button', { name: /Scanner \d+ niches/ }).click();
  await expect(page.getByRole('heading', { name: /affaire/ })).toBeVisible({ timeout: 60_000 });
  const rows = page.getByTestId('deals').locator('tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText('€');
  await expect(page.getByText('DÉMO').first()).toBeVisible();
});

test('a lot bought at once: one line per article, the price split to the cent, every line a sheet in the workshop', async ({ context, base }) => {
  const page = await context.newPage();
  // First run: skip the onboarding (no demo), then open the lot form.
  await page.goto(`${base}#/onboarding`);
  await page.getByRole('button', { name: 'Passer' }).click();
  // The app leaves the onboarding by itself: wait for it, or it would navigate away from the form.
  await expect(page).not.toHaveURL(/onboarding/);
  await page.goto(`${base}#/stock?lot=1`);
  await page.getByLabel('Articles (une ligne chacun)').fill('Chemise Pierre Cardin L très bon état\nPull Lacoste M\nJean Levi’s 501 W32');
  await page.getByLabel('Prix payé pour le lot').fill('20');
  const preview = page.getByTestId('lot-preview');
  await expect(preview.locator('tbody tr')).toHaveCount(3);
  await expect(preview.locator('tbody tr').first()).toContainText('Pierre Cardin');
  await expect(preview.locator('tbody tr').first()).toContainText('Très bon état');
  // No sales yet: equal parts, 6,67 + 6,67 + 6,66 = 20 €.
  await expect(page.getByText('Aucune vente comparable dans votre historique : parts égales.')).toBeVisible();
  await expect(preview).toContainText('6,67');
  await expect(preview).toContainText('6,66');
  await page.getByRole('button', { name: 'Créer 3 fiches' }).click();
  await expect(page).toHaveURL(/#\/workshop\/item_/);
  await expect(page.locator('.wq__row')).toHaveCount(3);
});

test('daily run: one task at a time with its action; skipping moves on and can be undone', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  const run = page.getByTestId('daily-run');
  await expect(run).toBeVisible();
  const item = run.getByTestId('run-item');
  const first = await item.innerText();
  const total = Number(await run.getByTestId('run-pos').getAttribute('data-n'));
  expect(total).toBeGreaterThan(1);
  await run.getByRole('button', { name: 'Passer' }).click();
  await expect(run.getByTestId('run-pos')).toHaveAttribute('data-n', String(total - 1));
  await expect(item).not.toHaveText(first);
  await page.getByRole('button', { name: 'Reprendre la tâche passée' }).click();
  await expect(item).toHaveText(first);
});
