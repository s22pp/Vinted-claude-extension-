import type { InventoryItem, Listing, ListingObservation, Sale } from '@/domain/entities';
import { type Cents, type MaybeCents, type MoneyMetric, subKnown, sumMetric } from '@/domain/money';
import { DAY, addMonths, daysBetween, monthKey, startOfMonth } from '@/domain/time';
import { median } from './stats';

/** Everything the engines need to know about one physical item, pre-joined. */
export interface ItemView {
  item: InventoryItem;
  listings: Listing[];
  current: Listing | null;
  sale: Sale | null;
  firstListedAt: number | null;
  /** Days since acquisition. Falls back to first listing date (INFERRED) when purchase date is unknown. */
  daysHeld: number | null;
  daysHeldInferred: boolean;
  /** Days on the current listing. */
  daysListed: number | null;
  cost: MaybeCents;
  askPrice: MaybeCents;
  /** ask − cost, null when either is unknown. */
  potentialProfit: MaybeCents;
  inStock: boolean;
}

export function buildItemViews(
  items: readonly InventoryItem[],
  listings: readonly Listing[],
  sales: readonly Sale[],
  now: number,
): ItemView[] {
  const byItem = new Map<string, Listing[]>();
  for (const l of listings) {
    const arr = byItem.get(l.inventoryItemId) ?? [];
    arr.push(l);
    byItem.set(l.inventoryItemId, arr);
  }
  const saleByItem = new Map<string, Sale>();
  for (const s of sales) {
    if (s.status === 'REFUNDED') continue;
    const prev = saleByItem.get(s.inventoryItemId);
    if (!prev || prev.soldAt < s.soldAt) saleByItem.set(s.inventoryItemId, s);
  }
  return items.map((item) => {
    const ls = (byItem.get(item.id) ?? []).sort((a, b) => a.listedAt - b.listedAt);
    const current = [...ls].reverse().find((l) => l.status === 'ACTIVE') ?? null;
    const firstListedAt = ls[0]?.listedAt ?? null;
    const heldFrom = item.purchaseDate ?? firstListedAt;
    const sale = saleByItem.get(item.id) ?? null;
    const end = sale?.soldAt ?? now;
    const inStock = item.status === 'LISTED' || item.status === 'DRAFT';
    const askPrice = current?.priceCents ?? null;
    return {
      item,
      listings: ls,
      current,
      sale,
      firstListedAt,
      daysHeld: heldFrom === null ? null : daysBetween(heldFrom, end),
      daysHeldInferred: item.purchaseDate === null && firstListedAt !== null,
      daysListed: current ? daysBetween(current.listedAt, now) : null,
      cost: item.purchasePriceCents,
      askPrice,
      potentialProfit: inStock ? subKnown(askPrice, item.purchasePriceCents) : null,
      inStock,
    };
  });
}

export interface SaleView {
  sale: Sale;
  item: InventoryItem;
  cost: MaybeCents;
  /** Net of seller-side costs; unknown extra costs are treated as unknown profit, not zero. */
  profit: MaybeCents;
  daysToSale: number | null;
  lastAskCents: MaybeCents;
}

export function buildSaleViews(views: readonly ItemView[], sales: readonly Sale[]): SaleView[] {
  const byId = new Map(views.map((v) => [v.item.id, v]));
  const out: SaleView[] = [];
  for (const sale of sales) {
    const v = byId.get(sale.inventoryItemId);
    if (!v) continue;
    const cost = v.item.purchasePriceCents;
    const extra = sale.extraCostsCents;
    const profit = cost === null || extra === null ? null : sale.salePriceCents - cost - extra;
    const listing = v.listings.find((l) => l.id === sale.listingId) ?? v.listings[v.listings.length - 1] ?? null;
    out.push({
      sale,
      item: v.item,
      cost,
      profit,
      daysToSale: v.firstListedAt === null ? null : daysBetween(v.firstListedAt, sale.soldAt),
      lastAskCents: listing?.priceCents ?? null,
    });
  }
  return out.sort((a, b) => b.sale.soldAt - a.sale.soldAt);
}

