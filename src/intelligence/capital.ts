import { type Cents, type MoneyMetric, sumMetric } from '@/domain/money';
import { DAY } from '@/domain/time';
import type { ItemView, SaleView } from './portfolio';
import { nicheKey } from './seller-model';
import { median, quantile } from './stats';

export type AgeBucket = '0-30' | '30-60' | '60-90' | '90+';
export const AGE_BUCKETS: AgeBucket[] = ['0-30', '30-60', '60-90', '90+'];

export type TrapReason = 'HIGH_COST' | 'LONG_HELD' | 'LOW_DEMAND' | 'THIN_MARGIN';
export type DemandLevel = 'LOW' | 'OK' | 'HIGH' | 'UNKNOWN';

/** Capital view of ONE owned article. */
export interface CapitalPosition {
  itemId: string;
  cost: Cents | null;
  costComplete: boolean;
  daysHeld: number | null;
  daysHeldInferred: boolean;
  ask: Cents | null;
  potentialProfit: Cents | null;
  potentialRoi: number | null;
  /**
   * Capital efficiency: potential profit per € invested per 30 days held (if sold now at the ask).
   * 0.5 = the article earns 50 % of its cost per month of immobilisation.
   */
  efficiency30: number | null;
  demand: DemandLevel;
  viewsPerDay: number | null;
  trap: { severity: number; reasons: TrapReason[] } | null;
}

export interface CapitalTrap {
  itemId: string;
  costCents: Cents;
  potentialProfitCents: Cents | null;
  daysHeld: number;
  yield30: number | null;
  severity: number;
  reasons: TrapReason[];
}

export interface NicheCapital {
  key: string;
  label: string;
  invested: Cents;
  count: number;
  medianDaysHeld: number;
  potentialProfit: Cents | null;
}

export interface CapitalSummary {
  invested: MoneyMetric;
  /** Items whose known cost excludes an unknown part (shipping): the invested total is a lower bound. */
  costsExcludingShipping: number;
  stockValue: MoneyMetric;
  potentialProfit: MoneyMetric;
  aging: { bucket: AgeBucket; invested: MoneyMetric; count: number }[];
  over30: MoneyMetric;
  over60: MoneyMetric;
  over90: MoneyMetric;
  returned90: MoneyMetric;
  turnover: number | null;
  efficiency30: number | null;
  medianDaysHeld: number | null;
  positions: CapitalPosition[];
  traps: CapitalTrap[];
  byNiche: NicheCapital[];
  stars: { itemId: string; costCents: Cents; profitCents: Cents; days: number; yield30: number }[];
}

function bucketOf(days: number): AgeBucket {
  if (days >= 90) return '90+';
  if (days >= 60) return '60-90';
  if (days >= 30) return '30-60';
  return '0-30';
}

/**
 * Where is my money stuck? Traps are judged on capital, time AND demand — a high theoretical margin
 * does not save an expensive article held for months that nobody looks at.
 */
