import {
  type ActivationEventName,
  type Category,
  type Condition,
  type DomainEvent,
  type Gender,
  type InventoryItem,
  InventoryItemSchema,
  type ItemStatus,
  type Listing,
  type PricePrediction,
  type Prep,
  PrepSchema,
  type RefundReason,
  type Sale,
} from '@/domain/entities';
import type { Cents } from '@/domain/money';
import { DAY } from '@/domain/time';
import { isLiveListing, listingStatusOf } from '@/domain/status';
import { type ComparableAnalysis, type ComparableSubject, analyzeComparables, buildQueries } from '@/intelligence/comparables';
import { resolvePrediction } from '@/intelligence/learning';
import type { MarketplaceAdapter, SearchResult } from './adapters/marketplace';
import { type EraDatabase, type InvoiceRow, db as defaultDb, uid } from './db';
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
    const listed = ds.listings.filter((l) => l.status === 'ACTIVE' || l.status === 'RESERVED');
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
    await this.db.transaction('rw', [...tables, this.db.observations, this.db.analyses, this.db.preps, this.db.invoices], async () => {
      const demoItemIds = (await this.db.items.filter((i) => i.isDemo).primaryKeys()) as string[];
      const demoSaleIds = (await this.db.sales.filter((x) => x.isDemo).primaryKeys()) as string[];
      await this.db.invoices.where('saleId').anyOf(demoSaleIds).delete();
      for (const t of tables) await (t as typeof this.db.items).filter((x: { isDemo?: boolean }) => !!x.isDemo).delete();
      await this.db.observations.where('inventoryItemId').anyOf(demoItemIds).delete();
      await this.db.preps.where('itemId').anyOf(demoItemIds).delete();
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
    status?: ItemStatus | null;
  }, now = Date.now()): Promise<string> {
    const id = uid('item');
    const status: ItemStatus = input.status ?? (input.priceCents !== null ? 'LISTED' : 'DRAFT');
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
      status,
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
          soldAt: status === 'SOLD' ? now : null,
          status: status === 'DRAFT' ? 'ACTIVE' : listingStatusOf(status),
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
      // A total typed by the seller replaces any breakdown.
      costDetail: null,
      updatedAt: now,
      meta: { ...item.meta, purchasePriceCents: { p: cents === null ? 'UNKNOWN' : 'USER_PROVIDED', at: now } },
    });
    if (cents !== null) {
      await this.db.events.put(this.event({ type: 'COST_ENTERED', at: now, inventoryItemId: itemId, listingId: null, data: { cost: cents }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }));
      await this.track('first_cost_entered');
    }
  }

  async updatePrice(itemId: string, cents: Cents, now = Date.now(), provenance: DomainEvent['provenance'] = 'USER_PROVIDED'): Promise<void> {
    const listing = (await this.db.listings.where('inventoryItemId').equals(itemId).toArray()).find((l) => isLiveListing(l.status));
    if (!listing) throw new Error('No active listing');
    await this.db.listings.put({ ...listing, priceCents: cents });
    await this.db.events.put(
      this.event({ type: 'PRICE_CHANGED', at: now, inventoryItemId: itemId, listingId: listing.id, data: { from: listing.priceCents, to: cents }, provenance, isDemo: listing.isDemo }),
    );
  }

  /**
   * Record — or correct — the sale of an item. Works for items still in stock and for items Vinted already
   * shows as sold without a known price. One completed sale per item: a second call updates it.
   */
  async recordSale(itemId: string, salePriceCents: Cents, soldAt?: number, extraCostsCents: Cents | null = 0): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    const listings = (await this.db.listings.where('inventoryItemId').equals(itemId).toArray()).sort((a, b) => a.listedAt - b.listedAt);
    const active = listings.find((l) => isLiveListing(l.status)) ?? [...listings].reverse().find((l) => l.status === 'SOLD') ?? listings[listings.length - 1] ?? null;
    const existing = (await this.db.sales.where('inventoryItemId').equals(itemId).toArray()).find((s) => s.status !== 'REFUNDED');
    soldAt ??= existing?.soldAt ?? active?.soldAt ?? Date.now();
    if (existing) {
      await this.db.sales.put({ ...existing, salePriceCents, soldAt, extraCostsCents });
      await this.db.events.put(this.event({ type: 'ITEM_SOLD', at: soldAt, inventoryItemId: itemId, listingId: existing.listingId, data: { price: salePriceCents }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }));
      await this.db.events.where('inventoryItemId').equals(itemId).filter((e) => e.type === 'ITEM_SOLD' && e.data.price !== salePriceCents).delete();
      return;
    }
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

  /**
   * Link a Vinted purchase to a stock item. Cost = item price + buyer protection (0,70 € + 5 %, verified rule);
   * shipping stays UNKNOWN (never 0) until entered: the known total then explicitly excludes shipping.
   */
  async linkPurchase(purchaseId: string, itemId: string, now = Date.now()): Promise<void> {
    const p = await this.db.purchases.get(purchaseId);
    const item = await this.db.items.get(itemId);
    if (!p || !item) throw new Error('Unknown purchase or item');
    const protection = 70 + Math.round(p.priceCents * 0.05);
    const cost = p.priceCents + protection;
    await this.db.transaction('rw', [this.db.items, this.db.purchases, this.db.events], async () => {
      await this.db.purchases.put({ ...p, linkedItemId: itemId });
      await this.db.items.put({
        ...item,
        purchasePriceCents: cost,
        costDetail: { itemCents: p.priceCents, protectionCents: protection, shippingCents: null },
        purchaseDate: p.date ?? item.purchaseDate,
        purchaseSource: 'Vinted',
        updatedAt: now,
        meta: { ...item.meta, purchasePriceCents: { p: 'DERIVED', at: now } },
      });
      await this.db.events.put(
        this.event({ type: 'COST_ENTERED', at: now, inventoryItemId: itemId, listingId: null, data: { cost, source: 'vinted_purchase', shippingKnown: false }, provenance: 'DERIVED', isDemo: item.isDemo }),
      );
    });
    await this.track('first_cost_entered');
  }

  /**
   * A Vinted purchase entered by hand: item price + buyer protection (0,70 € + 5 %, DERIVED) + shipping.
   * Unknown shipping stays null — the total is then "known excluding shipping", never shipping = 0.
   */
  async setCostBreakdown(itemId: string, itemCents: Cents, shippingCents: Cents | null, now = Date.now()): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    const protection = 70 + Math.round(itemCents * 0.05);
    const total = itemCents + protection + (shippingCents ?? 0);
    await this.db.transaction('rw', [this.db.items, this.db.events], async () => {
      await this.db.items.put({
        ...item,
        purchasePriceCents: total,
        costDetail: { itemCents, protectionCents: protection, shippingCents },
        purchaseSource: item.purchaseSource ?? 'Vinted',
        updatedAt: now,
        meta: { ...item.meta, purchasePriceCents: { p: 'USER_PROVIDED', at: now } },
      });
      await this.db.events.put(
        this.event({ type: 'COST_ENTERED', at: now, inventoryItemId: itemId, listingId: null, data: { cost: total, source: 'vinted_breakdown', shippingKnown: shippingCents !== null }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }),
      );
    });
    await this.track('first_cost_entered');
  }

  /** Shipping paid for a purchase: completes the total. null = still unknown. */
  async setShipping(itemId: string, shippingCents: Cents | null, now = Date.now()): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item?.costDetail) throw new Error('No cost breakdown for this item');
    const d = { ...item.costDetail, shippingCents };
    const total = d.itemCents + (d.protectionCents ?? 0) + (shippingCents ?? 0);
    await this.db.items.put({ ...item, costDetail: d, purchasePriceCents: total, updatedAt: now });
  }

  async dismissPurchase(purchaseId: string): Promise<void> {
    const p = await this.db.purchases.get(purchaseId);
    if (p) await this.db.purchases.put({ ...p, dismissed: true });
  }

  /** Manual reservation (Vinted's API does not expose it reliably). Kept across re-imports. */
  async setReserved(itemId: string, reserved: boolean, now = Date.now()): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    const to = reserved ? 'RESERVED' : 'LISTED';
    if (item.status === to) return;
    const listing = (await this.db.listings.where('inventoryItemId').equals(itemId).toArray()).find((l) => isLiveListing(l.status));
    await this.db.transaction('rw', [this.db.items, this.db.listings, this.db.events], async () => {
      await this.db.items.put({ ...item, status: to, updatedAt: now, meta: { ...item.meta, status: { p: 'USER_PROVIDED', at: now } } });
      if (listing) await this.db.listings.put({ ...listing, status: listingStatusOf(to) });
      await this.db.events.put(
        this.event({ type: 'STATUS_CHANGED', at: now, inventoryItemId: itemId, listingId: listing?.id ?? null, data: { from: item.status, to }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }),
      );
    });
  }

  /* ── Atelier de mise en ligne ─────────────────────────── */

  /** Facts read on the item itself (labels): they replace whatever was inferred. */
  async updateItemFacts(
    itemId: string,
    patch: Partial<Pick<InventoryItem, 'brand' | 'model' | 'category' | 'size' | 'condition' | 'material'>>,
    now = Date.now(),
  ): Promise<void> {
    const item = await this.db.items.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    const meta = { ...item.meta };
    for (const k of Object.keys(patch)) meta[k] = { p: 'USER_PROVIDED', at: now };
    await this.db.items.put({ ...item, ...patch, meta, updatedAt: now });
  }

  async getPrep(itemId: string, now = Date.now()): Promise<Prep> {
    return (await this.db.preps.get(itemId)) ?? PrepSchema.parse({ itemId, startedAt: now });
  }

  async savePrep(itemId: string, patch: Partial<Omit<Prep, 'itemId' | 'startedAt'>>, now = Date.now()): Promise<Prep> {
    const cur = await this.getPrep(itemId, now);
    const next = { ...cur, ...patch, itemId };
    await this.db.preps.put(next);
    return next;
  }

  /** Time with the sheet open (measured). Idle stretches are capped by the caller. */
  async addPrepTime(itemId: string, seconds: number, now = Date.now()): Promise<void> {
    if (seconds <= 0) return;
    const cur = await this.getPrep(itemId, now);
    await this.db.preps.put({ ...cur, seconds: cur.seconds + seconds });
  }

  /**
   * The seller published it by hand on Vinted. ERA does not touch Vinted: the listing is linked
   * on the next import through the reference in the title.
   */
  async markPrepPublished(itemId: string, priceCents: Cents | null, now = Date.now()): Promise<void> {
    const cur = await this.getPrep(itemId, now);
    const item = await this.db.items.get(itemId);
    await this.db.preps.put({ ...cur, priceCents, readyAt: cur.readyAt ?? now, publishedAt: now });
    if (item)
      await this.db.events.put(
        this.event({ type: 'LISTING_PREPARED', at: now, inventoryItemId: itemId, listingId: null, data: { price: priceCents ?? 0, seconds: Math.round(cur.seconds) }, provenance: 'USER_PROVIDED', isDemo: item.isDemo }),
      );
  }

  /* ── Comptabilité ────────────────────────────────────── */

  /** Issue (or return) the invoice of a sale: next number of the sale's year, inside one transaction. */
  async issueInvoice(saleId: string, now = Date.now()): Promise<InvoiceRow> {
    return this.db.transaction('rw', [this.db.invoices, this.db.sales], async () => {
      const existing = await this.db.invoices.get(saleId);
      if (existing) return existing;
      const sale = await this.db.sales.get(saleId);
      if (!sale) throw new Error(`Unknown sale ${saleId}`);
      const year = new Date(sale.soldAt).getFullYear();
      const last = await this.db.invoices.where('year').equals(year).toArray();
      const seq = last.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
      const row: InvoiceRow = { saleId, number: `${year}-${String(seq).padStart(4, '0')}`, year, seq, issuedAt: now, buyer: '' };
      await this.db.invoices.put(row);
      return row;
    });
  }

  async setInvoiceBuyer(saleId: string, buyer: string): Promise<void> {
    const row = await this.db.invoices.get(saleId);
    if (row) await this.db.invoices.put({ ...row, buyer });
  }

  /* ── Remboursements ──────────────────────────────────── */

  async setRefundReason(saleId: string, reason: RefundReason | null): Promise<void> {
    const sale = await this.db.sales.get(saleId);
    if (!sale) throw new Error(`Unknown sale ${saleId}`);
    await this.db.sales.put({ ...sale, refundReason: reason });
  }

  /** A sale that was refunded: kept for the refund analysis, excluded from revenue and profit. */
  async markRefunded(saleId: string, reason: RefundReason | null, now = Date.now()): Promise<void> {
    const sale = await this.db.sales.get(saleId);
    if (!sale) throw new Error(`Unknown sale ${saleId}`);
    await this.db.transaction('rw', [this.db.sales, this.db.events], async () => {
      await this.db.sales.put({ ...sale, status: 'REFUNDED', refundReason: reason });
      await this.db.events.put(this.event({ type: 'SALE_REFUNDED', at: now, inventoryItemId: sale.inventoryItemId, listingId: sale.listingId, data: { price: sale.salePriceCents }, provenance: 'USER_PROVIDED', isDemo: sale.isDemo }));
    });
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
