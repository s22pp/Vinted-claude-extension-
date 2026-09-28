import type { InventoryItem, Listing, ListingObservation, Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { favoriteGains } from '@/intelligence/favorites';
import { shouldObserve } from '@/domain/observe';
import { goalProgress } from '@/intelligence/goal';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { DEFAULT_REPLIES, type ReplyKit, conversationItem, fillReply, hasBlanks, kitReplies } from '@/intelligence/replies';

// 15 September 2026, noon: half of a 30-day month has elapsed.
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
  platformListingId: null,
  url: null,
  title: 't',
  priceCents: 4000,
  views: 10,
  favorites: 1,
  listedAt: NOW - 50 * DAY,
  removedAt: null,
  soldAt: null,
  status: 'ACTIVE',
  lastObservedAt: NOW,
  isDemo: false,
  ...over,
});

describe('monthly goal', () => {
  it('projects the month at the current pace and turns the gap into sales and listings', () => {
    // 4 sales of 50 € this month (days 2–10), 20 items listed, 4 sales in the last 30 days.
    const soldItems = Array.from({ length: 4 }, (_, i) => item(`s${i}`, { status: 'SOLD' }));
    const sales: Sale[] = soldItems.map((it, i) => ({ id: `sale${i}`, inventoryItemId: it.id, listingId: `ls${i}`, soldAt: Date.UTC(2026, 8, 2 + 2 * i, 12), salePriceCents: 5000, extraCostsCents: 0, status: 'COMPLETED', isDemo: false }));
    const stock = Array.from({ length: 20 }, (_, i) => item(`k${i}`));
    const views = buildItemViews([...soldItems, ...stock], [...soldItems.map((it, i) => listing(`ls${i}`, it.id, { status: 'SOLD' })), ...stock.map((it) => listing(`l${it.id}`, it.id))], sales, NOW);
    const g = goalProgress({ kind: 'REVENUE', cents: 100000 }, buildSaleViews(views, sales), views, NOW);
    expect(g.currentCents).toBe(20000);
    expect(g.projectedCents).toBe(Math.round((20000 / 14.5) * 30 / 100) * 100); // to the euro
    expect(g.onTrack).toBe(false);
    expect(g.perSale).toEqual({ cents: 5000, n: 4 });
    expect(g.salesNeeded).toBe(16); // 800 € / 50 €
    expect(g.salesExpected).toBe(Math.floor((4 / 14.5) * 15.5));
    expect(g.salesGap).toBe(16 - g.salesExpected);
    expect(g.listingsPerSale).toMatchObject({ n: 5, sales30: 4, listed: 20 });
    expect(g.extraListings).toBe(g.salesGap! * 5);
  });

  it('too few sales: no per-sale value, no invented listing count', () => {
    const views = buildItemViews([item('a')], [listing('l', 'a')], [], NOW);
    const g = goalProgress({ kind: 'PROFIT', cents: 50000 }, [], views, NOW);
    expect(g.perSale).toBeNull();
    expect(g.salesNeeded).toBeNull();
    expect(g.extraListings).toBeNull();
  });
});

describe('favourites gained since the previous import', () => {
  it('reads ERA’s own observation history: fresh gains only', () => {
    const views = buildItemViews([item('a'), item('b'), item('c')], [listing('la', 'a'), listing('lb', 'b'), listing('lc', 'c')], [], NOW);
    const obs = (listingId: string, itemId: string, at: number, favorites: number): ListingObservation => ({ id: `${listingId}${at}`, listingId, inventoryItemId: itemId, at, priceCents: 4000, views: 10, favorites, provenance: 'OBSERVED' });
    const g = favoriteGains(
      views,
      [obs('la', 'a', NOW - 3 * DAY, 2), obs('la', 'a', NOW - DAY, 5), obs('lb', 'b', NOW - 20 * DAY, 1), obs('lb', 'b', NOW - 10 * DAY, 4), obs('lc', 'c', NOW - DAY, 3)],
      NOW,
    );
    expect(g).toEqual([{ itemId: 'a', gained: 3, now: 5, since: NOW - 3 * DAY }]);
  });

  it('an import that found nothing new (no observation stored since) means no favourite gained since the previous import', () => {
    const obs = (at: number, favorites: number): ListingObservation => ({ id: `o${at}`, listingId: 'la', inventoryItemId: 'a', at, priceCents: 4000, views: 10, favorites, provenance: 'OBSERVED' });
    const rows = [obs(NOW - 2 * DAY, 2), obs(NOW - DAY, 5)];
    const seen = (lastObservedAt: number) => buildItemViews([item('a')], [{ ...listing('la', 'a'), lastObservedAt, lastObservationAt: NOW - DAY }], [], NOW);
    expect(favoriteGains(seen(NOW - DAY), rows, NOW)).toHaveLength(1);
    expect(favoriteGains(seen(NOW - 3 * 3_600_000), rows, NOW)).toEqual([]);
  });
});

