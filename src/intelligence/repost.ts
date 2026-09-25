import type { DomainEvent, InventoryItem, Listing, ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { skuOf, skusInText } from './listing';
import { brandKey, normalizeText } from './normalize';

/**
 * Reposts (the article deleted then published again on Vinted, by hand or by any tool) must not break
 * ERA's memory of the article. Vinted gives the new announcement a new id, zero views and zero
 * favourites; ERA attaches it to the SAME inventory item, so cost, purchase date, first listing date,
 * price history and predictions carry over — and records what the repost cost and what it brought.
 */

/** A listing gone from the wardrobe that may come back as a new announcement. */
export interface RepostCandidate {
  listing: Listing;
  item: InventoryItem;
}

/** A listing seen for the first time in the wardrobe. */
export interface NewListing {
  title: string;
  brand: string | null;
  size: string | null;
  priceCents: number;
}

export type RepostBasis = 'SKU' | 'TITLE';

export interface RepostMatch {
  candidate: RepostCandidate;
  /** SKU: ERA's reference in the new title (certain). TITLE: same title, brand and size (inferred). */
  basis: RepostBasis;
}

const sizeKey = (s: string | null) => (s ? normalizeText(s).replace(/\s+/g, '') : null);
const brandOf = (s: string | null) => (s && normalizeText(s) !== 'inconnue' ? brandKey(s) : null);
/** Two known values must agree; an unknown value never blocks the match. */
const agree = (a: string | null, b: string | null) => a === null || b === null || a === b;

export function matchRepost(n: NewListing, pool: readonly RepostCandidate[]): RepostMatch | null {
  const skus = skusInText(n.title);
  const bySku = skus.length ? pool.find((c) => skus.includes(skuOf(c.item.id))) : undefined;
  if (bySku) return { candidate: bySku, basis: 'SKU' };
  const title = normalizeText(n.title);
  const same = pool.filter(
    (c) => normalizeText(c.listing.title) === title && agree(brandOf(c.item.brand), brandOf(n.brand)) && agree(sizeKey(c.item.size), sizeKey(n.size)),
  );
  if (!same.length) return null;
  // Identical titles (several units of one article): the closest previous price is the same unit.
  const best = [...same].sort((a, b) => Math.abs(a.listing.priceCents - n.priceCents) - Math.abs(b.listing.priceCents - n.priceCents))[0]!;
  return { candidate: best, basis: 'TITLE' };
}

/** Days after a repost during which ERA proposes nothing else: its effect must be observed first. */
export const REPOST_COOLDOWN_DAYS = 7;
/** A removed listing still counts as "may come back" for this long. */
export const REPOST_WINDOW_DAYS = 30;

export interface RepostInfo {
  eventId: string;
  at: number;
  daysSince: number;
  fromListingId: string | null;
  toListingId: string | null;
  basis: RepostBasis;
  priceFrom: number | null;
  priceTo: number | null;
  /** What Vinted reset: the old announcement's last observed counts. */
  viewsLost: number | null;
  favoritesLost: number | null;
  /** Views per day on the new announcement's first week vs the old one's last week; null until measured. */
  effect: number | null;
  /** Reposts of this article recorded by ERA. */
  count: number;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function nearest(obs: readonly ListingObservation[], t: number, tolerance = 3 * DAY): ListingObservation | null {
  let best: ListingObservation | null = null;
  for (const o of obs) if (o.views !== null && Math.abs(o.at - t) <= tolerance && (!best || Math.abs(o.at - t) < Math.abs(best.at - t))) best = o;
  return best;
}

/**
 * Relative change in views/day: the new announcement over its first week (it starts at zero views)
 * against the old one over its last observed week. Null while the observations don't cover both.
 */
export function repostEffect(oldObs: readonly ListingObservation[], newObs: readonly ListingObservation[], at: number): number | null {
  const withViews = oldObs.filter((o) => o.views !== null && o.at <= at + DAY);
  const last = withViews.reduce<ListingObservation | null>((a, o) => (!a || o.at > a.at ? o : a), null);
  if (!last) return null;
  const weekBefore = nearest(withViews, last.at - 7 * DAY);
  const after = nearest(newObs, at + 7 * DAY);
  if (!weekBefore || !after || after.at - at < 5 * DAY) return null;
  const spanBefore = (last.at - weekBefore.at) / DAY;
  if (spanBefore < 3) return null;
  const before = (last.views! - weekBefore.views!) / spanBefore;
  const vpdAfter = after.views! / ((after.at - at) / DAY);
  if (before <= 0) return vpdAfter > 0 ? 1 : null;
  return vpdAfter / before - 1;
}

/** The latest repost of each item, with its measured effect. */
export function lastReposts(events: readonly DomainEvent[], observations: readonly ListingObservation[], now: number): Map<string, RepostInfo> {
  const obsByListing = new Map<string, ListingObservation[]>();
  for (const o of observations) obsByListing.set(o.listingId, [...(obsByListing.get(o.listingId) ?? []), o]);
  const count = new Map<string, number>();
  const latest = new Map<string, DomainEvent>();
  for (const e of events) {
    if (e.type !== 'LISTING_REPUBLISHED' || !e.inventoryItemId) continue;
    count.set(e.inventoryItemId, (count.get(e.inventoryItemId) ?? 0) + 1);
    const prev = latest.get(e.inventoryItemId);
    if (!prev || prev.at < e.at) latest.set(e.inventoryItemId, e);
  }
  const out = new Map<string, RepostInfo>();
  for (const [itemId, e] of latest) {
    const from = typeof e.data.from === 'string' ? e.data.from : null;
    const to = e.listingId;
    out.set(itemId, {
      eventId: e.id,
      at: e.at,
      daysSince: Math.max(0, Math.floor((now - e.at) / DAY)),
      fromListingId: from,
      toListingId: to,
      basis: e.data.basis === 'SKU' ? 'SKU' : 'TITLE',
      priceFrom: num(e.data.priceFrom),
      priceTo: num(e.data.priceTo),
      viewsLost: num(e.data.viewsLost),
      favoritesLost: num(e.data.favoritesLost),
      effect: from && to ? repostEffect(obsByListing.get(from) ?? [], obsByListing.get(to) ?? [], e.at) : null,
      count: count.get(itemId) ?? 1,
    });
  }
  return out;
}
