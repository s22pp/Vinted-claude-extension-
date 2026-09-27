import type { Category, Prep } from '@/domain/entities';
import { brandKey } from './normalize';
import type { SaleView } from './portfolio';
import { median } from './stats';

/**
 * Profit per hour of work: what each sale left you, over the time it took — the listing time measured in the
 * workshop (or your median when a sheet was not timed), plus the time per parcel and per purchase you estimate.
 * Only sales with a known profit count. Estimated minutes are said to be estimates.
 */
export interface TimeCosts {
  /** Minutes to pack and drop one parcel (your estimate). */
  shipMin: number;
  /** Minutes of sourcing per article bought (your estimate). */
  sourceMin: number;
  /** Listing minutes when nothing was measured at all (your estimate). */
  listMin: number;
}
export const TIME_DEFAULTS: TimeCosts = { shipMin: 10, sourceMin: 15, listMin: 12 };
export const TIME_KEY = 'timeCosts';

export interface HourlyRow {
  key: string;
  brand: string;
  category: Category;
  sales: number;
  profitCents: number;
  minutes: number;
  perHourCents: number;
}

export interface HourlyReport {
  sales: number;
  profitCents: number;
  minutes: number;
  perHourCents: number | null;
  /** Sales whose listing time was measured (the rest use your median or your estimate). */
  measured: number;
  listBasis: 'MEASURED' | 'MEDIAN' | 'ESTIMATE';
  byNiche: HourlyRow[];
}

export function hourlyReport(sales: readonly SaleView[], preps: ReadonlyMap<string, Prep>, t: TimeCosts): HourlyReport {
  const timed = [...preps.values()].filter((p) => p.seconds >= 20).map((p) => p.seconds / 60);
  const medianList = timed.length >= 3 ? median(timed) : null;
  const done = sales.filter((s) => s.sale.status !== 'REFUNDED' && s.profit !== null);
  let measured = 0;
  const rows = new Map<string, HourlyRow>();
  let profit = 0;
  let minutes = 0;
  for (const s of done) {
    const p = preps.get(s.item.id);
    const own = p && p.seconds >= 20 ? p.seconds / 60 : null;
    if (own !== null) measured++;
    const m = (own ?? medianList ?? t.listMin) + t.shipMin + t.sourceMin;
    profit += s.profit!;
    minutes += m;
    const key = `${brandKey(s.item.brand)}|${s.item.category}`;
    const r = rows.get(key) ?? { key, brand: s.item.brand, category: s.item.category, sales: 0, profitCents: 0, minutes: 0, perHourCents: 0 };
    r.sales++;
    r.profitCents += s.profit!;
    r.minutes += m;
    rows.set(key, r);
  }
  const byNiche = [...rows.values()]
    .filter((r) => r.sales >= 2)
    .map((r) => ({ ...r, perHourCents: Math.round((r.profitCents / r.minutes) * 60) }))
    .sort((a, b) => b.perHourCents - a.perHourCents);
  return {
    sales: done.length,
    profitCents: profit,
    minutes,
    perHourCents: minutes > 0 && done.length >= 3 ? Math.round((profit / minutes) * 60) : null,
    measured,
    listBasis: measured === done.length && done.length > 0 ? 'MEASURED' : medianList !== null ? 'MEDIAN' : 'ESTIMATE',
    byNiche,
  };
}
