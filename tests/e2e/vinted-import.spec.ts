import type { BrowserContext } from '@playwright/test';
import { expect, test } from './fixtures';

/** Fake vinted.fr: an HTML page for the tab ERA opens, and JSON with the verified field names only. */
async function fakeVinted(context: BrowserContext, opts: { loggedIn: boolean; extra?: object[]; orders?: object[]; searchMoved?: boolean; sortRefused?: boolean; searchDead?: boolean; editForm?: 'ok' | 'ambiguous'; lockPrice?: boolean }) {
  const calls: { method: string; path: string; csrf: string | null; body?: string | null }[] = [];
  // Test fixture only: the wardrobe can change between two imports (listings deleted, published again).
  const state = { hide: new Set<number>(), add: [] as object[] };
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
    if (url.pathname === '/my_orders' && url.searchParams.get('order_type') === 'purchased')
      // Test fixture only: the purchases page calls an orders endpoint ERA learns by observation.
      return route.fulfill({ contentType: 'text/html', body: `<html><body>achats<script>fetch('/api/v2/my_orders?era_test=purchased&page=1&per_page=20')</script></body></html>` });
    if (url.pathname === '/api/v2/my_orders' && (url.searchParams.get('era_test') === 'purchased' || url.searchParams.get('type') === 'purchased'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ my_orders: [{ title: 'Veste Harrington Ralph Lauren taille M', price: { amount: '18.0' }, date: '2026-08-01', status: 'Terminée' }] }) });
    if (url.pathname === '/catalog' && opts.searchMoved)
      // Test fixture only: the search page calls an endpoint ERA does not know yet.
      return route.fulfill({
        contentType: 'text/html',
        body: `<html><body>search<script>fetch('/api/v2/era-test/search?search_text=' + encodeURIComponent(${JSON.stringify(url.searchParams.get('search_text') ?? '')}) + '&page=1&per_page=24')</script></body></html>`,
      });
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const method = route.request().method();
    const record = () => calls.push({ method, path: url.pathname + url.search, csrf: route.request().headers()['x-csrf-token'] ?? null, body: route.request().postData() });
    // Test fixture only: a new favourite (member 555 on item 101, an hour ago), as the notifications feed shows it.
    if (url.pathname === '/web/api/notifications/notifications') {
      record();
      return json({ code: 0, notifications: [{ entry_type: 20, link: 'vintedfr://member?id=555', subject_id: 101, updated_at: new Date(Date.now() - 3_600_000).toISOString() }] });
    }
    // Test fixture only: pages carry a CSRF token like Vinted's, which API calls must echo.
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="csrf-token" content="t-123"></head><body>vinted</body></html>' });
    record();
    // Test fixture only: conversations, messages, offers — enough to watch what the automations send.
    if (url.pathname === '/api/v2/conversations' && method === 'POST') return json({ conversation: { id: 9001 } });
    if (url.pathname === '/api/v2/conversations/9001')
      return json({ conversation: { messages: [], opposite_user: { id: 555, login: 'alice' }, transaction: { id: 7001, item_title: 'Veste Harrington Ralph Lauren M', offer_price: { amount: '59.0' } } } });
    if (/^\/api\/v2\/conversations\/\d+\/replies$/.test(url.pathname) || /^\/api\/v2\/transactions\/\d+\/offers$/.test(url.pathname) || /offer_requests\/\d+\/(accept|reject)$/.test(url.pathname)) return json({});
    if (url.pathname === '/api/v2/inbox')
      return json({ conversations: [{ id: 9100, transaction: { id: 7100, item_id: 101, item_title: 'Veste Harrington Ralph Lauren M', item_price: { amount: '59.0' }, offer: { id: 8100, status: 'pending', price: { amount: '40.0' }, user_id: 556 } } }] });
    if (url.pathname === '/api/v2/users/current') return opts.loggedIn ? json({ user: { id: 177293623, login: 'era-archives' } }) : json({ code: 100 }, 401);
    if (url.pathname.startsWith('/api/v2/wardrobe/177293623/items'))
      return json({
        items: [
          { id: 101, title: 'Veste Harrington Ralph Lauren M', price: { amount: prices['101'], currency_code: 'EUR' }, view_count: 212, favourite_count: 9, brand_title: 'Ralph Lauren', size_title: 'M', status: 'Très bon état', is_draft: false, is_closed: false, is_hidden: false, photos: [{ url: null, is_main: true, high_resolution: { timestamp: 1756000000 } }] },
          { id: 102, title: "Jean Levi's 501 W32", price: '30.0', view_count: 40, favourite_count: 1, brand_title: '', is_draft: false, is_closed: false, is_hidden: false, photos: [] },
          { id: 103, title: 'Veste Carhartt Detroit M', price: { amount: '80.0' }, view_count: 300, favourite_count: 14, brand_title: 'Carhartt', is_draft: false, is_closed: true, is_hidden: false, photos: [] },
          ...(opts.extra ?? []),
          ...state.add,
        ].filter((it) => !state.hide.has((it as { id: number }).id)),
        pagination: { total_entries: 3 },
      });
    if (url.pathname.startsWith('/api/v2/item_upload/items/')) return json({ item: { id: 101, price: prices['101'] } });
    if (url.pathname === '/api/v2/era-test/search')
      return json({ items: [{ id: 9, title: 'Veste Ralph Lauren', price: '50.0', brand_title: 'Ralph Lauren' }], pagination: { total_entries: 120 } });
    if (url.pathname === '/api/v2/catalog/items' && (opts.searchMoved || opts.searchDead)) return json({ code: 404 }, 404);
    if (url.pathname === '/api/v2/catalog/items' && opts.sortRefused && url.searchParams.has('order')) return json({ code: 404 }, 404);
    // Test fixture only: a search for a brand ERA does not know yet returns listings sold under it.
    if (url.pathname === '/api/v2/catalog/items' && /bonobo/i.test(url.searchParams.get('search_text') ?? ''))
      return json({ items: [{ id: 31, title: 'Chemise Bonobo lin', price: '18.0', brand_title: 'Bonobo', size_title: 'L' }, { id: 32, title: 'Chemise en lin Bonobo', price: '22.0', brand_title: 'Bonobo', size_title: 'L' }], pagination: { total_entries: 40 } });
    if (url.pathname === '/api/v2/catalog/items')
      return json({ items: [{ id: 9, title: 'Veste Ralph Lauren', price: '50.0', brand_title: 'Ralph Lauren' }], pagination: { total_entries: 960 } });
    if (url.pathname === '/api/v2/my_orders')
      return json({ my_orders: [{ title: 'Veste Carhartt Detroit M', price: { amount: '75.0' }, date: '2026-09-10', status: 'Terminée' }, ...(opts.orders ?? [])] });
    return json({}, 404);
  });
  return Object.assign(calls, { clicked, prices, state });
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
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /Actualiser/ }).first().click();
  await expect(page.getByText(/0 nouveaux articles · 3 mis à jour/)).toBeVisible({ timeout: 40_000 });
  // The sold order is matched to the sale it already created: still one sale, not two.
  await page.goto(`${base}#/sales`);
  await expect(page.getByText('Veste Carhartt Detroit M')).toHaveCount(1);
  // Dated by the order (10 Sept.), not by the import day, even though Vinted gave no publication date.
  const row = page.locator('tr', { hasText: 'Veste Carhartt Detroit M' });
  await expect(row).toContainText('10 sept.');
});

