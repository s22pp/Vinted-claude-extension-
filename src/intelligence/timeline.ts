import type { DomainEvent } from '@/domain/entities';

/**
 * Older imports wrote one "Engagement" row per import: shown, per announcement, only the first one, those where
 * favourites moved, and the latest. Nothing is deleted.
 */
export function condenseEngagement(events: readonly DomainEvent[]): DomainEvent[] {
  const lastOf = new Map<string, string>();
  for (const e of events) if (e.type === 'ENGAGEMENT_OBSERVED') lastOf.set(e.listingId ?? '', e.id);
  const favs = new Map<string, unknown>();
  return events.filter((e) => {
    if (e.type !== 'ENGAGEMENT_OBSERVED') return true;
    const k = e.listingId ?? '';
    const first = !favs.has(k);
    const moved = favs.get(k) !== e.data.favorites;
    favs.set(k, e.data.favorites);
    return first || moved || lastOf.get(k) === e.id;
  });
}
