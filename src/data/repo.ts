import {
  type ActivationEventName,
  type Category,
  type Condition,
  type DomainEvent,
  type Gender,
  type InventoryItem,
  InventoryItemSchema,
  type Listing,
  type PricePrediction,
  type Sale,
} from '@/domain/entities';
import type { Cents } from '@/domain/money';
import { DAY } from '@/domain/time';
import { type ComparableAnalysis, type ComparableSubject, analyzeComparables, buildQueries } from '@/intelligence/comparables';
import { resolvePrediction } from '@/intelligence/learning';
import type { MarketplaceAdapter, SearchResult } from './adapters/marketplace';
import { type EraDatabase, db as defaultDb, uid } from './db';
import { generateDemoDataset } from './fixtures/demo';
import { DemoMarketplaceAdapter } from './adapters/demo-adapter';

export type DataMode = 'empty' | 'demo' | 'real';

export class EraRepository {
  constructor(readonly db: EraDatabase = defaultDb) {}

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.settings.get(key);
    return row === undefined ? fallback : (row.value as T);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  /** Local-only activation tracking. First occurrence wins; nothing leaves the device. */
  async track(name: ActivationEventName, at = Date.now()): Promise<void> {
    const exists = await this.db.activation.get(name);
    if (!exists) await this.db.activation.put({ name, at });
    const required: ActivationEventName[] = ['inventory_imported', 'first_cost_entered', 'first_market_analysis', 'first_buy_analysis', 'first_sale_tracked'];
    if (name !== 'activation_completed') {
      const done = await this.db.activation.bulkGet(required);
      if (done.every(Boolean) && !(await this.db.activation.get('activation_completed'))) {
        await this.db.activation.put({ name: 'activation_completed', at });
      }
    }
  }

  private event(e: Omit<DomainEvent, 'id' | 'isDemo'> & { isDemo?: boolean }): DomainEvent {
    return { id: uid('ev'), isDemo: false, ...e };
  }

  async loadDemo(now = Date.now()): Promise<void> {
    const ds = generateDemoDataset(now);
    await this.db.transaction('rw', [this.db.items, this.db.listings, this.db.observations, this.db.sales, this.db.events, this.db.predictions], async () => {
      await this.db.items.bulkPut(ds.items);
      await this.db.listings.bulkPut(ds.listings);
      await this.db.observations.bulkPut(ds.observations);
      await this.db.sales.bulkPut(ds.sales);
      await this.db.events.bulkPut(ds.events);
      // Resolve demo predictions against demo sales so the learning loop has history.
      const saleByItem = new Map(ds.sales.filter((s) => s.status === 'COMPLETED').map((s) => [s.inventoryItemId, s]));
      await this.db.predictions.bulkPut(
        ds.predictions.map((p) => {
          const s = saleByItem.get(p.inventoryItemId);
          return s ? { ...p, resolved: resolvePrediction(p, s) } : p;
        }),
      );
    });
    // Most demo items come with a (demo) market analysis of varying age, like a seller who has used ERA for a while.
    const adapter = new DemoMarketplaceAdapter();
    const listed = ds.listings.filter((l) => l.status === 'ACTIVE');
    const byItem = new Map(ds.items.map((i) => [i.id, i]));
    for (const [k, l] of listed.entries()) {
      if (k % 4 === 3) continue;
      const it = byItem.get(l.inventoryItemId)!;
      const subject = { title: it.title, brand: it.brand, model: it.model, category: it.category, gender: it.gender, size: it.size, condition: it.condition, material: it.material, era: it.era, priceCents: l.priceCents };
      const queries = buildQueries(subject);
      const results: SearchResult[] = [];
      for (const q of queries) results.push(await adapter.searchComparables(q));
      const at = now - ((k * 7) % 20) * DAY;
      const analysis = analyzeComparables(subject, results, { queries: queries.map((q) => q.text), source: 'DEMO', now: at });
      await this.db.analyses.put({ id: `analysis_${it.id}`, inventoryItemId: it.id, at, analysis, isDemo: true });
    }
    await this.setSetting('dataMode', 'demo');
  }

