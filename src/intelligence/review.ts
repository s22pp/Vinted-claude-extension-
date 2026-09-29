import { eurNumber } from '@/domain/money';
import { DAY, addMonths, startOfMonth } from '@/domain/time';
import { toCsv } from './accounting';
import type { ItemView, SaleView } from './portfolio';
import { median } from './stats';

/**
 * Pilotage: the business month by month, and the last 30 days against the 30 before — from the seller's own rows
 * only. Each figure says what it rests on: a profit with unknown costs is a lower bound, a sale without a date is
 * counted apart (never in the month it was imported), a listing date ERA did not see is not a "new listing".
 */
export interface PeriodStats {
  from: number;
  to: number;
  /** Cashed: sales not refunded. */
  revenueCents: number;
  sales: number;
  /** Sum of the known profits; `profitPartial` when some sales of the period have an unknown cost. */
  profitCents: number;
  profitPartial: boolean;
  /** Median price of a sale (null without sales). */
  basketCents: number | null;
  refunds: number;
  refundedCents: number;
  /** Refunds among all the period's orders (null when there was none). */
  refundRate: number | null;
  /** Listings put online, only those with a real publication date. */
  listed: number;
  /** Articles bought (purchase date in the period) and what they cost, as far as known. */
  bought: number;
  spentCents: number;
  spentPartial: boolean;
  /** Median days from listing to sale, over the sales where both dates are real; and how many. */
  daysToSell: number | null;
  daysToSellN: number;
}

export interface Review {
  /** The last 12 months, oldest first; the last one is the current month, still running. */
  months: PeriodStats[];
  last30: PeriodStats;
  prev30: PeriodStats;
  /** Sales Vinted gave without a date: in the totals of no month. */
  undated: number;
  /** Fewer than 5 orders in each 30-day window: the comparison is mostly chance. */
  lowData: boolean;
  today: { inStock: number; online: number; capitalCents: number; capitalUnknown: number };
}

export function periodStats(sales: readonly SaleView[], views: readonly ItemView[], from: number, to: number): PeriodStats {
  const inPeriod = sales.filter((s) => s.sale.dateKnown !== false && s.sale.soldAt >= from && s.sale.soldAt < to);
  const done = inPeriod.filter((s) => s.sale.status !== 'REFUNDED');
  const refunded = inPeriod.filter((s) => s.sale.status === 'REFUNDED');
  const profits = done.map((s) => s.profit).filter((p): p is number => p !== null);
  const speeds = done.map((s) => s.daysToSale).filter((d): d is number => d !== null);
  const bought = views.filter((v) => v.item.purchaseDate !== null && v.item.purchaseDate >= from && v.item.purchaseDate < to);
  const costs = bought.map((v) => v.cost).filter((c): c is number => c !== null);
  return {
    from,
    to,
    revenueCents: sum(done.map((s) => s.sale.salePriceCents)),
    sales: done.length,
    profitCents: sum(profits),
    profitPartial: profits.length < done.length,
    basketCents: done.length ? median(done.map((s) => s.sale.salePriceCents)) : null,
    refunds: refunded.length,
    refundedCents: sum(refunded.map((s) => s.sale.salePriceCents)),
    refundRate: inPeriod.length ? refunded.length / inPeriod.length : null,
    listed: views.filter((v) => v.firstListedKnown && v.firstListedAt !== null && v.firstListedAt >= from && v.firstListedAt < to).length,
    bought: bought.length,
    spentCents: sum(costs),
    spentPartial: costs.length < bought.length,
    daysToSell: speeds.length ? Math.round(median(speeds)) : null,
    daysToSellN: speeds.length,
  };
}

export function businessReview(sales: readonly SaleView[], views: readonly ItemView[], now: number): Review {
  const thisMonth = startOfMonth(now);
  const months: PeriodStats[] = [];
  for (let i = 11; i >= 0; i--) {
    const from = addMonths(thisMonth, -i);
    months.push(periodStats(sales, views, from, i === 0 ? now + 1 : addMonths(from, 1)));
  }
  const last30 = periodStats(sales, views, now - 30 * DAY, now + 1);
  const prev30 = periodStats(sales, views, now - 60 * DAY, now - 30 * DAY);
  const stock = views.filter((v) => v.inStock);
  return {
    months,
    last30,
    prev30,
    undated: sales.filter((s) => s.sale.dateKnown === false).length,
    lowData: last30.sales + last30.refunds < 5 && prev30.sales + prev30.refunds < 5,
    today: {
      inStock: stock.length,
      online: stock.filter((v) => v.current && (v.item.status === 'LISTED' || v.item.status === 'RESERVED')).length,
      capitalCents: sum(stock.map((v) => v.cost).filter((c): c is number => c !== null)),
      capitalUnknown: stock.filter((v) => v.cost === null).length,
    },
  };
}

/** The monthly table as CSV (French spreadsheet conventions, like the other exports). */
export function reviewCsv(r: Review, monthLabel: (from: number) => string): string {
  return toCsv(
    ['Mois', 'Ventes', 'Chiffre d’affaires (€)', 'Bénéfice connu (€)', 'Bénéfice partiel', 'Panier médian (€)', 'Remboursements', 'Montant remboursé (€)', 'Annonces mises en ligne', 'Articles achetés', 'Dépensé connu (€)', 'Délai de vente médian (j)'],
    r.months.map((m) => [
      monthLabel(m.from),
      m.sales,
      eurNumber(m.revenueCents),
      eurNumber(m.profitCents),
      m.profitPartial ? 'oui' : 'non',
      m.basketCents === null ? null : eurNumber(m.basketCents),
      m.refunds,
      eurNumber(m.refundedCents),
      m.listed,
      m.bought,
      eurNumber(m.spentCents),
      m.daysToSell,
    ]),
  );
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
