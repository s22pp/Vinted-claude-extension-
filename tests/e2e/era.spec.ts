import { readFileSync } from 'node:fs';
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

test('records: best sale, best month, steps crossed with their date, the next step', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/sales?period=all`);
  const card = page.getByTestId('records');
  await expect(card).toContainText('Meilleure vente');
  await expect(card).toContainText('Meilleur mois');
  await expect(card.getByText(/^1re vente · /)).toBeVisible();
  await expect(card).toContainText(/Prochain palier : \d+ ventes \(encore \d+\)/);
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
  // What the goal takes every month, against today.
  const plan = page.getByTestId('goal-plan');
  await expect(plan).toContainText('Pour tenir 2 000 € chaque mois');
  await expect(plan.locator('tr', { hasText: 'Ventes par mois' }).locator('td.num')).toHaveCount(2);
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

test('tools: the forbidden-words shield flags another brand; the photo check reads a picture and gives a verdict', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/tools`);
  await page.getByRole('button', { name: /Bouclier mots interdits/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#shield-text').fill('Veste style Carhartt, taille M, très bon état');
  await dialog.locator('#shield-brand').fill('Marlboro');
  await expect(dialog).toContainText('une autre marque dans l’annonce');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // A picture made here for the test (never a retouched one): the check reads its pixels and gives a verdict.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 400;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 300, 400);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByRole('button', { name: /Contrôle photo/ }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'veste.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('dialog').getByText(/^(Bonne|À améliorer|À refaire)$/)).toBeVisible({ timeout: 15_000 });
});

test('dispute file: from an order to ship, what ERA recorded on the sale, printable; an unknown sale said so', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/sales?ship=1`);
  const card = page.getByTestId('to-ship');
  await card.getByRole('button', { name: 'Dossier d’envoi' }).first().click();
  await expect(page).toHaveURL(/#\/dossier\//);
  await expect(page.getByText('Ce qu’ERA a enregistré sur cette vente — à joindre en cas de litige.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imprimer / PDF' })).toBeVisible();
  await page.goto(`${base}#/dossier/nope`);
  await expect(page.getByText('Vente introuvable.')).toBeVisible();
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

test('motion: "Réduites" in Réglages stops the movement at once, kept after a reload, back to the system on demand', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/settings`);
  await page.getByRole('group', { name: 'Animations' }).getByRole('button', { name: 'Réduites' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.reload();
  await page.goto(`${base}#/today`);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  // Entrances end at once: the page and the priorities are not moving.
  await page.locator('.prio__item').first().waitFor();
  const durations = await page.evaluate(() => ['.page', '.prio'].map((s) => getComputedStyle(document.querySelector(s)!).animationDuration));
  for (const d of durations) expect(parseFloat(d)).toBeLessThanOrEqual(0.001);
  // Nor a stagger: the chart bars, delayed by their rank otherwise, all show at once.
  await page.locator('.chart-bar').nth(2).waitFor();
  expect(await page.locator('.chart-bar').nth(2).evaluate((el) => getComputedStyle(el).animationDelay)).toBe('0s');
  await page.goto(`${base}#/settings`);
  await page.getByRole('group', { name: 'Animations' }).getByRole('button', { name: 'Comme le système' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'reduced');
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

test('backup: a full copy downloaded, then restored after confirmation', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/settings`);
  const card = page.getByTestId('backup');
  await expect(card).toContainText('Aucune sauvegarde');
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Télécharger une sauvegarde' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^era-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  await expect(card).toContainText('Dernière sauvegarde');
  await card.getByLabel('Restaurer…').setInputFiles(file!);
  await expect(page.getByRole('dialog')).toContainText('articles');
  await page.getByRole('button', { name: 'Remplacer par cette sauvegarde' }).click();
  await expect(page.getByText('Sauvegarde restaurée')).toBeVisible();
});

test('command palette: Ctrl+K, a few letters, Enter — an article, a screen or an action', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/today`);
  await page.keyboard.press('Control+k');
  const list = page.getByTestId('palette');
  await expect(list).toBeVisible();
  await expect(page.getByRole('dialog').locator('input')).toBeFocused();
  await page.keyboard.type('carhartt');
  await expect(list.getByRole('option').first()).toContainText(/Carhartt/i);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/item\//);
  await page.keyboard.press('Control+k');
  await expect(list).toBeVisible();
  await expect(page.getByRole('dialog').locator('input')).toBeFocused();
  await page.keyboard.type('ajouter un lot');
  await expect(page.getByRole('dialog').locator('input')).toHaveValue('ajouter un lot');
  await expect(list.getByRole('option').first()).toContainText('Ajouter un lot');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/stock\?lot=1/);
  await expect(page.getByLabel('Articles (une ligne chacun)')).toBeVisible();
});

