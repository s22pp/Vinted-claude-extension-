import { describe, expect, it } from 'vitest';
import { offerTiers, portfolioFigures, projectNet, rotation } from '@/intelligence/pro-figures';

describe('the projected net: asking price less the usual negotiation, less the full cost', () => {
  it('59 € asked, 18 € paid, 10 % negotiation: 53,10 € net, 35,10 € profit, 195 % return', () => {
    const p = projectNet(5900, 1800);
    expect(p.netSaleCents).toBe(5310);
    expect(p.profitCents).toBe(3510);
    expect(p.roi).toBeCloseTo(1.95, 2);
  });
  it('extras count in the cost; another negotiation rate is the seller’s', () => {
    expect(projectNet(5000, 1500, 500, 0.2)).toEqual({ netSaleCents: 4000, profitCents: 2000, roi: 1 });
  });
  it('an unknown cost gives no profit and no return — never zero', () => {
    expect(projectNet(5900, null)).toEqual({ netSaleCents: 5310, profitCents: null, roi: null });
  });
});

describe('three offer tiers', () => {
  it('floor at a 30 % return (rounded up to the euro), target −10 % (nearest euro), firm', () => {
    expect(offerTiers(5900, 1800)).toEqual({ floor: 2400, target: 5300, firm: 5900 });
    expect(offerTiers(4500, 2010, 300)).toEqual({ floor: 3100, target: 4100, firm: 4500 });
  });
  it('no floor without a cost', () => {
    expect(offerTiers(5900, null).floor).toBeNull();
  });
});

describe('rotation by days online', () => {
  it('fresh up to 14 days, to watch until 29, stalling from 30', () => {
    expect(rotation(0, 0, 0).state).toBe('FRESH');
    expect(rotation(14, 9, 0).state).toBe('FRESH');
    expect(rotation(15, 0, 0)).toEqual({ state: 'WATCH', advice: null });
    expect(rotation(29, 0, 0).state).toBe('WATCH');
    expect(rotation(30, 0, 0)).toEqual({ state: 'STALE', advice: 'REPOST_CUT' });
  });
  it('to watch with 5 favourites or more and no offer: a group offer to the favourites', () => {
    expect(rotation(20, 5, 0).advice).toBe('GROUP_OFFER');
    expect(rotation(20, 5, 1).advice).toBeNull();
    expect(rotation(20, 4, 0).advice).toBeNull();
  });
  it('unknown days: no label', () => {
    expect(rotation(null, 3, 0)).toEqual({ state: null, advice: null });
  });
});

describe('portfolio figures', () => {
  const now = new Date(2026, 10, 20, 12).getTime();
  const day = 86_400_000;
  const sold = (price: number, cost: number | null, soldAt: number, brand = 'Baracuta', listedDaysBefore: number | null = 10) => ({
    inStock: false,
    cost,
    askPrice: null,
    brand,
    firstListedAt: listedDaysBefore === null ? null : soldAt - listedDaysBefore * day,
    firstListedKnown: listedDaysBefore !== null,
    sale: { soldAt, salePriceCents: price, status: 'COMPLETED' },
  });
  const stock = (ask: number | null, cost: number | null) => ({ inStock: true, cost, askPrice: ask, brand: 'Levi’s', firstListedAt: null, firstListedKnown: false, sale: null });

  it('this month’s profit on known costs, against last month’s', () => {
    const f = portfolioFigures([sold(6000, 2000, now - 2 * day), sold(4000, 1000, new Date(2026, 9, 10).getTime())], now);
    expect(f.month).toMatchObject({ profitCents: 4000, sales: 1, missing: 0, prevProfitCents: 3000 });
    expect(f.month.deltaPct).toBeCloseTo(1 / 3, 6);
  });

  it('a sale without a cost: counted as missing, never as zero; no comparison then', () => {
    const f = portfolioFigures([sold(6000, 2000, now - day), sold(3000, null, now - day), sold(4000, 1000, new Date(2026, 9, 10).getTime())], now);
    expect(f.month.profitCents).toBe(4000);
    expect(f.month.missing).toBe(1);
    expect(f.month.deltaPct).toBeNull();
  });

  it('capital in the stock (known costs) and its potential after the usual negotiation', () => {
    const f = portfolioFigures([stock(5900, 1800), stock(3000, null), stock(null, 500)], now);
    expect(f.immobilized).toEqual({ cents: 2300, missing: 1, n: 3 });
    expect(f.potential).toEqual({ cents: 5310 + 2700, n: 2 });
  });

  it('average days to sell, only where the listing date is real', () => {
    const f = portfolioFigures([sold(5000, 1000, now - day, 'A', 10), sold(5000, 1000, now - day, 'A', 20), sold(5000, 1000, now - day, 'A', null)], now);
    expect(f.rotation).toEqual({ days: 15, n: 2 });
  });

  it('brands by return on cost, best first; unknown brands and costs left out', () => {
    const f = portfolioFigures([sold(6000, 2000, now - day, 'Baracuta'), sold(3000, 2000, now - day, 'Ralph Lauren'), sold(9000, null, now - day, 'Stone Island'), sold(2000, 1000, now - day, 'Inconnue')], now);
    expect(f.brands.map((b) => [b.brand, Math.round(b.roi * 100)])).toEqual([
      ['Baracuta', 200],
      ['Ralph Lauren', 50],
    ]);
  });
});
