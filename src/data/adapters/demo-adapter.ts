import { generateDemoMarket } from '../fixtures/demo';
import type { ComparableQuery, InventorySnapshotItem, ListingObservationSnapshot, MarketplaceAdapter, SearchResult } from './marketplace';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** DEMO adapter: deterministic fixtures. Everything it returns is labelled DEMO in the UI. */
export class DemoMarketplaceAdapter implements MarketplaceAdapter {
  readonly id = 'demo' as const;
  readonly isDemo = true;

  constructor(private readonly latencyMs = 0) {}

  private async delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async getInventory(): Promise<InventorySnapshotItem[]> {
    await this.delay();
    return [];
  }

  async getListing(): Promise<InventorySnapshotItem | null> {
    await this.delay();
    return null;
  }

  async getListingObservations(): Promise<ListingObservationSnapshot[]> {
    return [];
  }

  async searchComparables(query: ComparableQuery): Promise<SearchResult> {
    await this.delay();
    const seed = hash(`${query.text}|${query.size ?? ''}`);
    const res = generateDemoMarket(query, seed);
    return { ...res, fetchedAt: Date.now() };
  }
}