test('profit per hour: a figure from your sales, your time estimates editable', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/insights?tab=you`);
  const card = page.getByTestId('hourly');
  await expect(card).toContainText('de bénéfice par heure');
  const before = await card.locator('.t-h2').innerText();
  await card.getByLabel('Sourcing par article').fill('90');
  await expect(card.locator('.t-h2')).not.toHaveText(before);
});

test('expenses: an expense of the year comes off the margin, with its line and a CSV', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/accounting`);
  const card = page.getByTestId('expenses');
  const net = card.getByTestId('net-profit');
  await expect(net).toBeVisible();
  const before = await net.innerText();
  await card.getByLabel('Catégorie').selectOption('BOOST');
  await card.getByLabel('Montant').fill('12,50');
  await card.getByLabel('Note').fill('vitrine 7 jours');
  await card.getByRole('button', { name: 'Ajouter' }).click();
  await expect(card.locator('tr', { hasText: 'vitrine 7 jours' })).toContainText('Boost / vitrine');
  await expect(net).not.toHaveText(before);
  await expect(card).toContainText('12,50 €');
  await card.getByRole('button', { name: 'Supprimer cette dépense' }).click();
  await expect(card.locator('tr', { hasText: 'vitrine 7 jours' })).toHaveCount(0);
  await expect(net).toHaveText(before);
});

test('plan de baisse: the step due today with its price, never below the floor, one calendar for all', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/stock?filter=markdown`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  const md = page.getByTestId('markdown');
  await expect(md.locator('tr[data-state="due"]').first()).toBeVisible();
  await expect(md).toContainText('À faire maintenant');
  // Demo listings are not on Vinted: the apply button is there, switched off.
  await expect(md.getByRole('button', { name: /^Passer à .+ sur Vinted$/ })).toBeDisabled();
  // The calendar is the seller's: one step only, then none (plan off).
  await md.getByRole('button', { name: 'Régler le calendrier' }).click();
  const ed = page.getByTestId('markdown-editor');
  await ed.getByRole('button', { name: 'Retirer l’étape' }).last().click();
  await ed.getByLabel('Jours de l’étape 1').fill('300');
  await ed.getByRole('button', { name: 'Enregistrer (1 étape)' }).click();
  await expect(md.locator('tr')).toHaveCount(1);
  await expect(md.locator('tr')).toContainText(/J\+300\s*−5 %/);
  await md.getByRole('button', { name: 'Régler le calendrier' }).click();
  await ed.getByRole('button', { name: 'Retirer l’étape' }).click();
  await ed.getByRole('button', { name: 'Désactiver le plan' }).click();
  await expect(md).toContainText('Plan de baisse désactivé.');
  await page.goto(`${base}#/stock`);
  await expect(page.getByRole('button', { name: /Baisse à faire/ })).toHaveCount(0);
});

test('description templates: written once, applied to the sheet, the standard one still a click away', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/workshop`);
  const desc = page.locator('pre.wdesc');
  await expect(desc).toBeVisible();
  const standard = await desc.innerText();
  await page.getByTestId('desc-templates').getByRole('button', { name: 'Créer mon modèle de description' }).click();
  const modal = page.getByTestId('desc-templates-modal');
  // Opened from low on a scrolled page: the dialog is entirely on screen (it used to open half off screen).
  const box = (await page.getByRole('dialog').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect((await modal.getByLabel('Texte').boundingBox())!.height).toBeGreaterThan(120);
  await modal.getByLabel('Catégorie').selectOption('');
  await modal.getByLabel('Marque').fill('');
  await modal.getByLabel('Texte').fill('Belle pièce {marque}, taille {taille}.\nMesures : {mesures}\nMa boutique : envoi le jour même.');
  await modal.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(modal.getByText('Toutes catégories · Toutes marques')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(desc).toContainText('Belle pièce');
  await expect(desc).toContainText('Ma boutique : envoi le jour même.');
  await expect(desc).toContainText(/Réf\. E[0-9A-Z]{4}$/);
  await page.getByLabel('Modèle de description').selectOption({ label: 'Description ERA standard' });
  await expect(desc).toHaveText(standard);
});

test('title words: what comparable listings write and your title lacks, added before the reference in one click', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/workshop`);
  const tw = page.getByTestId('title-words');
  await expect(tw).toContainText('Analysez le marché');
  await tw.getByRole('button', { name: 'Analyser le marché' }).click();
  await expect(tw).toContainText('Utilisés par les', { timeout: 20_000 });
  const add = tw.getByRole('button', { name: /^Ajouter « .+ » au titre$/ }).first();
  const label = (await add.getAttribute('aria-label'))!;
  const word = /« (.+) »/.exec(label)![1]!;
  await add.click();
  await expect(page.locator('.wcopy__text')).toContainText(new RegExp(`${word} · E[0-9A-Z]{4}$`));
  await expect(tw.getByRole('button', { name: label })).toHaveCount(0);
});