export function capitalSummary(views: readonly ItemView[], sales: readonly SaleView[], now: number, personalMedianDays: number | null = null): CapitalSummary {
  const stock = views.filter((v) => v.inStock);
  const knownCosts = stock.map((v) => v.cost).filter((c): c is number => c !== null);
  const highCost = Math.max(4000, knownCosts.length >= 4 ? quantile(knownCosts, 0.75) : 4000);
  const longHeld = Math.max(60, personalMedianDays !== null ? Math.round(personalMedianDays * 3) : 60);
  const vpds = stock.filter((v) => v.current?.views != null).map((v) => v.current!.views! / Math.max(1, v.daysListed ?? 1));
  const medVpd = vpds.length >= 4 ? median(vpds) : null;

  const positions: CapitalPosition[] = stock.map((v) => {
    const days = v.daysHeld;
    const vpd = v.current?.views != null ? v.current.views / Math.max(1, v.daysListed ?? 1) : null;
    const favRate = v.current?.views && v.current.favorites !== null ? v.current.favorites / v.current.views : null;
    const demand: DemandLevel =
      vpd === null
        ? 'UNKNOWN'
        : (medVpd !== null && vpd < medVpd * 0.5) || (favRate !== null && v.current!.views! >= 50 && favRate < 0.015)
          ? 'LOW'
          : medVpd !== null && vpd > medVpd * 1.5
            ? 'HIGH'
            : 'OK';
    const p = v.potentialProfit;
    const roi = p !== null && v.cost ? p / v.cost : null;
    const eff = p !== null && v.cost && days !== null ? p / v.cost / (Math.max(1, days) / 30) : null;

    const reasons: TrapReason[] = [];
    if (v.cost !== null && v.cost >= highCost) reasons.push('HIGH_COST');
    if (days !== null && days >= longHeld) reasons.push('LONG_HELD');
    if (demand === 'LOW') reasons.push('LOW_DEMAND');
    if (roi !== null && roi < 0.3) reasons.push('THIN_MARGIN');
    // A trap needs capital at stake for a long time, plus either weak demand or a weak return.
    const isTrap =
      v.cost !== null &&
      v.cost >= 1500 &&
      reasons.includes('LONG_HELD') &&
      (reasons.includes('LOW_DEMAND') || reasons.includes('THIN_MARGIN') || (reasons.includes('HIGH_COST') && (eff === null || eff < 0.25)));
    const severity = isTrap ? ((v.cost! / 100) * ((days ?? 0) / 30) * (reasons.includes('LOW_DEMAND') ? 1.5 : 1)) / Math.max(1, (p ?? 0) / 100) : 0;
    return {
      itemId: v.item.id,
      cost: v.cost,
      costComplete: v.costComplete,
      daysHeld: days,
      daysHeldInferred: v.daysHeldInferred,
      ask: v.askPrice,
      potentialProfit: p,
      potentialRoi: roi,
      efficiency30: eff,
      demand,
      viewsPerDay: vpd,
      trap: isTrap ? { severity, reasons } : null,
    };
  });

  const traps: CapitalTrap[] = positions
    .filter((p) => p.trap)
    .map((p) => ({
      itemId: p.itemId,
      costCents: p.cost!,
      potentialProfitCents: p.potentialProfit,
      daysHeld: p.daysHeld ?? 0,
      yield30: p.efficiency30,
      severity: p.trap!.severity,
      reasons: p.trap!.reasons,
    }))
    .sort((a, b) => b.severity - a.severity);

  const aging = AGE_BUCKETS.map((bucket) => {
    const inB = stock.filter((v) => bucketOf(v.daysHeld ?? 0) === bucket);
    return { bucket, invested: sumMetric(inB.map((v) => v.cost)), count: inB.length };
  });
  const over = (d: number) => sumMetric(stock.filter((v) => (v.daysHeld ?? 0) >= d).map((v) => v.cost));

  const recent = sales.filter((s) => s.sale.status !== 'REFUNDED' && s.sale.soldAt >= now - 90 * DAY);
  const returned90 = sumMetric(recent.map((s) => s.cost));
  const invested = sumMetric(stock.map((v) => v.cost));
  const investedV = invested.status === 'unknown' ? 0 : invested.value;
  const turnover = returned90.status !== 'unknown' && investedV > 0 ? (returned90.value / investedV) * (365 / 90) : null;
  let profitDays = 0;
  let capitalDays = 0;
  for (const s of recent) {
    if (s.profit === null || s.cost === null || s.cost <= 0 || s.daysToSale === null) continue;
    profitDays += s.profit;
    capitalDays += (s.cost * Math.max(1, s.daysToSale)) / 30;
  }

  const niches = new Map<string, ItemView[]>();
  for (const v of stock) {
    const k = nicheKey(v.item.brand, v.item.model, v.item.category);
    niches.set(k, [...(niches.get(k) ?? []), v]);
  }
  const byNiche: NicheCapital[] = [...niches.entries()]
    .map(([key, vs]) => {
      const profits = vs.map((v) => v.potentialProfit).filter((p): p is number => p !== null);
      return {
        key,
        label: `${vs[0]!.item.brand} ${vs[0]!.item.model ?? ''}`.trim(),
        invested: vs.reduce((a, v) => a + (v.cost ?? 0), 0),
        count: vs.length,
        medianDaysHeld: median(vs.map((v) => v.daysHeld ?? 0)),
        potentialProfit: profits.length ? profits.reduce((a, b) => a + b, 0) : null,
      };
    })
    .filter((n) => n.invested > 0)
    .sort((a, b) => b.invested - a.invested);

  const stars = sales
    .filter((s) => s.sale.status !== 'REFUNDED' && s.profit !== null && s.cost && s.cost > 0 && s.daysToSale !== null)
    .map((s) => ({ itemId: s.item.id, costCents: s.cost!, profitCents: s.profit!, days: s.daysToSale!, yield30: s.profit! / s.cost! / (Math.max(1, s.daysToSale!) / 30) }))
    .sort((a, b) => b.yield30 - a.yield30)
    .slice(0, 5);

  const held = stock.map((v) => v.daysHeld ?? 0).sort((a, b) => a - b);
  return {
    invested,
    costsExcludingShipping: stock.filter((v) => v.cost !== null && !v.costComplete).length,
    stockValue: sumMetric(stock.map((v) => v.askPrice)),
    potentialProfit: sumMetric(stock.filter((v) => v.askPrice !== null).map((v) => v.potentialProfit)),
    aging,
    over30: over(30),
    over60: over(60),
    over90: over(90),
    returned90,
    turnover,
    efficiency30: capitalDays > 0 ? profitDays / capitalDays : null,
    medianDaysHeld: held.length ? held[Math.floor(held.length / 2)]! : null,
    positions,
    traps,
    byNiche,
    stars,
  };
}
