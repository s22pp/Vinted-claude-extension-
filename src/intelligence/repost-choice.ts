/**
 * The seller's own « À republier » list (pure): any article they choose, reposted one per round by the Pilote before
 * its own picks. A listing with favourites or views is the seller's call — ERA says what would be lost, the seller
 * accepts it once, and that acceptance holds only for those numbers: more favourites since, and ERA asks again.
 */

export const CHOSEN_REPOSTS_KEY = 'repostChosen';

export interface ChosenRepost {
  itemId: string;
  /** Favourites the seller accepted to lose when choosing (the listing's count then; 0 when it had none). */
  acceptFavourites: number;
  /** Views the listing had when chosen (said in the confirmation; never a reason to stop). */
  views: number | null;
  addedAt: number;
}

export interface ChosenFacts {
  itemId: string;
  title: string;
  /** ERA's status of the article (LISTED, RESERVED, SOLD…). */
  status: string;
  /** Its current listing is live on Vinted. */
  live: boolean;
  /** Favourites as ERA last read them; null when unknown (Vinted is asked again before anything is done). */
  favourites: number | null;
  views: number | null;
  /** A copy already waits for this article (finished first, never a second one). */
  pending: boolean;
}

/** Added in one go (a selection in Stock): each with the numbers the seller sees now; one already there takes the new ones. */
export function addChosen(list: readonly ChosenRepost[], items: readonly Pick<ChosenFacts, 'itemId' | 'favourites' | 'views'>[], now: number): ChosenRepost[] {
  const byId = new Map(list.map((c) => [c.itemId, c]));
  for (const it of items) {
    const was = byId.get(it.itemId);
    byId.set(it.itemId, { itemId: it.itemId, acceptFavourites: Math.max(0, it.favourites ?? 0), views: it.views, addedAt: was?.addedAt ?? now });
  }
  return [...byId.values()].sort((a, b) => a.addedAt - b.addedAt);
}

export const removeChosen = (list: readonly ChosenRepost[], itemId: string) => list.filter((c) => c.itemId !== itemId);

/** What a repost of these listings loses (said before the seller confirms): favourites and views, and on how many. */
export function lossOf(items: readonly Pick<ChosenFacts, 'favourites' | 'views'>[]): { withFavourites: number; favourites: number; views: number; unknown: number } {
  return {
    withFavourites: items.filter((i) => (i.favourites ?? 0) > 0).length,
    favourites: items.reduce((s, i) => s + Math.max(0, i.favourites ?? 0), 0),
    views: items.reduce((s, i) => s + Math.max(0, i.views ?? 0), 0),
    unknown: items.filter((i) => i.favourites === null).length,
  };
}

export type ChosenBlock = 'NOT_LIVE' | 'MORE_FAVOURITES';

export interface ChosenPlan {
  /** The one the round reposts, with what the seller accepted. */
  pick: (ChosenRepost & { title: string }) | null;
  /** Gone from the stock (sold, deleted): taken off the list. */
  drop: string[];
  /** Kept on the list but not reposted now, and why: reserved or hidden; or more favourites than the seller accepted. */
  blocked: { itemId: string; title: string; why: ChosenBlock; favourites?: number }[];
}

/** The round's pick from the seller's list, in the seller's order; never the article skipped this round (a price cut). */
export function planChosen(list: readonly ChosenRepost[], facts: readonly ChosenFacts[], skip: ReadonlySet<string> = new Set()): ChosenPlan {
  const byId = new Map(facts.map((f) => [f.itemId, f]));
  const out: ChosenPlan = { pick: null, drop: [], blocked: [] };
  for (const c of [...list].sort((a, b) => a.addedAt - b.addedAt)) {
    const f = byId.get(c.itemId);
    if (!f || f.status === 'SOLD' || f.status === 'ARCHIVED') {
      out.drop.push(c.itemId);
      continue;
    }
    if (f.pending || skip.has(c.itemId)) continue;
    if (f.status !== 'LISTED' || !f.live) {
      out.blocked.push({ itemId: c.itemId, title: f.title, why: 'NOT_LIVE' });
      continue;
    }
    if (f.favourites !== null && f.favourites > c.acceptFavourites) {
      out.blocked.push({ itemId: c.itemId, title: f.title, why: 'MORE_FAVOURITES', favourites: f.favourites });
      continue;
    }
    if (!out.pick) out.pick = { ...c, title: f.title };
  }
  return out;
}
