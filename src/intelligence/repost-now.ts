/**
 * « Republier maintenant » (pure): the seller's own repost of one listing, run at once — whether the Pilote is on or
 * off — and followed live in three steps, as the seller sees them:
 *  1. Publication en cours: the copy (same fields, same photos) made and published on Vinted;
 *  2. Vérification: the copy read back online, then the old listing removed — only once the copy is seen live;
 *  3. Republié: the article keeps its history, with the new listing's link.
 * A result Vinted does not show back clearly stays « à vérifier », never announced as done.
 */

export const REPOST_NOW_KEY = 'eraRepostNow';

export type NowStep = 'publish' | 'verify' | 'done';
export const NOW_STEPS: readonly NowStep[] = ['publish', 'verify', 'done'];

/** RUNNING: under way. DONE: all three steps seen on Vinted. UNCERTAIN: sent, not shown back — to check. FAILED: stopped. */
export type NowOutcome = 'RUNNING' | 'DONE' | 'UNCERTAIN' | 'FAILED';

export interface RepostNow {
  itemId: string;
  title: string;
  startedAt: number;
  /** The step under way, or where it stopped. */
  step: NowStep;
  outcome: NowOutcome;
  /** The new listing's Vinted id, once the copy exists. */
  newListingId: string | null;
  /** Why it stopped, or what remains to check (ERA's words). */
  detail: string | null;
  /** A copy exists on Vinted (draft or online) and the old listing is still there: « Reprendre » finishes it. */
  resumable: boolean;
  endedAt: number | null;
}

export function startNow(itemId: string, title: string, now: number): RepostNow {
  return { itemId, title, startedAt: now, step: 'publish', outcome: 'RUNNING', newListingId: null, detail: null, resumable: false, endedAt: null };
}

export type StepStatus = 'wait' | 'run' | 'done' | 'uncertain' | 'failed';

/** Each step's status, for the stepper. */
export function stepStatuses(r: RepostNow): { step: NowStep; status: StepStatus }[] {
  const at = NOW_STEPS.indexOf(r.step);
  return NOW_STEPS.map((step, i) => {
    let status: StepStatus;
    if (i < at) status = 'done';
    else if (i > at) status = 'wait';
    else if (r.outcome === 'RUNNING') status = 'run';
    else if (r.outcome === 'DONE') status = 'done';
    else if (r.outcome === 'UNCERTAIN') status = 'uncertain';
    else status = 'failed';
    return { step, status };
  });
}

/** Days since the listing went online, as the seller says it (« Hier », « Il y a 8 jours »); null when unknown. */
export function publishedAgo(listedAt: number | null, now: number): string | null {
  if (listedAt === null || !Number.isFinite(listedAt) || listedAt > now + 60_000) return null;
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const n = Math.round(day(now) - day(listedAt));
  return n <= 0 ? 'Aujourd’hui' : n === 1 ? 'Hier' : `Il y a ${n} jours`;
}
