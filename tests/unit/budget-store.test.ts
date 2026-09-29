import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as budget from '@/data/adapters/vinted/budget-store';

beforeEach(() => fakeBrowser.reset());

describe('Vinted call budget, as the service worker keeps it', () => {
  it('60 calls a session at most; the 61st is refused', async () => {
    for (let i = 0; i < 60; i++) expect((await budget.reserve()).ok).toBe(true);
    expect(await budget.reserve()).toEqual({ ok: false, code: 'BUDGET_EXHAUSTED' });
    expect((await budget.status()).remaining).toBe(0);
  });

  it('a 403 or 429 stops everything, and a service worker restart does not forget it', async () => {
    expect((await budget.reserve()).ok).toBe(true);
    await budget.report(200);
    expect((await budget.status()).halted).toBeNull();
    await budget.report(429);
    const s = await budget.status();
    expect(s.halted).toBe('RATE_LIMITED');
    expect(s.haltedUntil).toBeGreaterThan(Date.now());
    // The session budget is gone (browser restarted), the block is not.
    await fakeBrowser.storage.session.clear();
    expect((await budget.status()).halted).toBe('RATE_LIMITED');
    expect((await budget.reserve()).ok).toBe(false);
  });
});

describe('where the session budget went', () => {
  it('each call counted by use, from its path; the total is still the one budget', async () => {
    await budget.reserve(budget.useOf('/api/v2/wardrobe/1/items?page=1&per_page=96'));
    await budget.reserve(budget.useOf('/api/v2/catalog/items?search_text=veste&per_page=60'));
    await budget.reserve('SEARCH');
    await budget.reserve(budget.useOf('/web/api/notifications/notifications?page=1'));
    const s = await budget.status();
    expect(s.uses).toEqual({ IMPORT: 1, SEARCH: 2, AUTO: 1 });
    expect(s.remaining).toBe(56);
  });

  it('uses read from paths and methods', () => {
    expect(budget.useOf('/api/v2/users/current')).toBe('IMPORT');
    expect(budget.useOf('/api/v2/my_orders?type=sold&page=1')).toBe('ORDERS');
    expect(budget.useOf('/api/v9/some/search?search_text=nike')).toBe('SEARCH');
    expect(budget.useOf('/catalog?search_text=nike')).toBe('SEARCH');
    expect(budget.useOf('/api/v2/conversations', 'POST')).toBe('AUTO');
    expect(budget.useOf('/api/v2/transactions/5/offer_requests/9/accept', 'PUT')).toBe('AUTO');
    expect(budget.useOf('/api/v2/item_upload/items/12')).toBe('LISTING');
    expect(budget.useOf('/api/v2/items/12/is_hidden', 'PUT')).toBe('WRITE');
    expect(budget.useOf('/api/v2/photos', 'POST')).toBe('WRITE');
    expect(budget.useOf(undefined)).toBe('OTHER');
  });
});