test('two sales under the same title stay two sales, import after import', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: true, extra: [{ id: 105, title: 'Veste Carhartt Detroit M', price: '70.0', view_count: 50, favourite_count: 3, is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Veste Carhartt Detroit M', price: { amount: '68.0' }, date: '2026-09-18', status: 'Terminée' }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /Actualiser/ }).first().click();
  await expect(page.getByText(/0 nouveaux articles · 4 mis à jour/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/sales`);
  await expect(page.getByText('Veste Carhartt Detroit M')).toHaveCount(2);
});

test('a listing deleted and published again stays ONE article, with its history; a deleted one leaves the stock', async ({ context, base }) => {
  const v = await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  // On Vinted: the Harrington is deleted then published again (new id, zero views); the Levi's is deleted.
  v.state.hide.add(101);
  v.state.hide.add(102);
  v.state.add.push({ id: 201, title: 'Veste Harrington Ralph Lauren M', price: { amount: '55.0' }, view_count: 3, favourite_count: 0, brand_title: 'Ralph Lauren', size_title: 'M', status: 'Très bon état', is_draft: false, is_closed: false, is_hidden: false, photos: [{ url: null, is_main: true, high_resolution: { timestamp: 1758700000 } }] });
  await page.getByRole('button', { name: /Actualiser/ }).first().click();
  await expect(page.getByText(/1 republication reconnue/)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/1 annonce disparue de Vinted/)).toBeVisible();
  await page.goto(`${base}#/stock?filter=all`);
  const row = page.getByText('Veste Harrington Ralph Lauren M');
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByText(/l’ancienne annonce avait 212 vues et 9 favoris/)).toBeVisible();
  await expect(page.getByTestId('repost-memory')).toContainText('Republiée 1 fois');
});

test('an order Vinted says needs the seller shows first in Today and opens Vinted orders', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: true, extra: [{ id: 104, title: 'Sweat Nike vintage L', price: '25.0', view_count: 10, favourite_count: 2, is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-20', status: 'Envoi à préparer', item_id: 104, transaction_user_status: 'needs_action' }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/today`);
  const prio = page.getByRole('button', { name: /1 commande attend une action sur Vinted/ });
  await expect(prio).toBeVisible();
  // Record the tab ERA asks for (a new tab opened from an extension page is not reliable to observe here).
  await page.evaluate(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = (u?: string | URL) => (w.__opened.push(String(u)), null);
  });
  await prio.click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://www.vinted.fr/my_orders']);
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
  // The learned endpoint is reused directly next time (no second discovery). Two catalog/items tries
  // happened once: the default form, then the plain form a production tool uses.
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  await expect(page.locator('#diagnostic li').filter({ hasText: 'Recherche de comparables' }).getByText('✓')).toBeVisible({ timeout: 20_000 });
  expect(calls.filter((c) => c.path.startsWith('/api/v2/catalog/items')).length).toBe(2);
});

test('search unreachable everywhere: the report lists every try, the journal keeps it', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: true, searchDead: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  const catalog = page.locator('#diagnostic li').filter({ hasText: 'Recherche de comparables' });
  await expect(catalog.getByText('✗')).toBeVisible({ timeout: 60_000 });
  await expect(catalog).toContainText('forme par défaut /api/v2/catalog/items → HTTP 404');
  await expect(catalog).toContainText('forme simple → HTTP 404');
  await expect(page.getByText('Journal technique (dernières erreurs Vinted)')).toBeVisible();
});

test('search refuses the sort parameter (404): the plain form works, no page discovery, CSRF echoed', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true, sortRefused: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: 'Lancer le diagnostic' }).click();
  const catalog = page.locator('#diagnostic li').filter({ hasText: 'Recherche de comparables' });
  await expect(catalog.getByText('✓')).toBeVisible({ timeout: 40_000 });
  const search = calls.filter((c) => c.path.startsWith('/api/v2/catalog/items'));
  expect(search.map((c) => c.path.includes('order='))).toEqual([true, false]);
  expect(search.every((c) => c.csrf === 't-123')).toBe(true);
  expect(calls.some((c) => c.path.includes('era-test'))).toBe(false);
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