describe('observations stored by an import', () => {
  const prev = { priceCents: 4000, views: 10, favorites: 1, lastObservationAt: NOW - 3 * 3_600_000 };
  it('a change or a new listing: always; nothing moved: a live listing once a day, a closed one never', () => {
    expect(shouldObserve(undefined, { priceCents: 4000, views: 10, favorites: 1 }, true, NOW)).toBe(true);
    expect(shouldObserve(prev, { priceCents: 4000, views: 11, favorites: 1 }, true, NOW)).toBe(true);
    expect(shouldObserve(prev, { priceCents: 4000, views: 10, favorites: 1 }, true, NOW)).toBe(false);
    expect(shouldObserve({ ...prev, lastObservationAt: NOW - 21 * 3_600_000 }, { priceCents: 4000, views: 10, favorites: 1 }, true, NOW)).toBe(true);
    expect(shouldObserve({ ...prev, lastObservationAt: undefined }, { priceCents: 4000, views: 10, favorites: 1 }, true, NOW)).toBe(true);
    expect(shouldObserve({ ...prev, lastObservationAt: NOW - 30 * DAY }, { priceCents: 4000, views: 10, favorites: 1 }, false, NOW)).toBe(false);
    expect(shouldObserve(prev, { priceCents: 3500, views: 10, favorites: 1 }, false, NOW)).toBe(true);
  });
});

describe('reply templates', () => {
  it('fills what ERA knows and leaves the rest visibly blank', () => {
    const r = fillReply(DEFAULT_REPLIES.MEASURES, { title: 'Sweat Nike M', size: 'M', condition: null, defects: null, measures: null, price: '40 €', counter: '37 €' });
    expect(r).toContain('Sweat Nike M');
    expect(r).toContain('[à compléter]');
    expect(hasBlanks(r)).toBe(true);
    const c = fillReply(DEFAULT_REPLIES.OFFER_COUNTER, { title: 'x', size: null, condition: null, defects: null, measures: null, price: '40 €', counter: '37 €' });
    expect(c).toContain('37 €');
    expect(hasBlanks(c)).toBe(false);
  });
});

describe('goal plan', () => {
  it('what the goal takes every month, against today', async () => {
    const { goalPlan } = await import('@/intelligence/goal');
    const g = { goal: { kind: 'REVENUE', cents: 200000 }, perSale: { cents: 3300, n: 40 }, listingsPerSale: { n: 6, sales30: 3, listed: 18 }, sales30: 3 } as never;
    const now = Date.UTC(2026, 8, 27);
    const views = [{ firstListedAt: now - 3 * 86_400_000 }, { firstListedAt: now - 10 * 86_400_000 }, { firstListedAt: now - 40 * 86_400_000 }] as never;
    // 2 000 € at 33 € per sale = 61 sales; × 6 listings per sale = 366 online; 61 / (30/7) ≈ 15 a week; today 2 in 30 days.
    expect(goalPlan(g, views, now)).toEqual({ salesPerMonth: 61, listingsNeeded: 366, perWeek: 15, current: { sales30: 3, listed: 18, perWeek: 0.5 }, factor: 20.3 });
  });
});

describe('replies inside Vinted messaging', () => {
  const kit: ReplyKit = {
    templates: [
      { key: 'AVAILABLE', label: 'Disponible', text: DEFAULT_REPLIES.AVAILABLE },
      { key: 'OFFER_COUNTER', label: 'Contre-offre', text: DEFAULT_REPLIES.OFFER_COUNTER },
    ],
    items: { '101': { title: 'Veste Harrington M', size: 'M', condition: null, defects: null, measures: null, price: '59 €', counter: '54 €' } },
  };
  it('the conversation’s listing is the first linked one ERA knows', () => {
    expect(conversationItem(kit, ['999', '101', '102'])).toBe('101');
    expect(conversationItem(kit, ['999'])).toBeNull();
  });
  it('filled for that listing; an unknown listing keeps visible blanks, never an invented price', () => {
    const known = kitReplies(kit, '101');
    expect(known[1]).toMatchObject({ key: 'OFFER_COUNTER', blanks: false });
    expect(known[1]!.text).toContain('54 €');
    const unknown = kitReplies(kit, null);
    expect(unknown[0]!.blanks).toBe(false);
    expect(unknown[1]).toMatchObject({ blanks: true });
    expect(unknown[1]!.text).toContain('[à compléter]');
  });
});
