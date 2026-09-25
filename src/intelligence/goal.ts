import { DAY, addMonths, startOfMonth } from '@/domain/time';
import type { ItemView, SaleView } from './portfolio';
import { median } from './stats';

/**
 * Monthly goal: where the month will land at the current pace, how many sales are missing, and what
 * that means in listings — from the seller's own numbers, each with its sample size. An estimate, not a promise.
 */
export interface MonthlyGoal {
  kind: 'REVENUE' | 'PROFIT';
  cents: number;
}

export interface GoalProgress {
  goal: MonthlyGoal;
  /** Revenue cashed, or known profit, this month so far. */
  currentCents: number;
  /** Profit goal with sales of unknown cost: the current value is a lower bound. */
  partial: boolean;
  ratio: number;
  elapsedDays: number;
  daysInMonth: number;
  projectedCents: number;
  onTrack: boolean;
  remainingCents: number;
  /** Median value per sale (revenue or profit) over the last 90 days, and its sample. */
  perSale: { cents: number; n: number } | null;
  salesSoFar: number;
  salesNeeded: number | null;
  /** Sales expected by month end at the current daily pace. */
  salesExpected: number;
  /** Sales missing beyond the current pace. */
  salesGap: number | null;
  /** Listings online vs sales over 30 days: 1 sale per N listings. */
  listingsPerSale: { n: number; sales30: number; listed: number } | null;
  extraListings: number | null;
}

export function goalProgress(goal: MonthlyGoal, sales: readonly SaleView[], views: readonly ItemView[], now: number): GoalProgress {
  const start = startOfMonth(now);
  const end = addMonths(start, 1);
  const daysInMonth = Math.round((end - start) / DAY);
  const elapsedDays = Math.max(1, Math.min(daysInMonth, (now - start) / DAY));
  const done = sales.filter((s) => s.sale.status !== 'REFUNDED');
  const month = done.filter((s) => s.sale.soldAt >= start && s.sale.soldAt < end);
  const value = (s: SaleView) => (goal.kind === 'REVENUE' ? s.sale.salePriceCents : s.profit);
  const known = month.map(value).filter((v): v is number => v !== null);
  const currentCents = known.reduce((a, b) => a + b, 0);
  const partial = goal.kind === 'PROFIT' && known.length < month.length;
  // Projections are estimates: shown to the euro, never to the cent.
  const projectedCents = Math.round((currentCents / elapsedDays) * daysInMonth / 100) * 100;
  const remainingCents = Math.max(0, goal.cents - currentCents);

  const recent = done.filter((s) => s.sale.soldAt >= now - 90 * DAY).map(value).filter((v): v is number => v !== null && v > 0);
  const perSale = recent.length >= 3 ? { cents: Math.round(median(recent) / 100) * 100, n: recent.length } : null;
  const salesNeeded = perSale ? Math.ceil(remainingCents / perSale.cents) : null;
  const salesExpected = Math.floor((month.length / elapsedDays) * (daysInMonth - elapsedDays));
  const salesGap = salesNeeded === null ? null : Math.max(0, salesNeeded - salesExpected);

  const listed = views.filter((v) => v.inStock && v.current && (v.item.status === 'LISTED' || v.item.status === 'RESERVED')).length;
  const sales30 = done.filter((s) => s.sale.soldAt >= now - 30 * DAY).length;
  const listingsPerSale = listed >= 5 && sales30 >= 3 ? { n: listed / sales30, sales30, listed } : null;
  const extraListings = listingsPerSale && salesGap !== null ? Math.ceil(salesGap * listingsPerSale.n) : null;

  return {
    goal,
    currentCents,
    partial,
    ratio: goal.cents > 0 ? currentCents / goal.cents : 0,
    elapsedDays,
    daysInMonth,
    projectedCents,
    onTrack: projectedCents >= goal.cents,
    remainingCents,
    perSale,
    salesSoFar: month.length,
    salesNeeded,
    salesExpected,
    salesGap,
    listingsPerSale,
    extraListings,
  };
}
