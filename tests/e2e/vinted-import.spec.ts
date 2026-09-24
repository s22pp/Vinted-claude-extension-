import type { BrowserContext } from '@playwright/test';
import { expect, test } from './fixtures';

/** Fake vinted.fr: an HTML page for the tab ERA opens, and JSON with the verified field names only. */
async function fakeVinted(context: BrowserContext, opts: { loggedIn: boolean; extra?: object[]; orders?: object[]; searchMoved?: boolean; editForm?: 'ok' | 'ambiguous'; lockPrice?: boolean }) {
  const calls: { method: string; path: string }[] = [];
  const prices: Record<string, string> = { '101': '59.0' };
  const clicked: string[] = [];
  await context.route('https://www.vinted.fr/**', (route) => {
    const url = new URL(route.request().url());
    if (/^\/items\/\d+\/edit$/.test(url.pathname) && opts.editForm) {
      const id = url.pathname.split('/')[2]!;
      // Test fixture only: a form with a price field, a delete button, a boost button and a save button.
      const second = opts.editForm === 'ambiguous' ? '<label for="p2">Prix de réserve</label><input id="p2" name="price2">' : '';
      return route.fulfill({
        contentType: 'text/html',
        body: `<html><body><form id="f">
          <label for="${opts.editForm === 'ambiguous' ? 'p1' : 'price'}">Prix</label><input id="${opts.editForm === 'ambiguous' ? 'p1' : 'price'}" value="59,00">${second}
          <button type="button" onclick="fetch('/fake/click?b=delete',{method:'POST'})">Supprimer</button>
          <button type="button" onclick="fetch('/fake/click?b=boost',{method:'POST'})">Booster</button>
          <button type="submit">Enregistrer</button></form>
          <script>document.getElementById('f').addEventListener('submit', async (e) => { e.preventDefault();
            await fetch('/fake/save?id=${id}&price=' + encodeURIComponent(document.querySelector('input').value), { method: 'POST' });
            location.href = '/items/${id}'; });</script></body></html>`,
      });
    }
    if (url.pathname === '/fake/save') {
      if (!opts.lockPrice) prices[url.searchParams.get('id')!] = url.searchParams.get('price')!.replace(',', '.');
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/fake/click') {
      clicked.push(url.searchParams.get('b')!);
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/catalog' && opts.searchMoved)
      // Test fixture only: the search page calls an endpoint ERA does not know yet.
      return route.fulfill({
        contentType: 'text/html',
        body: `<html><body>search<script>fetch('/api/v2/era-test/search?search_text=' + encodeURIComponent(${JSON.stringify(url.searchParams.get('search_text') ?? '')}) + '&page=1&per_page=24')</script></body></html>`,
      });
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><body>vinted</body></html>' });
    calls.push({ method: route.request().method(), path: url.pathname + url.search });
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/v2/users/current') return opts.loggedIn ? json({ user: { id: 177293623, login: 'era-archives' } }) : json({ code: 100 }, 401);
    if (url.pathname.startsWith('/api/v2/wardrobe/177293623/items'))
      return json({
        items: [
          { id: 101, title: 'Veste Harrington Ralph Lauren M', price: { amount: prices['101'], currency_code: 'EUR' }, view_count: 212, favourite_count: 9, brand_title: 'Ralph Lauren', size_title: 'M', status: 'Très bon état', is_draft: false, is_closed: false, is_hidden: false, photos: [{ url: null, is_main: true, high_resolution: { timestamp: 1756000000 } }] },
          { id: 102, title: "Jean Levi's 501 W32", price: '30.0', view_count: 40, favourite_count: 1, brand_title: '', is_draft: false, is_closed: false, is_hidden: false, photos: [] },
          { id: 103, title: 'Veste Carhartt Detroit M', price: { amount: '80.0' }, view_count: 300, favourite_count: 14, brand_title: 'Carhartt', is_draft: false, is_closed: true, is_hidden: false, photos: [] },
          ...(opts.extra ?? []),
        ],
        pagination: { total_entries: 3 },
      });
    if (url.pathname.startsWith('/api/v2/item_upload/items/')) return json({ item: { id: 101, price: prices['101'] } });
    if (url.pathname === '/api/v2/era-test/search')
      return json({ items: [{ id: 9, title: 'Veste Ralph Lauren', price: '50.0', brand_title: 'Ralph Lauren' }], pagination: { total_entries: 120 } });
    if (url.pathname === '/api/v2/catalog/items' && opts.searchMoved) return json({ code: 404 }, 404);
    if (url.pathname === '/api/v2/catalog/items')
      return json({ items: [{ id: 9, title: 'Veste Ralph Lauren', price: '50.0', brand_title: 'Ralph Lauren' }], pagination: { total_entries: 960 } });
    if (url.pathname === '/api/v2/my_orders')
      return json({ my_orders: [{ title: 'Veste Carhartt Detroit M', price: { amount: '75.0' }, date: '2026-09-10', status: 'Terminée' }, ...(opts.orders ?? [])] });
    return json({}, 404);
  });
  return Object.assign(calls, { clicked, prices });
}

test('one click imports stock + sales, opening vinted.fr by itself', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/onboarding`);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).click();
  await expect(page.getByRole('heading', { name: 'Renseignez vos coûts' })).toBeVisible({ timeout: 20_000 });
  await page.goto(`${base}#/stock?filter=all`);
  await expect(page.locator('tbody tr[aria-rowindex]')).toHaveCount(3);
  await expect(page.getByText('Veste Harrington Ralph Lauren M')).toBeVisible();
  // Costs are never guessed.
  await expect(page.getByText('DÉMO')).toHaveCount(0);
  await page.goto(`${base}#/sales`);
  await expect(page.getByText('Veste Carhartt Detroit M')).toBeVisible();
  // Read-only and within budget.
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  expect(calls.length).toBeLessThanOrEqual(5);
  // The tab ERA opened in the background is closed again.
  expect(context.pages().some((p) => p.url().startsWith('https://www.vinted.fr'))).toBe(false);
});

