import type { Category, Confidence, MarketCandidate } from '@/domain/entities';
import type { SearchResult } from '@/data/adapters/marketplace';
import { EXCLUDED_TERMS, brandKey, categoriesInTitle, categoryAffinity, isUnknownBrand, normalizeText, titleHasBrand } from './normalize';
import { type SegmentStats, type SellerModel, sampleConfidence } from './seller-model';

/**
 * What to buy again — from the seller's OWN sales, never from the market alone. For each niche that sold often
 * enough: what it really cashes in, how fast, what it earns per day when costs are known, how much of it is
 * already in stock, and the most to pay for the next one. What sells slowly or poorly goes to "avoid".
 */

export interface ShoppingLine {
  key: string;
  label: string;
  /** Canonical brand key and category of the niche (what a deal must match). */
  brand: string | null;
  category: Category | null;
  sold: number;
  confidence: Confidence;
  /** Median price actually cashed in. */
  medianSaleCents: number;
  medianDays: number | null;
  /** Average profit per sale, when purchase costs are known. */
  avgProfitCents: number | null;
  /** Profit per day on the shelf (costs known and selling time known). */
  profitPerDayCents: number | null;
  inStock: number;
  /** Most to pay, all included (price + buyer protection + shipping), to keep the target profit. */
  maxLandedCents: number;
  /** Same, as the price listed on Vinted (buyer protection 0,70 € + 5 % on top; shipping not included). */
  maxVintedPriceCents: number;
  /** Why it is on the list, as i18n code + params. */
  why: { code: string; params: Record<string, string | number> };
}

export interface ShoppingList {
  buy: ShoppingLine[];
  avoid: ShoppingLine[];
  /** Niches with too few sales to conclude (shown as "à confirmer", never ranked). */
  unsure: number;
  /** Sales the list rests on. */
  basis: number;
}

export interface ShoppingOptions {
  /** Profit kept on every purchase, whatever the niche. */
  minProfitCents: number;
  /** …and at least this share of the sale price. */
  minProfitShare: number;
  minSold: number;
}

export const SHOPPING_DEFAULTS: ShoppingOptions = { minProfitCents: 800, minProfitShare: 0.4, minSold: 3 };

const euro = (c: number) => Math.floor(c / 100) * 100;

/** Landed cost limit → the price to look for on Vinted: p + 0,70 € + 5 % ≤ limit. */
export function vintedPriceFor(maxLandedCents: number): number {
  return Math.max(0, euro((maxLandedCents - 70) / 1.05));
}

function line(s: SegmentStats, o: ShoppingOptions): ShoppingLine | null {
  if (s.medianSaleCents === null || s.sold < o.minSold) return null;
  const profitPerDay = s.avgProfitCents !== null && s.medianDays !== null ? s.avgProfitCents / Math.max(1, s.medianDays) : null;
  const keep = Math.max(o.minProfitCents, s.medianSaleCents * o.minProfitShare);
  const maxLanded = Math.max(0, euro(s.medianSaleCents - keep));
  return {
    key: s.key,
    label: s.label,
    brand: s.brand,
    category: s.category,
    sold: s.sold,
    confidence: sampleConfidence(s.sold),
    medianSaleCents: s.medianSaleCents,
    medianDays: s.medianDays,
    avgProfitCents: s.avgProfitCents,
    profitPerDayCents: profitPerDay === null ? null : Math.round(profitPerDay),
    inStock: s.inStock,
    maxLandedCents: maxLanded,
    maxVintedPriceCents: vintedPriceFor(maxLanded),
    why: { code: 'none', params: {} },
  };
}