  async clearDemo(): Promise<void> {
    const tables = [this.db.items, this.db.listings, this.db.sales, this.db.events, this.db.predictions] as const;
    await this.db.transaction('rw', [...tables, this.db.observations, this.db.analyses], async () => {
      const demoItemIds = (await this.db.items.filter((i) => i.isDemo).primaryKeys()) as string[];
      for (const t of tables) await (t as typeof this.db.items).filter((x: { isDemo?: boolean }) => !!x.isDemo).delete();
      await this.db.observations.where('inventoryItemId').anyOf(demoItemIds).delete();
      await this.db.analyses.filter((a) => a.isDemo).delete();
    });
    const count = await this.db.items.count();
    await this.setSetting('dataMode', count > 0 ? 'real' : 'empty');
  }

  async addItem(input: {
    title: string;
    brand: string;
    model: string | null;
    category: Category;
    gender: Gender | null;
    size: string | null;
    condition: Condition | null;
    purchasePriceCents: Cents | null;
    purchaseDate: number | null;
    purchaseSource: string | null;
    priceCents: Cents | null;
    listedAt: number | null;
    views: number | null;
    favorites: number | null;
    url: string | null;
  }, now = Date.now()): Promise<string> {
    const id = uid('item');
    const item: InventoryItem = InventoryItemSchema.parse({
      id,
      title: input.title,
      brand: input.brand,
      model: input.model,
      category: input.category,
      gender: input.gender,
      size: input.size,
      condition: input.condition,
      material: null,
      era: null,
      photoUrl: null,
      purchasePriceCents: input.purchasePriceCents,
      purchaseDate: input.purchaseDate,
      purchaseSource: input.purchaseSource,
      status: input.priceCents !== null ? 'LISTED' : 'DRAFT',
      createdAt: now,
      updatedAt: now,
      meta: input.purchasePriceCents !== null ? { purchasePriceCents: { p: 'USER_PROVIDED', at: now } } : {},
      isDemo: false,
    });
    await this.db.transaction('rw', [this.db.items, this.db.listings, this.db.events, this.db.settings], async () => {
      await this.db.items.put(item);
      await this.db.events.put(
        this.event({ type: 'ITEM_ACQUIRED', at: input.purchaseDate ?? now, inventoryItemId: id, listingId: null, data: { cost: input.purchasePriceCents }, provenance: 'USER_PROVIDED' }),
      );
      if (input.priceCents !== null) {
        const listing: Listing = {
          id: uid('listing'),
          inventoryItemId: id,
          platform: 'vinted',
          platformListingId: null,
          url: input.url,
          title: input.title,
          priceCents: input.priceCents,
          views: input.views,
          favorites: input.favorites,
          listedAt: input.listedAt ?? now,
          removedAt: null,
          soldAt: null,
          status: 'ACTIVE',
          lastObservedAt: input.views !== null ? now : null,
          isDemo: false,
        };
        await this.db.listings.put(listing);
        await this.db.events.put(
          this.event({ type: 'LISTING_PUBLISHED', at: listing.listedAt, inventoryItemId: id, listingId: listing.id, data: { price: input.priceCents }, provenance: 'USER_PROVIDED' }),
        );
      }
      const mode = await this.getSetting<DataMode>('dataMode', 'empty');
      if (mode === 'empty') await this.setSetting('dataMode', 'real');
    });
    await this.track('inventory_imported');
    if (input.purchasePriceCents !== null) await this.track('first_cost_entered');
    return id;
  }

