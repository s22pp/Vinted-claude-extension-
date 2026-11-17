/**
 * Which of the seller's message wordings ERA sends next — learnt from the seller's own results (pure).
 *
 * The contact base measures, wording by wording, how many members answered (outcomes.ts). This turns it into a choice:
 * 1. Balance: until every wording rests on enough settled contacts, the least tried one goes out (a new wording the
 *    seller adds is tried first) — each one gets its fair measure.
 * 2. Exploit: once they all do, and one clearly beats the others, it goes out four times in five.
 * 3. Keep testing: the fifth goes to the least tried one, so a market that changes is noticed.
 * Never a conclusion on a handful: below the thresholds, ERA only balances, and says so.
 */

import { type ContactKind, type ContactRow, rateOf } from './outcomes';

export interface VariantStat {
  /** The wording before it was filled in (the template), as the contact base keeps it. */
  variant: string;
  /** Contacts sent with it. */
  n: number;
  /** Settled for the answer (answered, or old enough), and answered among them. */
  replyN: number;
  replied: number;
}

export interface Choice {
  tpl: string;
  /** BALANCE: still measuring; BEST: the wording that gets the most answers; EXPLORE: the share kept for testing. */
  why: 'BALANCE' | 'BEST' | 'EXPLORE';
  /** For BEST: its answer rate and how many settled contacts it rests on. */
  pct?: number;
  sample?: number;
}

/** Settled contacts each wording needs before ERA compares them. */
export const LEARN_MIN_SETTLED = 10;
/** How much better (percentage points) the best must answer than the next to be preferred. */
export const LEARN_MARGIN = 10;
/** One send in this many keeps testing the least tried wording. */
export const LEARN_EXPLORE_EVERY = 5;

function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function chooseTemplate(list: readonly string[], key: string, stats: readonly VariantStat[]): Choice | null {
  const usable = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  if (!usable.length) return null;
  const of = (tpl: string) => stats.find((s) => s.variant.trim() === tpl) ?? { variant: tpl, n: 0, replyN: 0, replied: 0 };
  const rows = usable.map((tpl) => ({ tpl, ...of(tpl) }));
  // The least tried (fewest sent); ties broken by the member's key, so the same member always gets the same wording.
  const h = hash(key);
  const fewest = Math.min(...rows.map((r) => r.n));
  const least = rows.filter((r) => r.n === fewest);
  const balance = least[h % least.length]!.tpl;
  if (usable.length === 1) return { tpl: usable[0]!, why: 'BALANCE' };
  if (rows.some((r) => r.replyN < LEARN_MIN_SETTLED)) return { tpl: balance, why: 'BALANCE' };
  const rated = rows.map((r) => ({ ...r, pct: (r.replied / r.replyN) * 100 })).sort((a, b) => b.pct - a.pct);
  const [best, next] = [rated[0]!, rated[1]!];
  if (best.pct - next.pct < LEARN_MARGIN) return { tpl: balance, why: 'BALANCE' };
  if (h % LEARN_EXPLORE_EVERY === 0) return { tpl: balance === best.tpl ? next.tpl : balance, why: 'EXPLORE' };
  return { tpl: best.tpl, why: 'BEST', pct: Math.round(best.pct), sample: best.replyN };
}

/** The contact base, wording by wording, for one kind of contact (the favourite messages). */
export function variantStats(rows: readonly ContactRow[], kind: ContactKind, now: number): VariantStat[] {
  const groups = new Map<string, ContactRow[]>();
  for (const r of rows) if (r.kind === kind && r.variant) groups.set(r.variant.trim(), [...(groups.get(r.variant.trim()) ?? []), r]);
  return [...groups.entries()].map(([variant, g]) => {
    const rate = rateOf(g, now);
    return { variant, n: rate.n, replyN: rate.replyN, replied: rate.replied };
  });
}

/**
 * Where the learning stands, for the seller: still measuring (and the least measured wording's settled contacts), a tie
 * (no wording clearly better), or the one ERA now prefers, with its rate and the next one's.
 */
export type LearnStatus =
  | { state: 'MEASURING'; least: number; need: number }
  | { state: 'TIE' }
  | { state: 'BEST'; tpl: string; pct: number; sample: number; nextPct: number };

export function learningStatus(list: readonly string[], stats: readonly VariantStat[]): LearnStatus | null {
  const usable = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  if (usable.length < 2) return null;
  const rows = usable.map((tpl) => stats.find((s) => s.variant.trim() === tpl) ?? { variant: tpl, n: 0, replyN: 0, replied: 0 });
  const least = Math.min(...rows.map((r) => r.replyN));
  if (least < LEARN_MIN_SETTLED) return { state: 'MEASURING', least, need: LEARN_MIN_SETTLED };
  const rated = rows.map((r) => ({ tpl: r.variant, pct: (r.replied / r.replyN) * 100, sample: r.replyN })).sort((a, b) => b.pct - a.pct);
  if (rated[0]!.pct - rated[1]!.pct < LEARN_MARGIN) return { state: 'TIE' };
  return { state: 'BEST', tpl: rated[0]!.tpl, pct: Math.round(rated[0]!.pct), sample: rated[0]!.sample, nextPct: Math.round(rated[1]!.pct) };
}