test('re-import updates instead of duplicating', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  const btn = page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first();
  await btn.click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Actualiser/ }).first().click();
  await expect(page.getByText(/0 nouveaux articles · 3 mis à jour/)).toBeVisible({ timeout: 20_000 });
});

test('not logged in: clear message, Vinted tab brought forward', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: false });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/Connectez-vous à Vinted/)).toBeVisible({ timeout: 20_000 });
  expect(context.pages().some((p) => p.url().startsWith('https://www.vinted.fr'))).toBe(true);
});

test('statuses: posted / reserved / sold are filterable, and sold items get a price in one step', async ({ context, base }) => {
  await fakeVinted(context, {
    loggedIn: true,
    extra: [
      { id: 104, title: 'Pull Lacoste L', price: '35.0', view_count: 80, favourite_count: 3, brand_title: 'Lacoste', is_draft: false, is_closed: false, is_hidden: false, is_reserved: true, photos: [] },
      { id: 105, title: 'Sweat Stone Island XL', price: '110.0', view_count: 150, favourite_count: 6, brand_title: 'Stone Island', is_draft: false, is_closed: true, is_hidden: false, photos: [] },
    ],
    // An old sale whose listing is no longer in the wardrobe.
    orders: [{ title: 'Chemise Burberry M', price: { amount: '48.0' }, date: '2026-03-02', status: 'Terminée' }],
  });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/5 nouveaux articles/)).toBeVisible({ timeout: 20_000 });

  await page.goto(`${base}#/stock`);
  await expect(page.getByRole('button', { name: /Réservés\s*1/ })).toBeVisible();
  await page.getByRole('button', { name: /Réservés/ }).click();
  await expect(page.locator('tbody tr[aria-rowindex]')).toHaveCount(1);
  await expect(page.locator('tbody tr[aria-rowindex]').first()).toContainText('Pull Lacoste L');
  await page.getByRole('button', { name: /^Vendus/ }).click();
  await expect(page.locator('tbody tr[aria-rowindex]')).toHaveCount(3);

  // The old order is a real sale even though its listing is gone.
  await page.goto(`${base}#/sales?p=all`);
  await page.getByRole('button', { name: 'Tout' }).click();
  await expect(page.getByText('Chemise Burberry M')).toBeVisible();
  // Sold on Vinted without an order → to complete, inline.
  await expect(page.getByRole('heading', { name: 'Ventes à compléter' })).toBeVisible();
  await page.getByLabel(/Prix encaissé — Sweat Stone Island XL/).fill('100');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: 'Ventes à compléter' })).toHaveCount(0);
  await expect(page.locator('tbody').getByText('Sweat Stone Island XL')).toBeVisible();
});

