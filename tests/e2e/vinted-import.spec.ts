import type { BrowserContext } from '@playwright/test';
import { expect, test } from './fixtures';

/** Fake vinted.fr: an HTML page for the tab ERA opens, and JSON with the verified field names only. */
async function fakeVinted(context: BrowserContext, opts: { loggedIn: boolean; extra?: object[]; orders?: object[] }) {
  const calls: { method: string; path: string }[] = [];
  await context.route('https://www.vinted.fr/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<html><body>vinted</body></html>' });
    calls.push({ method: route.request().method(), path: url.pathname + url.search });
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/v2/users/current') return opts.loggedIn ? json({ user: { id: 177293623, login: 'era-archives' } }) : json({ code: 100 }, 401);
    if (url.pathname.startsWith('/api/v2/wardrobe/177293623/items'))
      return json({
        items: [
          { id: 101, title: 'Veste Harrington Ralph Lauren M', price: { amount: '59.0', currency_code: 'EUR' }, view_count: 212, favourite_count: 9, brand_title: 'Ralph Lauren', size_title: 'M', status: 'Très bon état', is_draft: false, is_closed: false, is_hidden: false, photos: [{ url: null, is_main: true, high_resolution: { timestamp: 1756000000 } }] },
          { id: 102, title: "Jean Levi's 501 W32", price: '30.0', view_count: 40, favourite_count: 1, brand_title: '', is_draft: false, is_closed: false, is_hidden: false, photos: [] },
          { id: 103, title: 'Veste Carhartt Detroit M', price: { amount: '80.0' }, view_count: 300, favourite_count: 14, brand_title: 'Carhartt', is_draft: false, is_closed: true, is_hidden: false, photos: [] },
          ...(opts.extra ?? []),
        ],
        pagination: { total_entries: 3 },
      });
    if (url.pathname === '/api/v2/my_orders')
      return json({ my_orders: [{ title: 'Veste Carhartt Detroit M', price: { amount: '75.0' }, date: '2026-09-10', status: 'Terminée' }, ...(opts.orders ?? [])] });
    return json({}, 404);
  });
  return calls;
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
