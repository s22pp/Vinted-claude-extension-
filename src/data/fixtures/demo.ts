/**
 * DEMO / TEST FIXTURES — never presented as real data.
 * Deterministic (seeded) so screenshots and tests are stable.
 */
import type {
  Category,
  Condition,
  DomainEvent,
  Gender,
  InventoryItem,
  Listing,
  ListingObservation,
  MarketCandidate,
  PricePrediction,
  Sale,
} from '@/domain/entities';
import { DAY } from '@/domain/time';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export interface NicheSpec {
  brand: string;
  model: string | null;
  category: Category;
  gender: Gender;
  /** Typical market median in euros. */
  market: number;
  /** Typical buy price in euros. */
  buy: number;
  /** Median days to sell for this seller. */
  days: number;
  titles: string[];
  weight: number;
  photo: string;
}

export const DEMO_NICHES: NicheSpec[] = [
  { brand: 'Ralph Lauren', model: 'Harrington', category: 'JACKET', gender: 'MEN', market: 55, buy: 18, days: 8, weight: 5, photo: 'jacket', titles: ['Veste Harrington Ralph Lauren', 'Harrington Polo Ralph Lauren vintage', 'Blouson Harrington Ralph Lauren'] },
  { brand: 'Ralph Lauren', model: null, category: 'SWEATSHIRT', gender: 'MEN', market: 38, buy: 12, days: 6, weight: 5, photo: 'sweat', titles: ['Sweat Polo Ralph Lauren', 'Sweat col rond Ralph Lauren', 'Sweat zip Ralph Lauren'] },
  { brand: 'Ralph Lauren', model: null, category: 'SHIRT', gender: 'MEN', market: 28, buy: 8, days: 5, weight: 4, photo: 'shirt', titles: ['Chemise Oxford Ralph Lauren', 'Chemise Ralph Lauren custom fit'] },
  { brand: 'Carhartt', model: 'Detroit', category: 'JACKET', gender: 'MEN', market: 95, buy: 40, days: 12, weight: 3, photo: 'jacket', titles: ['Veste Carhartt Detroit', 'Carhartt Detroit jacket vintage', 'Veste Detroit Carhartt WIP'] },
  { brand: 'Carhartt', model: null, category: 'TROUSERS', gender: 'MEN', market: 42, buy: 15, days: 14, weight: 3, photo: 'pants', titles: ['Pantalon Carhartt double knee', 'Pantalon cargo Carhartt WIP'] },
  { brand: "Levi's", model: '501', category: 'JEANS', gender: 'MEN', market: 30, buy: 10, days: 16, weight: 4, photo: 'jeans', titles: ["Jean Levi's 501", "Levi's 501 vintage", "Jean 501 Levi's brut"] },
  { brand: 'Nike', model: 'ACG', category: 'JACKET', gender: 'MEN', market: 60, buy: 22, days: 10, weight: 2, photo: 'jacket', titles: ['Veste Nike ACG', 'Nike ACG polaire', 'Veste Nike ACG vintage'] },
  { brand: 'Burberry', model: null, category: 'COAT', gender: 'MEN', market: 120, buy: 55, days: 28, weight: 2, photo: 'coat', titles: ['Trench Burberry', 'Manteau Burberry laine'] },
  { brand: 'Lacoste', model: null, category: 'POLO', gender: 'MEN', market: 25, buy: 9, days: 9, weight: 3, photo: 'polo', titles: ['Polo Lacoste', 'Polo Lacoste classic fit'] },
  { brand: 'Stone Island', model: null, category: 'SWEATSHIRT', gender: 'MEN', market: 110, buy: 60, days: 20, weight: 2, photo: 'sweat', titles: ['Sweat Stone Island', 'Sweat Stone Island badge'] },
  { brand: 'Patagonia', model: 'Synchilla', category: 'KNIT', gender: 'UNISEX', market: 48, buy: 20, days: 11, weight: 2, photo: 'fleece', titles: ['Polaire Patagonia Synchilla', 'Patagonia Synchilla snap-t'] },
  { brand: 'Barbour', model: 'Bedale', category: 'JACKET', gender: 'MEN', market: 110, buy: 50, days: 24, weight: 2, photo: 'jacket', titles: ['Veste Barbour Bedale', 'Barbour Bedale cirée'] },
  { brand: 'Tommy Hilfiger', model: null, category: 'KNIT', gender: 'MEN', market: 24, buy: 9, days: 18, weight: 2, photo: 'knit', titles: ['Pull Tommy Hilfiger', 'Pull col V Tommy Hilfiger'] },
];

