import { describe, expect, it } from 'vitest';
import { PrepSchema } from '@/domain/entities';
import { hourlyReport } from '@/intelligence/hourly';

const sale = (id: string, brand: string, category: string, profit: number | null, status = 'COMPLETED') => ({ sale: { id: `s${id}`, status }, item: { id, brand, category }, profit }) as never;
const prep = (itemId: string, seconds: number) => PrepSchema.parse({ itemId, startedAt: 0, seconds });

describe('profit per hour of work', () => {
  it('measured listing time where it exists, your median elsewhere; your parcel and sourcing estimates on top', () => {
    const sales = [sale('a', 'Nike', 'SWEATSHIRT', 2000), sale('b', 'Nike', 'SWEATSHIRT', 1000), sale('c', 'Levi’s', 'JEANS', 3000), sale('d', 'Zara', 'KNIT', null), sale('e', 'Nike', 'SWEATSHIRT', 5000, 'REFUNDED')];
    const preps = new Map([
      ['a', prep('a', 600)],
      ['b', prep('b', 1200)],
      ['x', prep('x', 900)],
    ]);
    const r = hourlyReport(sales, preps, { shipMin: 10, sourceMin: 20, listMin: 12 });
    // a: 10 + 30 = 40 min · b: 20 + 30 = 50 · c: median(10, 20, 15) = 15 + 30 = 45 → 135 min for 60 € → 26,67 €/h.
    expect(r).toMatchObject({ sales: 3, profitCents: 6000, minutes: 135, perHourCents: 2667, measured: 2, listBasis: 'MEDIAN' });
    expect(r.byNiche).toEqual([{ key: 'nike|SWEATSHIRT', brand: 'Nike', category: 'SWEATSHIRT', sales: 2, profitCents: 3000, minutes: 90, perHourCents: 2000 }]);
  });
  it('no timed sheet at all: your estimate, said so; under 3 sales, no figure', () => {
    const r = hourlyReport([sale('a', 'Nike', 'SWEATSHIRT', 2000), sale('b', 'Nike', 'SWEATSHIRT', 1000)], new Map(), { shipMin: 10, sourceMin: 20, listMin: 12 });
    expect(r).toMatchObject({ perHourCents: null, listBasis: 'ESTIMATE' });
  });
});
