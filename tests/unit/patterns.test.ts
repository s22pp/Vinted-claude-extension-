import { describe, expect, it } from 'vitest';
import type { InventoryItem, Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { minePatterns } from '@/intelligence/patterns';
import type { ItemView, SaleView } from '@/intelligence/portfolio';

const NOW = Date.UTC(2026, 8, 25);
function sv(i: number, brand: string, days: number | null, category: InventoryItem['category'] = 'JACKET'): SaleView {
  const item = { id: `i${i}`, title: 't', brand, model: null, category, gender: null, size: 'M', condition: 'GOOD', material: null, era: null, photoUrl: null, purchasePriceCents: 1000, costDetail: null, purchaseDate: null, purchaseSource: null, status: 'SOLD', createdAt: 0, updatedAt: 0, meta: brand === 'Inconnue' ? { brand: { p: 'UNKNOWN', at: 0 } } : {}, isDemo: false } as InventoryItem;
  const sale: Sale = { id: `s${i}`, inventoryItemId: item.id, listingId: null, soldAt: NOW - i * DAY, salePriceCents: 3000, extraCostsCents: 0, status: 'COMPLETED', isDemo: false };
  return { sale, item, cost: 1000, profit: 2000, daysToSale: days, lastAskCents: null };
}
const views: ItemView[] = [];
const speed = (ps: ReturnType<typeof minePatterns>) => ps.filter((p) => p.kind === 'SPEED');

describe('speed patterns', () => {
  it('count only sales whose selling time is known, and say so', () => {
    // 6 Nike sales but only 5 dated, against 10 dated others.
    const rows = [...[20, 22, 25, 30, 28].map((d, i) => sv(i, 'Nike', d)), sv(5, 'Nike', null), ...Array.from({ length: 10 }, (_, i) => sv(10 + i, 'Levi’s', 6, 'JEANS'))];
    const p = speed(minePatterns(rows, views, { category: (c) => c })).find((x) => x.params.label === 'Nike')!;
    expect(p).toMatchObject({ code: 'speedSlow', sample: 5, baselineSample: 10, value: 25, baseline: 6 });
    expect(p.params.x).toBe(4.2);
  });

  it('no finding from sub-2-day medians (calendar-day noise) nor from an unknown brand', () => {
    const rows = [...Array.from({ length: 6 }, (_, i) => sv(i, 'Inconnue', 5)), ...Array.from({ length: 10 }, (_, i) => sv(10 + i, 'Nike', 1, 'SWEATSHIRT'))];
    const ps = speed(minePatterns(rows, views, { category: (c) => c }));
    expect(ps.find((x) => x.params.label === 'Inconnue')).toBeUndefined();
    expect(ps).toHaveLength(0);
  });
});
