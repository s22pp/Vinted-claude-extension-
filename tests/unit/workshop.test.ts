import { parseOrder, parseWardrobeItem } from '@/data/adapters/vinted/parse';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import { type InventoryItem, type Listing, PrepSchema, type Sale } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { skuOf, skusInText } from '@/intelligence/listing';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { refundSummary } from '@/intelligence/refunds';
import { draftDescription, draftTitle, measureFields, prepStats, readiness, relistTitle, suggestPrice, suggestedPackage, workshopQueue } from '@/intelligence/workshop';

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

describe('relist a similar article', () => {
  it('keeps the model’s words, drops ERA’s reference, swaps the size only where the title carries it', () => {
    expect(relistTitle('Polo Ralph Lauren slim taille M · E1C4G', 'M', 'L')).toBe('Polo Ralph Lauren slim taille L');
    expect(relistTitle('Polo Ralph Lauren M', 'M', 'XL')).toBe('Polo Ralph Lauren XL');
    expect(relistTitle('Polo Ralph Lauren TM', 'M', 'S')).toBe('Polo Ralph Lauren TS');
    expect(relistTitle('Polo Ralph Lauren Marine', 'M', 'L')).toBe('Polo Ralph Lauren Marine');
    expect(relistTitle('Jean Levi’s 501 W32', 'W32', 'W32')).toBe('Jean Levi’s 501 W32');
  });

  it('creates new sheets from a sold article: its identity, never what belongs to the physical article', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    await db.items.put(item('src', { title: 'Polo Ralph Lauren M', brand: 'Ralph Lauren', model: 'Custom Fit', category: 'POLO', size: 'M', condition: 'VERY_GOOD', material: '100 % coton', era: 'vintage', status: 'SOLD', photoUrl: 'https://images1.vinted.net/x.jpg' }));
    await db.listings.put({ id: 'l1', inventoryItemId: 'src', platform: 'vinted', platformListingId: '4242', url: null, title: 'Polo Ralph Lauren M', priceCents: 3500, views: 80, favorites: 4, listedAt: NOW - 20 * DAY, removedAt: null, soldAt: NOW - 2 * DAY, status: 'SOLD', lastObservedAt: NOW, isDemo: false });
    await db.sales.put({ id: 's1', inventoryItemId: 'src', listingId: 'l1', soldAt: NOW - 2 * DAY, salePriceCents: 3200, extraCostsCents: 0, status: 'COMPLETED', isDemo: false } as Sale);
    await repo.savePrep('src', { measures: { length: '70' }, defects: 'petite tache', colors: 'Marine', material: '100 % coton', packageSize: 'SMALL', productRef: 'RL-123' });
    const ids = await repo.relistSimilar('src', { count: 2, size: 'L', condition: 'GOOD', costCents: 800, purchaseDate: NOW }, NOW);
    expect(ids).toHaveLength(2);
    const [a] = await db.items.bulkGet(ids);
    expect(a).toMatchObject({ title: 'Polo Ralph Lauren L', brand: 'Ralph Lauren', model: 'Custom Fit', category: 'POLO', size: 'L', condition: 'GOOD', era: 'vintage', status: 'DRAFT', purchasePriceCents: 800, material: null, photoUrl: null });
    const p = (await db.preps.get(ids[0]!))!;
    expect(p).toMatchObject({ measures: {}, defects: '', colors: '', material: '', productRef: '', packageSize: 'SMALL', template: { itemId: 'src', listingId: '4242', size: 'M', soldCents: 3200, soldAt: NOW - 2 * DAY } });
    // No listing yet: it waits in the workshop.
    expect(await db.listings.where('inventoryItemId').anyOf(ids).count()).toBe(0);
  });
});

describe('listing quality', () => {
  it('flags only what was read, and ranks by what there is to gain', async () => {
    const { listingQuality } = await import('@/intelligence/listing-quality');
    const base = { analysis: null, analysisStale: false, pricing: null, stagnation: null, personal: null, trap: null, lastDrop: null, priceSeenDays: null, lastRepost: null, recommendation: null } as never;
    const view = (over: object) => ({ item: item('q', { title: 'Veste Carhartt M', brand: 'Carhartt', category: 'JACKET' }), inStock: true, current: { id: 'l', platformListingId: '9', title: 'Veste Carhartt Detroit M', priceCents: 8000, photoCount: null, description: null, ...over } }) as never;
    const unread = listingQuality({ ...(base as object), view: view({}) } as never)!;
    expect(unread.issues).toEqual([]);
    expect(unread.unread).toEqual(['photos', 'description']);
    const bad = listingQuality({ ...(base as object), view: view({ photoCount: 2, description: 'Bon état.' }) } as never)!;
    expect(bad.issues.map((i) => i.code)).toEqual(['FEW_PHOTOS', 'SHORT_DESC', 'NO_MEASURES']);
    const good = listingQuality({ ...(base as object), view: view({ photoCount: 8, description: 'Veste Carhartt Detroit, très bon état, aucun défaut. Mesures à plat : aisselle à aisselle 58 cm, longueur 70 cm. 100 % coton.' }) } as never)!;
    expect(good.issues).toEqual([]);
  });
});
