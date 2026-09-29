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
  /** Sales over the last 30 days (refunds excluded). */
  sales30: number;
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
    sales30,
  };
}

export interface GoalPlan {
  /** Sales per month the goal needs, at your median value per sale. */
  salesPerMonth: number;
  /** Listings online the goal needs, at your current listings-per-sale ratio. */
  listingsNeeded: number | null;
  /** New listings per week to replace what sells. */
  perWeek: number;
  current: { sales30: number; listed: number; perWeek: number };
  /** How many times today's sales pace the goal is. */
  factor: number | null;
}

/**
 * What the goal takes every month, not just this one: sales per month, listings online, new listings per week —
 * from your own median sale value and listings-per-sale ratio. It assumes those stay the same with more stock,
 * which is not guaranteed (more of the same niche can sell slower): a direction, not a promise.
 */
export function goalPlan(g: GoalProgress, views: readonly ItemView[], now: number): GoalPlan | null {
  if (!g.perSale || g.perSale.cents <= 0) return null;
  const salesPerMonth = Math.ceil(g.goal.cents / g.perSale.cents);
  const firstListed = views.map((v) => v.firstListedAt).filter((x): x is number => x !== null && x >= now - 30 * DAY).length;
  const current = { sales30: g.sales30, listed: g.listingsPerSale?.listed ?? views.filter((v) => v.inStock && v.current).length, perWeek: Math.round((firstListed / (30 / 7)) * 10) / 10 };
  return {
    salesPerMonth,
    listingsNeeded: g.listingsPerSale ? Math.ceil(salesPerMonth * g.listingsPerSale.n) : null,
    perWeek: Math.ceil(salesPerMonth / (30 / 7)),
    current,
    factor: current.sales30 > 0 ? Math.round((salesPerMonth / current.sales30) * 10) / 10 : null,
  };
}

export interface BuyingPlan {
  /** Articles to buy each week: each new listing the goal needs is an article bought first. */
  perWeek: number;
  /** What a sold article cost you (median of the known costs over 180 days), and on how many sales. */
  medianCost: { cents: number; n: number } | null;
  /** Buying budget per week and stock capital the goal ties up, at that median cost. */
  budgetPerWeekCents: number | null;
  capitalNeededCents: number | null;
}

/**
 * The goal's plan turned into buying: how many articles a week, the weekly budget and the capital in stock it takes,
 * at what your sold articles cost you. Same caveat as the plan: it assumes costs and selling pace hold with more stock.
 */
export function buyingPlan(plan: GoalPlan, sales: readonly SaleView[], now: number): BuyingPlan {
  const costs = sales
    .filter((s) => s.sale.status !== 'REFUNDED' && s.sale.soldAt >= now - 180 * DAY && s.cost !== null && s.cost > 0)
    .map((s) => s.cost!);
  const medianCost = costs.length >= 3 ? { cents: Math.round(median(costs)), n: costs.length } : null;
  return {
    perWeek: plan.perWeek,
    medianCost,
    budgetPerWeekCents: medianCost ? Math.round((plan.perWeek * medianCost.cents) / 100) * 100 : null,
    capitalNeededCents: medianCost && plan.listingsNeeded !== null ? Math.round((plan.listingsNeeded * medianCost.cents) / 100) * 100 : null,
  };
}
