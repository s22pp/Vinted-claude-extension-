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
