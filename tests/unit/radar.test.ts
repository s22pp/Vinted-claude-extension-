import { describe, expect, it } from 'vitest';
import type { MarketCandidate } from '@/domain/entities';
import { localMedian, matchesSearch, newSearch, scoreScan } from '@/intelligence/radar';

const search = newSearch({ brand: 'Ralph Lauren', category: 'JACKET', size: 'M', maxPriceCents: 3000, minCondition: 'VERY_GOOD' }, 1_000)!;
const cand = (id: string, price: number, over: Partial<MarketCandidate> = {}): MarketCandidate => ({
  id,
  title: `Veste Ralph Lauren ${id}`,
  brand: 'Ralph Lauren',
  priceCents: price,
  size: 'M',
  condition: 'VERY_GOOD',
  category: 'JACKET',
  gender: null,
  url: null,
  photoUrl: null,
  favorites: null,
  listedAt: null,
  promoted: false,
  sellerId: null,
  ...over,
});
const seg = (brand: string, category: 'JACKET' | null, sold: number, median: number) => ({ brand, category, sold, medianSaleCents: median }) as never;

describe('Radar: saved searches scored against the local median', () => {
  it('a saved search needs a brand; the rest is optional', () => {
    expect(newSearch({ brand: '  ', category: null, size: '', maxPriceCents: null, minCondition: null }, 1)).toBeNull();
    expect(search).toMatchObject({ brand: 'Ralph Lauren', size: 'M', maxPriceCents: 3000, minCondition: 'VERY_GOOD' });
  });

  it('the filters: price max, condition min (better passes), size; unknown condition or size fails a filter set on it', () => {
    expect(matchesSearch(cand('a', 3000), search)).toBe(true);
    expect(matchesSearch(cand('a', 3100), search)).toBe(false);
    expect(matchesSearch(cand('a', 2000, { condition: 'NEW_WITH_TAGS' }), search)).toBe(true);
    expect(matchesSearch(cand('a', 2000, { condition: 'GOOD' }), search)).toBe(false);
    expect(matchesSearch(cand('a', 2000, { condition: null }), search)).toBe(false);
    expect(matchesSearch(cand('a', 2000, { size: 'm ' }), search)).toBe(true);
    expect(matchesSearch(cand('a', 2000, { size: 'L' }), search)).toBe(false);
  });

  it('the local median: the seller’s own sales first (3 or more), else the scan’s asking prices (5 or more), else none', () => {
    const model = { byNiche: [seg('Ralph Lauren', 'JACKET', 4, 5500)], byBrand: [seg('Ralph Lauren', null, 9, 4000)] };
    expect(localMedian(search, model, [])).toEqual({ cents: 5500, basis: 'SALES', n: 4 });
    expect(localMedian(search, { byNiche: [seg('Ralph Lauren', 'JACKET', 2, 5500)], byBrand: [seg('Ralph Lauren', null, 9, 4000)] }, [])).toEqual({ cents: 4000, basis: 'SALES', n: 9 });
    expect(localMedian(search, null, [1000, 2000, 3000, 4000, 5000])).toEqual({ cents: 3000, basis: 'SCAN', n: 5 });
    expect(localMedian(search, null, [1000, 2000])).toBeNull();
  });

  it('a scan: the seller’s own listings left out, the filters applied, each deal’s margin over its all-in cost, best first', () => {
    const model = { byNiche: [seg('Ralph Lauren', 'JACKET', 4, 5500)], byBrand: [] };
    const r = scoreScan(search, [cand('1', 2500), cand('2', 1000), cand('3', 4000), cand('mine', 500)], model, new Set(['mine']), 42);
    expect(r).toMatchObject({ at: 42, seen: 4, median: { cents: 5500, basis: 'SALES' } });
    expect(r.deals.map((d) => d.id)).toEqual(['2', '1']);
    // 10 € listed → 11,20 € with the buyer protection → 55 − 11,20 = 43,80 €.
    expect(r.deals[0]).toMatchObject({ landedCents: 1120, marginCents: 4380, url: 'https://www.vinted.fr/items/2' });
  });

  it('no median known: the deals are listed without a margin (never a made-up one)', () => {
    const r = scoreScan(search, [cand('1', 2500), cand('2', 1000)], null, new Set(), 1);
    expect(r.median).toBeNull();
    expect(r.deals.every((d) => d.marginCents === null)).toBe(true);
    expect(r.deals.map((d) => d.id)).toEqual(['2', '1']);
  });
});
