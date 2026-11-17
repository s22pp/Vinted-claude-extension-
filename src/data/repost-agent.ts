import { buildItemViews } from '@/intelligence/portfolio';
import { REPOST_DAYS, repostQueue } from '@/intelligence/repost-plan';
import { errorInfo } from './adapters/marketplace';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { db } from './db';
import { duePriceCuts } from './price-cuts';
import { finishRepost, pendingReposts, repostAsDraft } from './vinted-repost';
import { publishDraft } from './vinted-draft';

export interface AutoRepostResult {
  /** The article reposted this round (its copy live, the old listing gone or its deletion sent), with its new price if any. */
  done: { title: string; from: number | null; to: number | null; deleted: boolean } | null;
  /** The one the round would repost (simulation), named only. */
  would: { title: string; to: number | null } | null;
  /** Why the round's repost stopped half-way (taken up again next round), and the stopping code if any. */
  failed: string | null;
  code: string | null;
}

const STOPPING = /^(NETWORK_403|RATE_LIMITED|NOT_LOGGED_IN|BUDGET_EXHAUSTED|NO_VINTED_TAB)/;

/**
 * One repost per round (EXPERIMENTAL — the same steps as the seller's clicks, each verified on Vinted): a copy waiting
 * from an earlier round is finished first (published, then the old listing deleted); else the oldest listing online
 * REPOST_DAYS days or more with no favourite gets a copy (same photos, the plan's cut price when one is due), the copy is
 * published and read back, then the old listing is deleted — only once the copy is live and the old one still has no
 * favourite, both checked on Vinted. Any doubt stops it: the next round takes it up where it stopped.
 */
export async function autoRepost(dryRun: boolean, skipItemIds: ReadonlySet<string> = new Set(), now = Date.now()): Promise<AutoRepostResult> {
  const out: AutoRepostResult = { done: null, would: null, failed: null, code: null };
  const fail = (title: string, code: string, detail?: string) => {
    out.failed = `${title} : ${code}${detail ? ` · ${detail}` : ''}`;
    out.code = code;
    return out;
  };
  const pending = await pendingReposts(now);
  const [items, listings, sales] = await Promise.all([db.items.filter((i) => !i.isDemo).toArray(), db.listings.filter((l) => !l.isDemo).toArray(), db.sales.filter((s) => !s.isDemo).toArray()]);
  const views = buildItemViews(items, listings, sales, now);
  const cuts = new Map((await duePriceCuts(now).catch(() => [])).map((c) => [c.itemId, c]));

  // A copy already made (an earlier round, or by hand): finished first — never a second copy meanwhile.
  const waiting = pending.find((p) => !p.deleteSentAt);
  if (waiting) {
    if (dryRun) {
      out.would = { title: waiting.title, to: null };
      return out;
    }
    // Still a draft on Vinted: published first (an already published copy is never « published » again).
    let stillDraft = false;
    try {
      const copy = (await new VintedTabAdapter().rawGet(`/api/v2/item_upload/items/${waiting.draftId}`)) as { item?: { is_draft?: unknown } };
      stillDraft = copy.item?.is_draft === true;
    } catch (e) {
      const { code, detail } = errorInfo(e);
      return fail(waiting.title, code, detail ?? undefined);
    }
    if (stillDraft) {
      const pub = await publishDraft(waiting.draftId, waiting.itemId, waiting.title);
      if (!pub.ok) return fail(waiting.title, pub.code, `copie ${waiting.draftId} encore en brouillon · ${pub.detail ?? ''}`);
    }
    const fin = await finishRepost(waiting.itemId, now);
    if (!fin.ok) return fail(waiting.title, fin.code, fin.detail);
    out.done = { title: waiting.title, from: null, to: null, deleted: fin.verified };
    return out;
  }

  const queue = repostQueue(
    views
      .filter((v) => v.inStock && !skipItemIds.has(v.item.id))
      .map((v) => ({
        itemId: v.item.id,
        title: v.current?.title ?? v.item.title,
        status: v.item.status,
        live: v.current?.status === 'ACTIVE',
        listedAtKnown: v.current?.listedAtKnown !== false,
        daysListed: v.daysListed,
        favourites: v.current?.favorites ?? null,
        pending: pending.some((p) => p.itemId === v.item.id),
      })),
    REPOST_DAYS,
  );
  const pick = queue[0];
  if (!pick) return out;
  const cut = cuts.get(pick.itemId) ?? null;
  if (dryRun) {
    out.would = { title: pick.title, to: cut?.toCents ?? null };
    return out;
  }
  try {
    const copy = await repostAsDraft(pick.itemId, now, cut?.toCents ?? null);
    if (!copy.ok) return fail(pick.title, copy.code, copy.detail);
    const pub = await publishDraft(copy.draftId, pick.itemId, pick.title);
    if (!pub.ok) return fail(pick.title, pub.code, `copie ${copy.draftId} faite, publication à reprendre · ${pub.detail ?? ''}`);
    const fin = await finishRepost(pick.itemId, Date.now());
    if (!fin.ok) return fail(pick.title, fin.code, `copie ${copy.draftId} en ligne, ancienne annonce gardée pour l’instant · ${fin.detail ?? ''}`);
    out.done = { title: pick.title, from: cut?.fromCents ?? null, to: cut?.toCents ?? null, deleted: fin.verified };
    return out;
  } catch (e) {
    const { code, detail } = errorInfo(e);
    return fail(pick.title, code, detail ?? undefined);
  }
}

export const isStopping = (code: string | null) => !!code && STOPPING.test(code);
