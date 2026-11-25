import { CHOSEN_REPOSTS_KEY, type ChosenRepost, removeChosen } from '@/intelligence/repost-choice';
import { REPOST_ALARM, REPOST_JOBS_KEY, REPOST_WAIT_KEY, type RepostNow, type WaitWindow, clampWindow, drawWaitMs, isActive, nextMove, startNow } from '@/intelligence/repost-now';
import { errorInfo } from './adapters/marketplace';
import { loadBudget, writeWait } from './adapters/vinted/budget-store';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { db, uid } from './db';
import { repo } from './repo';
import { PENDING_REPOSTS_KEY, deleteForRepost, pendingReposts, repostAsDraft } from './vinted-repost';
import { publishDraft } from './vinted-draft';
import { waitAlive } from './vinted-write';

/**
 * The list paused by a stop that concerns the account. It takes up again by itself: after a Vinted block once its
 * pause is over, after anything else (no tab, logged out) a minute later — the article concerned first.
 */
export const REPOST_PAUSE_KEY = 'eraRepostPause';
/** Pause after a stop that is not a Vinted block (tab, login): then ERA tries again by itself. */
export const AUTO_RESUME_MS = 60_000;

interface Pause {
  code: string;
  detail: string;
  at: number;
  until: number;
  itemId: string;
}
/** These stop the whole list: the account comes first. Anything else stops only the article concerned. */
const STOP = /^(NETWORK_403|RATE_LIMITED|NOT_LOGGED_IN|BUDGET_EXHAUSTED|NO_VINTED_TAB)/;
/** Finished jobs are kept a day, for the seller to read what happened. */
const KEEP_MS = 24 * 3_600_000;

const obj = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

export async function repostJobs(): Promise<RepostNow[]> {
  const v = await browser.storage.local.get(REPOST_JOBS_KEY);
  const list = v[REPOST_JOBS_KEY];
  return Array.isArray(list) ? (list as RepostNow[]) : [];
}

// One change at a time: the worker, the dashboard's clicks and the alarm all go through here.
let lock: Promise<unknown> = Promise.resolve();
function change<T>(fn: (jobs: RepostNow[]) => { jobs: RepostNow[]; out: T }): Promise<T> {
  const run = lock.then(async () => {
    const { jobs, out } = fn(await repostJobs());
    await browser.storage.local.set({ [REPOST_JOBS_KEY]: jobs });
    return out;
  });
  lock = run.catch(() => undefined);
  return run;
}

const patch = (itemId: string, p: Partial<RepostNow>) =>
  change((jobs) => ({ jobs: jobs.map((j) => (j.itemId === itemId ? { ...j, ...p } : j)), out: undefined }));

/** The copy, published and read back online, as the article's live listing (the old one is already REMOVED). */
async function recordCopy(itemId: string, draftId: string, now: number): Promise<void> {
  const all = await db.listings.where('inventoryItemId').equals(itemId).toArray();
  if (all.some((l) => l.platformListingId === draftId)) return;
  const old = all.filter((l) => l.status === 'REMOVED').sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0))[0];
  if (!old) return;
  await db.listings.put({
    id: uid('listing'),
    inventoryItemId: itemId,
    platform: 'vinted',
    platformListingId: draftId,
    url: `https://www.vinted.fr/items/${draftId}`,
    title: old.title,
    priceCents: old.priceCents,
    views: null,
    favorites: null,
    listedAt: now,
    listedAtKnown: true,
    photoCount: old.photoCount ?? null,
    description: old.description ?? null,
    photoUrls: [],
    removedAt: null,
    soldAt: null,
    status: 'ACTIVE',
    lastObservedAt: null,
    isDemo: false,
  });
}

/**
 * The seller's « Republier maintenant », for one article or several: each joins the list (an article already under way
 * is not added twice) with the seller's wait window and the favourites accepted in the confirmation.
 */