  async setPurchasePrice(itemId: string, cents: Cents | null, now = Date.now()): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    await this.db.items.put({
      ...item,
      purchasePriceCents: cents,
      updatedAt: now,
      meta: { ...item.meta, purchasePriceCents: { p: cents === null ? 'UNKNOWN' : 'USER_PROVIDED', at: now } },
    });
    if (cents !== null) {
      await this.db.events.put(this.event({ type: 'COST_ENTERED', at: now, inventoryItemId: itemId, listingId: null, data: { cost: cents }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }));
      await this.track('first_cost_entered');
    }
  }

  async updatePrice(itemId: string, cents: Cents, now = Date.now()): Promise<void> {
    const listing = (await this.db.listings.where('inventoryItemId').equals(itemId).toArray()).find((l) => l.status === 'ACTIVE');
    if (!listing) throw new Error('No active listing');
    await this.db.listings.put({ ...listing, priceCents: cents });
    await this.db.events.put(
      this.event({ type: 'PRICE_CHANGED', at: now, inventoryItemId: itemId, listingId: listing.id, data: { from: listing.priceCents, to: cents }, provenance: 'USER_PROVIDED', isDemo: listing.isDemo }),
    );
  }

  async recordSale(itemId: string, salePriceCents: Cents, soldAt = Date.now(), extraCostsCents: Cents | null = 0): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    const listings = await this.db.listings.where('inventoryItemId').equals(itemId).toArray();
    const active = listings.find((l) => l.status === 'ACTIVE') ?? null;
    const sale: Sale = {
      id: uid('sale'),
      inventoryItemId: itemId,
      listingId: active?.id ?? null,
      soldAt,
      salePriceCents,
      extraCostsCents,
      status: 'COMPLETED',
      isDemo: item.isDemo,
    };
    const preds = await this.db.predictions.where('inventoryItemId').equals(itemId).toArray();
    await this.db.transaction('rw', [this.db.items, this.db.listings, this.db.sales, this.db.events, this.db.predictions], async () => {
      await this.db.sales.put(sale);
      await this.db.items.put({ ...item, status: 'SOLD', updatedAt: soldAt });
      if (active) await this.db.listings.put({ ...active, status: 'SOLD', soldAt });
      await this.db.events.put(this.event({ type: 'ITEM_SOLD', at: soldAt, inventoryItemId: itemId, listingId: active?.id ?? null, data: { price: salePriceCents }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }));
      for (const p of preds.filter((x) => !x.resolved)) {
        const resolved = resolvePrediction(p, sale);
        await this.db.predictions.put({ ...p, resolved });
        await this.db.events.put(
          this.event({ type: 'PREDICTION_RESOLVED', at: soldAt, inventoryItemId: itemId, listingId: null, data: { error: Math.round(resolved.priceError * 1000) / 1000 }, provenance: 'DERIVED', isDemo: item.isDemo }),
        );
      }
    });
    await this.track('first_sale_tracked');
  }

  /** Collect → analyze → store. Adapter failures propagate as MarketplaceError; local data is untouched. */
  async analyzeMarket(
    adapter: MarketplaceAdapter,
    subject: ComparableSubject,
    itemId: string | null,
    onStage?: (s: 'COLLECTING' | 'COMPARING' | 'READY') => void,
    now = Date.now(),
  ): Promise<ComparableAnalysis> {
    onStage?.('COLLECTING');
    const queries = buildQueries(subject);
    const results: SearchResult[] = [];
    for (const q of queries) results.push(await adapter.searchComparables(q));
    onStage?.('COMPARING');
    const analysis = analyzeComparables(subject, results, { queries: queries.map((q) => q.text), source: adapter.isDemo ? 'DEMO' : 'VINTED', now });
    const item = itemId ? await this.db.items.get(itemId) : null;
    const isDemo = adapter.isDemo || !!item?.isDemo;
    if (itemId) {
      await this.db.analyses.put({ id: `analysis_${itemId}`, inventoryItemId: itemId, at: now, analysis, isDemo });
      await this.db.events.put(
        this.event({
          type: 'MARKET_ANALYZED',
          at: now,
          inventoryItemId: itemId,
          listingId: null,
          data: { quality: analysis.quality, n: analysis.keptCount, median: analysis.distribution?.p50 ?? null },
          provenance: 'DERIVED',
          isDemo,
        }),
      );
    }
    await this.track('first_market_analysis');
    onStage?.('READY');
    return analysis;
  }

  async storePrediction(p: Omit<PricePrediction, 'id' | 'resolved'>): Promise<void> {
    const open = (await this.db.predictions.where('inventoryItemId').equals(p.inventoryItemId).toArray()).filter((x) => !x.resolved && x.at > p.at - DAY);
    // One open prediction per item per day: re-analysing doesn't inflate the learning set.
    await this.db.predictions.bulkDelete(open.map((x) => x.id));
    await this.db.predictions.put({ ...p, id: uid('pred'), resolved: null });
  }

  async recordDecision(key: string, itemId: string | null, action: string, outcome: 'ACCEPTED' | 'DISMISSED' | 'SNOOZED', now = Date.now()): Promise<void> {
    await this.db.decisions.put({ id: uid('dec'), recommendationKey: key, inventoryItemId: itemId, action, outcome, at: now, until: outcome === 'SNOOZED' ? now + 7 * DAY : null });
  }

  async resetAll(): Promise<void> {
    await this.db.delete();
    await this.db.open();
  }
}

export const repo = new EraRepository();