const SIZES = ['S', 'M', 'M', 'L', 'L', 'XL'];
const JEAN_SIZES = ['W30', 'W31', 'W32', 'W32', 'W33', 'W34'];
const CONDITIONS: Condition[] = ['VERY_GOOD', 'VERY_GOOD', 'VERY_GOOD', 'GOOD', 'NEW_WITHOUT_TAGS', 'GOOD'];
const SOURCES = ['Vinted', 'Friperie', 'Vide-grenier', 'Emmaüs', 'Leboncoin'];

export interface DemoDataset {
  items: InventoryItem[];
  listings: Listing[];
  observations: ListingObservation[];
  sales: Sale[];
  events: DomainEvent[];
  predictions: PricePrediction[];
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function weightedNiche(r: () => number): NicheSpec {
  const total = DEMO_NICHES.reduce((a, n) => a + n.weight, 0);
  let x = r() * total;
  for (const n of DEMO_NICHES) {
    x -= n.weight;
    if (x <= 0) return n;
  }
  return DEMO_NICHES[0]!;
}

const euro = (e: number) => Math.round(e) * 100;

export function generateDemoDataset(now: number, opts: { soldCount?: number; stockCount?: number; seed?: number } = {}): DemoDataset {
  const r = rng(opts.seed ?? 42);
  const soldCount = opts.soldCount ?? 64;
  const stockCount = opts.stockCount ?? 58;
  const ds: DemoDataset = { items: [], listings: [], observations: [], sales: [], events: [], predictions: [] };
  let n = 0;
  const ev = (e: Omit<DomainEvent, 'id' | 'provenance' | 'isDemo'> & { provenance?: DomainEvent['provenance'] }) =>
    ds.events.push({ id: `demo_ev_${ds.events.length}`, provenance: 'OBSERVED', isDemo: true, ...e });

  const makeItem = (sold: boolean) => {
    const spec = weightedNiche(r);
    const id = `demo_item_${n++}`;
    const title = pick(r, spec.titles);
    const size = spec.category === 'JEANS' ? pick(r, JEAN_SIZES) : pick(r, SIZES);
    const condition = pick(r, CONDITIONS);
    // Stock skews recent but includes a real tail of aged items.
    const ageDays = sold ? 10 + Math.floor(r() * 250) : Math.floor(Math.pow(r(), 1.6) * 140) + 1;
    const purchaseDate = now - ageDays * DAY - Math.floor(r() * DAY);
    const costKnown = r() > (sold ? 0.1 : 0.16);
    // A few aged pieces were overpaid: the capital traps a real stock always contains.
    const overpaid = !sold && ageDays > 50 && r() < 0.3;
    const buy = overpaid ? spec.market * (0.72 + r() * 0.12) : Math.max(3, spec.buy * (0.6 + r() * 0.8));
    const item: InventoryItem = {
      id,
      title: `${title} ${size}`,
      brand: spec.brand,
      model: spec.model,
      category: spec.category,
      gender: spec.gender,
      size,
      condition,
      material: null,
      era: title.toLowerCase().includes('vintage') ? 'vintage' : null,
      photoUrl: `demo:${spec.photo}:${Math.floor(r() * 6)}`,
      purchasePriceCents: costKnown ? euro(buy) : null,
      purchaseDate: costKnown || r() > 0.5 ? purchaseDate : null,
      purchaseSource: costKnown ? pick(r, SOURCES) : null,
      status: sold ? 'SOLD' : r() > 0.07 ? 'LISTED' : 'DRAFT',
      createdAt: purchaseDate,
      updatedAt: now - Math.floor(r() * 3 * DAY),
      meta: costKnown ? { purchasePriceCents: { p: 'USER_PROVIDED', at: purchaseDate } } : {},
      isDemo: true,
    };
    ds.items.push(item);
    ev({ type: 'ITEM_ACQUIRED', at: purchaseDate, inventoryItemId: id, listingId: null, data: { cost: item.purchasePriceCents }, provenance: costKnown ? 'USER_PROVIDED' : 'INFERRED' });
    if (item.status === 'DRAFT') return;

    // Listing lifecycle: publish, maybe a price change, maybe a republish, maybe a sale.
    const cond = condition === 'GOOD' ? 0.9 : condition === 'NEW_WITHOUT_TAGS' ? 1.15 : 1;
    let price = euro(spec.market * cond * (0.95 + r() * 0.55));
    let listedAt = purchaseDate + Math.floor((1 + r() * 4) * DAY);
    const saleAfter = sold ? Math.max(1, Math.round(spec.days * (0.3 + r() * 1.6) * (price / euro(spec.market)))) : Infinity;
    const endAt = sold ? Math.min(now - DAY, listedAt + saleAfter * DAY) : now;
    const republish = r() < (sold ? 0.15 : 0.22) && endAt - listedAt > 20 * DAY;
    const segments = republish ? 2 : 1;
    let lastListing: Listing | null = null;
    // Some aged items are mispriced on purpose so the engines have something real to say.
    const stubborn = !sold && !overpaid && ageDays > 45 && r() < 0.55;
    if (stubborn) price = euro(spec.market * (1.3 + r() * 0.4));
    if (overpaid) price = euro(spec.market * (0.95 + r() * 0.15));
    let totalViews = 0;
    let totalFavs = 0;
    for (let seg = 0; seg < segments; seg++) {
      const segStart = seg === 0 ? listedAt : listedAt + Math.floor((endAt - listedAt) * 0.55);
      const segEnd = seg === segments - 1 ? endAt : listedAt + Math.floor((endAt - listedAt) * 0.55);
      const lid = `demo_listing_${ds.listings.length}`;
      const days = Math.max(1, (segEnd - segStart) / DAY);
      const vpd = (sold ? 6 : 2.2) * (euro(spec.market) / price) * (0.4 + r() * 1.4) * (stubborn ? 0.9 : 1);
      const favRate = stubborn ? 0.003 + r() * 0.008 : sold ? 0.02 + r() * 0.05 : 0.006 + r() * 0.03;
      if (seg > 0) {
        ev({ type: 'LISTING_REPUBLISHED', at: segStart, inventoryItemId: id, listingId: lid, data: { price } });
      } else {
        ev({ type: 'LISTING_PUBLISHED', at: segStart, inventoryItemId: id, listingId: lid, data: { price } });
      }
      // weekly observations
      let v = 0;
      let f = 0;
      for (let t = segStart + DAY; t <= segEnd; t += Math.max(DAY, Math.floor(days / 8) * DAY)) {
        v += Math.round(vpd * Math.max(1, Math.floor(days / 8)) * (0.6 + r() * 0.8));
        f = Math.round(v * favRate);
        if (r() < 0.12 && !sold && seg === segments - 1 && t > segStart + 10 * DAY) {
          const newPrice = Math.max(500, price - euro(2 + r() * 6));
          ev({ type: 'PRICE_CHANGED', at: t, inventoryItemId: id, listingId: lid, data: { from: price, to: newPrice }, provenance: 'OBSERVED' });
          price = newPrice;
        }
        ds.observations.push({ id: `demo_obs_${ds.observations.length}`, listingId: lid, inventoryItemId: id, at: t, priceCents: price, views: v, favorites: f, provenance: 'OBSERVED' });
      }
      ev({ type: 'ENGAGEMENT_OBSERVED', at: segEnd, inventoryItemId: id, listingId: lid, data: { views: v, favorites: f } });
      totalViews += v;
      totalFavs += f;
      const isLast = seg === segments - 1;
      const listing: Listing = {
        id: lid,
        inventoryItemId: id,
        platform: 'vinted',
        platformListingId: null,
        url: null,
        title: item.title,
        priceCents: price,
        views: v,
        favorites: f,
        listedAt: segStart,
        removedAt: isLast ? null : segEnd,
        soldAt: isLast && sold ? endAt : null,
        status: isLast ? (sold ? 'SOLD' : 'ACTIVE') : 'REMOVED',
        lastObservedAt: segEnd,
        isDemo: true,
      };
      if (!isLast) ev({ type: 'LISTING_REMOVED', at: segEnd, inventoryItemId: id, listingId: lid, data: { views: v, favorites: f } });
      ds.listings.push(listing);
      lastListing = listing;
    }
    void totalViews;
    void totalFavs;

    // A prediction made when first listed, to be confronted with reality.
    const predMid = euro(spec.market * cond * (0.95 + r() * 0.15));
    const pred: PricePrediction = {
      id: `demo_pred_${ds.predictions.length}`,
      inventoryItemId: id,
      at: listedAt,
      strategy: 'BALANCED',
      priceMinCents: Math.round(predMid * 0.92 / 100) * 100,
      priceMaxCents: Math.round(predMid * 1.08 / 100) * 100,
      daysMin: Math.max(1, Math.round(spec.days * 0.6)),
      daysMax: Math.round(spec.days * 1.8),
      confidence: r() < 0.35 ? 'HIGH' : r() < 0.7 ? 'MEDIUM' : 'LOW',
      sampleSize: 8 + Math.floor(r() * 20),
      resolved: null,
      isDemo: true,
    };
    ds.predictions.push(pred);
    ev({ type: 'PREDICTION_MADE', at: listedAt, inventoryItemId: id, listingId: lastListing?.id ?? null, data: { min: pred.priceMinCents, max: pred.priceMaxCents } , provenance: 'PREDICTED' });

    if (sold && lastListing) {
      // Buyers negotiate: sale lands a bit under the ask.
      const salePrice = Math.max(500, Math.round((lastListing.priceCents * (0.86 + r() * 0.14)) / 100) * 100);
      const refunded = r() < 0.08;
      const sale: Sale = {
        id: `demo_sale_${ds.sales.length}`,
        inventoryItemId: id,
        listingId: lastListing.id,
        soldAt: endAt,
        salePriceCents: salePrice,
        extraCostsCents: r() < 0.85 ? 0 : null,
        status: refunded ? 'REFUNDED' : 'COMPLETED',
        isDemo: true,
      };
      ds.sales.push(sale);
      ev({ type: 'ITEM_SOLD', at: endAt, inventoryItemId: id, listingId: lastListing.id, data: { price: salePrice } });
      if (refunded) {
        ev({ type: 'SALE_REFUNDED', at: endAt + 4 * DAY, inventoryItemId: id, listingId: lastListing.id, data: { price: salePrice } });
        item.status = 'LISTED';
        lastListing.status = 'ACTIVE';
        lastListing.soldAt = null;
      }
    }
    listedAt = 0;
  };

  for (let i = 0; i < soldCount; i++) makeItem(true);
  for (let i = 0; i < stockCount; i++) makeItem(false);
  ds.events.sort((a, b) => a.at - b.at);
  return ds;
}

/**
 * DEMO market: generates a plausible search result page for a query, including the noise
 * real searches contain (other brands, lots, kids sizes, broken 1 € items, duplicates, fantasy prices).
 */
export function generateDemoMarket(
  q: { text: string; brand: string; category: Category | null; gender: Gender | null; size: string | null },
  seed: number,
): { candidates: MarketCandidate[]; totalEntries: number; totalCapped: boolean } {
  const r = rng(seed);
  const spec =
    DEMO_NICHES.find((n) => n.brand.toLowerCase() === q.brand.toLowerCase() && n.model && q.text.toLowerCase().includes(n.model.toLowerCase())) ??
    DEMO_NICHES.find((n) => n.brand.toLowerCase() === q.brand.toLowerCase() && n.category === q.category) ??
    null;
  const market = spec?.market ?? 30 + r() * 40;
  const typeWord = (spec?.titles[0] ?? q.text).split(' ')[0] ?? '';
  const count = spec ? 22 + Math.floor(r() * 16) : Math.floor(r() * 9);
  const out: MarketCandidate[] = [];
  const base = (i: number, title: string, price: number, extra: Partial<MarketCandidate> = {}): MarketCandidate => ({
    id: `demo_mkt_${seed}_${i}`,
    title,
    brand: q.brand,
    priceCents: euro(price),
    size: pick(r, q.category === 'JEANS' ? JEAN_SIZES : SIZES),
    condition: pick(r, CONDITIONS),
    category: null,
    gender: null,
    url: null,
    photoUrl: null,
    favorites: Math.floor(r() * r() * 22),
    listedAt: Date.now() - Math.floor(r() * 20) * DAY,
    promoted: r() < 0.05,
    sellerId: `s${Math.floor(r() * 400)}`,
    ...extra,
  });
  for (let i = 0; i < count; i++) {
    const t = spec ? pick(r, spec.titles) : `${typeWord} ${q.brand}`;
    // log-normal-ish price around market
    const price = market * Math.exp((r() + r() + r() - 1.5) * 0.42);
    out.push(base(i, `${t}${r() < 0.3 ? ' vintage' : ''}`, Math.max(4, price)));
  }
  let i = count;
  // Noise the pipeline must reject:
  out.push(base(i++, `Lot 3 ${typeWord.toLowerCase()} ${q.brand}`, market * 1.6));
  out.push(base(i++, `${typeWord} ${q.brand} enfant 12 ans`, market * 0.4));
  out.push(base(i++, `${typeWord} ${q.brand} troué`, 1));
  out.push(base(i++, `${typeWord} Tommy Hilfiger`, market * 0.7, { brand: 'Tommy Hilfiger' }));
  out.push(base(i++, `${typeWord} façon ${q.brand}`, market * 0.3, { brand: null }));
  if (spec) {
    out.push(base(i++, `${spec.titles[0]} rare collector`, market * 6));
    const dup = out[2]!;
    out.push({ ...dup, id: `demo_mkt_${seed}_${i++}` });
  }
  const total = spec ? (spec.market > 80 ? 180 + Math.floor(r() * 500) : 960) : count * 3;
  return { candidates: out, totalEntries: total, totalCapped: total >= 960 };
}
