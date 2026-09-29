import { describe, expect, it } from 'vitest';
import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { businessReview, periodStats, reviewCsv } from '@/intelligence/review';

// 15 September 2026, noon.
const NOW = Date.UTC(2026, 8, 15, 12);
const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  title: `Article ${id}`,
  brand: 'Nike',
  model: null,
  category: 'SWEATSHIRT',
  gender: null,
  size: 'M',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  photoUrl: null,
  purchasePriceCents: 1000,
  costDetail: null,
  purchaseDate: null,
  purchaseSource: null,
  status: 'LISTED',
  createdAt: 0,
  updatedAt: 0,
  meta: {},
  isDemo: false,
  ...over,
});
const listing = (id: string, itemId: string, listedAt: number, over: Partial<Listing> = {}): Listing => ({
  id,
  inventoryItemId: itemId,
  platform: 'vinted',
  platformListingId: null,
  url: null,
  title: 't',
  priceCents: 4000,
  views: 10,
  favorites: 1,
  listedAt,
  removedAt: null,
  soldAt: null,
  status: 'ACTIVE',
  lastObservedAt: NOW,
  isDemo: false,
  ...over,
});
const sale = (id: string, itemId: string, soldAt: number, over: Partial<Sale> = {}): Sale => ({ id, inventoryItemId: itemId, listingId: null, soldAt, salePriceCents: 3000, extraCostsCents: 0, status: 'COMPLETED', isDemo: false, ...over });

function build(items: InventoryItem[], listings: Listing[], sales: Sale[]) {
  const views = buildItemViews(items, listings, sales, NOW);
  return { views, sales: buildSaleViews(views, sales) };
}

describe('pilotage: the business month by month', () => {
  it('counts a period from real dates only: refunds apart, unknown costs make the profit a lower bound', () => {
    const items = [
      item('a', { status: 'SOLD' }),
      item('b', { status: 'SOLD', purchasePriceCents: null }),
      item('c', { status: 'SOLD' }),
      item('d', { status: 'SOLD' }),
    ];
    // Imported from Vinted (a Vinted id) with no publication date read: ERA only knows when it first saw them.
    const listings = ['a', 'b', 'c', 'd'].map((id, i) => listing(`l${id}`, id, NOW - 20 * DAY, { platformListingId: String(100 + i) }));
    const sales = [
      sale('s1', 'a', NOW - 5 * DAY, { salePriceCents: 4000 }),
      sale('s2', 'b', NOW - 4 * DAY, { salePriceCents: 2000 }),
      sale('s3', 'c', NOW - 3 * DAY, { status: 'REFUNDED', salePriceCents: 5000 }),
      // Vinted gave no date: soldAt is the import day, it belongs to no period.
      sale('s4', 'd', NOW - 1 * DAY, { dateKnown: false }),
    ];
    const b = build(items, listings, sales);
    const p = periodStats(b.sales, b.views, NOW - 30 * DAY, NOW + 1);
    expect(p.sales).toBe(2);
    expect(p.revenueCents).toBe(6000);
    // Only a's profit is known (4000 − 1000); b's cost is unknown: a lower bound, said so.
    expect(p.profitCents).toBe(3000);
    expect(p.profitPartial).toBe(true);
    expect(p.refunds).toBe(1);
    expect(p.refundedCents).toBe(5000);
    expect(p.refundRate).toBeCloseTo(1 / 3);
    expect(p.basketCents).toBe(3000);
    // Listings imported from Vinted without a real publication date are not "new listings".
    expect(p.listed).toBe(0);
    expect(p.daysToSell).toBeNull();
    expect(businessReview(b.sales, b.views, NOW).undated).toBe(1);
  });

  it('new listings, purchases and selling speed only where the dates are real', () => {
    const items = [item('a', { purchaseDate: NOW - 10 * DAY, status: 'SOLD' }), item('b', { purchaseDate: NOW - 8 * DAY, purchasePriceCents: null }), item('c', { purchaseDate: NOW - 90 * DAY })];
    const listings = [listing('la', 'a', NOW - 9 * DAY, { platformListingId: null }), listing('lb', 'b', NOW - 7 * DAY), listing('lc', 'c', NOW - 80 * DAY)];
    const b = build(items, listings, [sale('s', 'a', NOW - 2 * DAY)]);
    const p = periodStats(b.sales, b.views, NOW - 30 * DAY, NOW + 1);
    expect(p.listed).toBe(2);
    expect(p.bought).toBe(2);
    expect(p.spentCents).toBe(1000);
    expect(p.spentPartial).toBe(true);
    expect(p.daysToSell).toBe(7);
    expect(p.daysToSellN).toBe(1);
  });

  it('twelve months, the current one last; a thin month says it is thin; the CSV opens in a French spreadsheet', () => {
    const items = [item('a', { status: 'SOLD' }), item('b')];
    const b = build(items, [listing('la', 'a', NOW - 100 * DAY), listing('lb', 'b', NOW - 40 * DAY)], [sale('s', 'a', NOW - 40 * DAY, { salePriceCents: 2550 })]);
    const r = businessReview(b.sales, b.views, NOW);
    expect(r.months).toHaveLength(12);
    expect(r.months[11]!.from).toBeLessThanOrEqual(NOW);
    expect(r.months.reduce((n, m) => n + m.sales, 0)).toBe(1);
    expect(r.prev30.sales).toBe(1);
    expect(r.last30.sales).toBe(0);
    expect(r.lowData).toBe(true);
    expect(r.today).toEqual({ inStock: 1, online: 1, capitalCents: 1000, capitalUnknown: 0 });
    const csv = reviewCsv(r, (from) => new Date(from).toISOString().slice(0, 7));
    expect(csv.startsWith('﻿Mois;Ventes;')).toBe(true);
    expect(csv).toContain(';25,50;');
    expect(csv.trim().split('\r\n')).toHaveLength(13);
  });
});
