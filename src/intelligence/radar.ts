import { CONDITIONS, type Category, type Condition, type MarketCandidate } from '@/domain/entities';
import { brandKey } from './normalize';
import type { SellerModel } from './seller-model';
import { vintedLanded } from './shopping';
import { median } from './stats';

/**
 * Marché → Radar: the seller's saved searches (brand, category, size, price max, condition min), scanned on their
 * click — one search on Vinted per saved search, within the request pacing. Each listing found is scored against the
 * « local median »: what the seller really cashes in for that brand and kind (their sales), else the median of the
 * prices asked in the same scan (said as such). Pure: the filters, the medians, the scores.
 */

export const RADAR_KEY = 'radarSearches';
export const RADAR_LAST_KEY = 'radarLast';
/** A median from the seller's own sales needs this many; one from the scan, this many listings. */
export const MIN_SALES = 3;
export const MIN_LISTINGS = 5;

export interface SavedSearch {
  id: string;
  brand: string;
  category: Category | null;
  size: string | null;
  maxPriceCents: number | null;
  minCondition: Condition | null;
  createdAt: number;
}

export interface RadarDeal {
  id: string;
  title: string;
  priceCents: number;
  /** Price + buyer protection (0,70 € + 5 %); shipping not included. */
  landedCents: number;
  /** Local median − landed cost: null when no median is known. */
  marginCents: number | null;
  size: string | null;
  condition: Condition | null;
  url: string;
  photoUrl: string | null;
}

export interface LocalMedian {
  cents: number;
  basis: 'SALES' | 'SCAN';
  n: number;
}

export interface RadarScan {
  at: number;
  median: LocalMedian | null;
  deals: RadarDeal[];
  /** Listings Vinted returned before the search's own filters. */
  seen: number;
}

/** NEW_WITH_TAGS is the best: a lower index is a better condition. */
const rank = (c: Condition) => CONDITIONS.indexOf(c);

/** The search's own filters: price max, condition min, size; a condition or size Vinted did not give fails a filter set on it. */
export function matchesSearch(c: Pick<MarketCandidate, 'priceCents' | 'condition' | 'size'>, s: SavedSearch): boolean {
  if (s.maxPriceCents !== null && c.priceCents > s.maxPriceCents) return false;
  if (s.minCondition !== null && (c.condition === null || rank(c.condition) > rank(s.minCondition))) return false;
  if (s.size !== null && s.size.trim() && (c.size ?? '').trim().toLowerCase() !== s.size.trim().toLowerCase()) return false;
  return true;
}

/** What the seller cashes in for this brand (and kind), else the scan's median asking price. */
export function localMedian(s: Pick<SavedSearch, 'brand' | 'category'>, model: Pick<SellerModel, 'byNiche' | 'byBrand'> | null, scanPrices: readonly number[]): LocalMedian | null {
  const b = brandKey(s.brand);
  const mine =
    (model?.byNiche ?? []).find((x) => x.brand !== null && brandKey(x.brand) === b && (s.category === null || x.category === s.category) && x.sold >= MIN_SALES && x.medianSaleCents !== null) ??
    (model?.byBrand ?? []).find((x) => x.brand !== null && brandKey(x.brand) === b && x.sold >= MIN_SALES && x.medianSaleCents !== null);
  if (mine?.medianSaleCents != null) return { cents: mine.medianSaleCents, basis: 'SALES', n: mine.sold };
  if (scanPrices.length >= MIN_LISTINGS) return { cents: Math.round(median(scanPrices)), basis: 'SCAN', n: scanPrices.length };
  return null;
}

/** The scan's listings that pass the search's filters, scored, the best margin first; the seller's own never. */
export function scoreScan(s: SavedSearch, candidates: readonly MarketCandidate[], model: Pick<SellerModel, 'byNiche' | 'byBrand'> | null, own: ReadonlySet<string>, now: number): RadarScan {
  const others = candidates.filter((c) => !own.has(c.id));
  const med = localMedian(s, model, others.map((c) => c.priceCents));
  const deals = others
    .filter((c) => matchesSearch(c, s))
    .map((c): RadarDeal => {
      const landedCents = vintedLanded(c.priceCents);
      return { id: c.id, title: c.title, priceCents: c.priceCents, landedCents, marginCents: med ? med.cents - landedCents : null, size: c.size, condition: c.condition, url: c.url ?? `https://www.vinted.fr/items/${c.id}`, photoUrl: c.photoUrl };
    })
    .sort((a, b) => (b.marginCents ?? -Infinity) - (a.marginCents ?? -Infinity) || a.priceCents - b.priceCents);
  return { at: now, median: med, deals, seen: candidates.length };
}

/** A saved search from the seller's form: a brand is required, the rest optional. */
export function newSearch(f: { brand: string; category: Category | null; size: string; maxPriceCents: number | null; minCondition: Condition | null }, now: number): SavedSearch | null {
  const brand = f.brand.replace(/\s+/g, ' ').trim();
  if (!brand) return null;
  return { id: `rs_${now.toString(36)}`, brand, category: f.category, size: f.size.trim() || null, maxPriceCents: f.maxPriceCents, minCondition: f.minCondition, createdAt: now };
}
