import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { analyzeBuy } from '@/intelligence/buy';
import { capitalSummary } from '@/intelligence/capital';
import { type ComparableAnalysis, analyzeComparables } from '@/intelligence/comparables';
import { computeItemIntel, todayPriorities } from '@/intelligence/decision';
import { resolvePrediction } from '@/intelligence/learning';
import { marketVsYou } from '@/intelligence/market-vs-you';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { buildPrediction, precisionRows, precisionSummary } from '@/intelligence/precision';
import { priceStrategies } from '@/intelligence/pricing';
import { buildSellerModel, realizedFor } from '@/intelligence/seller-model';

const NOW = Date.UTC(2026, 8, 24);

const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  title: 'Veste Harrington Ralph Lauren M',
  brand: 'Ralph Lauren',
  model: 'Harrington',
  category: 'JACKET',
  gender: 'MEN',
  size: 'M',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  photoUrl: null,
  purchasePriceCents: 1800,
  costDetail: null,
  purchaseDate: NOW - 40 * DAY,
  purchaseSource: null,
  status: 'LISTED',
  createdAt: 0,
  updatedAt: 0,
  meta: {},
  isDemo: false,
  ...over,
});

const listing = (id: string, itemId: string, over: Partial<Listing> = {}): Listing => ({
  id,
  inventoryItemId: itemId,
  platform: 'vinted',
  platformListingId: null,
  url: null,
  title: 't',
  priceCents: 5500,
  views: 100,
  favorites: 2,
  listedAt: NOW - 38 * DAY,
  removedAt: null,
  soldAt: null,
  status: 'ACTIVE',
  lastObservedAt: NOW,
  isDemo: false,
  ...over,
});

let mid = 0;
function market(prices: number[], brand = 'Ralph Lauren'): ComparableAnalysis {
  return analyzeComparables(
    { title: `Veste Harrington ${brand}`, brand, model: 'Harrington', category: 'JACKET', gender: 'MEN', size: 'M', condition: 'VERY_GOOD', material: null, era: null, priceCents: null },
    [
      {
        candidates: prices.map((p) => ({
          id: `m${mid++}`,
          title: `Veste Harrington ${brand}`,
          brand,
          priceCents: p * 100,
          size: 'M',
          condition: 'VERY_GOOD' as const,
          category: null,
          gender: null,
          url: null,
          photoUrl: null,
          favorites: 6,
          listedAt: null,
          promoted: false,
          sellerId: `s${mid}`,
        })),
        totalEntries: 120,
        totalCapped: false,
        fetchedAt: 0,
      },
    ],
    { queries: [], source: 'VINTED', now: NOW },
  );
}
const MKT = market([38, 40, 42, 44, 45, 46, 47, 48, 50, 52, 54, 55, 56, 58, 60, 62]);

/** n completed sales of Harringtons: cost, price, days on the shelf. */
function soldSet(n: number, cost = 1500, price = 4500, days = 7) {
  const items = Array.from({ length: n }, (_, i) => item(`s${i}`, { status: 'SOLD', purchasePriceCents: cost, purchaseDate: NOW - (days + 30) * DAY }));
  const listings = items.map((it) => listing(`l${it.id}`, it.id, { status: 'SOLD', listedAt: NOW - (days + 20) * DAY, soldAt: NOW - 20 * DAY, priceCents: price }));
  const sales: Sale[] = items.map((it) => ({ id: `sale${it.id}`, inventoryItemId: it.id, listingId: `l${it.id}`, soldAt: NOW - 20 * DAY, salePriceCents: price, extraCostsCents: 0, status: 'COMPLETED', isDemo: false }));
  return { items, listings, sales };
}

describe('purchase cost: item / buyer protection / shipping', () => {
  it('unknown shipping is never 0: total is "known excluding shipping" until it is entered', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.items.put(item('a', { purchasePriceCents: null }));
    await db.purchases.put({ id: 'p', title: 'Veste', priceCents: 2000, date: NOW - 50 * DAY, status: null, linkedItemId: null, dismissed: false, importedAt: NOW });
    await repo.linkPurchase('p', 'a');
    let a = (await db.items.get('a'))!;
    expect(a.costDetail).toEqual({ itemCents: 2000, protectionCents: 170, shippingCents: null });
    expect(a.purchasePriceCents).toBe(2170);
    const [v] = buildItemViews([a], [listing('l', 'a')], [], NOW);
    expect(v!.costComplete).toBe(false);
    expect(capitalSummary([v!], [], NOW).costsExcludingShipping).toBe(1);

    await repo.setShipping('a', 489);
    a = (await db.items.get('a'))!;
    expect(a.purchasePriceCents).toBe(2659);
    expect(buildItemViews([a], [listing('l', 'a')], [], NOW)[0]!.costComplete).toBe(true);
  });
});

