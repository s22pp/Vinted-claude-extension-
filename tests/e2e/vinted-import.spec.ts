import type { BrowserContext } from '@playwright/test';
import { expect, fakeLabelServer, test } from './fixtures';

/** Fake vinted.fr: an HTML page for the tab ERA opens, and JSON with the verified field names only. */
async function fakeVinted(context: BrowserContext, opts: { loggedIn: boolean; bundleFavs?: boolean; extra?: object[]; orders?: object[]; searchMoved?: boolean; sortRefused?: boolean; searchDead?: boolean; editForm?: 'ok' | 'ambiguous'; lockPrice?: boolean }) {
  const calls: { method: string; path: string; csrf: string | null; body?: string | null }[] = [];
  // Test fixture only: the wardrobe can change between two imports (listings deleted, published again).
  const state = { hide: new Set<number>(), add: [] as object[], draft: null as object | null, labelOrdered: false, hidden101: false, photos: 0, published555: false, deleted: new Set<number>() };
  const prices: Record<string, string> = { '101': '59.0' };
  const clicked: string[] = [];
  // Test fixture only: Vinted's image server (a tiny JPEG header is enough).
  await context.route('https://images1.vinted.net/**', (route) => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]) }));
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
      const fav = (subject: number) => ({ entry_type: 20, link: 'vintedfr://member?id=555', subject_id: subject, updated_at: new Date(Date.now() - 3_600_000).toISOString() });
      return json({ code: 0, notifications: opts.bundleFavs ? [fav(101), fav(102)] : [fav(101)] });
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
    // Test fixture only: Vinted's upload helpers and a draft endpoint that remembers what it was sent.
    if (url.pathname === '/api/v2/item_upload/suggestions/categories' && method === 'POST') return json({ suggested_category_id: 1812 });
    if (url.pathname === '/api/v2/item_upload/brands') return json({ brands: [{ id: 4273, title: 'Polo Ralph Lauren' }, { id: 88, title: 'Ralph Lauren' }] });
    if (url.pathname === '/api/v2/item_upload/size_groups') return json({ size_groups: [{ sizes: [{ id: 207, title: 'S' }, { id: 208, title: 'M' }] }] });
    if (url.pathname === '/api/v2/catalogs/1812/package_sizes') return json({ package_sizes: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    if (url.pathname === '/api/v2/item_upload/drafts' && method === 'POST') {
      state.draft = JSON.parse(route.request().postData() ?? '{}').draft;
      return json({ draft: { id: 555 } });
    }
    if (url.pathname === '/api/v2/item_upload/items/555') {
      const d = state.draft as { title?: string; assigned_photos?: { id: number }[] } | null;
      return json({ item: { id: 555, title: d?.title, is_draft: !state.published555, photos: (d?.assigned_photos ?? []).map((p) => ({ id: p.id, full_size_url: `https://images1.vinted.net/t/copy/${p.id}.jpeg` })) } });
    }
    // Test fixture only: a listing with no favourite, its photos, the upload route and the delete route.
    if (url.pathname === '/api/v2/photos' && method === 'POST') return json({ photo: { id: 7001 + state.photos++, url: 'https://images1.vinted.net/t/new.jpeg' } });
    if (url.pathname === '/api/v2/item_upload/items/110')
      return state.deleted.has(110)
        ? json({ code: 404 }, 404)
        : json({
            item: {
              id: 110,
              title: 'Chemise Pierre Cardin L',
              description: 'Chemise Pierre Cardin, coton, très bon état.',
              price: { amount: '25.0', currency_code: 'EUR' },
              brand_id: 5575,
              brand: 'Pierre Cardin',
              size_id: 209,
              catalog_id: 1803,
              status_id: 2,
              package_size_id: 1,
              color_ids: [9],
              favourite_count: 0,
              is_draft: false,
              photos: [{ id: 1, full_size_url: 'https://images1.vinted.net/t/110/1.jpeg' }, { id: 2, full_size_url: 'https://images1.vinted.net/t/110/2.jpeg' }],
            },
          });
    if (/^\/api\/v2\/items\/\d+\/delete$/.test(url.pathname) && method === 'POST') {
      const id = Number(url.pathname.split('/')[4]);
      state.deleted.add(id);
      state.hide.add(id);
      return json({});
    }
    // Test fixture only: an order's conversation, a label Vinted makes after it is ordered, a hide that reads back.
    if (url.pathname === '/api/v2/conversations/9200') return json({ conversation: { transaction: { id: 7200, shipment_id: 6200, shipment: { status: 1 } } } });
    if (url.pathname === '/api/v2/conversations/9201') return json({ conversation: { transaction: { id: 7201, shipment_id: 6201 } } });
    if (url.pathname === '/api/v2/shipments/6201/label_url') return json({ label_url: 'https://labels.example/6201.pdf', code: 0 });
    if (url.pathname === '/api/v2/shipments/6200/label_url') return json({ label_url: state.labelOrdered ? 'https://labels.example/6200.pdf' : null, code: 0 });
    if (url.pathname === '/api/v2/user_addresses/default_shipping_address') return json({ user_address: { id: 42 } });
    if (url.pathname === '/api/v2/transactions/7200/shipment/order' && method === 'PUT') {
      state.labelOrdered = true;
      return json({});
    }
    if (url.pathname === '/api/v2/items/101/is_hidden' && method === 'PUT') {
      state.hidden101 = JSON.parse(route.request().postData() ?? '{}').is_hidden === true;
      return json({});
    }
    if (url.pathname === '/api/v2/item_upload/items/101')
      return json({ item: { id: 101, title: 'Veste Harrington Ralph Lauren M', description: 'Veste Harrington, bon état.', photos: [{ full_size_url: 'https://images1.vinted.net/t/101/1.jpeg' }, { full_size_url: 'https://images1.vinted.net/t/101/2.jpeg' }], price: prices['101'], is_hidden: state.hidden101 } });
    // Test fixture only: the sold Carhartt's own upload data (Vinted's ids for that kind of article).
    if (url.pathname === '/api/v2/item_upload/items/103') return json({ item: { id: 103, title: 'Veste Carhartt Detroit M', catalog_id: 2551, brand_id: 362, brand: 'Carhartt', size_id: 208, status_id: 2, package_size_id: 2, price: '80.0' } });
    if (url.pathname.startsWith('/api/v2/item_upload/items/')) return json({ item: { id: 101, price: prices['101'] } });
    if (url.pathname === '/api/v2/era-test/search')
      return json({ items: [{ id: 9, title: 'Veste Ralph Lauren', price: '50.0', brand_title: 'Ralph Lauren' }], pagination: { total_entries: 120 } });
    if (url.pathname === '/api/v2/catalog/items' && (opts.searchMoved || opts.searchDead)) return json({ code: 404 }, 404);
    if (url.pathname === '/api/v2/catalog/items' && opts.sortRefused && url.searchParams.has('order')) return json({ code: 404 }, 404);
    // Test fixture only: a collaboration found under its parts, never under "uniqlo x kaws"; an unknown brand found nowhere.
    if (url.pathname === '/api/v2/catalog/items') {
      const q = (url.searchParams.get('search_text') ?? '').toLowerCase();
      if (/zorgblat/.test(q) || /uniqlo x kaws/.test(q)) return json({ items: [], pagination: { total_entries: 0 } });
      if (/kaws/.test(q))
        return json({
          items: Array.from({ length: 10 }, (_, i) => ({ id: 700 + i, title: `T-shirt Uniqlo x Kaws blanc M ${i}`, price: String(14 + i), brand_title: 'UNIQLO', size_title: 'M' })),
          pagination: { total_entries: 10 },
        });
    }
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

test('an order Vinted says needs the seller: first in Today, a checklist, then the printable label in one click', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true, extra: [{ id: 104, title: 'Sweat Nike vintage L', price: '25.0', view_count: 10, favourite_count: 2, is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-20', status: 'Envoi à préparer', item_id: 104, conversation_id: 9200, transaction_user_status: 'needs_action' }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/today`);
  await page.getByRole('button', { name: /1 commande attend une action sur Vinted/ }).click();
  await expect(page).toHaveURL(/#\/sales\?ship=1/);
  const card = page.getByTestId('to-ship');
  await expect(card).toContainText('Sweat Nike vintage L');
  await card.getByLabel('Photo de l’article avant emballage (preuve d’état)').check();
  await page.evaluate(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = (u?: string | URL) => (w.__opened.push(String(u)), null);
  });
  await card.getByRole('button', { name: 'Obtenir le bordereau' }).click();
  await expect(page.getByText('Bordereau prêt')).toBeVisible({ timeout: 40_000 });
  const put = calls.find((c) => c.method === 'PUT')!;
  expect(put.path).toBe('/api/v2/transactions/7200/shipment/order');
  expect(JSON.parse(put.body!)).toEqual({ seller_address_id: 42, drop_off_type: null, label_type: 'printable' });
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://labels.example/6200.pdf']);
});;

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
  // Messages without an offer: the seller keeps only the "vous" one they like, shown on their own listing.
  const noOffer = page.getByTestId('messages-no-offer');
  await expect(noOffer).toContainText('la veste Ralph Lauren');
  await noOffer.getByRole('checkbox').nth(0).uncheck();
  await noOffer.getByRole('checkbox').nth(1).uncheck();
  await noOffer.getByRole('checkbox').nth(3).check();

  // Simulation: reads only; the purchase cost is unknown, so no offer is planned.
  const before = calls.length;
  await page.getByRole('button', { name: 'Simuler' }).first().click();
  await expect(log).toContainText('coût d’achat inconnu', { timeout: 30_000 });
  expect(calls.slice(before).every((c) => c.method === 'GET')).toBe(true);

  // Real run on the new favourite: open the conversation, send the message — nothing else.
  await page.getByRole('button', { name: 'Lancer maintenant' }).first().click();
  const sent = 'Bonjour, merci pour votre favori ! Je reste disponible si vous avez des questions sur la veste Ralph Lauren.';
  const writes = () => calls.filter((c) => c.method !== 'GET');
  // (The simulation already logged this text: wait for the real writes.)
  await expect.poll(() => writes().length, { timeout: 60_000 }).toBe(2);
  await expect(log).toContainText(sent);
  expect(writes().map((w) => `${w.method} ${w.path}`)).toEqual(['POST /api/v2/conversations', 'POST /api/v2/conversations/9001/replies']);
  expect(JSON.parse(writes()[1]!.body!).reply.body).toBe(sent);
  expect(JSON.parse(writes()[0]!.body!)).toEqual({ initiator: 'seller_enters_notification', item_id: 101, opposite_user_id: 555 });
  expect(writes().map((w) => w.csrf)).toEqual(['t-123', 't-123']);

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

test('workshop → a Vinted DRAFT prefilled with Vinted’s own ids, read back, never published', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true, extra: [{ id: 107, title: 'Pull Ralph Lauren M', price: '0', view_count: 0, favourite_count: 0, brand_title: 'Ralph Lauren', size_title: 'M', status: 'Très bon état', is_draft: true, is_closed: false, is_hidden: false, photos: [] }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/workshop`);
  await page.locator('.wq__row', { hasText: 'Pull Ralph Lauren M' }).first().click();
  await page.getByLabel('Prix', { exact: true }).fill('35');
  await page.evaluate(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = (u?: string | URL) => (w.__opened.push(String(u)), null);
  });
  await page.getByRole('button', { name: 'Créer le brouillon sur Vinted' }).click();
  await expect(page.getByText('Brouillon créé sur Vinted')).toBeVisible({ timeout: 40_000 });
  const posted = calls.find((c) => c.method === 'POST' && c.path === '/api/v2/item_upload/drafts')!;
  const draft = JSON.parse(posted.body!).draft;
  expect(draft).toMatchObject({ catalog_id: 1812, brand_id: 88, size_id: 208, status_id: 2, package_size_id: 2, price: '35.00', currency: 'EUR', assigned_photos: [] });
  expect(draft.title).toMatch(/E[0-9A-Z]{4}$/);
  // Only a draft: nothing published, the seller opens it on Vinted to add the photos.
  expect(calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/api/v2/item_upload/suggestions/categories', '/api/v2/item_upload/drafts']);
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://www.vinted.fr/items/555/edit']);
  await expect(page.getByRole('button', { name: 'Ouvrir le brouillon Vinted' })).toBeVisible();
});

test('hide a listing on Vinted from its page: sent, read back, status follows', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await importThenOpen(page, base);
  await page.getByRole('button', { name: 'Masquer sur Vinted' }).click();
  await expect(page.getByText('Annonce masquée')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('Confirmé par Vinted.')).toBeVisible();
  const put = calls.find((c) => c.method === 'PUT')!;
  expect([put.path, JSON.parse(put.body!)]).toEqual(['/api/v2/items/101/is_hidden', { is_hidden: true }]);
  await expect(page.getByRole('button', { name: 'Réafficher sur Vinted' })).toBeVisible();
});

test('repost without loss: a draft copy with the same photos, the old listing deleted only once the copy is live', async ({ context, base }) => {
  // Two imports and two spaced writes (≥ 12 s apart), under the 12-calls-per-minute limit, as on a real account.
  test.setTimeout(300_000);
  const shirt = { id: 110, title: 'Chemise Pierre Cardin L', price: '25.0', view_count: 18, favourite_count: 0, brand_title: 'Pierre Cardin', size_title: 'L', status: 'Très bon état', is_draft: false, is_closed: false, is_hidden: false, photos: [{ url: 'https://images1.vinted.net/t/110/1.jpeg', is_main: true }] };
  const calls = await fakeVinted(context, { loggedIn: true, extra: [shirt] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  const open = async () => {
    await page.goto(`${base}#/stock?filter=all`);
    await page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Chemise Pierre Cardin L' }).click();
    await page.evaluate(() => {
      const w = window as unknown as { __opened: string[] };
      w.__opened = [];
      window.open = (u?: string | URL) => (w.__opened.push(String(u)), null);
    });
  };
  await open();
  await page.getByRole('button', { name: 'Republier sans rien perdre' }).click();
  await page.getByRole('button', { name: 'Créer la copie en brouillon' }).click();
  await expect(page.getByText('Copie créée en brouillon')).toBeVisible({ timeout: 40_000 });
  // Same fields, Vinted's own ids, and the photos sent again — nothing published, nothing deleted.
  const draft = JSON.parse(calls.find((c) => c.method === 'POST' && c.path === '/api/v2/item_upload/drafts')!.body!).draft;
  expect(draft).toMatchObject({ title: 'Chemise Pierre Cardin L', price: '25.00', brand_id: 5575, size_id: 209, catalog_id: 1803, status_id: 2, package_size_id: 1, color_ids: [9], assigned_photos: [{ id: 7001, orientation: 0 }, { id: 7002, orientation: 0 }] });
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/v2/photos', '/api/v2/photos', '/api/v2/item_upload/drafts']);
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://www.vinted.fr/items/555/edit']);
  await expect(page.getByTestId('repost-pending')).toContainText('brouillon');

  // Not published yet: ERA refuses to delete the old listing.
  await page.getByRole('button', { name: 'Supprimer l’ancienne annonce' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer l’ancienne annonce' }).click();
  await expect(page.getByText(/pas encore publiée/)).toBeVisible({ timeout: 20_000 });
  expect(calls.some((c) => c.path.endsWith('/delete'))).toBe(false);
  await page.keyboard.press('Escape');

  // The seller publishes the copy on Vinted: the next import joins it to the SAME article.
  calls.state.published555 = true;
  calls.state.add.push({ ...shirt, id: 555, view_count: 0 });
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Actualiser/ }).first().click();
  // The per-minute limit may hold the import back for up to a minute: waited, never bypassed.
  await expect(page.getByText(/1 republication reconnue/)).toBeVisible({ timeout: 120_000 });
  await open();
  await expect(page.getByText('Chemise Pierre Cardin L').first()).toBeVisible();
  await expect(page.getByTestId('repost-pending')).toContainText('La copie est en ligne');
  await page.getByRole('button', { name: 'Supprimer l’ancienne annonce' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer l’ancienne annonce' }).click();
  await expect(page.getByText('Ancienne annonce supprimée').first()).toBeVisible({ timeout: 120_000 });
  expect(calls.filter((c) => c.path.endsWith('/delete')).map((c) => c.path)).toEqual(['/api/v2/items/110/delete']);
  await expect(page.getByTestId('repost-pending')).toHaveCount(0);
  await expect(page.getByText(/copie faite par ERA/)).toBeVisible();
  await page.goto(`${base}#/stock?filter=all`);
  await expect(page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Chemise Pierre Cardin L' })).toHaveCount(1);
});

test('repost refused when the listing has favourites: no button action, nothing sent', async ({ context, base }) => {
  const calls = await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await importThenOpen(page, base);
  await expect(page.getByRole('button', { name: 'Republier sans rien perdre' })).toBeDisabled();
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});

test('all labels at once: each order handled in turn, each PDF saved under a clear name', async ({ context, base }) => {
  test.setTimeout(180_000);
  const closeCarrier = await fakeLabelServer();
  const sold = (id: number, title: string) => ({ id, title, price: '25.0', view_count: 10, favourite_count: 2, is_draft: false, is_closed: true, is_hidden: false, photos: [] });
  const calls = await fakeVinted(context, {
    loggedIn: true,
    extra: [sold(104, 'Sweat Nike vintage L'), sold(106, 'Polo Lacoste M')],
    orders: [
      { title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-20', status: 'Envoi à préparer', item_id: 104, conversation_id: 9200, transaction_user_status: 'needs_action' },
      { title: 'Polo Lacoste M', price: { amount: '30.0' }, date: '2026-09-21', status: 'Envoi à préparer', item_id: 106, conversation_id: 9201, transaction_user_status: 'needs_action' },
    ],
  });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/5 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/sales?ship=1`);
  await page.getByRole('button', { name: 'Tous les bordereaux (2)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Récupérer et enregistrer' }).click();
  const batch = page.getByTestId('labels-batch');
  await expect(batch).toContainText('Polo Lacoste M', { timeout: 120_000 });
  // The ready label is only fetched; the other one is ordered, like Vinted's own button — nothing else is sent.
  expect(calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/api/v2/transactions/7200/shipment/order']);
  // Both PDFs really downloaded by the browser (names: see the unit test; under Playwright, Chrome renames files).
  await expect(batch.getByText('Enregistré', { exact: true })).toHaveCount(2);
  await expect(page.getByText('2 bordereaux enregistrés')).toBeVisible();
  const files = await page.evaluate(async () => {
    const c = (globalThis as unknown as { chrome: { downloads: { search: (q: object) => Promise<{ url: string; state: string; mime: string }[]> } } }).chrome;
    return (await c.downloads.search({})).map((d) => [d.url, d.state, d.mime]);
  });
  expect(files.sort()).toEqual([
    ['https://labels.example/6200.pdf', 'complete', 'application/pdf'],
    ['https://labels.example/6201.pdf', 'complete', 'application/pdf'],
  ]);
  await closeCarrier();
});

test('a label the browser cannot download is reported as not saved, never as saved', async ({ context, base }) => {
  test.setTimeout(120_000);
  // No carrier server running: Vinted gives a label URL, the download fails.
  await fakeVinted(context, { loggedIn: true, extra: [{ id: 104, title: 'Sweat Nike vintage L', price: '25.0', view_count: 10, favourite_count: 2, is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-20', status: 'Envoi à préparer', item_id: 104, conversation_id: 9201, transaction_user_status: 'needs_action' }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted|Actualiser/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/sales?ship=1`);
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByTestId('to-ship').getByRole('button', { name: 'Obtenir le bordereau' }).click();
  await expect(page.getByText(/PDF non enregistré/)).toBeVisible({ timeout: 60_000 });
});

test('relist a similar article: from a sale to a workshop sheet to a Vinted draft with the model’s own ids', async ({ context, base }) => {
  test.setTimeout(120_000);
  const calls = await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/stock?filter=all`);
  await page.locator('tbody tr[aria-rowindex]').filter({ hasText: 'Veste Carhartt Detroit M' }).click();
  await page.getByRole('button', { name: 'Remettre en vente un similaire' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Taille (étiquette)').fill('L');
  await dialog.getByLabel('Coût d’achat (chacun)').fill('20');
  await dialog.getByRole('button', { name: 'Créer la fiche' }).click();
  // Straight into the workshop sheet, the real sale price as reference.
  await expect(page).toHaveURL(/#\/workshop\/item_/);
  await expect(page.getByTestId('relist-ref')).toContainText('vendu 75');
  await expect(page.getByLabel('Prix', { exact: true })).toHaveValue(/75/);
  await page.evaluate(() => {
    window.open = () => null;
  });
  const before = calls.length;
  await page.getByRole('button', { name: 'Créer le brouillon sur Vinted' }).click();
  await expect(page.getByText('Brouillon créé sur Vinted')).toBeVisible({ timeout: 40_000 });
  // Category and brand from the sold listing itself: no category suggestion asked, no brand search.
  const after = calls.slice(before);
  expect(after.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/api/v2/item_upload/drafts']);
  expect(after.some((c) => c.path.startsWith('/api/v2/item_upload/brands'))).toBe(false);
  const draft = JSON.parse(after.find((c) => c.path === '/api/v2/item_upload/drafts')!.body!).draft;
  // A different size (L): not the model's size id; the category's sizes are asked instead (none match in the fixture).
  expect(draft).toMatchObject({ catalog_id: 2551, brand_id: 362, brand: 'Carhartt', size_id: null, price: '75.00' });
});

test('price analysis: a search that finds nothing is widened; when all find nothing, the searches are shown', async ({ context, base }) => {
  test.setTimeout(150_000);
  const tee = (id: number, title: string, brand: string) => ({ id, title, price: '35.0', view_count: 5, favourite_count: 0, brand_title: brand, size_title: 'M', status: 'Très bon état', is_draft: false, is_closed: false, is_hidden: false, photos: [] });
  const calls = await fakeVinted(context, { loggedIn: true, extra: [tee(108, 'UNIQLO x KAWS T-shirt homme blanc motif graphique bleu – Taille M – Très bon état · ✓', 'UNIQLO x KAWS'), tee(109, 'T-shirt Zorgblat graphique M', 'Zorgblat')] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/5 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  const analyze = async (title: string) => {
    await page.goto(`${base}#/stock?filter=all`);
    await page.locator('tbody tr[aria-rowindex]').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Analyser le marché' }).click();
  };
  await analyze('UNIQLO x KAWS');
  await expect(page.getByText(/Analysé/).first()).toBeVisible({ timeout: 60_000 });
  const searched = calls.filter((c) => c.path.startsWith('/api/v2/catalog/items')).map((c) => new URL(`https://x${c.path}`).searchParams.get('search_text'));
  expect(searched).toEqual(['UNIQLO x KAWS t-shirt', 'KAWS t-shirt']);
  await expect(page.getByText('Aucun comparable fiable')).toHaveCount(0);

  await analyze('Zorgblat');
  await expect(page.getByTestId('search-trace')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('search-trace')).toContainText('« Zorgblat t-shirt » → 0 annonces lues');
  await expect(page.getByTestId('search-trace').locator('li')).toHaveCount(3);
});

test('missing costs: the matching Vinted purchase in one click, the others typed one after the other', async ({ context, base }) => {
  test.setTimeout(120_000);
  await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/today`);
  await page.getByRole('button', { name: /coûts d’achat manquent/ }).click();
  const costs = page.getByTestId('costs');
  await expect(costs).toContainText('Veste Harrington Ralph Lauren M');
  // The Harrington was bought on Vinted (purchases are read right after the stock): 18 € + protection = 19,60 €.
  await expect(costs.getByText('Achat Vinted trouvé')).toBeVisible({ timeout: 30_000 });
  await expect(costs).toContainText('19,60');
  await costs.getByRole('button', { name: 'Utiliser' }).click();
  await expect(page.getByText('Coût repris de l’achat Vinted')).toBeVisible();
  // The sold Carhartt comes first among the rest: type, Enter, the next field is focused.
  const carhartt = costs.getByLabel('Coût d’achat de Veste Carhartt Detroit M');
  await carhartt.fill('25');
  await carhartt.press('Enter');
  await expect(costs.getByLabel("Coût d’achat de Jean Levi's 501 W32")).toBeFocused();
  await expect(costs.getByLabel('Coût d’achat de Veste Carhartt Detroit M')).toHaveCount(0);
});

test('dispute file: the article as described, the checks ticked with their time, the conversation — printable', async ({ context, base }) => {
  test.setTimeout(120_000);
  await fakeVinted(context, { loggedIn: true, extra: [{ id: 104, title: 'Sweat Nike vintage L', price: '25.0', view_count: 10, favourite_count: 2, brand_title: 'Nike', size_title: 'L', is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-20', status: 'Envoi à préparer', item_id: 104, conversation_id: 9200, transaction_user_status: 'needs_action' }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/sales?ship=1`);
  const card = page.getByTestId('to-ship');
  await card.getByLabel('Photo de l’article avant emballage (preuve d’état)').check();
  await card.getByRole('button', { name: 'Dossier d’envoi' }).click();
  const dossier = page.getByTestId('dossier');
  await expect(dossier).toContainText('Sweat Nike vintage L');
  await expect(dossier).toContainText('20/09/2026');
  await expect(dossier).toContainText('https://www.vinted.fr/inbox/9200');
  await expect(dossier.locator('li', { hasText: 'Photo de l’article avant emballage' })).toContainText('coché le');
  await expect(dossier.locator('li', { hasText: 'Conforme aux photos et à la description' })).toContainText('non coché');
});

test('listing quality: what holds each listing back, from what Vinted shows; descriptions read on demand', async ({ context, base }) => {
  test.setTimeout(120_000);
  await fakeVinted(context, { loggedIn: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/quality`);
  const table = page.getByTestId('quality');
  const row = table.locator('tr', { hasText: 'Veste Harrington Ralph Lauren M' });
  // One photo in the wardrobe; the description is not returned there: said, not assumed.
  await expect(row).toContainText('seulement 1 photos');
  await expect(row).toContainText('non lu : description');
  await page.getByRole('button', { name: /Lire \d+ descriptions? sur Vinted/ }).click();
  await expect(page.getByText(/annonces? lues?/).first()).toBeVisible({ timeout: 40_000 });
  await expect(row).toContainText('description très courte');
  await expect(row).toContainText('aucune mesure à plat');
  await expect(row).not.toContainText('non lu : description');
});

test('bundle offer: one member favourites two listings — one message for both, nothing else', async ({ context, base }) => {
  test.setTimeout(120_000);
  const calls = await fakeVinted(context, { loggedIn: true, bundleFavs: true });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/3 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/automations`);
  await page.getByLabel('Activer pour les nouveaux favoris').check();
  await expect(page.getByLabel('Offre groupée quand un membre met plusieurs de vos articles en favori')).toBeChecked();
  await page.getByRole('button', { name: 'Lancer maintenant' }).first().click();
  const writes = () => calls.filter((c) => c.method !== 'GET');
  await expect.poll(() => writes().length, { timeout: 60_000 }).toBe(2);
  expect(writes().map((w) => `${w.method} ${w.path}`)).toEqual(['POST /api/v2/conversations', 'POST /api/v2/conversations/9001/replies']);
  // Costs unknown: the bundle is proposed without a promised price.
  expect(JSON.parse(writes()[1]!.body!).reply.body).toBe('Hello ! J’ai vu tes favoris sur la veste Ralph Lauren et le jean Levi’s 🙂 Si tu les prends ensemble en lot, je te fais un prix : dis-moi !');
  await expect(page.getByTestId('auto-log')).toContainText('Offre groupée');
});

test('parcels to watch: a parcel sent long ago and still not delivered is flagged, with its conversation', async ({ context, base }) => {
  test.setTimeout(120_000);
  await fakeVinted(context, { loggedIn: true, extra: [{ id: 104, title: 'Sweat Nike vintage L', price: '25.0', view_count: 10, favourite_count: 2, is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-10', status: 'Colis envoyé', item_id: 104, conversation_id: 9200 }] });
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await page.goto(`${base}#/sales`);
  const card = page.getByTestId('parcels');
  await expect(card).toContainText('Sweat Nike vintage L');
  await expect(card).toContainText(/en route depuis \d+ j/);
  await expect(card).toContainText('au moins');
  // The finished Carhartt order is not flagged.
  await expect(card).not.toContainText('Carhartt');
  await page.goto(`${base}#/today`);
  await expect(page.getByTestId('daily-run')).toContainText('Colis à surveiller');
});

test('icon badge counts the orders to ship; automatic refresh is scheduled only once switched on', async ({ context, base }) => {
  test.setTimeout(120_000);
  await fakeVinted(context, { loggedIn: true, extra: [{ id: 104, title: 'Sweat Nike vintage L', price: '25.0', view_count: 10, favourite_count: 2, is_draft: false, is_closed: true, is_hidden: false, photos: [] }], orders: [{ title: 'Sweat Nike vintage L', price: { amount: '25.0' }, date: '2026-09-20', status: 'Envoi à préparer', item_id: 104, conversation_id: 9200, transaction_user_status: 'needs_action' }] });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`${base}#/settings`);
  expect(await sw.evaluate(async () => (await chrome.alarms.get('era-refresh')) ?? null)).toBeNull();
  await page.getByRole('button', { name: /Importer mon stock Vinted/ }).first().click();
  await expect(page.getByText(/4 nouveaux articles/)).toBeVisible({ timeout: 40_000 });
  await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({})), { timeout: 10_000 }).toBe('1');
  await page.getByLabel('Actualiser automatiquement').check();
  await expect.poll(() => sw.evaluate(async () => (await chrome.alarms.get('era-refresh'))?.periodInMinutes ?? null), { timeout: 10_000 }).toBe(360);
  await page.getByLabel('Actualiser automatiquement').uncheck();
  await expect.poll(() => sw.evaluate(async () => (await chrome.alarms.get('era-refresh')) ?? null), { timeout: 10_000 }).toBeNull();
});
