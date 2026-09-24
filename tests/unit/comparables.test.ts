import type { MarketCandidate } from '@/domain/entities';
import { type ComparableSubject, analyzeComparables, buildQueries } from '@/intelligence/comparables';
import { brandKey, categoriesInTitle, normalizeText } from '@/intelligence/normalize';
import { weightedQuantile } from '@/intelligence/stats';

const subject: ComparableSubject = {
  title: 'Veste Harrington Ralph Lauren M',
  brand: 'Ralph Lauren',
  model: 'Harrington',
  category: 'JACKET',
  gender: 'MEN',
  size: 'M',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  priceCents: 5900,
};

let n = 0;
const c = (title: string, euros: number, extra: Partial<MarketCandidate> = {}): MarketCandidate => ({
  id: `c${n++}`,
  title,
  brand: 'Ralph Lauren',
  priceCents: euros * 100,
  size: 'M',
  condition: 'VERY_GOOD',
  category: null,
  gender: null,
  url: null,
  photoUrl: null,
  favorites: 4,
  listedAt: null,
  promoted: false,
  sellerId: `s${n}`,
  ...extra,
});

function goodSet(prices: number[]) {
  return prices.map((p) => c('Veste Harrington Ralph Lauren', p));
}

const run = (cands: MarketCandidate[], s = subject) =>
  analyzeComparables(s, [{ candidates: cands, totalEntries: cands.length, totalCapped: false, fetchedAt: 0 }], {
    queries: ['q'],
    source: 'DEMO',
    now: 0,
  });

describe('normalization', () => {
  it('canonicalises brand aliases', () => {
    expect(brandKey('Polo Ralph Lauren')).toBe('ralph lauren');
    expect(brandKey("Levi's")).toBe('levis');
    expect(brandKey('Carhartt WIP')).toBe('carhartt');
  });
  it('does not read "Polo Ralph Lauren" as the POLO category', () => {
    expect(categoriesInTitle(normalizeText('Sweat Polo Ralph Lauren'))).toEqual(['SWEATSHIRT']);
    expect(categoriesInTitle(normalizeText('Polo Lacoste'))).toEqual(['POLO']);
  });
  it('queries never contain colours and use brand + model', () => {
    const qs = buildQueries(subject).map((q) => q.text);
    expect(qs).toContain('Ralph Lauren Harrington');
    expect(qs).toContain('Ralph Lauren veste');
  });
});

describe('comparable engine', () => {
  it('rejects noise with explicit reasons', () => {
    const a = run([
      ...goodSet([40, 42, 45, 46, 48, 50, 52, 54, 55, 58]),
      c('Lot 3 vestes Ralph Lauren', 90),
      c('Veste Ralph Lauren enfant 12 ans', 20),
      c('Veste Harrington Tommy Hilfiger', 30, { brand: 'Tommy Hilfiger' }),
      c('Jean Ralph Lauren', 35),
      c('Veste Harrington Ralph Lauren', 1),
      c('Veste Harrington Ralph Lauren rare', 400),
    ]);
    expect(a.exclusions.EXCLUDED_TERM).toBe(2);
    expect(a.exclusions.BRAND_MISMATCH).toBe(1);
    expect(a.exclusions.CATEGORY_MISMATCH).toBe(1);
    expect(a.exclusions.OUTLIER_LOW).toBe(1);
    expect(a.exclusions.OUTLIER_HIGH).toBe(1);
    expect(a.keptCount).toBe(10);
  });

  it('deduplicates the same listing across queries and reposts of the same seller', () => {
    const base = goodSet([40, 42, 45, 46, 48, 50, 52, 54, 55, 58]);
    const repost = { ...base[0]!, id: 'other-id' };
    const a = analyzeComparables(
      subject,
      [
        { candidates: base, totalEntries: 10, totalCapped: false, fetchedAt: 0 },
        { candidates: [...base.slice(0, 3), repost], totalEntries: 10, totalCapped: false, fetchedAt: 0 },
      ],
      { queries: ['a', 'b'], source: 'DEMO', now: 0 },
    );
    expect(a.keptCount).toBe(10);
    expect(a.exclusions.DUPLICATE).toBe(1);
  });

  it('computes a robust distribution and positions the current price', () => {
    const a = run(goodSet([38, 40, 42, 44, 45, 46, 47, 48, 50, 52, 54, 55, 56, 58, 60, 62]));
    const d = a.distribution!;
    expect(d.p25).toBeLessThan(d.p50);
    expect(d.p50).toBeGreaterThan(4500);
    expect(d.p50).toBeLessThan(5200);
    expect(a.position!.deltaPct).toBeGreaterThan(0.1);
    expect(a.quality === 'HIGH' || a.quality === 'MEDIUM').toBe(true);
  });

  it('refuses to conclude under 8 comparables', () => {
    const a = run(goodSet([40, 45, 50, 55, 60]));
    expect(a.quality).toBe('INSUFFICIENT');
    expect(a.notes).toContain('SMALL_SAMPLE');
  });

  it('flags a capped supply total as ≥ 960, not 960', () => {
    const a = analyzeComparables(subject, [{ candidates: goodSet([40, 50]), totalEntries: 960, totalCapped: true, fetchedAt: 0 }], {
      queries: [],
      source: 'DEMO',
      now: 0,
    });
    expect(a.totalCapped).toBe(true);
    expect(a.notes).toContain('SUPPLY_CAPPED');
  });

  it('down-weights less similar comparables', () => {
    const close = goodSet([60, 60, 60, 60, 60, 60, 60, 60]);
    const far = Array.from({ length: 8 }, () => c('Veste Ralph Lauren', 30, { size: 'XXL', condition: 'SATISFACTORY' }));
    const a = run([...close, ...far]);
    expect(a.distribution!.p50).toBeGreaterThan(4500);
    expect(a.effectiveSample).toBeLessThan(16);
  });
});

describe('weighted quantile', () => {
  it('matches the plain median with equal weights', () => {
    expect(weightedQuantile([1, 2, 3, 4, 5].map((v) => ({ v, w: 1 })), 0.5)).toBe(3);
  });
});