describe('capital intelligence', () => {
  it('a high theoretical margin does not save an expensive article held long with no demand', () => {
    const views = buildItemViews(
      [
        item('dead', { purchasePriceCents: 6000, purchaseDate: NOW - 120 * DAY }),
        item('fresh', { purchasePriceCents: 6000, purchaseDate: NOW - 10 * DAY }),
        ...['a', 'b', 'c', 'd'].map((id) => item(id, { purchasePriceCents: 1000, purchaseDate: NOW - 20 * DAY })),
      ],
      [
        // 150 € ask on a 60 € cost = 150 % theoretical margin, but 12 views in 118 days.
        listing('l0', 'dead', { priceCents: 15000, views: 12, favorites: 0, listedAt: NOW - 118 * DAY }),
        listing('l1', 'fresh', { priceCents: 9000, views: 60, listedAt: NOW - 8 * DAY }),
        ...['a', 'b', 'c', 'd'].map((id) => listing(`l${id}`, id, { priceCents: 3000, views: 80, listedAt: NOW - 18 * DAY })),
      ],
      [],
      NOW,
    );
    const cap = capitalSummary(views, [], NOW);
    const dead = cap.positions.find((p) => p.itemId === 'dead')!;
    expect(dead.potentialRoi).toBeCloseTo(1.5);
    expect(dead.demand).toBe('LOW');
    expect(dead.trap!.reasons).toEqual(expect.arrayContaining(['HIGH_COST', 'LONG_HELD', 'LOW_DEMAND']));
    expect(cap.traps.map((t) => t.itemId)).toEqual(['dead']);
    // Same cost, recent: not a trap.
    expect(cap.positions.find((p) => p.itemId === 'fresh')!.trap).toBeNull();
    // Efficiency: profit per € per 30 days held.
    expect(dead.efficiency30).toBeCloseTo(1.5 / (120 / 30), 2);
  });

  it('a seller who usually sells slowly gets a longer "long held" threshold', () => {
    const views = buildItemViews([item('x', { purchasePriceCents: 3000, purchaseDate: NOW - 70 * DAY })], [listing('l', 'x', { priceCents: 3200, views: 5, listedAt: NOW - 68 * DAY })], [], NOW);
    expect(capitalSummary(views, [], NOW).traps).toHaveLength(1);
    expect(capitalSummary(views, [], NOW, 30).traps).toHaveLength(0);
  });
});

describe('Buy Analyzer V2', () => {
  const input = { title: 'Veste Harrington', brand: 'Ralph Lauren', model: 'Harrington', category: 'JACKET' as const, gender: null, size: 'M', condition: 'VERY_GOOD' as const, purchasePriceCents: 2200, url: null };

  it('three strategies with profit and ROI each; speed says what it is based on', () => {
    const b = analyzeBuy(input, MKT, null, null);
    expect(b.strategies.map((s) => s.strategy)).toEqual(['FAST', 'BALANCED', 'MAX_MARGIN']);
    for (const s of b.strategies) {
      expect(s.profit.min).toBe(s.range.min - 2200);
      expect(s.roi!.max).toBeCloseTo((s.range.max - 2200) / 2200);
    }
    expect(b.speed).toMatchObject({ basis: 'DEFAULT', n: 0 });
    expect(b.yield30).toBeGreaterThan(0);
    expect(b.demandDetail).toMatchObject({ avgFavorites: 6, supply: 120, supplyCapped: false });
  });

  it('personal history drives the speed; capital risk lists its reasons', () => {
    const s = soldSet(5, 1500, 4800, 9);
    const views = buildItemViews(s.items, s.listings, s.sales, NOW);
    const model = buildSellerModel(views, buildSaleViews(views, s.sales), { category: (c) => c });
    const personal = model.byNiche[0]!;
    const b = analyzeBuy(input, MKT, model, personal);
    expect(b.speed!.basis).toBe('PERSONAL');
    expect(b.speed!.n).toBe(5);
    const pricey = analyzeBuy({ ...input, purchasePriceCents: 5200 }, MKT, null, null);
    expect(pricey.capitalRisk).toBe('HIGH');
    expect(pricey.capitalRiskReasons).toEqual(expect.arrayContaining(['HIGH_COST', 'THIN_ROI']));
  });
});

