import type { ComparableQuery, InventorySnapshotItem, ListingObservationSnapshot, MarketplaceAdapter, SearchResult } from '../marketplace';
import { MarketplaceError } from '../marketplace';
import { currentUserId, firstArray, isDraft, parseCatalogItem, parseOrder, parseTotalEntries, parseWardrobeItem, type SoldOrder } from './parse';
import type { ApiResult, BudgetStatus, EraMessage, PageResult } from './protocol';

export async function findVintedTab(): Promise<number | null> {
  const tabs = await browser.tabs.query({ url: 'https://www.vinted.fr/*' });
  return tabs.find((t) => t.active)?.id ?? tabs[0]?.id ?? null;
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
    const tab = await findVintedTab();
    if (tab === null) throw new MarketplaceError('UNAVAILABLE', 'NO_VINTED_TAB');
    let res: ApiResult;
    try {
      res = (await browser.tabs.sendMessage(tab, { type: 'era:api', path } satisfies EraMessage)) as ApiResult;
    } catch {
      throw new MarketplaceError('UNAVAILABLE', 'CONTENT_SCRIPT_UNREACHABLE');
    }
    if (!res.ok) throw new MarketplaceError(res.code, res.status ? `HTTP_${res.status}` : res.code);
    return res.json;
  }

  async userId(): Promise<string> {
    const id = currentUserId(await this.api('/api/v2/users/current'));
    if (!id) throw new MarketplaceError('UNAVAILABLE', 'NO_USER');
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