export interface PeriodSales {
  count: number;
  refunded: number;
  revenue: Cents;
  profit: MoneyMetric;
  cost: MoneyMetric;
}

export function periodSales(sv: readonly SaleView[], from: number, to: number): PeriodSales {
  const inPeriod = sv.filter((s) => s.sale.soldAt >= from && s.sale.soldAt < to);
  const done = inPeriod.filter((s) => s.sale.status !== 'REFUNDED');
  return {
    count: done.length,
    refunded: inPeriod.length - done.length,
    revenue: done.reduce((a, s) => a + s.sale.salePriceCents, 0),
    profit: sumMetric(done.map((s) => s.profit)),
    cost: sumMetric(done.map((s) => s.cost)),
  };
}

export interface MonthPoint {
  key: string;
  start: number;
  revenue: Cents;
  profit: Cents | null;
  profitMissing: number;
  count: number;
}

export function monthlySeries(sv: readonly SaleView[], now: number, months = 12): MonthPoint[] {
  const out: MonthPoint[] = [];
  const first = addMonths(startOfMonth(now), -(months - 1));
  for (let i = 0; i < months; i++) {
    const start = addMonths(first, i);
    const end = addMonths(first, i + 1);
    const p = periodSales(sv, start, end);
    out.push({
      key: monthKey(start),
      start,
      revenue: p.revenue,
      profit: p.profit.status === 'unknown' ? (p.count === 0 ? 0 : null) : p.profit.value,
      profitMissing: p.profit.status === 'partial' || p.profit.status === 'unknown' ? p.profit.missing : 0,
      count: p.count,
    });
  }
  return out;
}

export interface SalesSummary {
  period: PeriodSales;
  averageMargin: number | null;
  roi: number | null;
  medianDaysToSale: number | null;
  averageSalePrice: Cents | null;
  sellThrough: number | null;
  refundRate: number | null;
  capitalReturned: MoneyMetric;
}

export function salesSummary(views: readonly ItemView[], sv: readonly SaleView[], from: number, to: number): SalesSummary {
  const period = periodSales(sv, from, to);
  const done = sv.filter((s) => s.sale.soldAt >= from && s.sale.soldAt < to && s.sale.status !== 'REFUNDED');
  const all = sv.filter((s) => s.sale.soldAt >= from && s.sale.soldAt < to);
  const withProfit = done.filter((s) => s.profit !== null);
  const profitSum = withProfit.reduce((a, s) => a + (s.profit ?? 0), 0);
  const revenueWithProfit = withProfit.reduce((a, s) => a + s.sale.salePriceCents, 0);
  const costWithProfit = withProfit.reduce((a, s) => a + (s.cost ?? 0), 0);
  const days = done.map((s) => s.daysToSale).filter((d): d is number => d !== null);
  const listedNow = views.filter((v) => v.inStock && v.current).length;
  return {
    period,
    averageMargin: revenueWithProfit > 0 ? profitSum / revenueWithProfit : null,
    roi: costWithProfit > 0 ? profitSum / costWithProfit : null,
    medianDaysToSale: days.length ? median(days) : null,
    averageSalePrice: done.length ? Math.round(period.revenue / done.length / 100) * 100 : null,
    sellThrough: done.length + listedNow > 0 ? done.length / (done.length + listedNow) : null,
    refundRate: all.length ? (all.length - done.length) / all.length : null,
    capitalReturned: period.cost,
  };
}

export function lastNDays(now: number, n: number): [number, number] {
  return [now - n * DAY, now + 1];
}

export function observationsFor(obs: readonly ListingObservation[], itemId: string): ListingObservation[] {
  return obs.filter((o) => o.inventoryItemId === itemId).sort((a, b) => a.at - b.at);
}
