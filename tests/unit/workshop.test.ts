import { parseOrder, parseWardrobeItem } from '@/data/adapters/vinted/parse';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import { type InventoryItem, type Listing, PrepSchema, type Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { skuOf, skusInText } from '@/intelligence/listing';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { refundSummary } from '@/intelligence/refunds';
import { draftDescription, draftTitle, measureFields, prepStats, readiness, suggestPrice, suggestedPackage, workshopQueue } from '@/intelligence/workshop';

const NOW = Date.UTC(2026, 8, 24);
const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  title: 'Jean Levi’s 501 W32',
  brand: 'Levi’s',
  model: '501',
  category: 'JEANS',
  gender: 'MEN',
  size: 'W32',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  photoUrl: null,
  purchasePriceCents: 900,
  costDetail: null,
  purchaseDate: NOW - 20 * DAY,
  purchaseSource: null,
  status: 'DRAFT',
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
  priceCents: 3000,
  views: 10,
  favorites: 0,
  listedAt: NOW - 10 * DAY,
  removedAt: null,
  soldAt: null,
  status: 'ACTIVE',
  lastObservedAt: NOW,
  isDemo: false,
  ...over,
});
const prep = (itemId: string, over: Partial<ReturnType<typeof PrepSchema.parse>> = {}) => ({ ...PrepSchema.parse({ itemId, startedAt: NOW }), ...over });

describe('listing workshop', () => {
  it('queues owned items that buyers cannot see, oldest capital first', () => {
    const views = buildItemViews(
      [item('old', { purchaseDate: NOW - 90 * DAY }), item('new', { purchaseDate: NOW - 2 * DAY }), item('live', { status: 'LISTED' }), item('done', {})],
      [listing('l', 'live')],
      [],
      NOW,
    );
    const q = workshopQueue(views, new Map([['done', prep('done', { publishedAt: NOW })]]));
    expect(q.toList.map((v) => v.item.id)).toEqual(['old', 'new']);
    expect(q.awaitingImport.map((v) => v.item.id)).toEqual(['done']);
  });

  it('the title keeps the ERA reference that links the future listing, and the product reference', () => {
    const t = draftTitle(item('a'), prep('a', { productRef: '00501-0114' }));
    expect(t).toContain('00501-0114');
    expect(t.endsWith(skuOf('a'))).toBe(true);
    expect(skusInText(`Jean Levi’s 501 · ${skuOf('a')}`)).toEqual([skuOf('a')]);
  });

  it('the description only states what was read; blanks stay visible', () => {
    const d = draftDescription({ ...item('a') }, prep('a', { measures: { waist: '41', inseam: '80' } }), [], (k) => k);
    expect(d).toContain('waist 41 cm');
    expect(d).toContain('length __');
    expect(d).toContain('__ (lire l’étiquette');
    expect(d).toContain(`Réf. ${skuOf('a')}`);
  });

  it('refund rules tighten readiness: all measures become mandatory', () => {
    const it0 = item('a');
    const p = prep('a', { measures: { waist: '41', inseam: '80' }, checks: ['sizeLabel', 'brandExact', 'photoLogo', 'photoComposition', 'photoSizeLabel', 'photoDefects', 'measureZero'] });
    const title = draftTitle(it0, p);
    expect(readiness(it0, p, title, 3000, []).ready).toBe(true);
    const strict = readiness(it0, p, title, 3000, ['MEASURES_REQUIRED']);
    expect(strict.ready).toBe(false);
    expect(strict.items.find((i) => i.key === 'measures')!.done).toBe(false);
    expect(measureFields('JEANS')).toEqual(['waist', 'inseam', 'length']);
    expect(suggestedPackage('TSHIRT')).toBe('SMALL');
    expect(suggestedPackage('KNIT')).toBe('MEDIUM');
  });

  it('the price is deduced, never asked: market first, else what you cashed on this niche', () => {
    expect(suggestPrice(null, null, null)).toBeNull();
    const personal = { sold: 4, medianSaleCents: 3100 } as Parameters<typeof suggestPrice>[2];
    expect(suggestPrice(null, null, personal)).toMatchObject({ cents: 3100, basis: 'PERSONAL', n: 4 });
  });

  it('time per sheet is measured, not estimated', () => {
    const s = prepStats([prep('a', { seconds: 180, publishedAt: NOW - DAY }), prep('b', { seconds: 300, publishedAt: NOW - 10 * DAY }), prep('c', { seconds: 5, publishedAt: NOW })], NOW);
    expect(s).toMatchObject({ published7: 2, published30: 3, timed: 2, medianMinutes: 4 });
  });

  it('a sheet is stored locally and marked published without touching Vinted', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.items.put(item('a'));
    await repo.savePrep('a', { measures: { waist: '41' } });
    await repo.addPrepTime('a', 42);
    await repo.markPrepPublished('a', 3000);
    const p = (await db.preps.get('a'))!;
    expect(p).toMatchObject({ measures: { waist: '41' }, seconds: 42, priceCents: 3000 });
    expect(p.publishedAt).not.toBeNull();
    expect((await db.events.where('type').equals('LISTING_PREPARED').count())).toBe(1);
  });
});

