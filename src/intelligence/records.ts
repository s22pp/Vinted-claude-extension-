import { addMonths, monthKey, startOfMonth } from '@/domain/time';
import type { SaleView } from './portfolio';

/**
 * The seller's records, from the sales ERA holds only (a refunded sale does not count; a sale without its real date
 * counts in the totals, never where a date matters). Nothing estimated: a record ERA cannot tell is absent.
 */

export const COUNT_STEPS = [1, 10, 25, 50, 100, 150, 200, 300, 500, 1000] as const;
/** Revenue steps, cents. */
export const REVENUE_STEPS = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000] as const;

export interface Milestone {
  kind: 'COUNT' | 'REVENUE';
  value: number;
  /** When the step was crossed; null when the sale that crossed it has no known date. */
  at: number | null;
}

export interface SaleRecord {
  itemId: string;
  title: string;
  cents: number;
  at: number | null;
}

export interface SalesRecords {
  count: number;
  revenue: number;
  reached: Milestone[];
  next: { count: { value: number; left: number } | null; revenue: { value: number; left: number } | null };
  bestSale: SaleRecord | null;
  /** Known, positive profit only. */
  bestProfit: SaleRecord | null;
  bestMonth: { start: number; revenue: number; count: number } | null;
  fastest: (SaleRecord & { days: number }) | null;
  /** Longest run of calendar months with at least one sale, and the run still going (this month or last month). */
  streak: { longest: number; current: number };
  /** Sales left out where a date matters (the order gave none). */
  undated: number;
}

export function salesRecords(sales: readonly SaleView[], now: number): SalesRecords {
  const kept = sales.filter((s) => s.sale.status !== 'REFUNDED').sort((a, b) => a.sale.soldAt - b.sale.soldAt);
  const dated = (s: SaleView) => s.sale.dateKnown !== false;
  const rec = (s: SaleView, cents: number): SaleRecord => ({ itemId: s.item.id, title: s.item.title, cents, at: dated(s) ? s.sale.soldAt : null });

  const reached: Milestone[] = [];
  let revenue = 0;
  kept.forEach((s, i) => {
    const before = revenue;
    revenue += s.sale.salePriceCents;
    const at = dated(s) ? s.sale.soldAt : null;
    for (const c of COUNT_STEPS) if (i + 1 === c) reached.push({ kind: 'COUNT', value: c, at });
    for (const r of REVENUE_STEPS) if (before < r && revenue >= r) reached.push({ kind: 'REVENUE', value: r, at });
  });
  const nextCount = COUNT_STEPS.find((c) => c > kept.length);
  const nextRevenue = REVENUE_STEPS.find((r) => r > revenue);

  const top = <T,>(xs: T[], score: (x: T) => number): T | null => xs.reduce<T | null>((b, x) => (b === null || score(x) > score(b) ? x : b), null);
  const best = top(kept, (s) => s.sale.salePriceCents);
  const bestP = top(
    kept.filter((s) => s.profit !== null && s.profit > 0),
    (s) => s.profit!,
  );
  const fast = top(
    kept.filter((s) => s.daysToSale !== null),
    (s) => -s.daysToSale!,
  );

  // Months: dated sales only.
  const months = new Map<string, { start: number; revenue: number; count: number }>();
  for (const s of kept.filter(dated)) {
    const start = startOfMonth(s.sale.soldAt);
    const m = months.get(monthKey(start)) ?? { start, revenue: 0, count: 0 };
    m.revenue += s.sale.salePriceCents;
    m.count++;
    months.set(monthKey(start), m);
  }
  const bestMonth = top([...months.values()], (m) => m.revenue);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const m of [...months.values()].sort((a, b) => a.start - b.start)) {
    run = prev !== null && monthKey(addMonths(prev, 1)) === monthKey(m.start) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = m.start;
  }
  const thisMonth = startOfMonth(now);
  const current = prev !== null && (monthKey(prev) === monthKey(thisMonth) || monthKey(prev) === monthKey(addMonths(thisMonth, -1))) ? run : 0;

  return {
    count: kept.length,
    revenue,
    reached,
    next: { count: nextCount ? { value: nextCount, left: nextCount - kept.length } : null, revenue: nextRevenue ? { value: nextRevenue, left: nextRevenue - revenue } : null },
    bestSale: best ? rec(best, best.sale.salePriceCents) : null,
    bestProfit: bestP ? rec(bestP, bestP.profit!) : null,
    bestMonth,
    fastest: fast ? { ...rec(fast, fast.sale.salePriceCents), days: fast.daysToSale! } : null,
    streak: { longest, current },
    undated: kept.filter((s) => !dated(s)).length,
  };
}