export async function enqueueReposts(items: readonly { itemId: string; acceptFavourites: number }[], window: WaitWindow, now = Date.now()): Promise<number> {
  const w = clampWindow(window);
  await repo.setSetting(REPOST_WAIT_KEY, w);
  const titles = new Map<string, string>();
  for (const it of items) {
    const item = await db.items.get(it.itemId);
    if (item && !item.isDemo) titles.set(it.itemId, item.title);
  }
  return change((jobs) => {
    const kept = jobs.filter((j) => isActive(j) || now - (j.endedAt ?? j.startedAt) < KEEP_MS);
    let added = 0;
    const out = [...kept];
    for (const it of items) {
      const title = titles.get(it.itemId);
      if (!title || out.some((j) => j.itemId === it.itemId && isActive(j))) continue;
      const i = out.findIndex((j) => j.itemId === it.itemId);
      if (i >= 0) out.splice(i, 1);
      out.push(startNow(it.itemId, title, now, it.acceptFavourites, w));
      added++;
    }
    return { jobs: out, out: added };
  });
}

/** « Reprendre »: the article goes on from where it stopped; the list's pause, if any, is lifted by the seller here. */
export async function resumeRepost(itemId: string): Promise<boolean> {
  await browser.storage.local.remove(REPOST_PAUSE_KEY);
  return change((jobs) => {
    const j = jobs.find((x) => x.itemId === itemId);
    if (!j || !j.resumable || isActive(j)) return { jobs, out: false };
    return { jobs: jobs.map((x) => (x === j ? { ...x, outcome: 'RUNNING' as const, detail: null, resumable: false, endedAt: null } : x)), out: true };
  });
}

/** « Remettre en ligne maintenant »: the wait ends now (the old listing is already gone). */
export function skipWait(itemId: string, now = Date.now()): Promise<boolean> {
  return change((jobs) => {
    const j = jobs.find((x) => x.itemId === itemId && x.outcome === 'WAITING');
    if (!j) return { jobs, out: false };
    return { jobs: jobs.map((x) => (x === j ? { ...x, waitUntil: now } : x)), out: true };
  });
}

/** Off the list: an article not started yet, or one finished or stopped (never one under way). */
export function forgetRepost(itemId: string): Promise<boolean> {
  return change((jobs) => {
    const j = jobs.find((x) => x.itemId === itemId);
    if (!j || j.outcome === 'RUNNING' || j.outcome === 'WAITING') return { jobs, out: false };
    return { jobs: jobs.filter((x) => x !== j), out: true };
  });
}

type StepOutcome = 'next' | 'paused';

async function stopped(j: RepostNow, code: string, detail: string | undefined, resumable: boolean): Promise<StepOutcome> {
  const text = `${code}${detail ? ` · ${detail}` : ''}`;
  await patch(j.itemId, { outcome: 'FAILED', detail: text, resumable, endedAt: Date.now() });
  if (!STOP.test(code)) return 'next';
  const now = Date.now();
  // A Vinted block: as long as its pause lasts. Anything else: a minute.
  const { haltedUntil } = await loadBudget().catch(() => ({ haltedUntil: null }));
  const until = /^(NETWORK_403|RATE_LIMITED)/.test(code) && haltedUntil ? haltedUntil : now + AUTO_RESUME_MS;
  await browser.storage.local.set({ [REPOST_PAUSE_KEY]: { code, detail: text, at: now, until, itemId: j.itemId } satisfies Pause });
  return 'paused';
}

