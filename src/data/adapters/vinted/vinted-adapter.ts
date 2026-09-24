import type { ComparableQuery, InventorySnapshotItem, ListingObservationSnapshot, MarketplaceAdapter, SearchResult } from '../marketplace';
import { MarketplaceError } from '../marketplace';
import { currentUserId, firstArray, parseCatalogItem, parseOrder, parseTotalEntries, parseWardrobeItem, type SoldOrder } from './parse';
import type { ApiResult, BudgetStatus, EraMessage, PageResult, ReserveResult } from './protocol';
import { db } from '../../db';

export async function findVintedTab(): Promise<number | null> {
  const tabs = await browser.tabs.query({ url: 'https://www.vinted.fr/*' });
  return tabs.find((t) => t.active)?.id ?? tabs[0]?.id ?? null;
}

export async function ping(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'era:ping' } satisfies EraMessage);
    return true;
  } catch {
    return false;
  }
}

export function waitForLoad(tabId: number, timeoutMs = 25_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(on);
      resolve();
    };
    const on = (id: number, info: { status?: string }) => id === tabId && info.status === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(on);
    void browser.tabs.get(tabId).then((t) => t.status === 'complete' && done());
  });
}

/**
 * One-click: reuse an open vinted.fr tab, or open one in the background (a normal page visit, not an API call)
 * and wait until ERA's content script answers there.
 */
export async function ensureVintedTab(): Promise<{ tabId: number; created: boolean }> {
  const existing = await findVintedTab();
  if (existing !== null && (await ping(existing))) return { tabId: existing, created: false };
  // A vinted.fr tab opened before ERA was installed has no content script: reload it. Otherwise open one.
  const tabId = existing ?? (await browser.tabs.create({ url: 'https://www.vinted.fr/', active: false })).id!;
  // Vinted pages are heavy: give a slow connection up to ~15 s before retrying once.
  const pingLoop = async (tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if (await ping(tabId)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  if (existing !== null) await browser.tabs.reload(tabId);
  await waitForLoad(tabId);
  if (await pingLoop()) return { tabId, created: existing === null };
  // One retry covers a first load that failed (network hiccup, interstitial).
  await browser.tabs.update(tabId, { url: 'https://www.vinted.fr/' });
  await waitForLoad(tabId);
  if (await pingLoop()) return { tabId, created: existing === null };
  if (existing === null) await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
  throw new MarketplaceError('NO_VINTED_TAB', 'CONTENT_SCRIPT_UNREACHABLE');
}

export const SEARCH_TEMPLATE_KEY = 'vintedSearchTemplate';
/** From the verified API map. Replaced by the observed endpoint if Vinted answers 404. */
export const DEFAULT_SEARCH_TEMPLATE = '/api/v2/catalog/items?search_text={q}&per_page=60&order=newest_first';

export function fillTemplate(template: string, q: string): string {
  return template.replace('{q}', encodeURIComponent(q));
}

/** Turn an observed search URL into a reusable template: same path and params, our text in search_text. */
export function templateFromObserved(url: string): string | null {
  const [path, qs = ''] = url.split('?');
  if (!path?.startsWith('/api/')) return null;
  const params = new URLSearchParams(qs);
  if (!params.has('search_text')) return null;
  params.set('search_text', '__Q__');
  // Keep the page's own paging and filters, but never ask for more than 2 pages' worth.
  params.delete('page');
  return `${path}?${params.toString().replace('__Q__', '{q}')}`;
}

/**
 * Open Vinted's public search page in a background tab (normal browsing), then read which API URL the page
 * itself called for its results. Nothing is injected into the page; the tab is closed afterwards.
 */
export async function discoverSearchTemplate(q: string): Promise<{ template: string | null; observed: string[] }> {
  const r = (await browser.runtime.sendMessage({ type: 'era:budget:reserve' } satisfies EraMessage)) as ReserveResult;
  if (!r.ok) throw new MarketplaceError(r.code);
  const url = `https://www.vinted.fr/catalog?search_text=${encodeURIComponent(q)}&order=newest_first`;
  const tab = await browser.tabs.create({ url, active: false });
  const tabId = tab.id!;
  try {
    await waitForLoad(tabId, 15_000);
    // First load failed (network hiccup, interstitial)? Navigate once more.
    if (!(await ping(tabId))) {
      await browser.tabs.update(tabId, { url });
      await waitForLoad(tabId, 15_000);
    }
    let observed: string[] = [];
    // Results are fetched by the page after load: poll the resource list for up to ~12 s.
    for (let i = 0; i < 24; i++) {
      await new Promise((res) => setTimeout(res, 500));
      try {
        const o = (await browser.tabs.sendMessage(tabId, { type: 'era:observe' } satisfies EraMessage)) as { urls: string[] };
        observed = o.urls;
        const hit = observed.map(templateFromObserved).find((x): x is string => x !== null);
        if (hit) return { template: hit, observed: observed.map((u) => u.split('?')[0]!) };
      } catch {
        /* content script not ready yet */
      }
    }
    return { template: null, observed: [...new Set(observed.map((u) => u.split('?')[0]!))] };
  } finally {
    await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

export async function budgetStatus(): Promise<BudgetStatus | null> {
  try {
    return (await browser.runtime.sendMessage({ type: 'era:budget:status' } satisfies EraMessage)) as BudgetStatus;
  } catch {
    return null;
  }
}

export async function readPageContext(tabId: number): Promise<PageResult | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, { type: 'era:page' } satisfies EraMessage)) as PageResult;
  } catch {
    return null; // not a vinted.fr tab, or content script not injected yet
  }
}