test('connection diagnostic pinpoints the failing link and produces a report', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  for (const s of ['Extension (service worker)', 'Onglet vinted.fr', 'Session Vinted', 'Lecture du dressing', 'Recherche de comparables'])
    await expect(page.locator('#diagnostic li').filter({ hasText: s }).getByText('✓')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#diagnostic')).toContainText('connecté · id 177293623');
  await expect(page.locator('#diagnostic')).toContainText('≥ 960');
});

test('diagnostic stops at the session when logged out', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: false });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  const session = page.locator('#diagnostic li').filter({ hasText: 'Session Vinted' });
  await expect(session.getByText('✗')).toBeVisible({ timeout: 20_000 });
  await expect(session).toContainText('NOT_LOGGED_IN · HTTP 401 · /api/v2/users/current');
  await expect(page.locator('#diagnostic li').filter({ hasText: 'Lecture du dressing' })).toHaveCount(0);
});

test('search moved (404): ERA learns the endpoint from Vinted’s own search page, then uses it', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true, searchMoved: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  const catalog = page.locator('#diagnostic li').filter({ hasText: 'Recherche de comparables' });
  await expect(catalog.getByText('✓')).toBeVisible({ timeout: 40_000 });
  await expect(catalog).toContainText('via /api/v2/era-test/search');
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  // The learned endpoint is reused directly next time (no second discovery).
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  await expect(page.locator('#diagnostic li').filter({ hasText: 'Recherche de comparables' }).getByText('✓')).toBeVisible({ timeout: 20_000 });
  expect(calls.filter((c) => c.path.startsWith('/api/v2/catalog/items')).length).toBe(1);
});

async function importThenOpen(page: import('@playwright/test').Page, base: string) {
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/nouveaux articles/)).toBeVisible({ timeout: 20_000 });
  await page.goto(`${base}#/stock?filter=listed`);
  await page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Veste Harrington' }).click();
}

test('price edit on Vinted: only the price, saved, then verified on Vinted', async ({ context, base }) => {
  const fake = await fakeVinted(context, { loggedIn: true, editForm: 'ok' });
  const page = await context.newPage();
  await importThenOpen(page, base);
  await page.getByRole('button', { name: 'Modifier le prix sur Vinted' }).click();
  await page.getByLabel('Nouveau prix').fill('49');
  await page.getByRole('button', { name: 'Appliquer sur Vinted', exact: true }).click();
  await expect(page.getByText('Prix mis à jour sur Vinted : 49 €')).toBeVisible({ timeout: 40_000 });
  expect(fake.prices['101']).toBe('49');
  expect(fake.clicked).toEqual([]); // never delete, never boost
  await expect(page.locator('header').getByText('49 €')).toBeVisible();
});

test('ambiguous form: nothing is saved on Vinted', async ({ context, base }) => {
  const fake = await fakeVinted(context, { loggedIn: true, editForm: 'ambiguous' });
  const page = await context.newPage();
  await importThenOpen(page, base);
  await page.getByRole('button', { name: 'Modifier le prix sur Vinted' }).click();
  await page.getByLabel('Nouveau prix').fill('49');
  await page.getByRole('button', { name: 'Appliquer sur Vinted', exact: true }).click();
  await expect(page.getByText('Modification annulée avant enregistrement')).toBeVisible({ timeout: 40_000 });
  expect(fake.prices['101']).toBe('59.0');
});

test('Vinted refuses the price: ERA says so instead of claiming success', async ({ context, base }) => {
  const fake = await fakeVinted(context, { loggedIn: true, editForm: 'ok', lockPrice: true });
  const page = await context.newPage();
  await importThenOpen(page, base);
  await page.getByRole('button', { name: 'Modifier le prix sur Vinted' }).click();
  await page.getByLabel('Nouveau prix').fill('49');
  await page.getByRole('button', { name: 'Appliquer sur Vinted', exact: true }).click();
  await expect(page.getByText('Vinted n’a pas pris le nouveau prix')).toBeVisible({ timeout: 40_000 });
  expect(fake.prices['101']).toBe('59.0');
});
