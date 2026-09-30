import type { AutoLogRow } from './db';
import { isUnconfirmed } from './journal';
import type { SearchOk, VintedErrorEntry } from './adapters/vinted/vinted-adapter';

/**
 * What of the Vinted integration has been seen working on THIS device, route by route, from ERA's own records:
 * the journal of writes (only what Vinted accepted AND showed back counts as verified), the import, the searches and
 * the error journal. Pure: the card reads the records, this decides what they prove. Fixture tests prove ERA's logic;
 * only these records prove the real integration.
 */

export type IntegKey = 'stock' | 'sold' | 'reserved' | 'search' | 'purchases' | 'priceEdit' | 'description' | 'draft' | 'label' | 'hide' | 'repost' | 'auto';

/**
 * VERIFIED: every route seen working here. PARTIAL: some routes only. FAILING: the last attempt failed (or the search
 * is paused). UNTESTED: never seen working here. UNAVAILABLE: Vinted does not give what this needs.
 */
export type IntegState = 'VERIFIED' | 'PARTIAL' | 'FAILING' | 'UNTESTED' | 'UNAVAILABLE';

export interface Failure {
  at: number | null;
  detail: string;
}

export interface RouteStatus {
  key: string;
  /** Accepted by Vinted and shown back. */
  ok: number;
  /** Accepted, but Vinted's read-back did not show it (not a verified route). */
  unconfirmed: number;
  lastOk: number | null;
  lastFail: Failure | null;
}

export interface IntegStatus {
  key: IntegKey;
  write: boolean;
  /** Things seen working here (listings read, sales, searches, writes shown back…). */
  n: number;
  state: IntegState;
  lastOk: number | null;
  lastFail: Failure | null;
  routes: RouteStatus[];
  /** A fact worth saying on its own line (i18n key under integrations.note + params). */
  note: { key: string; params?: Record<string, string | number> } | null;
}

export interface IntegrationRecords {
  now: number;
  listings: number;
  lastImport: number | null;
  importError: { at: number; code: string; detail?: string } | null;
  sold: number;
  reserved: number;
  /** Keys of the wardrobe items at the last import (null: never imported). */
  wardrobeKeys: string[] | null;
  /** Searches that gave comparables, and how they were read. */
  searches: { at: number; via: 'PAGE' | 'LEARNED' | null }[];
  /** Every search that brought listings, by route, as the adapter records it (from 0.31.2; `searches` holds the older). */
  searchOk?: SearchOk;
  searchMode: 'API' | 'LEARNED' | 'PAGE';
  /** The search paused after a full failure: since `at`, until `until`. */
  searchDown: { at: number; until: number; detail: string } | null;
  errors: VintedErrorEntry[];
  purchases: number;
  purchasesError: string | null;
  log: (Pick<AutoLogRow, 'at' | 'kind' | 'ok' | 'dryRun' | 'detail' | 'unconfirmed'> & { target?: string })[];
}

/** The routes behind each write, as the journal names them. */
export const WRITE_ROUTES: Partial<Record<IntegKey, AutoLogRow['kind'][]>> = {
  priceEdit: ['PRICE'],
  description: ['DESCRIPTION'],
  draft: ['DRAFT'],
  label: ['LABEL'],
  hide: ['HIDE', 'UNHIDE'],
  repost: ['REPOST', 'DELETE'],
  auto: ['FAV_MESSAGE', 'FAV_BUNDLE', 'FAV_OFFER', 'OFFER_ACCEPT', 'OFFER_REJECT', 'OFFER_COUNTER'],
};

const ORDER: IntegKey[] = ['stock', 'sold', 'reserved', 'search', 'purchases', 'priceEdit', 'description', 'draft', 'label', 'hide', 'repost', 'auto'];

/** Stops journaled by the other schedules (a skipped refresh, skipped buy alerts): not the automations'. */
const NOT_AUTOMATIONS = new Set(['Actualisation automatique', 'Alertes d’achat']);

