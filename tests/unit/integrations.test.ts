import { describe, expect, it } from 'vitest';
import { type IntegrationRecords, type IntegKey, integrationStatus } from '@/data/integrations';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const base = (x: Partial<IntegrationRecords> = {}): IntegrationRecords => ({
  now: NOW,
  listings: 0,
  lastImport: null,
  importError: null,
  sold: 0,
  reserved: 0,
  wardrobeKeys: null,
  searches: [],
  searchMode: 'API',
  searchDown: null,
  errors: [],
  purchases: 0,
  purchasesError: null,
  log: [],
  ...x,
});
const row = (kind: IntegrationRecords['log'][number]['kind'], at: number, ok = true, extra: Partial<IntegrationRecords['log'][number]> = {}) => ({ kind, at, ok, dryRun: false, detail: ok ? 'ok' : 'NETWORK_403 · refusé', ...extra });
const get = (rec: IntegrationRecords, k: IntegKey) => integrationStatus(rec).find((s) => s.key === k)!;

describe('Vinted integrations: what the records on this device prove', () => {
  it('nothing done yet: reads unverified, writes untested, never a success invented', () => {
    const all = integrationStatus(base());
    expect(all.map((s) => s.key)).toEqual(['stock', 'sold', 'reserved', 'search', 'purchases', 'priceEdit', 'description', 'draft', 'label', 'hide', 'repost', 'auto']);
    expect(all.every((s) => s.state === 'UNTESTED' && s.n === 0 && s.lastOk === null)).toBe(true);
  });

  it('reads seen working: stock, sales, purchases verified with the last import date', () => {
    const r = base({ listings: 47, sold: 41, purchases: 40, lastImport: NOW - DAY });
    expect(get(r, 'stock')).toMatchObject({ state: 'VERIFIED', n: 47, lastOk: NOW - DAY });
    expect(get(r, 'sold')).toMatchObject({ state: 'VERIFIED', n: 41 });
    expect(get(r, 'purchases')).toMatchObject({ state: 'VERIFIED', n: 40 });
  });

  it('an import that failed after the last good one: failing, with what Vinted said', () => {
    const r = base({ listings: 47, lastImport: NOW - 2 * DAY, importError: { at: NOW - DAY, code: 'NOT_LOGGED_IN', detail: 'session expirée' } });
    expect(get(r, 'stock')).toMatchObject({ state: 'FAILING', lastFail: { at: NOW - DAY, detail: 'NOT_LOGGED_IN · session expirée' } });
    // Older than the last good import: history, not the current state.
    expect(get({ ...r, lastImport: NOW }, 'stock').state).toBe('VERIFIED');
  });

  it('reserved: a reserved item seen → verified; only the field → partial; no field → unavailable', () => {
    expect(get(base({ reserved: 2, lastImport: NOW }), 'reserved').state).toBe('VERIFIED');
    expect(get(base({ wardrobeKeys: ['id', 'is_closed', 'is_reserved'], lastImport: NOW }), 'reserved')).toMatchObject({ state: 'PARTIAL', note: { key: 'reservedField' } });
    expect(get(base({ wardrobeKeys: ['id', 'is_closed'] }), 'reserved')).toMatchObject({ state: 'UNAVAILABLE', note: { key: 'reservedNoField' } });
  });

  it('search: the API answers 404 and the page was never read yet → failing, the page route untested, said so', () => {
    const r = base({ searchMode: 'PAGE', errors: [{ at: NOW - DAY, code: 'UNAVAILABLE', detail: 'HTTP 404', path: '/api/v2/catalog/items' }] });
    const s = get(r, 'search');
    expect(s.state).toBe('FAILING');
    expect(s.lastFail).toEqual({ at: NOW - DAY, detail: 'UNAVAILABLE · HTTP 404' });
    expect(s.routes.map((x) => x.key)).toEqual(['PAGE']);
    expect(s.note).toEqual({ key: 'searchPageUntested' });
  });

  it('search: read on the page after the 404 → verified on its current route; the old API route kept as history', () => {
    const r = base({
      searchMode: 'PAGE',
      errors: [{ at: NOW - DAY, code: 'UNAVAILABLE', detail: 'HTTP 404', path: '/api/v2/catalog/items' }],
      searches: [
        { at: NOW - 30 * DAY, via: null },
        { at: NOW - 1000, via: 'PAGE' },
      ],
    });
    const s = get(r, 'search');
    expect(s.state).toBe('VERIFIED');
    expect(s.routes.map((x) => [x.key, x.ok])).toEqual([
      ['API', 1],
      ['PAGE', 1],
    ]);
  });

  it('search paused after a full failure: failing until the pause ends', () => {
    const r = base({ searches: [{ at: NOW - DAY, via: null }], searchDown: { at: NOW - 60_000, until: NOW + 60_000, detail: 'recherche Vinted introuvable' } });
    expect(get(r, 'search')).toMatchObject({ state: 'FAILING', note: { key: 'searchPaused' } });
    expect(get({ ...r, searchDown: { ...r.searchDown!, until: NOW - 1 } }, 'search').state).toBe('VERIFIED');
  });

  it('writes: only what Vinted accepted and showed back counts; simulations never do', () => {
    const r = base({
      log: [
        row('LABEL', NOW - 3 * DAY),
        row('LABEL', NOW - 2 * DAY),
        row('FAV_MESSAGE', NOW - DAY, true, { dryRun: true }),
        row('HIDE', NOW - DAY, true, { detail: 'envoyé ; Vinted ne dit pas l’état (non vérifié)' }),
        row('PRICE', NOW - 2 * DAY, false),
        row('PRICE', NOW - DAY),
      ],
    });
    expect(get(r, 'label')).toMatchObject({ state: 'VERIFIED', n: 2, lastOk: NOW - 2 * DAY });
    expect(get(r, 'auto')).toMatchObject({ state: 'UNTESTED', n: 0 });
    // Sent, Vinted did not show it back (an old row: said in its detail): not verified.
    const hide = get(r, 'hide');
    expect(hide.state).toBe('UNTESTED');
    expect(hide.routes.find((x) => x.key === 'HIDE')).toMatchObject({ ok: 0, unconfirmed: 1 });
    // A failure followed by a success: verified, the failure kept as history.
    expect(get(r, 'priceEdit')).toMatchObject({ state: 'VERIFIED', lastFail: { at: NOW - 2 * DAY } });
  });

  it('automations: messages seen working, offers never tried → partial, route by route', () => {
    const r = base({ log: Array.from({ length: 9 }, (_, i) => row('FAV_MESSAGE', NOW - i * DAY)) });
    const a = get(r, 'auto');
    expect(a).toMatchObject({ state: 'PARTIAL', n: 9 });
    expect(a.routes.filter((x) => x.ok > 0).map((x) => x.key)).toEqual(['FAV_MESSAGE']);
    expect(a.routes.find((x) => x.key === 'OFFER_ACCEPT')).toMatchObject({ ok: 0, lastFail: null });
  });

  it('automations: a pass Vinted stopped after the last success (blocked) is the current state', () => {
    const r = base({ log: [row('FAV_MESSAGE', NOW - DAY), { kind: 'STOP', at: NOW, ok: false, dryRun: false, detail: '0 faites · 0 ignorées · 0 échecs · arrêt : NETWORK_403' }] });
    expect(get(r, 'auto')).toMatchObject({ state: 'FAILING', lastFail: { at: NOW, detail: expect.stringContaining('NETWORK_403') } });
  });

  it('stopped by ERA’s own limit (call budget spent): said so, never shown as Vinted failing', () => {
    const r = base({
      log: [
        row('FAV_MESSAGE', NOW - DAY),
        { kind: 'STOP', at: NOW, ok: false, dryRun: false, detail: '0 faites · 0 ignorées · 0 échecs · arrêt : BUDGET_EXHAUSTED' },
        row('LABEL', NOW, false, { detail: 'BUDGET_EXHAUSTED · 60 appels par session' }),
      ],
    });
    expect(get(r, 'auto')).toMatchObject({ state: 'PARTIAL', lastFail: null, note: { key: 'ownLimit', params: { detail: expect.stringContaining('BUDGET_EXHAUSTED') } } });
    expect(get(r, 'label')).toMatchObject({ state: 'UNTESTED', lastFail: null, note: { key: 'ownLimit' } });
  });

  it('repost: the copy seen working, the old listing never deleted → partial', () => {
    const r = base({ log: [row('REPOST', NOW - DAY), row('DELETE', NOW, true, { unconfirmed: true })] });
    const s = get(r, 'repost');
    expect(s.state).toBe('PARTIAL');
    expect(s.routes.map((x) => [x.key, x.ok, x.unconfirmed])).toEqual([
      ['REPOST', 1, 0],
      ['DELETE', 0, 1],
    ]);
  });
});
