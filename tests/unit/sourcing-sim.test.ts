import { describe, expect, it } from 'vitest';
import { simulateSourcing } from '@/intelligence/sourcing-sim';

describe('sourcing simulator « Est-ce que j’achète ? »', () => {
  it('the resale is taken 10 % lower (haggling): profit, ROI and multiple on the real cost', () => {
    const r = simulateSourcing({ buyCents: 1000, feesCents: 0, resaleCents: 5000 });
    expect(r).toMatchObject({ costCents: 1000, netResaleCents: 4500, profitCents: 3500, verdict: 'GO', maxBuyCents: 2500 });
    expect(r.roi).toBeCloseTo(3.5);
    expect(r.multiple).toBeCloseTo(4.5);
  });

  it('GO from ROI 80 % and 20 € of profit, both included', () => {
    expect(simulateSourcing({ buyCents: 2500, feesCents: 0, resaleCents: 5000 })).toMatchObject({ profitCents: 2000, verdict: 'GO' });
    expect(simulateSourcing({ buyCents: 2000, feesCents: 200, resaleCents: 5000 })).toMatchObject({ costCents: 2200, profitCents: 2300, verdict: 'GO' });
  });

  it('NÉGOCIER in between, with the most to pay to reach GO', () => {
    const r = simulateSourcing({ buyCents: 2800, feesCents: 0, resaleCents: 5000 });
    expect(r).toMatchObject({ profitCents: 1700, verdict: 'NEGOTIATE', maxBuyCents: 2500 });
    // ROI under 80 % but over 40 %, profit fine: still a price to negotiate.
    expect(simulateSourcing({ buyCents: 6000, feesCents: 0, resaleCents: 10000 })).toMatchObject({ profitCents: 3000, verdict: 'NEGOTIATE', maxBuyCents: 5000 });
  });

  it('PASSER under 12 € of profit or under 40 % of ROI', () => {
    expect(simulateSourcing({ buyCents: 3000, feesCents: 0, resaleCents: 4500 })).toMatchObject({ profitCents: 1050, verdict: 'PASS', maxBuyCents: 2000 });
    expect(simulateSourcing({ buyCents: 8000, feesCents: 0, resaleCents: 12000 })).toMatchObject({ profitCents: 2800, verdict: 'PASS' });
  });

  it('a resale too low for any price to reach 20 € of profit: no maximum to propose', () => {
    expect(simulateSourcing({ buyCents: 500, feesCents: 0, resaleCents: 2000 })).toMatchObject({ profitCents: 1300, verdict: 'NEGOTIATE', maxBuyCents: null });
  });

  it('bought on Vinted: the buyer protection (0,70 € + 5 %) is in the cost, and the maximum is a listed price', () => {
    const r = simulateSourcing({ buyCents: 1000, feesCents: 0, resaleCents: 5000, onVinted: true });
    expect(r).toMatchObject({ costCents: 1120, profitCents: 3380, verdict: 'GO', maxBuyCents: 2300 });
  });

  it('a free piece: no ROI to divide by, the profit decides', () => {
    expect(simulateSourcing({ buyCents: 0, feesCents: 0, resaleCents: 3000 })).toMatchObject({ roi: null, multiple: null, profitCents: 2700, verdict: 'GO' });
  });
});
