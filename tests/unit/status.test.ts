import { parseWardrobeItem } from '@/data/adapters/vinted/parse';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import type { InventoryItem, Listing } from '@/domain/entities';
import { resolveImportedStatus } from '@/domain/status';
import { DAY } from '@/domain/time';
import { capitalSummary } from '@/intelligence/capital';
import { computeItemIntel, todayPriorities } from '@/intelligence/decision';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { buildSellerModel } from '@/intelligence/seller-model';

const base = { id: 1, title: 'Veste Harrington Ralph Lauren M', price: '59.0', photos: [] };

describe('Vinted status parsing', () => {
  it('maps verified flags: closed → sold, draft, hidden', () => {
    expect(parseWardrobeItem({ ...base, is_closed: true })!.status).toBe('SOLD');
    expect(parseWardrobeItem({ ...base, is_draft: true })!.status).toBe('DRAFT');
    expect(parseWardrobeItem({ ...base, is_hidden: true })!.status).toBe('HIDDEN');
    expect(parseWardrobeItem({ ...base })!.status).toBe('ACTIVE');
  });
  it('reads a reservation flag only when Vinted sends one', () => {
    expect(parseWardrobeItem({ ...base, is_reserved: true })).toMatchObject({ status: 'RESERVED', reservedKnown: true });
    expect(parseWardrobeItem({ ...base, is_reserved: false })).toMatchObject({ status: 'ACTIVE', reservedKnown: true });
    expect(parseWardrobeItem({ ...base })!.reservedKnown).toBe(false);
  });
});

describe('status after re-import', () => {
  const manual = { status: 'RESERVED' as const, meta: { status: { p: 'USER_PROVIDED' as const, at: 0 } } };
  it('keeps a hand-marked reservation when Vinted exposes no flag', () => {
    expect(resolveImportedStatus(manual, 'ACTIVE', false)).toEqual({ status: 'RESERVED', p: 'USER_PROVIDED' });
  });
  it('Vinted wins when it does say something', () => {
    expect(resolveImportedStatus(manual, 'ACTIVE', true).status).toBe('LISTED');
    expect(resolveImportedStatus(manual, 'SOLD', false).status).toBe('SOLD');
  });
});

const NOW = Date.UTC(2026, 8, 24);
const item = (id: string, status: InventoryItem['status']): InventoryItem => ({
  id, title: 'Veste', brand: 'Ralph Lauren', model: null, category: 'JACKET', gender: null, size: null, condition: null, material: null, era: null,
  photoUrl: null, purchasePriceCents: 2000, purchaseDate: NOW - 90 * DAY, purchaseSource: null, status, createdAt: 0, updatedAt: 0, meta: {}, isDemo: false,
});
const listing = (id: string, itemId: string, status: Listing['status']): Listing => ({
  id, inventoryItemId: itemId, platform: 'vinted', platformListingId: null, url: null, title: 'Veste', priceCents: 9000, views: 900, favorites: 1,
  listedAt: NOW - 80 * DAY, removedAt: null, soldAt: status === 'SOLD' ? NOW - DAY : null, status, lastObservedAt: NOW, isDemo: false,
});

describe('reserved and sold-without-price items', () => {
  const views = buildItemViews(
    [item('r', 'RESERVED'), item('s', 'SOLD')],
    [listing('lr', 'r', 'RESERVED'), listing('ls', 's', 'SOLD')],
    [],
    NOW,
  );
  it('a reserved item is still stock (capital) but never gets a reprice', () => {
    const r = views.find((v) => v.item.id === 'r')!;
    expect(r.inStock).toBe(true);
    expect(r.current?.id).toBe('lr');
    const intel = computeItemIntel(r, null, null, null, null, NOW);
    expect(intel.stagnation).toBeNull();
    expect(intel.recommendation).toBeNull();
  });
  it('sold on Vinted without a price surfaces as a priority', () => {
    const intel = views.filter((v) => v.inStock).map((v) => computeItemIntel(v, null, null, null, null, NOW));
    const model = buildSellerModel(views, buildSaleViews(views, []), { category: (c) => c });
    const p = todayPriorities(intel, capitalSummary(views, [], NOW), model, views);
    expect(p.find((x) => x.code === 'MISSING_SALE')?.itemIds).toEqual(['s']);
    expect(p.find((x) => x.code === 'RESERVED')?.itemIds).toEqual(['r']);
  });
});

describe('recording a sale', () => {
  it('works on an item already sold on Vinted, and a second entry corrects instead of duplicating', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.items.put(item('s', 'SOLD'));
    await db.listings.put(listing('ls', 's', 'SOLD'));
    await repo.recordSale('s', 7500);
    await repo.recordSale('s', 7000);
    const sales = await db.sales.toArray();
    expect(sales).toHaveLength(1);
    expect(sales[0]!.salePriceCents).toBe(7000);
    expect(sales[0]!.listingId).toBe('ls');
    expect(sales[0]!.soldAt).toBe(NOW - DAY);
  });

  it('manual reservation round-trips', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.items.put(item('a', 'LISTED'));
    await db.listings.put(listing('la', 'a', 'ACTIVE'));
    await repo.setReserved('a', true);
    expect((await db.items.get('a'))!.status).toBe('RESERVED');
    expect((await db.listings.get('la'))!.status).toBe('RESERVED');
    expect((await db.items.get('a'))!.meta.status?.p).toBe('USER_PROVIDED');
    await repo.setReserved('a', false);
    expect((await db.items.get('a'))!.status).toBe('LISTED');
  });
});

import { fillTemplate, templateFromObserved } from '@/data/adapters/vinted/vinted-adapter';
import { isAllowedApi } from '@/data/adapters/vinted/protocol';

describe('search endpoint learned from the page', () => {
  it('keeps the observed path and params, swaps in our text, drops paging', () => {
    const t = templateFromObserved('/api/v9/some/search?search_text=nike&page=3&per_page=24&order=newest_first')!;
    expect(t).toBe('/api/v9/some/search?search_text={q}&per_page=24&order=newest_first');
    expect(fillTemplate(t, 'veste ralph lauren')).toBe('/api/v9/some/search?search_text=veste%20ralph%20lauren&per_page=24&order=newest_first');
  });
  it('ignores non-search calls', () => {
    expect(templateFromObserved('/api/v2/users/current')).toBeNull();
    expect(templateFromObserved('/web/api/whatever?search_text=x')).toBeNull();
  });
  it('the content script only allows read paths it knows or observed searches', () => {
    expect(isAllowedApi('/api/v2/catalog/items?search_text=a')).toBe(true);
    expect(isAllowedApi('/api/v9/other/search?search_text=a')).toBe(true);
    expect(isAllowedApi('/api/v2/items/123/delete')).toBe(false);
  });
});