/** One step of the article under way. */
async function runStep(itemId: string, step: 'copy' | 'delete' | 'publish'): Promise<StepOutcome> {
  const j = (await repostJobs()).find((x) => x.itemId === itemId);
  if (!j) return 'next';
  await patch(itemId, { step, outcome: 'RUNNING' });
  try {
    if (step === 'copy') {
      // 1. Everything copied into a draft — an existing copy for this article is taken up, never made twice.
      let draftId = (await pendingReposts()).find((p) => p.itemId === itemId)?.draftId ?? null;
      if (!draftId) {
        const c = await repostAsDraft(itemId, Date.now(), null, j.acceptFavourites);
        if (!c.ok) {
          const again = (await pendingReposts()).find((p) => p.itemId === itemId);
          return stopped(j, c.code, c.detail, !!again || STOP.test(c.code));
        }
        draftId = c.draftId;
      }
      await patch(itemId, { newListingId: draftId, step: 'delete' });
      return 'next';
    }
    if (step === 'delete') {
      // 2. The old listing deleted, read back gone; then the wait is drawn in the seller's window.
      const d = await deleteForRepost(itemId);
      if (!d.ok) return stopped(j, d.code, d.detail, true);
      if (!d.verified) {
        await patch(itemId, { outcome: 'UNCERTAIN', detail: 'suppression de l’ancienne annonce envoyée, pas encore confirmée par Vinted', resumable: true, endedAt: Date.now() });
        return 'next';
      }
      const now = Date.now();
      await patch(itemId, { step: 'wait', outcome: 'WAITING', waitUntil: now + drawWaitMs(j.wait, Math.random()) });
      return 'next';
    }
    // 4. The draft published, read back online.
    const pending = (await pendingReposts()).find((p) => p.itemId === itemId);
    const draftId = j.newListingId ?? pending?.draftId ?? null;
    if (!draftId) return stopped(j, 'NOT_APPLIED', 'copie introuvable', false);
    // Already published (a step taken up after Chrome stopped the worker): not published twice.
    const back = obj(obj(await new VintedTabAdapter().rawGet(`/api/v2/item_upload/items/${draftId}`)).item);
    let verified = back.is_draft === false;
    if (back.is_draft !== false) {
      const spacing = await writeWait();
      if (spacing > 0) await waitAlive(spacing);
      const pub = await publishDraft(draftId, itemId, j.title);
      if (!pub.ok) return stopped(j, pub.code, `${pub.detail ?? pub.code} · ancienne annonce supprimée, la copie ${draftId} attend en brouillon sur Vinted`, true);
      verified = pub.verified;
    }
    if (!verified) {
      await patch(itemId, { outcome: 'UNCERTAIN', detail: 'publication envoyée, pas encore relue en ligne sur Vinted', resumable: false, endedAt: Date.now() });
      return 'next';
    }
    // Done: the article shows its new listing now (not after the next import), off the waiting copies and off the
    // seller's « À republier » list if it was there.
    await recordCopy(itemId, draftId, Date.now());
    await repo.setSetting(PENDING_REPOSTS_KEY, (await pendingReposts()).filter((p) => p.itemId !== itemId));
    await repo.setSetting(CHOSEN_REPOSTS_KEY, removeChosen(await repo.getSetting<ChosenRepost[]>(CHOSEN_REPOSTS_KEY, []), itemId));
    await patch(itemId, { step: 'done', outcome: 'DONE', detail: null, resumable: false, waitUntil: null, endedAt: Date.now() });
    return 'next';
  } catch (e) {
    const { code, detail } = errorInfo(e);
    return stopped(j, code, detail ?? undefined, true);
  }
}

/**
 * Background-only: the list, worked one article at a time. A wait of more than a minute is left to the alarm (Chrome
 * stops an idle worker); a shorter one is slept on here. Paused by a stop concerning the account: nothing goes on
 * until the pause is over, then the list takes up again by itself (or at the seller's « Reprendre »).
 */
export async function runRepostQueue(): Promise<void> {
  for (let guard = 0; guard < 500; guard++) {
    const pause = obj((await browser.storage.local.get(REPOST_PAUSE_KEY))[REPOST_PAUSE_KEY]);
    if (Object.keys(pause).length > 0) {
      const until = typeof pause.until === 'number' ? pause.until : 0;
      if (until > Date.now()) {
        // Taken up by itself at the end of the pause (the alarm wakes the worker).
        await browser.alarms.create(REPOST_ALARM, { when: until });
        return;
      }
      await browser.storage.local.remove(REPOST_PAUSE_KEY);
      if (typeof pause.itemId === 'string') await resumeRepost(pause.itemId);
    }
    const move = nextMove(await repostJobs(), Date.now());
    if (move.kind === 'idle') {
      await browser.alarms.clear(REPOST_ALARM);
      return;
    }
    if (move.kind === 'sleep') {
      await browser.alarms.create(REPOST_ALARM, { when: move.until });
      const left = move.until - Date.now();
      if (left > 55_000) return;
      await waitAlive(Math.max(0, left));
      continue;
    }
    if ((await runStep(move.itemId, move.step)) === 'paused') continue;
  }
}
