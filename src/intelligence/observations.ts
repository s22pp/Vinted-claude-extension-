import type { ListingObservation } from '@/domain/entities';

const cache = new WeakMap<readonly ListingObservation[], Map<string, ListingObservation[]>>();

/**
 * Observations grouped by listing, oldest first. Several engines need this for the same render: the grouping
 * is built once per observations array (same array → same index) instead of once per engine.
 */
export function observationsByListing(observations: readonly ListingObservation[]): Map<string, ListingObservation[]> {
  const hit = cache.get(observations);
  if (hit) return hit;
  const m = new Map<string, ListingObservation[]>();
  for (const o of observations) {
    const arr = m.get(o.listingId);
    if (arr) arr.push(o);
    else m.set(o.listingId, [o]);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.at - b.at);
  cache.set(observations, m);
  return m;
}
