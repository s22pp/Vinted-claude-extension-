import type { Listing } from './entities';

/** A live listing that did not change is observed again after this long: one point a day for its history. */
export const OBSERVE_EVERY_MS = 20 * 60 * 60 * 1000;

/**
 * Whether an import stores an observation of a listing. Something moved (price, views, favourites) or a new
 * listing: yes. Nothing moved: a live listing gets one a day at most — automatic refreshes every few hours would
 * otherwise pile up identical rows that every screen then reads — and a closed one none.
 */
export function shouldObserve(
  prev: Pick<Listing, 'priceCents' | 'views' | 'favorites' | 'lastObservationAt'> | undefined | null,
  now: { priceCents: number; views: number | null; favorites: number | null },
  live: boolean,
  at: number,
): boolean {
  if (!prev || prev.priceCents !== now.priceCents || prev.views !== now.views || prev.favorites !== now.favorites) return true;
  return live && (prev.lastObservationAt == null || at - prev.lastObservationAt >= OBSERVE_EVERY_MS);
}
