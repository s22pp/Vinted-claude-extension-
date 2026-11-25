import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as budget from '@/data/adapters/vinted/budget-store';
import { HALT_COOLDOWN_MS, haltPauseMs } from '@/data/adapters/marketplace';
import { RATE_PAUSE_MS, UNLIMITED, isUnlimited } from '@/data/budget-plan';

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.useRealTimers());

describe('Direct mode (the default): no local cap', () => {
  it('no quota on calls: the 200th call still goes, and « remaining » reads unlimited', async () => {
    expect(await budget.execMode()).toBe('DIRECT');
    for (let i = 0; i < 200; i++) expect((await budget.reserve()).ok).toBe(true);
    const s = await budget.status();
    expect(s.mode).toBe('DIRECT');
    expect(isUnlimited(s.remaining)).toBe(true);
    expect(s.remaining).toBe(UNLIMITED);
  });

  it('writes: no quota, no forced wait between two of them', async () => {
    for (let i = 0; i < 30; i++) await budget.reserveWrite();
    expect(await budget.writeWait()).toBe(0);
    expect(await budget.autoWriteWait()).toBe(0);
  });

  it('a block still stops every call, then lifts by itself once its pause is over (no restart)', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 25, 10, 0) });
    await budget.report(429);
    expect((await budget.reserve()).ok).toBe(false);
    expect((await budget.status()).halted).toBe('RATE_LIMITED');
    vi.setSystemTime(Date.now() + RATE_PAUSE_MS + 1000);
    expect((await budget.status()).halted).toBeNull();
    expect((await budget.reserve()).ok).toBe(true);
  });

  it('a 429 pauses as long as Vinted asks; a 403 for hours', () => {
    expect(haltPauseMs(429, null)).toBe(RATE_PAUSE_MS);
    expect(haltPauseMs(429, 120_000)).toBe(120_000);
    expect(haltPauseMs(429, 5)).toBe(60_000);
    expect(haltPauseMs(403)).toBe(HALT_COOLDOWN_MS);
  });
});

describe('Prudent mode: the measured limits, chosen in Réglages', () => {
  beforeEach(() => budget.setExecMode('PRUDENT'));

  it('15 writes a session at most, 20 s apart', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 25, 10, 0) });
    await budget.reserveWrite();
    await expect(budget.reserveWrite()).rejects.toMatchObject({ code: 'WRITE_COOLDOWN' });
    expect(await budget.writeWait()).toBeGreaterThan(0);
  });

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

describe('where the session budget went (Prudent)', () => {
  beforeEach(() => budget.setExecMode('PRUDENT'));
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

describe('scheduled runs stop short of the reserve, call by call (Prudent)', () => {
  beforeEach(() => budget.setExecMode('PRUDENT'));
  it('21 calls left: a scheduled run gets one, then is refused at 20; the seller’s own click still goes through', async () => {
    for (let i = 0; i < 39; i++) await budget.reserve();
    expect((await budget.status()).remaining).toBe(21);
    const got = await budget.asScheduled(20, async () => [await budget.reserve('IMPORT'), await budget.reserve('IMPORT')]);
    expect(got[0]!.ok).toBe(true);
    expect(got[1]).toEqual({ ok: false, code: 'BUDGET_EXHAUSTED' });
    // Outside a scheduled run: the reserve is the seller's.
    expect((await budget.reserve('WRITE')).ok).toBe(true);
    expect((await budget.status()).remaining).toBe(19);
  });
});
