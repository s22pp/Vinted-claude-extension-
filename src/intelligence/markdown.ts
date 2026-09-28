import type { DomainEvent, Listing, ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';

/**
 * Plan de baisse: a price calendar the seller sets once (by default −5 % after 14 days online, −10 % after 30),
 * counted from the listing's starting price, never below the floor (known cost + minimum margin). ERA never
 * lowers a price by itself: a step that is due is shown, the seller applies it — one listing at a time.
 * Unknown cost = unknown floor: the plan is shown but not applied (UNKNOWN ≠ ZERO).
 */

export interface MarkdownStep {
  /** Days online (current listing). */
  day: number;
  /** % off the starting price. */
  pct: number;
}

export const MARKDOWN_KEY = 'markdownSteps';
export const DEFAULT_MARKDOWN: MarkdownStep[] = [
  { day: 14, pct: 5 },
  { day: 30, pct: 10 },
];

/** Cleans what the seller typed: whole days and % in range, ordered, at most 4 steps, each deeper than the one before. */
export function normalizeSteps(steps: readonly Partial<MarkdownStep>[] | null | undefined): MarkdownStep[] {
  const ok = (steps ?? [])
    .map((s) => ({ day: Math.round(Number(s.day)), pct: Math.round(Number(s.pct)) }))
    .filter((s) => Number.isFinite(s.day) && Number.isFinite(s.pct) && s.day >= 1 && s.day <= 365 && s.pct >= 1 && s.pct <= 50)
    .sort((a, b) => a.day - b.day);
  const out: MarkdownStep[] = [];
  for (const s of ok) if (!out.length || (s.day > out[out.length - 1]!.day && s.pct > out[out.length - 1]!.pct)) out.push(s);
  return out.slice(0, 4);
}

export interface PlannedStep extends MarkdownStep {
  /** When the step is due. */
  at: number;
  targetCents: number;
  /** The floor stopped this step (the % would have gone lower). */
  clamped: boolean;
  /** The current price is already at or under this step. */
  done: boolean;
}

export type MarkdownPlan =
  | { status: 'NONE' }
  | { status: 'DUE'; step: PlannedStep; steps: PlannedStep[]; startCents: number; floorCents: number }
  | { status: 'WAIT'; next: PlannedStep; steps: PlannedStep[]; startCents: number; floorCents: number | null }
  | { status: 'NO_COST'; due: PlannedStep | null; steps: PlannedStep[]; startCents: number }
  | { status: 'DONE'; steps: PlannedStep[]; startCents: number; floorCents: number; atFloor: boolean };

/** A lower price that reads well: 50 cents under 20 €, whole euros above, rounded down. */
export function niceDown(cents: number): number {
  const unit = cents < 2000 ? 50 : 100;
  return Math.floor(cents / unit) * unit;
}

export interface MarkdownInput {
  askCents: number | null;
  startCents: number | null;
  listedAt: number | null;
  /** Floor: known cost + minimum margin; null when the cost is unknown. */
  floorCents: number | null;
  now: number;
}

export function markdownPlan(x: MarkdownInput, steps: readonly MarkdownStep[]): MarkdownPlan {
  if (x.askCents === null || x.listedAt === null || !steps.length) return { status: 'NONE' };
  const ask = x.askCents;
  const start = Math.max(x.startCents ?? ask, ask);
  // Vinted's lowest price is 1 €; a floor never lands on odd cents.
  const floor = x.floorCents === null ? null : Math.max(100, Math.ceil(x.floorCents / 100) * 100);
  const planned: PlannedStep[] = steps.map((s) => {
    const raw = Math.max(100, niceDown(Math.round(start * (1 - s.pct / 100))));
    const target = floor === null ? raw : Math.max(raw, floor);
    return { ...s, at: x.listedAt! + s.day * DAY, targetCents: target, clamped: floor !== null && raw < floor, done: ask <= target };
  });
  const due = planned.filter((s) => s.at <= x.now);
  const current = due[due.length - 1] ?? null;
  const pending = current && !current.done && current.targetCents < ask ? current : null;
  const next = planned.find((s) => s.at > x.now && s.targetCents < ask) ?? null;
  if (floor === null) {
    if (pending || next) return { status: 'NO_COST', due: pending, steps: planned, startCents: start };
    return { status: 'NONE' };
  }
  if (pending) return { status: 'DUE', step: pending, steps: planned, startCents: start, floorCents: floor };
  if (next) return { status: 'WAIT', next, steps: planned, startCents: start, floorCents: floor };
  return { status: 'DONE', steps: planned, startCents: start, floorCents: floor, atFloor: ask <= floor };
}

/**
 * A listing's starting price: the first price ERA saw on it (observations), else the "from" of its first
 * price change, else its price today.
 */
export function startPriceOf(l: Listing, observations: readonly ListingObservation[], priceEvents: readonly DomainEvent[]): number {
  let first: ListingObservation | null = null;
  for (const o of observations) if (o.listingId === l.id && (!first || o.at < first.at)) first = o;
  if (first) return first.priceCents;
  let ev: DomainEvent | null = null;
  for (const e of priceEvents) if (e.type === 'PRICE_CHANGED' && e.listingId === l.id && typeof e.data.from === 'number' && (!ev || e.at < ev.at)) ev = e;
  return ev ? (ev.data.from as number) : l.priceCents;
}