/**
 * Real Vinted adapter (read-only). Calls go through an open vinted.fr tab so they carry the user's own
 * session; every call is reserved against the session budget by the background worker.
 * Pagination never goes beyond 2 pages.
 */
export class VintedTabAdapter implements MarketplaceAdapter {
  readonly id = 'vinted' as const;
  readonly isDemo = false;
  /** Field names actually returned by the wardrobe endpoint — checked, never assumed. */
  readonly wardrobeKeys = new Set<string>();

  private async api(path: string): Promise<unknown> {
    // One click: if no vinted.fr tab is open, ERA opens one in the background.
    const { tabId: tab } = await ensureVintedTab();
    let res: ApiResult;
    try {
      res = (await browser.tabs.sendMessage(tab, { type: 'era:api', path } satisfies EraMessage)) as ApiResult;
    } catch {
      throw new MarketplaceError('NO_VINTED_TAB', 'CONTENT_SCRIPT_UNREACHABLE');
    }
    if (!res.ok) throw new MarketplaceError(res.code, res.detail ?? (res.status ? `HTTP ${res.status}` : res.code));
    return res.json;
  }

  /** Whitelisted GET through the Vinted tab (used by the diagnostic). */
  rawGet(path: string): Promise<unknown> {
    return this.api(path);
  }

  async userId(): Promise<string> {
    const id = currentUserId(await this.api('/api/v2/users/current'));
    if (!id) throw new MarketplaceError('NOT_LOGGED_IN');
    return id;
  }

  async getInventory(): Promise<InventorySnapshotItem[]> {
    const uid = await this.userId();
    const out: InventorySnapshotItem[] = [];
    for (let page = 1; page <= 2; page++) {
      const raw = firstArray(await this.api(`/api/v2/wardrobe/${uid}/items?page=${page}&per_page=96`), ['items']);
      for (const it of raw) {
        for (const k of Object.keys(it)) this.wardrobeKeys.add(k);
        const p = parseWardrobeItem(it);
        if (p) out.push(p);
      }
      if (raw.length < 96) break;
    }
    return out;
  }

  async getSoldOrders(): Promise<SoldOrder[]> {
    const out: SoldOrder[] = [];
    for (let page = 1; page <= 2; page++) {
      const raw = firstArray(await this.api(`/api/v2/my_orders?type=sold&page=${page}&per_page=20`), ['my_orders', 'orders']);
      out.push(...raw.map(parseOrder).filter((o): o is SoldOrder => o !== null));
      if (raw.length < 20) break;
    }
    return out;
  }

  async getListing(): Promise<InventorySnapshotItem | null> {
    // No verified public endpoint for a single listing by id (/api/v2/items/{id} does not exist).
    return null;
  }

  async getListingObservations(): Promise<ListingObservationSnapshot[]> {
    // History is built locally from successive imports; Vinted exposes none.
    return [];
  }

  async searchComparables(query: ComparableQuery): Promise<SearchResult> {
    const stored = (await db.settings.get(SEARCH_TEMPLATE_KEY))?.value as string | undefined;
    const template = stored ?? DEFAULT_SEARCH_TEMPLATE;
    let json: unknown;
    try {
      json = await this.api(fillTemplate(template, query.text));
    } catch (e) {
      // 404: Vinted moved its search. Learn the endpoint its own search page uses, then retry once.
      if (!(e instanceof MarketplaceError) || !/HTTP 404/.test(e.message)) throw e;
      const learned = await discoverSearchTemplate(query.text);
      if (!learned.template || learned.template === template) {
        throw new MarketplaceError('UNAVAILABLE', `recherche Vinted introuvable (HTTP 404 sur ${template.split('?')[0]}) · appels observés sur la page de recherche : ${learned.observed.join(' | ') || 'aucun'}`);
      }
      await db.settings.put({ key: SEARCH_TEMPLATE_KEY, value: learned.template });
      json = await this.api(fillTemplate(learned.template, query.text));
    }
    const { total, capped } = parseTotalEntries(json);
    return {
      candidates: firstArray(json, ['items']).map(parseCatalogItem).filter((c) => c !== null),
      totalEntries: total,
      totalCapped: capped,
      fetchedAt: Date.now(),
    };
  }

}