/** ERA's own limits (call budget, write spacing, daily cap, one operation at a time): a stop, not Vinted failing. */
const OWN_LIMIT = /BUDGET_EXHAUSTED|WRITE_COOLDOWN|plafond du jour|opération Vinted est en cours/;

/** Rows written before 0.31.1 carry no `unconfirmed`: their detail said it. */

const latest = (xs: (Failure | null)[]): Failure | null =>
  xs.filter((x): x is Failure => x !== null).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;

/** The last attempt failed: a failure newer than the last success (a dateless failure only counts with no success). */
const failing = (lastOk: number | null, lastFail: Failure | null) => !!lastFail && (lastOk === null || (lastFail.at !== null && lastFail.at > lastOk));

function route(key: string, rows: IntegrationRecords['log']): RouteStatus {
  const mine = rows.filter((r) => r.kind === key && !r.dryRun);
  const ok = mine.filter((r) => r.ok && !isUnconfirmed(r));
  const fail = mine.filter((r) => !r.ok && !OWN_LIMIT.test(r.detail)).sort((a, b) => b.at - a.at)[0];
  return {
    key,
    ok: ok.length,
    unconfirmed: mine.filter((r) => r.ok && isUnconfirmed(r)).length,
    lastOk: ok.length ? Math.max(...ok.map((r) => r.at)) : null,
    lastFail: fail ? { at: fail.at, detail: fail.detail } : null,
  };
}

function fromRoutes(key: IntegKey, routes: RouteStatus[], extraFail: Failure | null = null): IntegStatus {
  const oks = routes.map((r) => r.lastOk).filter((x): x is number => x !== null);
  const lastOk = oks.length ? Math.max(...oks) : null;
  const lastFail = latest([...routes.map((r) => r.lastFail), extraFail]);
  const verified = routes.filter((r) => r.ok > 0).length;
  const state: IntegState = failing(lastOk, lastFail) ? 'FAILING' : verified === 0 ? 'UNTESTED' : verified === routes.length ? 'VERIFIED' : 'PARTIAL';
  return { key, write: true, n: routes.reduce((s, r) => s + r.ok, 0), state, lastOk, lastFail, routes, note: null };
}

function read(key: IntegKey, n: number, lastOk: number | null, lastFail: Failure | null, note: IntegStatus['note'] = null): IntegStatus {
  const state: IntegState = failing(n > 0 ? lastOk : null, lastFail) ? 'FAILING' : n > 0 ? 'VERIFIED' : 'UNTESTED';
  return { key, write: false, n, state, lastOk: n > 0 ? lastOk : null, lastFail, routes: [], note };
}

