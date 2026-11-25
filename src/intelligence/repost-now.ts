/**
 * « Republier maintenant » (pure): the seller's own repost, in the order the seller set, one article after another:
 *  1. Récupération: everything read on Vinted and copied into a Vinted DRAFT (same fields, same photos sent again),
 *     read back — invisible to buyers. If this fails, nothing is deleted.
 *  2. Suppression: the old listing deleted, then read back gone.
 *  3. Attente: a wait drawn between the seller's minimum and maximum (3 to 10 minutes unless changed).
 *  4. Remise en ligne: the draft published, then read back online.
 * A result Vinted does not show back clearly stays « à vérifier », never announced as done. Each job is stored, so the
 * wait survives Chrome stopping the extension's worker: an alarm takes it up at its time.
 */

/** The jobs, in order (storage.local): the dashboard, the popup and the worker all read the same list. */
export const REPOST_JOBS_KEY = 'eraRepostJobs';
/** The seller's wait window, in minutes (a setting). */
export const REPOST_WAIT_KEY = 'repostWait';
export const REPOST_ALARM = 'era-repost';

export interface WaitWindow {
  minMin: number;
  maxMin: number;
}
export const DEFAULT_WAIT: WaitWindow = { minMin: 3, maxMin: 10 };
/** The longest wait ERA accepts: the article is offline meanwhile. */
export const MAX_WAIT_MIN = 60;

export type NowStep = 'copy' | 'delete' | 'wait' | 'publish' | 'done';
/** The four steps shown to the seller (« done » is where a finished job stands). */
export const NOW_STEPS: readonly Exclude<NowStep, 'done'>[] = ['copy', 'delete', 'wait', 'publish'];

/**
 * QUEUED: not started (another article goes first). RUNNING: a step under way. WAITING: offline, the wait running.
 * DONE: all four steps seen on Vinted. UNCERTAIN: sent, not shown back — to check. FAILED: stopped.
 */
export type NowOutcome = 'QUEUED' | 'RUNNING' | 'WAITING' | 'DONE' | 'UNCERTAIN' | 'FAILED';

export interface RepostNow {
  itemId: string;
  title: string;
  startedAt: number;
  /** The step under way, or where it stopped. */
  step: NowStep;
  outcome: NowOutcome;
  /** Favourites the seller accepted to lose, as seen in the confirmation. */
  acceptFavourites: number;
  /** The seller's window for this article, in minutes. */
  wait: WaitWindow;
  /** The end of the wait (ms), once the old listing is gone. */
  waitUntil: number | null;
  /** The copy's Vinted id (the draft, then the new listing). */
  newListingId: string | null;
  /** Why it stopped, or what remains to check (ERA's words). */
  detail: string | null;
  /** « Reprendre » takes it up where it stopped (a copy exists on Vinted, or nothing was touched yet). */
  resumable: boolean;
  endedAt: number | null;
}

export function startNow(itemId: string, title: string, now: number, acceptFavourites: number, wait: WaitWindow): RepostNow {
  return { itemId, title, startedAt: now, step: 'copy', outcome: 'QUEUED', acceptFavourites: Math.max(0, Math.floor(acceptFavourites)), wait: clampWindow(wait), waitUntil: null, newListingId: null, detail: null, resumable: false, endedAt: null };
}

/** A window the seller typed, made valid: whole minutes, 0 ≤ min ≤ max ≤ 60. */
export function clampWindow(w: Partial<WaitWindow> | null | undefined): WaitWindow {
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(MAX_WAIT_MIN, Math.max(0, Math.round(x))) : d);
  const minMin = n(w?.minMin, DEFAULT_WAIT.minMin);
  const maxMin = Math.max(minMin, n(w?.maxMin, Math.max(minMin, DEFAULT_WAIT.maxMin)));
  return { minMin, maxMin };
}

/** The wait for one article, drawn evenly in the window (ms). `rand` in [0, 1). */
export function drawWaitMs(w: WaitWindow, rand: number): number {
  const { minMin, maxMin } = clampWindow(w);
  const r = Math.min(Math.max(rand, 0), 0.999_999);
  return Math.round((minMin + (maxMin - minMin) * r) * 60_000);
}

/** Still in the list's hands (not finished nor stopped). */
export const isActive = (j: RepostNow) => j.outcome === 'QUEUED' || j.outcome === 'RUNNING' || j.outcome === 'WAITING';

/**
 * What the runner does next with the list: the first job still active is the one under way (one article at a time);
 * a wait not over yet is slept on until `until`.
 */
export type NextMove = { kind: 'idle' } | { kind: 'sleep'; itemId: string; until: number } | { kind: 'step'; itemId: string; step: 'copy' | 'delete' | 'publish' };

export function nextMove(jobs: readonly RepostNow[], now: number): NextMove {
  const j = jobs.find(isActive);
  if (!j) return { kind: 'idle' };
  if (j.step === 'wait') {
    const until = j.waitUntil ?? now;
    return until > now ? { kind: 'sleep', itemId: j.itemId, until } : { kind: 'step', itemId: j.itemId, step: 'publish' };
  }
  if (j.step === 'done') return { kind: 'idle' };
  return { kind: 'step', itemId: j.itemId, step: j.step };
}

export type StepStatus = 'wait' | 'run' | 'done' | 'uncertain' | 'failed';

/** Each step's status, for the stepper. */
export function stepStatuses(r: RepostNow): { step: Exclude<NowStep, 'done'>; status: StepStatus }[] {
  const at = r.step === 'done' ? NOW_STEPS.length : NOW_STEPS.indexOf(r.step);
  return NOW_STEPS.map((step, i) => {
    let status: StepStatus;
    if (i < at) status = 'done';
    else if (i > at) status = 'wait';
    else if (r.outcome === 'RUNNING' || r.outcome === 'WAITING') status = 'run';
    else if (r.outcome === 'QUEUED') status = 'wait';
    else if (r.outcome === 'DONE') status = 'done';
    else if (r.outcome === 'UNCERTAIN') status = 'uncertain';
    else status = 'failed';
    return { step, status };
  });
}

/** « 6 min 12 s », « 45 s »: what is left of a wait. */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
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
