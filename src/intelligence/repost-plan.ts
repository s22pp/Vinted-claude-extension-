/**
 * Which listing the autopilot reposts (one per round): online for REPOST_DAYS or more, never a single favourite (a repost
 * would lose them — checked again on Vinted before anything is done), neither reserved nor hidden, its publication date
 * known; the oldest first. Pure.
 */

export const REPOST_DAYS = 30;

export interface RepostCandidate {
  itemId: string;
  title: string;
  /** ERA's status of the article. */
  status: string;
  /** The current listing is live on Vinted (ACTIVE). */
  live: boolean;
  /** Vinted gave a real publication date (else the age is only a lower bound: never reposted on a guess). */
  listedAtKnown: boolean;
  daysListed: number | null;
  favourites: number | null;
  /** A copy already waits (made earlier): finished first, never a second one. */
  pending: boolean;
}

export function repostQueue(items: readonly RepostCandidate[], days = REPOST_DAYS): RepostCandidate[] {
  return items
    .filter((c) => c.status === 'LISTED' && c.live && c.listedAtKnown && !c.pending && c.favourites === 0 && (c.daysListed ?? 0) >= days)
    .sort((a, b) => (b.daysListed ?? 0) - (a.daysListed ?? 0) || a.title.localeCompare(b.title));
}
