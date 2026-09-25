import type { ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';
import type { ItemView } from './portfolio';

export interface FavoriteGain {
  itemId: string;
  gained: number;
  now: number;
  since: number;
}

/**
 * Favourites gained between the two latest imports, per item still for sale — read from ERA's own
 * observation history (no extra Vinted call). Only recent imports count: an old gain is no longer news.
 */
export function favoriteGains(views: readonly ItemView[], observations: readonly ListingObservation[], now: number, freshDays = 7): FavoriteGain[] {
  const byListing = new Map<string, ListingObservation[]>();
  for (const o of observations) byListing.set(o.listingId, [...(byListing.get(o.listingId) ?? []), o]);
  const out: FavoriteGain[] = [];
  for (const v of views) {
    if (!v.inStock || !v.current) continue;
    const obs = (byListing.get(v.current.id) ?? []).filter((o) => o.favorites !== null).sort((a, b) => a.at - b.at);
    if (obs.length < 2) continue;
    const last = obs[obs.length - 1]!;
    const prev = obs[obs.length - 2]!;
    if (now - last.at > freshDays * DAY) continue;
    const gained = last.favorites! - prev.favorites!;
    if (gained > 0) out.push({ itemId: v.item.id, gained, now: last.favorites!, since: prev.at });
  }
  return out.sort((a, b) => b.gained - a.gained);
}