test('purchases: real buying prices imported and linked to stock in one click', async ({ context, base }) => {
  await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/stock`);
  await expect(page.getByText('1 achat Vinted à rattacher')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Rattacher' }).first().click();
  await expect(page.getByText('correspondance sûre', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Valider la correspondance sûre' }).click();
  await expect(page.getByText('1 achat Vinted à rattacher')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Veste Harrington' }).click();
  // 18 € + 0,70 € + 5 % buyer protection = 19,60 €
  await expect(page.locator('header').getByText('19,60 €')).toBeVisible();
});

test('automations: a simulation sends nothing; a real run writes only whitelisted requests, with the page token', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/automations`);
  await page.getByLabel('Activer pour les nouveaux favoris').check();
  await page.getByLabel('Activer le tri des offres reçues').check();
  const log = page.getByTestId('auto-log');

  // Simulation: reads only; the purchase cost is unknown, so no offer is planned.
  const before = calls.length;
  await page.getByRole('button', { name: 'Simuler' }).first().click();
  await expect(log).toContainText('coût d’achat inconnu', { timeout: 30_000 });
  expect(calls.slice(before).every((c) => c.method === 'GET')).toBe(true);

  // Real run on the new favourite: open the conversation, send the message — nothing else.
  await page.getByRole('button', { name: 'Lancer maintenant' }).first().click();
  await expect(log).toContainText('Bonjour alice', { timeout: 60_000 });
  const writes = () => calls.filter((c) => c.method !== 'GET');
  expect(writes().map((w) => `${w.method} ${w.path}`)).toEqual(['POST /api/v2/conversations', 'POST /api/v2/conversations/9001/replies']);
  expect(JSON.parse(writes()[0]!.body!)).toEqual({ initiator: 'seller_enters_notification', item_id: 101, opposite_user_id: 555 });
  expect(writes().every((w) => w.csrf === 't-123')).toBe(true);

  // Offer received: 40 € on 59 € (68 %) → one counter-offer at 92 % → 55 €.
  await page.getByRole('button', { name: 'Lancer maintenant' }).nth(1).click();
  await expect(log).toContainText('contre-offre 55,00 €', { timeout: 60_000 });
  const counter = writes().slice(2);
  expect(counter.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /api/v2/transactions/7100/offers']);
  expect(JSON.parse(counter[0]!.body!)).toEqual({ offer: { price: '55.00', currency: 'EUR' } });
});

