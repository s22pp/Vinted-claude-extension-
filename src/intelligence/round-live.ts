/**
 * The round, live (pure): each step of the autopilot's round as it goes — waiting, running, done (with what it did),
 * skipped (switched off, or nothing to do), stopped — and the Vinted requests it has used so far. The background writes
 * it as the round goes; the Pilote panel draws it. Nothing is invented: a step is « done » only once it has returned.
 */

export const ROUND_STEPS = ['refresh', 'offers', 'fav', 'delivered', 'replies', 'priceCut', 'repost', 'labels', 'alerts', 'outcomes', 'backup'] as const;
export type RoundStep = (typeof ROUND_STEPS)[number];

export type StepState = 'WAIT' | 'RUN' | 'DONE' | 'SKIP' | 'STOP';

export interface LiveStep {
  state: StepState;
  /** What the step did (messages sent, labels saved…), when it has a count; null when it has none. */
  n: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface LiveRound {
  startedAt: number;
  endedAt: number | null;
  dryRun: boolean;
  manual: boolean;
  steps: Record<RoundStep, LiveStep>;
  /** Vinted requests used by the round so far. */
  calls: number;
  /** Why the round stopped, if it did (ERA's own words). */
  stopped: string | null;
}

/** chrome.storage.session key the background writes and the panel reads. */
export const LIVE_ROUND_KEY = 'eraRoundLive';
/** A finished round stays on the panel this long, then the panel shows the usual summary only. */
export const LIVE_KEEP_MS = 15 * 60_000;

export function startRound(now: number, dryRun: boolean, manual: boolean): LiveRound {
  const steps = Object.fromEntries(ROUND_STEPS.map((s) => [s, { state: 'WAIT', n: null, startedAt: null, endedAt: null }])) as Record<RoundStep, LiveStep>;
  return { startedAt: now, endedAt: null, dryRun, manual, steps, calls: 0, stopped: null };
}

export function stepBegin(r: LiveRound, step: RoundStep, now: number): LiveRound {
  return { ...r, steps: { ...r.steps, [step]: { ...r.steps[step], state: 'RUN', startedAt: now } } };
}

export function stepEnd(r: LiveRound, step: RoundStep, now: number, n: number | null, stopped = false): LiveRound {
  return { ...r, steps: { ...r.steps, [step]: { ...r.steps[step], state: stopped ? 'STOP' : 'DONE', n, endedAt: now } } };
}

/** The round is over: the steps never begun were skipped (switched off, nothing to do, or after a stop). */
export function finishRound(r: LiveRound, now: number, stopped: string | null): LiveRound {
  const steps = Object.fromEntries(
    ROUND_STEPS.map((s) => {
      const x = r.steps[s];
      // A step still marked running when the round ends was cut short.
      return [s, x.state === 'WAIT' ? { ...x, state: 'SKIP' } : x.state === 'RUN' ? { ...x, state: 'STOP', endedAt: now } : x];
    }),
  ) as Record<RoundStep, LiveStep>;
  return { ...r, steps, endedAt: now, stopped };
}

/** The step running now (at most one), for the panel's « en cours » line. */
export const currentStep = (r: LiveRound): RoundStep | null => ROUND_STEPS.find((s) => r.steps[s].state === 'RUN') ?? null;

/** Shown on the panel: a round running, or one finished less than LIVE_KEEP_MS ago. */
export const showLive = (r: LiveRound | null | undefined, now: number): r is LiveRound => !!r && (r.endedAt === null || now - r.endedAt < LIVE_KEEP_MS);

/** Steps done / steps that will run (skipped ones do not count), for the progress bar. */
export function progress(r: LiveRound): { done: number; total: number } {
  const states = ROUND_STEPS.map((s) => r.steps[s].state);
  const total = r.endedAt === null ? states.filter((s) => s !== 'SKIP').length : states.filter((s) => s === 'DONE' || s === 'STOP').length;
  return { done: states.filter((s) => s === 'DONE' || s === 'STOP').length, total: Math.max(1, total) };
}