export function integrationStatus(rec: IntegrationRecords): IntegStatus[] {
  const out = new Map<IntegKey, IntegStatus>();
  const importFail = rec.importError ? { at: rec.importError.at, detail: `${rec.importError.code}${rec.importError.detail ? ` · ${rec.importError.detail}` : ''}` } : null;
  const journalFail = (test: (path: string) => boolean): Failure | null => {
    // INFO lines say how a search was read (the page after the API): not failures.
    const e = rec.errors.filter((x) => x.code !== 'INFO' && test(x.path)).sort((a, b) => b.at - a.at)[0];
    return e ? { at: e.at, detail: `${e.code} · ${e.detail}` } : null;
  };

  out.set('stock', read('stock', rec.listings, rec.lastImport, latest([importFail, journalFail((p) => p.startsWith('/api/v2/wardrobe'))])));
  out.set('sold', read('sold', rec.sold, rec.lastImport, null));
  out.set('purchases', read('purchases', rec.purchases, null, rec.purchasesError ? { at: null, detail: rec.purchasesError } : null));

  // Reserved: seen on an item, or at least the field Vinted gives on every wardrobe item.
  const field = rec.wardrobeKeys === null ? null : rec.wardrobeKeys.includes('is_reserved');
  if (rec.reserved > 0) out.set('reserved', read('reserved', rec.reserved, rec.lastImport, null));
  else if (field === true)
    out.set('reserved', { key: 'reserved', write: false, n: 0, state: 'PARTIAL', lastOk: rec.lastImport, lastFail: null, routes: [], note: { key: 'reservedField' } });
  else if (field === false)
    out.set('reserved', { key: 'reserved', write: false, n: 0, state: 'UNAVAILABLE', lastOk: null, lastFail: null, routes: [], note: { key: 'reservedNoField' } });
  else out.set('reserved', read('reserved', 0, null, null));

  // Search: three ways to read, the current one decides.
  const searchRoutes: RouteStatus[] = (['API', 'LEARNED', 'PAGE'] as const)
    .map((k) => {
      const hits = rec.searches.filter((s) => (s.via ?? 'API') === k);
      const rec2 = rec.searchOk?.[k];
      // Two partial tallies of the same searches (analyses kept, every search since 0.31.2): the larger, never the sum.
      const ok = Math.max(hits.length, rec2?.n ?? 0);
      const at = Math.max(hits.length ? Math.max(...hits.map((s) => s.at)) : 0, rec2?.at ?? 0);
      return { key: k, ok, unconfirmed: 0, lastOk: ok > 0 ? at : null, lastFail: null };
    })
    .filter((r) => r.ok > 0 || r.key === rec.searchMode);
  const current = searchRoutes.find((r) => r.key === rec.searchMode)!;
  const searchFail = latest([
    // The adapter journals a failed search as 'catalog'; the calls themselves under their path.
    journalFail((p) => p === 'catalog' || p.startsWith('/api/v2/catalog') || /search/i.test(p)),
    rec.searchDown && rec.searchDown.until > rec.now ? { at: rec.searchDown.at, detail: rec.searchDown.detail } : null,
  ]);
  current.lastFail = searchFail;
  const searchOk = searchRoutes.map((r) => r.lastOk).filter((x): x is number => x !== null);
  const searchLastOk = searchOk.length ? Math.max(...searchOk) : null;
  const paused = !!rec.searchDown && rec.searchDown.until > rec.now;
  out.set('search', {
    key: 'search',
    write: false,
    n: searchRoutes.reduce((s, r) => s + r.ok, 0),
    state: paused || failing(current.lastOk, searchFail) ? 'FAILING' : current.ok > 0 ? 'VERIFIED' : searchOk.length ? 'PARTIAL' : 'UNTESTED',
    lastOk: searchLastOk,
    lastFail: searchFail,
    routes: searchRoutes,
    note: paused ? { key: 'searchPaused', params: { until: rec.searchDown!.until } } : rec.searchMode !== 'API' && current.ok === 0 ? { key: rec.searchMode === 'PAGE' ? 'searchPageUntested' : 'searchLearnedUntested' } : null,
  });

  for (const [key, kinds] of Object.entries(WRITE_ROUTES) as [IntegKey, AutoLogRow['kind'][]][]) {
    const routes = kinds.map((k) => route(k, rec.log));
    const mine = rec.log.filter((r) => !r.dryRun && !r.ok && (kinds.includes(r.kind) || (key === 'auto' && r.kind === 'STOP' && !NOT_AUTOMATIONS.has(r.target ?? ''))));
    // An automation pass that stopped on Vinted's side (block, logged out) is the automations' last failure too.
    const stop = key === 'auto' ? mine.filter((r) => r.kind === 'STOP' && !OWN_LIMIT.test(r.detail)).sort((a, b) => b.at - a.at)[0] : undefined;
    const status = fromRoutes(key, routes, stop ? { at: stop.at, detail: stop.detail } : null);
    // Stopped by one of ERA's own limits since the last success: said as such, never as Vinted failing.
    const own = mine.filter((r) => OWN_LIMIT.test(r.detail)).sort((a, b) => b.at - a.at)[0];
    if (own && status.state !== 'FAILING' && (status.lastOk === null || own.at > status.lastOk)) status.note = { key: 'ownLimit', params: { detail: own.detail } };
    out.set(key, status);
  }
  return ORDER.map((k) => out.get(k)!);
}