test('price analysis without a brand on Vinted: searches the title’s words, never "inconnue", and learns the brand', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true, extra: [{ id: 106, title: 'Chemise Bonobo lin L', price: '20.0', view_count: 12, favourite_count: 0, brand_title: '', is_draft: false, is_closed: false, is_hidden: false, photos: [] }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  // The Levi's has no brand field either: the title gives it.
  await page.goto(`${base}#/stock?filter=all`);
  await page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Jean Levi' }).click();
  await expect(page.getByTestId('item-facts')).toHaveText(/^Levi’s/);
  await page.goto(`${base}#/stock?filter=all`);
  await page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Chemise Bonobo' }).click();
  await expect(page.getByTestId('item-facts')).not.toContainText('Bonobo');
  await page.getByRole('button', { name: /analyse/i }).first().click();
  await expect(page.getByTestId('item-facts')).toHaveText(/^Bonobo/, { timeout: 40_000 });
  const searches = calls.filter((c) => c.path.startsWith('/api/v2/catalog/items')).map((c) => new URL(`https://x${c.path}`).searchParams.get('search_text'));
  expect(searches.length).toBeGreaterThan(0);
  expect(searches.every((q) => q && /bonobo/.test(q) && !/inconnu/i.test(q))).toBe(true);
  // Its own listing was read once on Vinted before searching (verified route).
  expect(calls.some((c) => c.path === '/api/v2/item_upload/items/106')).toBe(true);
});
