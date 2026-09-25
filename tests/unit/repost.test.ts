import { describe, expect, it } from 'vitest';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import type { DomainEvent, InventoryItem, Listing, ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { skuOf } from '@/intelligence/listing';
import { lastReposts, matchRepost, repostEffect } from '@/intelligence/repost';

const NOW = Date.UTC(2026, 8, 25);
const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  title: 'Sweat Nike vintage L',
  brand: 'Nike',
  model: null,
  category: 'SWEATSHIRT',
  gender: null,
  size: 'L',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  photoUrl: null,
  purchasePriceCents: 800,
  costDetail: null,
  purchaseDate: NOW - 60 * DAY,
  purchaseSource: null,
  status: 'LISTED',
  createdAt: 0,
  updatedAt: 0,
  meta: {},
  isDemo: false,
  ...over,
});
const listing = (id: string, itemId: string, over: Partial<Listing> = {}): Listing => ({
  id,
  inventoryItemId: itemId,
  platform: 'vinted',
  platformListingId: id,
  url: null,
  title: 'Sweat Nike vintage L',
  priceCents: 2500,
  views: 40,
  favorites: 0,
  listedAt: NOW - 30 * DAY,
  removedAt: null,
  soldAt: null,
  status: 'ACTIVE',
  lastObservedAt: NOW - DAY,
  isDemo: false,
  ...over,
});
const obs = (listingId: string, at: number, views: number): ListingObservation => ({ id: `${listingId}-${at}`, listingId, inventoryItemId: 'a', at, priceCents: 2500, views, favorites: 0, provenance: 'OBSERVED' });

describe('matchRepost — the same article under a new announcement', () => {
  const a = { listing: listing('100', 'a'), item: item('a') };
  const b = { listing: listing('200', 'b', { title: 'Sweat Nike vintage L', priceCents: 1500 }), item: item('b') };

  it('same title, brand and size: recognised (inferred)', () => {
    expect(matchRepost({ title: 'Sweat  NIKE vintage l', brand: 'Nike', size: 'L', priceCents: 2400 }, [a])).toEqual({ candidate: a, basis: 'TITLE' });
  });

  it('ERA reference in the new title wins over any title', () => {
    const m = matchRepost({ title: `Sweat Adidas ${skuOf('b')}`, brand: 'Adidas', size: 'M', priceCents: 9000 }, [a, b]);
    expect(m).toEqual({ candidate: b, basis: 'SKU' });
  });

  it('a different brand or size is another article; an unknown one never blocks', () => {
    expect(matchRepost({ title: 'Sweat Nike vintage L', brand: 'Adidas', size: 'L', priceCents: 2500 }, [a])).toBeNull();
    expect(matchRepost({ title: 'Sweat Nike vintage L', brand: 'Nike', size: 'XL', priceCents: 2500 }, [a])).toBeNull();
    expect(matchRepost({ title: 'Sweat Nike vintage L', brand: null, size: null, priceCents: 2500 }, [{ ...a, item: item('a', { brand: 'Inconnue', size: null }) }])?.basis).toBe('TITLE');
    expect(matchRepost({ title: 'Pull Nike vintage L', brand: 'Nike', size: 'L', priceCents: 2500 }, [a])).toBeNull();
  });

  it('several units under one title: the closest previous price is the same unit', () => {
    expect(matchRepost({ title: 'Sweat Nike vintage L', brand: 'Nike', size: 'L', priceCents: 1400 }, [a, b])?.candidate).toBe(b);
  });
});

describe('repostEffect — measured, never assumed', () => {
  const at = NOW - 10 * DAY;
  const before = [obs('100', at - 9 * DAY, 20), obs('100', at - 2 * DAY, 27)]; // 1 view/day over its last week
  it('compares the first week of the new announcement with the last week of the old one', () => {
    expect(repostEffect(before, [obs('200', at + 7 * DAY, 21)], at)).toBeCloseTo(2); // 3/day vs 1/day
    expect(repostEffect(before, [obs('200', at + 7 * DAY, 6)], at)).toBeCloseTo(-0.14, 1);
  });
  it('stays unknown until both weeks are observed', () => {
    expect(repostEffect(before, [obs('200', at + 2 * DAY, 9)], at)).toBeNull();
    expect(repostEffect([obs('100', at - 2 * DAY, 27)], [obs('200', at + 7 * DAY, 21)], at)).toBeNull();
  });
});

