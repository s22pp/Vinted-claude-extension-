import { describe, expect, it } from 'vitest';
import type { SegmentStats, SellerModel } from '@/intelligence/seller-model';
import { shoppingList, vintedPriceFor } from '@/intelligence/shopping';

const seg = (key: string, over: Partial<SegmentStats>): SegmentStats => ({
  key,
  label: key,
  brand: key.split('|')[0]!,
  category: 'SHIRT',
  sold: 5,
  refunded: 0,
  inStock: 1,
  avgBuyCents: 800,
  avgSaleCents: 3000,
  medianSaleCents: 3000,
  avgProfitCents: 2000,
  profitSample: 5,
  medianDays: 10,
  roi: 2.5,
  yield30: null,
  sellThrough: 0.8,
  avgDiscount: null,
  confidence: 'MEDIUM',
  ...over,
});
const model = (byNiche: SegmentStats[], medianDays = 12) => ({ byNiche, medianDays }) as unknown as SellerModel;

describe('shopping list — from your own sales', () => {
  it('ranks by profit per day, keeps a profit on every purchase, and says the Vinted price to look for', () => {
    const l = shoppingList(model([seg('pierre cardin|SHIRT', { avgProfitCents: 2000, medianDays: 10 }), seg('carhartt|JACKET', { medianSaleCents: 7500, avgProfitCents: 4500, medianDays: 5 })]));
    expect(l.buy.map((x) => x.key)).toEqual(['carhartt|JACKET', 'pierre cardin|SHIRT']);
    const shirt = l.buy[1]!;
    // 30 € cashed in, keep max(8 €, 40 %) = 12 € → 18 € landed → 16 € listed on Vinted (0,70 € + 5 % on top, rounded down).
    expect(shirt).toMatchObject({ maxLandedCents: 1800, maxVintedPriceCents: 1600, profitPerDayCents: 200 });
    expect(vintedPriceFor(1800)).toBe(1600);
  });

  it('sets aside what earns too little per sale or per day, and never ranks a guess', () => {
    const l = shoppingList(
      model([
        seg('a|SHIRT', { avgProfitCents: null, medianDays: 60 }), // profit unknown and very slow
        seg('b|SHIRT', { avgProfitCents: 300 }), // 3 € per sale
        seg('d|SHIRT', { avgProfitCents: 2000, medianDays: 100 }), // 0,20 €/day vs a typical 2 €/day
        seg('e|SHIRT', {}),
        seg('f|SHIRT', {}),
        seg('c|SHIRT', { sold: 2 }),
        seg('inconnue|SHIRT', { sold: 9 }),
      ]),
    );
    expect(l.avoid.map((x) => [x.key, x.why.code])).toEqual([
      ['a|SHIRT', 'slow'],
      ['b|SHIRT', 'poor'],
      ['d|SHIRT', 'lowDay'],
    ]);
    expect(l.buy.map((x) => x.key)).toEqual(['e|SHIRT', 'f|SHIRT']);
    expect(l.unsure).toBe(1);
  });

  it('slow but more profitable per day than the rest stays on the list', () => {
    const l = shoppingList(model([seg('stone|KNIT', { medianSaleCents: 13200, avgProfitCents: 6000, medianDays: 34 }), seg('x|SHIRT', {}), seg('y|SHIRT', {})], 13));
    expect(l.avoid).toHaveLength(0);
  });

  it('without costs, ranks by cash per day and says profit is unknown', () => {
    const l = shoppingList(model([seg('x|SHIRT', { avgProfitCents: null })]));
    expect(l.buy[0]).toMatchObject({ profitPerDayCents: null, why: { code: 'fast', params: { days: 10 } } });
  });
});

describe('deal scanner', () => {
  const line = shoppingList(model([seg('carhartt|JACKET', { label: 'Carhartt Veste', category: 'JACKET', medianSaleCents: 7500, avgProfitCents: 4500, medianDays: 5 })])).buy[0]!;
  const cand = (id: string, title: string, price: number, brand: string | null = 'Carhartt') => ({ id, title, brand, priceCents: price, size: 'M', condition: 'GOOD' as const, category: null, gender: null, url: `https://www.vinted.fr/items/${id}`, photoUrl: null, favorites: null, listedAt: null, promoted: false, sellerId: 's' });
  const result = (cands: ReturnType<typeof cand>[]) => ({ candidates: cands, totalEntries: cands.length, totalCapped: false, fetchedAt: 0 });

  it('keeps same brand, same kind, under the all-in maximum — best margin first', async () => {
    const { findDeals, vintedLanded } = await import('@/intelligence/shopping');
    // max landed: 75 € − max(8 €, 30 €) = 45 €.
    const deals = findDeals(
      line,
      result([
        cand('1', 'Veste Carhartt Detroit M', 3000),
        cand('2', 'Veste Carhartt Active L', 4000), // 42,70 € landed: still under 45 €
        cand('3', 'Veste Carhartt M', 4500), // 47,95 € landed: over
        cand('4', 'Lot de 3 vestes Carhartt', 2000), // a lot
        cand('5', 'Veste Dickies M', 1500, 'Dickies'), // another brand
        cand('6', 'Pantalon Carhartt', 1500), // another kind of article
        cand('7', 'Veste Carhartt enfant 12 ans', 1000), // kids
        cand('8', 'Veste Carhartt S', 1200), // mine
      ]),
      new Set(['8']),
    );
    expect(deals.map((d) => d.candidate.id)).toEqual(['1', '2']);
    expect(deals[0]).toMatchObject({ landedCents: vintedLanded(3000), marginCents: 7500 - 3220 });
  });
});
