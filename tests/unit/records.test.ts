import { describe, expect, it } from 'vitest';
import type { SaleView } from '@/intelligence/portfolio';
import { salesRecords } from '@/intelligence/records';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
let n = 0;
const sale = (iso: string, cents: number, x: { profit?: number | null; days?: number | null; refunded?: boolean; undated?: boolean; title?: string } = {}): SaleView =>
  ({
    sale: { id: `s${++n}`, inventoryItemId: `i${n}`, listingId: null, soldAt: at(iso), salePriceCents: cents, extraCostsCents: 0, status: x.refunded ? 'REFUNDED' : 'COMPLETED', dateKnown: !x.undated },
    item: { id: `i${n}`, title: x.title ?? `Article ${n}` },
    cost: null,
    profit: x.profit ?? null,
    daysToSale: x.days ?? null,
    lastAskCents: null,
  }) as unknown as SaleView;

describe('sales records: from the sales ERA holds, nothing estimated', () => {
  it('no sale: no record, the first step next', () => {
    const r = salesRecords([], at('2026-09-30'));
    expect(r).toMatchObject({ count: 0, revenue: 0, reached: [], bestSale: null, bestProfit: null, bestMonth: null, fastest: null, streak: { longest: 0, current: 0 } });
    expect(r.next.count).toEqual({ value: 1, left: 1 });
  });

  it('steps crossed with their date; a refunded sale never counts', () => {
    const xs = [
      sale('2026-06-02', 6000),
      ...Array.from({ length: 9 }, (_, i) => sale(`2026-07-${String(i + 1).padStart(2, '0')}`, 5000)),
      sale('2026-08-01', 9000, { refunded: true }),
    ];
    const r = salesRecords(xs, at('2026-09-30'));
    expect(r.count).toBe(10);
    expect(r.revenue).toBe(51_000);
    expect(r.reached.filter((m) => m.kind === 'COUNT')).toEqual([
      { kind: 'COUNT', value: 1, at: at('2026-06-02') },
      { kind: 'COUNT', value: 10, at: at('2026-07-09') },
    ]);
    // 100 € crossed by the 2nd sale (60 + 50), 500 € by the 10th.
    expect(r.reached.filter((m) => m.kind === 'REVENUE').map((m) => [m.value, m.at])).toEqual([
      [10_000, at('2026-07-01')],
      [50_000, at('2026-07-09')],
    ]);
    expect(r.next.count).toEqual({ value: 25, left: 15 });
    expect(r.bestSale).toMatchObject({ cents: 6000, at: at('2026-06-02') });
  });

  it('best month and runs of months from dated sales only; undated sales said, never placed', () => {
    const r = salesRecords([sale('2026-06-10', 2000), sale('2026-07-10', 3000), sale('2026-07-20', 3000), sale('2026-08-05', 1000), sale('2026-09-01', 99_000, { undated: true })], at('2026-09-15'));
    expect(r.bestMonth).toMatchObject({ start: new Date(2026, 6, 1).getTime(), revenue: 6000, count: 2 });
    expect(r.streak).toEqual({ longest: 3, current: 3 });
    expect(r.undated).toBe(1);
    // The best sale is undated: its amount is known, its date is not.
    expect(r.bestSale).toMatchObject({ cents: 99_000, at: null });
    // Two months without a sale: the run is over.
    expect(salesRecords([sale('2026-05-10', 2000), sale('2026-06-10', 2000)], at('2026-09-15')).streak).toEqual({ longest: 2, current: 0 });
  });

  it('best profit only when known and positive; fastest only with a real publication date', () => {
    const r = salesRecords([sale('2026-07-01', 3000, { profit: -500, days: 3 }), sale('2026-07-02', 2000, { profit: 1200, days: null }), sale('2026-07-03', 4000, { profit: null, days: 12 })], at('2026-09-01'));
    expect(r.bestProfit).toMatchObject({ cents: 1200 });
    expect(r.fastest).toMatchObject({ days: 3, cents: 3000 });
    expect(salesRecords([sale('2026-07-01', 3000, { profit: -500 })], at('2026-09-01')).bestProfit).toBeNull();
  });
});
