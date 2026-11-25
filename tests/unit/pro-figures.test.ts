import { describe, expect, it } from 'vitest';
import { offerTiers, projectNet, rotation } from '@/intelligence/pro-figures';

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