describe('prediction → reality', () => {
  it('freezes price, delay, confidence and the data used, then measures the error', () => {
    const pricing = priceStrategies(MKT, { priceCents: 5500, views: 10, favorites: 0, daysListed: 3, condition: 'VERY_GOOD' }, null);
    const pred = buildPrediction({ itemId: 'a', at: NOW - 20 * DAY, analysis: MKT, pricing, personal: null, askCents: 5500, correction: 1, kind: 'RECOMMENDATION', isDemo: false, suggestedCents: 4900 })!;
    expect(pred.suggestedCents).toBe(4900);
    expect(pred.basis).toMatchObject({ comparables: MKT.keptCount, p50: MKT.distribution!.p50, source: 'VINTED', personalN: 0, askCents: 5500 });
    expect(pred.priceMinCents).toBeLessThanOrEqual(4900);
    expect(pred.priceMaxCents).toBeGreaterThanOrEqual(4900);

    const full = { ...pred, id: 'p', resolved: null };
    const resolved = { ...full, resolved: resolvePrediction(full, { soldAt: NOW - 9 * DAY, salePriceCents: 4700 }) };
    const [row] = precisionRows([resolved]);
    expect(row!.priceErrorCents).toBe(-200);
    expect(row!.priceErrorPct).toBeCloseTo(-200 / 4900);
    expect(row!.actual!.days).toBe(11);
    const s = precisionSummary(precisionRows([resolved, { ...full, id: 'open' }]));
    expect(s).toMatchObject({ resolved: 1, open: 1, medianAbsErrorCents: 200 });
  });
});

describe('market insight vs your performance', () => {
  it('asking and realised prices stay separate; the gap needs both sides', () => {
    const s = soldSet(4, 1500, 4000, 7);
    const views = buildItemViews(s.items, s.listings, s.sales, NOW);
    const sv = buildSaleViews(views, s.sales);
    const model = buildSellerModel(views, sv, { category: (c) => c });
    const [row] = marketVsYou('brand', model, [MKT]);
    expect(row!.market!.askingMedianCents).toBe(4900); // median of the 16 unique asking prices
    expect(row!.market!.listings).toBe(MKT.keptCount);
    expect(row!.you.medianSaleCents).toBe(4000);
    expect(row!.gapPct).toBeCloseTo((4000 - 4900) / 4900);
    // Price bands are defined by YOUR sale price: no market side.
    expect(marketVsYou('band', model, [MKT]).every((r) => r.market === null)).toBe(true);
    // Too few sales: no gap, flagged weak.
    const thin = buildSellerModel(views.slice(0, 2), sv.slice(0, 2), { category: (c) => c });
    expect(marketVsYou('brand', thin, [MKT])[0]!.gapPct).toBeNull();
    // Realised lane: never the item itself, never refunds.
    expect(realizedFor(sv, s.items[0]!, 's0')!.points).toHaveLength(3);
  });
});

describe('Today priorities open their items', () => {
  it('"clearly above comparables" requires a fresh reliable analysis and an ask above P75', () => {
    const views = buildItemViews(
      [item('hi', { purchasePriceCents: 1500 }), item('ok', { purchasePriceCents: 1500 }), item('ship', { purchasePriceCents: 2170, costDetail: { itemCents: 2000, protectionCents: 170, shippingCents: null } })],
      [listing('l1', 'hi', { priceCents: 9000 }), listing('l2', 'ok', { priceCents: 5000 }), listing('l3', 'ship', { priceCents: 5000 })],
      [],
      NOW,
    );
    const fresh = { ...MKT, at: NOW - DAY };
    const intel = [computeItemIntel(views[0]!, fresh, null, null, null, NOW), computeItemIntel(views[1]!, fresh, null, null, null, NOW), computeItemIntel(views[2]!, null, null, null, null, NOW)];
    const model = buildSellerModel(views, [], { category: (c) => c });
    const p = todayPriorities(intel, capitalSummary(views, [], NOW), model, views);
    expect(p.find((x) => x.code === 'OVERPRICED')!.itemIds).toEqual(['hi']);
    expect(p.find((x) => x.code === 'MISSING_SHIPPING')!.itemIds).toEqual(['ship']);
    // The same ask with a stale analysis is not a fact any more.
    const stale = [computeItemIntel(views[0]!, { ...MKT, at: NOW - 30 * DAY }, null, null, null, NOW)];
    expect(todayPriorities(stale, capitalSummary(views, [], NOW), model, views).find((x) => x.code === 'OVERPRICED')).toBeUndefined();
    for (const x of p) if (x.code !== 'NICHE') expect(x.itemIds.length).toBe(x.count);
  });
});