export function shoppingList(model: SellerModel, o: ShoppingOptions = SHOPPING_DEFAULTS): ShoppingList {
  // Niches are the most precise; an unknown brand is not a niche to rebuy.
  const segs = model.byNiche.filter((s) => !isUnknownBrand(s.brand ?? s.label.split(' ')[0] ?? null));
  const lines = segs.map((s) => line(s, o)).filter((l): l is ShoppingLine => l !== null);
  const unsure = segs.filter((s) => s.sold > 0 && s.sold < o.minSold).length;
  const basis = lines.reduce((a, l) => a + l.sold, 0);
  const days = model.medianDays;

  // Ranking: profit per day when known; else cash per day; never an unknown counted as zero.
  const score = (l: ShoppingLine) => l.profitPerDayCents ?? (l.medianDays !== null ? l.medianSaleCents / Math.max(1, l.medianDays) / 2 : l.medianSaleCents / 60);
  const poor = (l: ShoppingLine) => l.avgProfitCents !== null && l.avgProfitCents < o.minProfitCents;
  // Profit per day already weighs speed: slowness alone only counts when the profit is unknown.
  const slow = (l: ShoppingLine) => l.profitPerDayCents === null && days !== null && l.medianDays !== null && l.medianDays > Math.max(2 * days, days + 21);
  const perDay = lines.map((l) => l.profitPerDayCents).filter((x): x is number => x !== null && x > 0).sort((a, b) => a - b);
  const typical = perDay.length >= 3 ? perDay[Math.floor(perDay.length / 2)]! : null;
  const lowDay = (l: ShoppingLine) => typical !== null && l.profitPerDayCents !== null && l.profitPerDayCents < typical * 0.25;

  const avoid = lines
    .filter((l) => poor(l) || lowDay(l) || slow(l))
    .map(
      (l): ShoppingLine => ({
        ...l,
        why: poor(l)
          ? { code: 'poor', params: { profit: l.avgProfitCents ?? 0 } }
          : lowDay(l)
            ? { code: 'lowDay', params: { amount: l.profitPerDayCents ?? 0, typical: Math.round((typical ?? 0) / 100) } }
            : { code: 'slow', params: { days: l.medianDays ?? 0, base: Math.round(days ?? 0) } },
      }),
    );
  const avoided = new Set(avoid.map((l) => l.key));
  const buy = lines
    .filter((l) => !avoided.has(l.key))
    .sort((a, b) => score(b) - score(a))
    .map((l): ShoppingLine => ({
      ...l,
      why:
        l.profitPerDayCents !== null
          ? { code: 'profitDay', params: { amount: l.profitPerDayCents } }
          : l.medianDays !== null
            ? { code: 'fast', params: { days: l.medianDays } }
            : { code: 'sold', params: { n: l.sold } },
    }));
  return { buy, avoid, unsure, basis };
}

/* ── Deal scanner ───────────────────────────────────────── */

/** What buying a listing on Vinted really costs: price + buyer protection (0,70 € + 5 %); shipping on top. */
export const vintedLanded = (listedCents: number) => listedCents + 70 + Math.round(listedCents * 0.05);

export interface Deal {
  niche: string;
  candidate: MarketCandidate;
  landedCents: number;
  maxLandedCents: number;
  /** Median price this niche cashes in for you. */
  expectedSaleCents: number;
  /** expected − landed, shipping excluded. */
  marginCents: number;
}

/**
 * Listings of a niche worth buying: same brand, same kind of article, not a lot / kids / replica, not yours,
 * all-in cost at or under the niche's maximum. Best margin first.
 */
export function findDeals(line: ShoppingLine, result: SearchResult, ownIds: ReadonlySet<string>, max = 5): Deal[] {
  const out: Deal[] = [];
  for (const c of result.candidates) {
    if (ownIds.has(c.id)) continue;
    const nt = normalizeText(c.title);
    if (EXCLUDED_TERMS.test(nt)) continue;
    if (line.brand && !isUnknownBrand(line.brand) && !((c.brand && brandKey(c.brand) === line.brand) || titleHasBrand(c.title, line.brand))) continue;
    if (line.category && line.category !== 'OTHER') {
      const cats = c.category ? [c.category] : categoriesInTitle(nt);
      if (cats.length && !cats.some((k) => categoryAffinity(line.category!, k) >= 0.5)) continue;
    }
    const landed = vintedLanded(c.priceCents);
    if (landed > line.maxLandedCents) continue;
    out.push({ niche: line.label, candidate: c, landedCents: landed, maxLandedCents: line.maxLandedCents, expectedSaleCents: line.medianSaleCents, marginCents: line.medianSaleCents - landed });
  }
  return out.sort((a, b) => b.marginCents - a.marginCents).slice(0, max);
}
