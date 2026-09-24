import type { ComparableQuery, InventorySnapshotItem, ListingObservationSnapshot, MarketplaceAdapter, SearchResult } from '../marketplace';
import { MarketplaceError } from '../marketplace';
import { currentUserId, firstArray, isDraft, parseCatalogItem, parseOrder, parseTotalEntries, parseWardrobeItem, type SoldOrder } from './parse';
import type { ApiResult, BudgetStatus, EraMessage, PageResult } from './protocol';

export async function findVintedTab(): Promise<number | null> {
  const tabs = await browser.tabs.query({ url: 'https://www.vinted.fr/*' });
  return tabs.find((t) => t.active)?.id ?? tabs[0]?.id ?? null;
}

async function ping(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'era:ping' } satisfies EraMessage);
    return true;
  } catch {
    return false;
  }
}

function waitForLoad(tabId: number, timeoutMs = 25_000): Promise<void> {
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
  const pingLoop = async () => {
    for (let i = 0; i < 20; i++) {
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
        const p = parseWardrobeItem(it);
        if (p) out.push(isDraft(it) ? { ...p, status: 'REMOVED' } : p);
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
    const json = await this.api(`/api/v2/catalog/items?search_text=${encodeURIComponent(query.text)}&per_page=60&order=newest_first`);
    const { total, capped } = parseTotalEntries(json);
    return {
      candidates: firstArray(json, ['items']).map(parseCatalogItem).filter((c) => c !== null),
      totalEntries: total,
      totalCapped: capped,
      fetchedAt: Date.now(),
    };
  }
}