describe('lastReposts', () => {
  const ev = (id: string, at: number, data: DomainEvent['data']): DomainEvent => ({ id, type: 'LISTING_REPUBLISHED', at, inventoryItemId: 'a', listingId: '200', data, provenance: 'INFERRED', isDemo: false });
  it('keeps the latest repost of each article with what Vinted reset, and counts them', () => {
    const m = lastReposts([ev('e1', NOW - 40 * DAY, { from: '50', basis: 'TITLE' }), ev('e2', NOW - 5 * DAY, { from: '100', basis: 'SKU', viewsLost: 57, favoritesLost: 9, priceFrom: 3000, priceTo: 2500 })], [], NOW);
    expect(m.get('a')).toMatchObject({ eventId: 'e2', daysSince: 5, basis: 'SKU', viewsLost: 57, favoritesLost: 9, priceFrom: 3000, priceTo: 2500, count: 2, effect: null });
  });
});

describe('splitRepost — a wrong title match is undone in one click', () => {
  it('the new announcement becomes its own article; the old one keeps its history', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.items.put(item('a'));
    await db.listings.bulkPut([listing('100', 'a', { status: 'REMOVED', removedAt: NOW - 3 * DAY }), listing('200', 'a', { listedAt: NOW - 3 * DAY, priceCents: 2000 })]);
    await db.observations.bulkPut([{ ...obs('200', NOW - DAY, 5), inventoryItemId: 'a' }]);
    const base = { inventoryItemId: 'a', listingId: '200', provenance: 'INFERRED' as const, isDemo: false, at: NOW - 3 * DAY };
    await db.events.bulkPut([
      { ...base, id: 'rp', type: 'LISTING_REPUBLISHED', data: { from: '100', basis: 'TITLE', priceFrom: 2500, priceTo: 2000, price: 2000 } },
      { ...base, id: 'pc', type: 'PRICE_CHANGED', data: { from: 2500, to: 2000 }, provenance: 'OBSERVED' },
    ]);
    const id = await repo.splitRepost('rp', NOW);
    expect(id).not.toBeNull();
    const fresh = (await db.items.get(id!))!;
    expect(fresh).toMatchObject({ purchasePriceCents: null, purchaseDate: null, brand: 'Nike' });
    expect((await db.listings.get('200'))!.inventoryItemId).toBe(id);
    expect((await db.observations.where('listingId').equals('200').first())!.inventoryItemId).toBe(id);
    expect(await db.events.get('pc')).toBeUndefined();
    expect((await db.events.get('rp'))!).toMatchObject({ type: 'LISTING_PUBLISHED', inventoryItemId: id });
    expect((await db.items.get('a'))!.status).toBe('ARCHIVED');
  });
});

describe('condenseEngagement — a readable item history', () => {
  it('keeps, per announcement, the first reading, favourite moves and the latest; nothing else', async () => {
    const { condenseEngagement } = await import('@/intelligence/timeline');
    const e = (id: string, listingId: string, favorites: number, type: DomainEvent['type'] = 'ENGAGEMENT_OBSERVED'): DomainEvent => ({ id, type, at: 0, inventoryItemId: 'a', listingId, data: { views: 1, favorites }, provenance: 'OBSERVED', isDemo: false });
    const out = condenseEngagement([e('1', 'x', 0), e('2', 'x', 0), e('p', 'x', 0, 'PRICE_CHANGED'), e('3', 'x', 2), e('4', 'x', 2), e('5', 'x', 2), e('6', 'y', 0)]);
    expect(out.map((x) => x.id)).toEqual(['1', 'p', '3', '5', '6']);
  });
});