test('a screen that fails stays contained: it says so, the menu and the other screens keep working, the report keeps it', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  // Test only: a reply template stored with a wrong type makes the item page's reply card fail to render.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('era-intelligence');
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key: 'replyTemplates', value: { MEASURES: 123 } });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.goto(`${base}#/stock?filter=listed`);
  await page.reload();
  await page.locator('tbody tr[aria-rowindex]').first().click();
  const boundary = page.getByTestId('error-boundary');
  await expect(boundary).toContainText('Cet écran a rencontré une erreur');
  await expect(page.locator('.sidebar')).toBeVisible();
  await boundary.getByRole('button', { name: 'Aller à Aujourd’hui' }).click();
  await expect(page.getByTestId('error-boundary')).toHaveCount(0);
  await expect(page.getByTestId('daily-run')).toBeVisible();
  // Kept in this browser for the diagnostic report.
  await page.goto(`${base}#/settings`);
  await expect(page.getByRole('button', { name: 'Copier le rapport' })).toBeVisible();
});

test('pilotage: the last 30 days against the 30 before, a year month by month, exported as CSV', async ({ context, base }) => {
  const page = await context.newPage();
  await loadDemo(page, base);
  await page.goto(`${base}#/insights`);
  const review = page.getByTestId('business-review');
  await expect(review).toBeVisible();
  await expect(review).toContainText('Chiffre d’affaires · 30 j');
  await expect(review).toContainText(/vs .* les 30 j d’avant|pareil que les 30 j d’avant/);
  // Up to twelve months (none before the first activity), the current one marked as running, one row per indicator.
  const cols = await review.locator('.review-table thead th').count();
  expect(cols).toBeGreaterThanOrEqual(4);
  expect(cols).toBeLessThanOrEqual(13);
  await expect(review.locator('.review-table thead')).toContainText('(en cours)');
  await expect(review.locator('.review-table tbody tr')).toHaveCount(8);
  const [download] = await Promise.all([page.waitForEvent('download'), review.getByRole('button', { name: 'Exporter (CSV)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^era-pilotage-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text.split('\r\n').filter(Boolean)).toHaveLength(13);
  expect(text).toContain('Mois;Ventes;Chiffre d’affaires (€)');
  // A monthly goal turns into buying: articles a week, a weekly budget, the capital it ties up, niches to buy first.
  await review.getByLabel('Montant de l’objectif').fill('2000');
  await review.getByRole('button', { name: 'Enregistrer' }).click();
  const plan = page.getByTestId('buying-plan');
  await expect(plan).toContainText('Plan d’achat pour 2 000');
  await expect(plan).toContainText('Articles à acheter par semaine');
  await expect(plan).toContainText('Budget d’achat par semaine');
  await expect(plan).toContainText(/max .* sur Vinted/);
  // The month's report: one printable page, the demo said as such; the month before is a closed month.
  await review.getByRole('button', { name: 'Rapport du mois' }).click();
  const report = page.getByTestId('report');
  await expect(report).toContainText('Rapport d’activité');
  await expect(report).toContainText('DONNÉES DE DÉMONSTRATION');
  await expect(report).toContainText('Mois en cours');
  await expect(report).toContainText('Le mois en chiffres');
  await expect(report).toContainText('Meilleures ventes');
  await expect(report).toContainText('Objectif mensuel');
  await page.getByRole('button', { name: /Mois précédent/ }).click();
  await expect(report).toContainText('Mois clos');
  await expect(page.getByRole('button', { name: /Mois suivant/ })).toBeVisible();
});

test('every screen, every tab: no display error, no script error, no console error', async ({ context, base, extId }) => {
  test.setTimeout(180_000);
  // Test fixture only: the map's tiles, served locally (a 1×1 PNG) — the test browser does not reach the internet.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await context.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${page.url()} · ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console ${page.url()} · ${m.text()}`);
  });
  await loadDemo(page, base);
  const routes = [
    'today', 'stock', 'stock?filter=listed', 'stock?lot=1', 'stock?costs=1', 'workshop', 'capital', 'quality',
    'sales', 'sales?ship=1', 'parcels', 'accounting', 'market', 'buy', 'buy?tab=list', 'buy?tab=scan',
    'insights?tab=review', 'insights?tab=patterns', 'insights?tab=you', 'insights?tab=precision', 'insights?tab=niches',
    'report', 'tools', 'automations', 'settings',
  ];
  for (const r of routes) {
    await page.goto(`${base}#/${r}`);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('error-boundary'), r).toHaveCount(0);
  }
  // An article, its dispute file and invoice: opened from the data itself.
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').first().click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('error-boundary'), 'item').toHaveCount(0);
  // The toolbar popup and the side panel.
  for (const p of ['popup.html', 'sidepanel.html']) {
    await page.goto(`chrome-extension://${extId}/${p}`);
    await page.waitForTimeout(700);
    await expect(page.getByTestId('error-boundary'), p).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