describe('refund reasons', () => {
  const sold = (id: string, brand: string, status: Sale['status'], reason: Sale['refundReason'] = null) => {
    const it0 = item(id, { brand, status: 'SOLD' });
    const l = listing(`l${id}`, id, { status: 'SOLD', soldAt: NOW - DAY });
    const s: Sale = { id: `s${id}`, inventoryItemId: id, listingId: l.id, soldAt: NOW - DAY, salePriceCents: 3000, extraCostsCents: 0, status, refundReason: reason, isDemo: false };
    return { it0, l, s };
  };

  it('a reason becomes a workshop rule once it repeats; one refund is an anecdote', () => {
    const rows = [
      sold('a', 'Levi’s', 'REFUNDED', 'SIZE'),
      sold('b', 'Levi’s', 'REFUNDED', 'SIZE'),
      sold('c', 'Nike', 'REFUNDED', 'DEFECT'),
      sold('d', 'Nike', 'REFUNDED', null),
      ...['e', 'f', 'g', 'h', 'i', 'j'].map((x) => sold(x, x === 'e' ? 'Levi’s' : 'Nike', 'COMPLETED')),
    ];
    const views = buildItemViews(rows.map((r) => r.it0), rows.map((r) => r.l), rows.map((r) => r.s), NOW);
    const s = refundSummary(buildSaleViews(views, rows.map((r) => r.s)), { category: (c) => c });
    expect(s).toMatchObject({ sales: 10, refunded: 4, withReason: 3, refundedCents: 12000 });
    expect(s.missingReason).toEqual(['sd']);
    expect(s.guards).toEqual([{ guard: 'MEASURES_REQUIRED', reason: 'SIZE', n: 2 }]);
    // Levi's: 2 refunds out of 3 sales is below the 5-sale floor → no segment claim.
    expect(s.segments.find((x) => x.label === 'Levi’s')).toBeUndefined();
  });

  it('the reason is kept on the sale; marking a refund takes it out of revenue', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    const r = sold('a', 'Nike', 'COMPLETED');
    await db.items.put(r.it0);
    await db.sales.put(r.s);
    await repo.markRefunded('sa', 'SIZE');
    expect(await db.sales.get('sa')).toMatchObject({ status: 'REFUNDED', refundReason: 'SIZE' });
    await repo.setRefundReason('sa', 'DEFECT');
    expect((await db.sales.get('sa'))!.refundReason).toBe('DEFECT');
  });
});

describe('Vinted orders and wardrobe (fixtures: they prove our parsing, not the real API)', () => {
  it('reads order field variants and keeps the listing id for an exact match', () => {
    expect(parseOrder({ title: 'Veste', price: { amount: '42.0' }, date: '2026-09-01', status: 'Terminée', item_id: 123 })).toMatchObject({ priceCents: 4200, itemId: '123' });
    expect(parseOrder({ item: { title: 'Veste', id: 9 }, item_price: { amount: '10' }, created_at: '2026-09-01T10:00:00Z', status_text: 'Remboursée' })).toMatchObject({
      title: 'Veste',
      priceCents: 1000,
      status: 'Remboursée',
      itemId: '9',
    });
  });
  it('"Vérification en cours" is invisible to buyers', () => {
    expect(parseWardrobeItem({ id: 1, title: 'Veste', price: '20', item_alert_type: 'delayed_publication' })!.status).toBe('HIDDEN');
  });
});
