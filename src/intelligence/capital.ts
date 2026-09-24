import { type Cents, type MoneyMetric, sumMetric } from '@/domain/money';
import { DAY } from '@/domain/time';
import type { ItemView, SaleView } from './portfolio';

export type AgeBucket = '0-30' | '30-60' | '60-90' | '90+';
export const AGE_BUCKETS: AgeBucket[] = ['0-30', '30-60', '60-90', '90+'];

export interface CapitalTrap {
  itemId: string;
  costCents: Cents;
  potentialProfitCents: Cents | null;
  daysHeld: number;
  /** Potential profit per € invested per 30 days held. */
  yield30: number | null;
  severity: number;
}

export interface CapitalSummary {
  invested: MoneyMetric;
  stockValue: MoneyMetric;
  potentialProfit: MoneyMetric;
  aging: { bucket: AgeBucket; invested: MoneyMetric; count: number }[];
  over30: MoneyMetric;
  over60: MoneyMetric;
  over90: MoneyMetric;
  /** Cost of goods sold over the last 90 days: capital that came back. */
  returned90: MoneyMetric;
  /** Annualised inventory turns based on the last 90 days. */
  turnover: number | null;
  /** Realised profit per € of capital per 30 days of holding (last 90 days of sales). */
  efficiency30: number | null;
  medianDaysHeld: number | null;
  traps: CapitalTrap[];
  /** Best-rotating sold items, the contrast to traps. */
  stars: { itemId: string; costCents: Cents; profitCents: Cents; days: number; yield30: number }[];
}

function bucketOf(days: number): AgeBucket {
  if (days >= 90) return '90+';
  if (days >= 60) return '60-90';
  if (days >= 30) return '30-60';
  return '0-30';
}

export function capitalSummary(views: readonly ItemView[], sales: readonly SaleView[], now: number): CapitalSummary {
  const stock = views.filter((v) => v.inStock);
  const held = stock.map((v) => v.daysHeld ?? 0);
  const aging = AGE_BUCKETS.map((bucket) => {
    const inB = stock.filter((v) => bucketOf(v.daysHeld ?? 0) === bucket);
    return { bucket, invested: sumMetric(inB.map((v) => v.cost)), count: inB.length };
  });
  const over = (d: number) => sumMetric(stock.filter((v) => (v.daysHeld ?? 0) >= d).map((v) => v.cost));

  const recent = sales.filter((s) => s.sale.status !== 'REFUNDED' && s.sale.soldAt >= now - 90 * DAY);
  const returned90 = sumMetric(recent.map((s) => s.cost));
  const invested = sumMetric(stock.map((v) => v.cost));
  const investedV = invested.status === 'unknown' ? 0 : invested.value;
  const turnover =
    returned90.status !== 'unknown' && investedV > 0 ? (returned90.value / investedV) * (365 / 90) : null;

  let profitDays = 0;
  let capitalDays = 0;
  for (const s of recent) {
    if (s.profit === null || s.cost === null || s.cost <= 0 || s.daysToSale === null) continue;
    profitDays += s.profit;
    capitalDays += s.cost * Math.max(1, s.daysToSale) / 30;
  }

  const traps: CapitalTrap[] = [];
  for (const v of stock) {
    if (v.cost === null || v.cost < 1000 || v.daysHeld === null || v.daysHeld < 45) continue;
    const p = v.potentialProfit;
    const y30 = p === null ? null : p / v.cost / (v.daysHeld / 30);
    const weakReturn = p === null || p / v.cost < 0.6 || (y30 !== null && y30 < 0.25);
    if (!weakReturn) continue;
    traps.push({
      itemId: v.item.id,
      costCents: v.cost,
      potentialProfitCents: p,
      daysHeld: v.daysHeld,
      yield30: y30,
      severity: (v.cost / 100) * (v.daysHeld / 30) / Math.max(1, (p ?? 0) / 100),
    });
  }
  traps.sort((a, b) => b.severity - a.severity);

  const stars = sales
    .filter((s) => s.sale.status !== 'REFUNDED' && s.profit !== null && s.cost && s.cost > 0 && s.daysToSale !== null)
    .map((s) => ({
      itemId: s.item.id,
      costCents: s.cost!,
      profitCents: s.profit!,
      days: s.daysToSale!,
      yield30: s.profit! / s.cost! / (Math.max(1, s.daysToSale!) / 30),
    }))
    .sort((a, b) => b.yield30 - a.yield30)
    .slice(0, 5);

  const sortedHeld = [...held].sort((a, b) => a - b);
  return {
    invested,
    stockValue: sumMetric(stock.map((v) => v.askPrice)),
    potentialProfit: sumMetric(stock.filter((v) => v.askPrice !== null).map((v) => v.potentialProfit)),
    aging,
    over30: over(30),
    over60: over(60),
    over90: over(90),
    returned90,
    turnover,
    efficiency30: capitalDays > 0 ? profitDays / capitalDays : null,
    medianDaysHeld: sortedHeld.length ? sortedHeld[Math.floor(sortedHeld.length / 2)]! : null,
    traps,
    stars,
  };
}
