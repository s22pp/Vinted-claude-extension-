import { CHOSEN_REPOSTS_KEY, type ChosenRepost, removeChosen } from '@/intelligence/repost-choice';
import { REPOST_NOW_KEY, type RepostNow, startNow } from '@/intelligence/repost-now';
import { errorInfo } from './adapters/marketplace';
import { db } from './db';
import { repo } from './repo';
import { finishRepost, pendingReposts, repostAsDraft } from './vinted-repost';
import { publishDraft } from './vinted-draft';

/**
 * « Republier maintenant » (EXPERIMENTAL): the seller's own repost of one listing, run at once, Pilote on or off — the
 * same verified steps as a round's repost: the copy made with the same photos and published, read back online, and only
 * then the old listing removed. Favourites: at most as many as the seller saw and accepted in the confirmation.
 * A copy already waiting for this article is finished, never made twice. Each step is written to the browser session,
 * so the dialog (dashboard or popup) follows it live, and can be closed meanwhile.
 */
export async function repostNow(itemId: string, acceptFavourites: number, now = Date.now()): Promise<RepostNow> {
  const item = await db.items.get(itemId);
  let r = startNow(itemId, item?.title ?? itemId, now);
  const save = async (patch: Partial<RepostNow>) => {
    r = { ...r, ...patch };
    await browser.storage.session.set({ [REPOST_NOW_KEY]: r }).catch(() => undefined);
    return r;
  };
  await save({});
  const stop = (detail: string, resumable: boolean, outcome: 'FAILED' | 'UNCERTAIN' = 'FAILED') => save({ outcome, detail, resumable, endedAt: Date.now() });
  try {
    // 1. Publication en cours: a copy waiting for this article is taken up; else one is made.
    let draftId = (await pendingReposts(now)).find((p) => p.itemId === itemId)?.draftId ?? null;
    if (!draftId) {
      const copy = await repostAsDraft(itemId, now, null, acceptFavourites);
      if (!copy.ok) return stop(`${copy.code}${copy.detail ? ` · ${copy.detail}` : ''}`, false);
      draftId = copy.draftId;
    }
    await save({ newListingId: draftId });
    const pub = await publishDraft(draftId, itemId, r.title);
    if (!pub.ok) return stop(`copie ${draftId} faite, pas encore publiée : ${pub.code}${pub.detail ? ` · ${pub.detail}` : ''}`, true);
    // 2. Vérification: the copy read back online, then the old listing removed (favourites checked again on Vinted).
    await save({ step: 'verify' });
    const fin = await finishRepost(itemId, Date.now());
    if (!fin.ok) return stop(`copie ${draftId} en ligne, ancienne annonce gardée : ${fin.code}${fin.detail ? ` · ${fin.detail}` : ''}`, true);
    // Done: off the seller's « À republier » list if it was there (its new listing is never picked again).
    await repo.setSetting(CHOSEN_REPOSTS_KEY, removeChosen(await repo.getSetting<ChosenRepost[]>(CHOSEN_REPOSTS_KEY, []), itemId));
    if (!pub.verified || !fin.verified)
      return save({ step: 'verify', outcome: 'UNCERTAIN', detail: !pub.verified ? 'publication envoyée, pas encore relue en ligne sur Vinted' : 'suppression de l’ancienne annonce envoyée, pas encore confirmée par Vinted', resumable: false, endedAt: Date.now() });
    // 3. Republié.
    return save({ step: 'done', outcome: 'DONE', detail: null, resumable: false, endedAt: Date.now() });
  } catch (e) {
    const { code, detail } = errorInfo(e);
    const waiting = (await pendingReposts(Date.now()).catch(() => [])).some((p) => p.itemId === itemId);
    return stop(`${code}${detail ? ` · ${detail}` : ''}`, waiting);
  }
}
