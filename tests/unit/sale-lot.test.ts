import { describe, expect, it } from 'vitest';
import { dormant, lotHashtags, lotListing, lotProblem, planSaleLot } from '@/intelligence/sale-lot';

const it_ = (id: string, ask: number | null, cost: number | null, days = 40, inStock = true) => ({ itemId: id, title: `Article ${id}`, askCents: ask, costCents: cost, daysListed: days, inStock });

describe('« Créer un lot »', () => {
  it('2 to 5 articles in stock, each with a price', () => {
    expect(lotProblem([it_('a', 2000, 500)])).toBe('COUNT');
    expect(lotProblem(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => it_(x, 1000, 100)))).toBe('COUNT');
    expect(lotProblem([it_('a', 2000, 500), it_('b', 1000, 300, 40, false)])).toBe('NOT_IN_STOCK');
    expect(lotProblem([it_('a', 2000, 500), it_('b', null, 300)])).toBe('NO_PRICE');
  });

  it('−15 % on the summed prices, rounded down to the euro; the costs summed beside it', () => {
    // 25 + 30 + 20 = 75 € → 63,75 → 63 €; costs 5 + 8 + 4 = 17 €.
    expect(planSaleLot([it_('a', 2500, 500), it_('b', 3000, 800), it_('c', 2000, 400)])).toEqual({ itemIds: ['a', 'b', 'c'], totalAskCents: 7500, lotCents: 6300, costCents: 1700, costComplete: true, profitCents: 4600, atCost: false, discountPct: 15 });
  });

  it('a cost unknown: never counted as 0 in the profit; the lot never under the known costs', () => {
    expect(planSaleLot([it_('a', 2500, null), it_('b', 3000, 800)])).toMatchObject({ costComplete: false, profitCents: null, costCents: 800 });
    expect(planSaleLot([it_('a', 1000, 900), it_('b', 1000, 900)])).toMatchObject({ lotCents: 1800, atCost: true });
  });

  it('asleep first: 30 days online or more, the longest first', () => {
    expect(dormant([it_('a', 1000, 1, 10), it_('b', 1000, 1, 45), it_('c', 1000, 1, 90), it_('d', 1000, 1, 60, false)]).map((x) => x.itemId)).toEqual(['c', 'b']);
  });

  it('the listing text names every article and both prices', () => {
    const items = [it_('a', 2500, 500), it_('b', 3000, 800)];
    const l = lotListing(items, planSaleLot(items)!, (c) => `${c / 100} €`);
    expect(l.title).toBe('Lot de 2 articles · 46 € au lieu de 55 €');
    expect(l.description).toContain('– Article a (25 € à l’unité)');
  });

  it('the discount is the seller’s: −25 % typed, kept between 0 and 60 %', () => {
    const items = [it_('a', 2500, 500), it_('b', 3000, 800)];
    expect(planSaleLot(items, 25)).toMatchObject({ lotCents: 4100, discountPct: 25, profitCents: 2800 });
    expect(planSaleLot(items, 90)).toMatchObject({ discountPct: 60, lotCents: 2200 });
    expect(planSaleLot(items, -5)).toMatchObject({ discountPct: 0, lotCents: 5500 });
  });

  it('the lot’s listing: its brands in the title, one line per piece, the discount, 10 to 15 hashtags', () => {
    const items = [
      { ...it_('a', 2500, 500), title: 'Veste Harrington', brand: 'Ralph Lauren', category: 'JACKET' as const, size: 'M' },
      { ...it_('b', 3000, 800), title: 'Jean 501', brand: 'Levi’s', category: 'JEANS' as const, size: 'W32' },
    ];
    const l = lotListing(items, planSaleLot(items, 20)!, (c) => `${c / 100} €`);
    expect(l.title).toBe('Lot de 2 articles Ralph Lauren · Levi’s · 44 € (−20 %)');
    expect(l.description).toContain('(−20 %)');
    expect(l.description.split('\n').at(-1)).toBe(l.hashtags.join(' '));
    expect(l.hashtags.slice(0, 6)).toEqual(['#lot', '#lotvetements', '#ralphlauren', '#levis', '#veste', '#jean']);
    expect(lotHashtags(items).length).toBeGreaterThanOrEqual(10);
    expect(lotHashtags(items).length).toBeLessThanOrEqual(15);
  });
});
