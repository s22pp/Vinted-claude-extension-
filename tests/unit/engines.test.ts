import type { InventoryItem, Listing, PricePrediction, Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { analyzeBuy } from '@/intelligence/buy';
import { capitalSummary } from '@/intelligence/capital';
import { type ComparableAnalysis, analyzeComparables } from '@/intelligence/comparables';
import { computeItemIntel } from '@/intelligence/decision';
import { resolvePrediction, summarizeLearning } from '@/intelligence/learning';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { priceStrategies } from '@/intelligence/pricing';
import { buildSellerModel } from '@/intelligence/seller-model';
import { diagnoseStagnation } from '@/intelligence/stagnation';

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

function market(prices: number[]): ComparableAnalysis {
  let i = 0;
  return analyzeComparables(
    { title: 'Veste Harrington Ralph Lauren', brand: 'Ralph Lauren', model: 'Harrington', category: 'JACKET', gender: 'MEN', size: 'M', condition: 'VERY_GOOD', material: null, era: null, priceCents: null },
    [
      {
        candidates: prices.map((p) => ({
          id: `m${i++}`,
          title: 'Veste Harrington Ralph Lauren',
          brand: 'Ralph Lauren',
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
          sellerId: `s${i}`,
        })),
        totalEntries: 120,
        totalCapped: false,
        fetchedAt: 0,
      },
    ],
    { queries: [], source: 'DEMO', now: NOW },
  );
}

const MKT = market([38, 40, 42, 44, 45, 46, 47, 48, 50, 52, 54, 55, 56, 58, 60, 62]);

describe('domain relationships', () => {
  it('a republish is a new listing of the same item, and age counts from the first listing', () => {
    const it1 = item('a');
    const views = buildItemViews(
      [it1],
      [listing('l1', 'a', { status: 'REMOVED', listedAt: NOW - 60 * DAY, removedAt: NOW - 20 * DAY }), listing('l2', 'a', { listedAt: NOW - 20 * DAY })],
      [],
      NOW,
    );
    expect(views).toHaveLength(1);
    expect(views[0]!.listings).toHaveLength(2);
    expect(views[0]!.current!.id).toBe('l2');
    expect(views[0]!.firstListedAt).toBe(NOW - 60 * DAY);
    expect(views[0]!.daysListed).toBe(20);
  });

  it('unknown cost keeps potential profit unknown', () => {
    const [v] = buildItemViews([item('a', { purchasePriceCents: null })], [listing('l', 'a')], [], NOW);
    expect(v!.potentialProfit).toBeNull();
    const cap = capitalSummary([v!], [], NOW);
    expect(cap.invested.status).toBe('unknown');
    expect(cap.potentialProfit.status).toBe('unknown');
  });
});

describe('pricing', () => {
  it('produces three ordered strategies within the observed ceiling', () => {
    const p = priceStrategies(MKT, { priceCents: 5900, views: 10, favorites: 0, daysListed: 10, condition: 'VERY_GOOD' }, null);
    expect(p.status).toBe('OK');
    const [fast, bal, max] = p.options;
    expect(fast!.range.max).toBeLessThanOrEqual(bal!.range.max);
    expect(bal!.range.min).toBeLessThanOrEqual(max!.range.min);
    expect(max!.range.max).toBeLessThanOrEqual(p.ceilingCents!);
    expect(p.options.every((o) => o.range.min % 100 === 0)).toBe(true);
    expect(p.recommended).toBe('BALANCED');
  });

  it('demand proven (≥3 favourites) → maximum margin', () => {
    const p = priceStrategies(MKT, { priceCents: 5000, views: 40, favorites: 5, daysListed: 4, condition: 'VERY_GOOD' }, null);
    expect(p.recommended).toBe('MAX_MARGIN');
    expect(p.basis).toBe('DEMAND_PROVEN');
  });

  it('refuses to price on insufficient comparables', () => {
    const p = priceStrategies(market([40, 50, 60]), { priceCents: 5000, views: 0, favorites: 0, daysListed: 1, condition: null }, null);
    expect(p.status).toBe('INSUFFICIENT_DATA');
    expect(p.options).toHaveLength(0);
  });

  it('shifts down for "bon état"', () => {
    const vg = priceStrategies(MKT, { priceCents: null, views: null, favorites: null, daysListed: null, condition: 'VERY_GOOD' }, null);
    const g = priceStrategies(MKT, { priceCents: null, views: null, favorites: null, daysListed: null, condition: 'GOOD' }, null);
    expect(g.options[1]!.range.min).toBeLessThan(vg.options[1]!.range.min);
  });
});

describe('stagnation', () => {
  it('high visibility, low interest → reprice, not repost', () => {
    const [v] = buildItemViews([item('a')], [listing('l', 'a', { views: 1204, favorites: 2, priceCents: 7000, listedAt: NOW - 41 * DAY })], [], NOW);
    const d = diagnoseStagnation(v!, MKT, null, NOW)!;
    expect(d.state).toBe('HIGH_VISIBILITY_LOW_INTEREST');
    expect(d.action).toBe('REPRICE');
  });

  it('never suggests a repost when the listing has favourites', () => {
    const [v] = buildItemViews([item('a')], [listing('l', 'a', { views: 12, favorites: 1, priceCents: 5000, listedAt: NOW - 30 * DAY })], [], NOW);
    const d = diagnoseStagnation(v!, MKT, null, NOW)!;
    expect(d.state).toBe('LOW_VISIBILITY');
    expect(d.action).not.toBe('REPOST');
  });

  it('favourites without conversion → small drop that notifies favouriters', () => {
    const [v] = buildItemViews([item('a')], [listing('l', 'a', { views: 60, favorites: 9, listedAt: NOW - 30 * DAY })], [], NOW);
    const intel = computeItemIntel(v!, MKT, null, null, null, NOW);
    expect(intel.stagnation!.state).toBe('FAVORITES_NO_CONVERSION');
    expect(intel.recommendation!.action).toBe('SMALL_DROP');
    expect(intel.recommendation!.alternative!.code).toBe('alt.noRepostFavorites');
  });

  it('too early is not stagnant', () => {
    const [v] = buildItemViews([item('a')], [listing('l', 'a', { listedAt: NOW - 3 * DAY, views: 5 })], [], NOW);
    expect(diagnoseStagnation(v!, MKT, null, NOW)!.stagnant).toBe(false);
  });
});

describe('recommendations', () => {
  it('always carry action, why, confidence, impact', () => {
    const [v] = buildItemViews([item('a')], [listing('l', 'a', { views: 1204, favorites: 2, priceCents: 7000, listedAt: NOW - 41 * DAY })], [], NOW);
    const r = computeItemIntel(v!, MKT, null, null, null, NOW).recommendation!;
    expect(r.action).toBe('SET_PRICE');
    expect(r.actionParams.price).toBeLessThan(7000);
    expect(r.why.length).toBeGreaterThan(0);
    expect(r.confidence).toBeDefined();
    expect(r.impact.code).toBe('impact.fasterLowerMargin');
    expect(r.alternative).not.toBeNull();
  });

  it('missing cost → ADD_COST, never a fake profit', () => {
    const [v] = buildItemViews([item('a', { purchasePriceCents: null })], [listing('l', 'a', { listedAt: NOW - 2 * DAY })], [], NOW);
    expect(computeItemIntel(v!, MKT, null, null, null, NOW).recommendation!.action).toBe('ADD_COST');
  });
});

describe('capital', () => {
  it('detects capital traps and ages capital in buckets', () => {
    const views = buildItemViews(
      [item('trap', { purchasePriceCents: 7000, purchaseDate: NOW - 83 * DAY }), item('ok', { purchasePriceCents: 1200, purchaseDate: NOW - 7 * DAY })],
      [listing('l1', 'trap', { priceCents: 8800 }), listing('l2', 'ok', { priceCents: 3600 })],
      [],
      NOW,
    );
    const cap = capitalSummary(views, [], NOW);
    expect(cap.traps.map((t) => t.itemId)).toEqual(['trap']);
    expect(cap.over60).toEqual({ status: 'known', value: 7000, count: 1 });
    expect(cap.invested).toEqual({ status: 'known', value: 8200, count: 2 });
  });
});

describe('buy analyzer / deal score', () => {
  it('explains the score by dimension and sums correctly', () => {
    const b = analyzeBuy(
      { title: 'Veste Harrington Ralph Lauren', brand: 'Ralph Lauren', model: 'Harrington', category: 'JACKET', gender: 'MEN', size: 'M', condition: 'VERY_GOOD', purchasePriceCents: 2200, url: null },
      MKT,
      null,
      null,
    );
    expect(b.dealScore!.dimensions).toHaveLength(7);
    expect(b.dealScore!.total).toBe(b.dealScore!.dimensions.reduce((a, d) => a + d.score, 0));
    expect(b.dealScore!.dimensions.reduce((a, d) => a + d.max, 0)).toBe(100);
    expect(b.profit!.min).toBeGreaterThan(0);
    expect(b.maxBuyCents).toBeGreaterThan(0);
  });

  it('a bad deal is flagged, an insufficient market gives no score', () => {
    const input = { title: 'Veste', brand: 'Ralph Lauren', model: 'Harrington', category: 'JACKET' as const, gender: null, size: null, condition: null, purchasePriceCents: 6000, url: null };
    expect(analyzeBuy(input, MKT, null, null).verdict).toBe('AVOID');
    const thin = analyzeBuy(input, market([40, 50, 60]), null, null);
    expect(thin.verdict).toBe('INSUFFICIENT_DATA');
    expect(thin.dealScore).toBeNull();
  });
});

describe('prediction → reality', () => {
  const pred: PricePrediction = {
    id: 'p',
    inventoryItemId: 'a',
    at: NOW - 20 * DAY,
    strategy: 'BALANCED',
    priceMinCents: 4600,
    priceMaxCents: 5200,
    daysMin: 8,
    daysMax: 18,
    confidence: 'MEDIUM',
    sampleSize: 12,
    resolved: null,
    isDemo: false,
  };

  it('measures price and time error', () => {
    const r = resolvePrediction(pred, { soldAt: NOW - 9 * DAY, salePriceCents: 4700 });
    expect(r.days).toBe(11);
    expect(r.timeInRange).toBe(true);
    expect(r.priceInRange).toBe(true);
    expect(r.priceError).toBeCloseTo((4700 - 4900) / 4900, 5);
  });

  it('learns a shrunk price correction and calibration per confidence', () => {
    const preds = Array.from({ length: 12 }, (_, i) => ({
      ...pred,
      id: `p${i}`,
      resolved: resolvePrediction(pred, { soldAt: NOW - (5 + i) * DAY, salePriceCents: 4500 }),
    }));
    const s = summarizeLearning(preds);
    expect(s.resolved).toBe(12);
    expect(s.priceBias!).toBeLessThan(0);
    expect(s.priceCorrection).toBeLessThan(1);
    expect(s.priceCorrection).toBeGreaterThan(1 + s.priceBias!);
    expect(s.calibration.find((c) => c.confidence === 'MEDIUM')!.n).toBe(12);
  });
});

describe('seller model', () => {
  it('reports sample size and separates refunded sales', () => {
    const items = [item('a', { status: 'SOLD' }), item('b', { status: 'SOLD' }), item('c')];
    const listings = [listing('la', 'a', { status: 'SOLD' }), listing('lb', 'b', { status: 'SOLD' }), listing('lc', 'c')];
    const sales: Sale[] = [
      { id: 's1', inventoryItemId: 'a', listingId: 'la', soldAt: NOW - 30 * DAY, salePriceCents: 5000, extraCostsCents: 0, status: 'COMPLETED', isDemo: false },
      { id: 's2', inventoryItemId: 'b', listingId: 'lb', soldAt: NOW - 20 * DAY, salePriceCents: 5200, extraCostsCents: 0, status: 'REFUNDED', isDemo: false },
    ];
    const views = buildItemViews(items, listings, sales, NOW);
    const m = buildSellerModel(views, buildSaleViews(views, sales), { category: (c) => c });
    const niche = m.byNiche[0]!;
    expect(niche.sold).toBe(1);
    expect(niche.refunded).toBe(1);
    expect(niche.confidence).toBe('LOW');
    expect(m.refundRate).toBe(0.5);
  });
});
