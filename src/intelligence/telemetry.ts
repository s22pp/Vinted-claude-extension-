import { type Rotation, rotation } from './pro-figures';

/**
 * The live telemetry of Aujourd'hui (v4.0): net profit over 30 days with its day-by-day curve, and the stock's velocity
 * (fresh / to watch / stalling). Pure; an unknown cost is never counted as zero — it is counted as unknown.
 */

const DAY = 86_400_000;

export interface ProfitWindow {
  /** Known profit of the completed sales in the window. */
  knownCents: number;
  /** Sales in the window whose cost is unknown (their profit is not in knownCents). */
  unknown: number;
  sales: number;
  /** Known profit accumulated day by day, oldest first (days + 1 points, the last one today). */
  cumulative: number[];
}

export function profitWindow(sales: readonly { soldAt: number; status: string; profit: number | null }[], now: number, days = 30): ProfitWindow {
  const start = new Date(now - days * DAY).setHours(0, 0, 0, 0);
  const inWindow = sales.filter((s) => s.status !== 'REFUNDED' && s.soldAt >= start && s.soldAt <= now);
  const perDay = new Array<number>(days + 1).fill(0);
  for (const s of inWindow) {
    if (s.profit === null) continue;
    const k = Math.min(days, Math.max(0, Math.floor((s.soldAt - start) / DAY)));
    perDay[k]! += s.profit;
  }
  let run = 0;
  const cumulative = perDay.map((v) => (run += v));
  return { knownCents: run, unknown: inWindow.filter((s) => s.profit === null).length, sales: inWindow.length, cumulative };
}

/** A 5 % cut, rounded to the nearest 10 cents; null when the price is unknown (a cut of nothing is no cut). */
export const cutFivePct = (cents: number | null): number | null => (cents === null || !(cents > 0) ? null : Math.max(10, Math.round((cents * 0.95) / 10) * 10));

export type Velocity = Record<Rotation, number> & { unknown: number };

/** The listings online, by how long they have been: fresh (< 15 days), to watch (15–29), stalling (30 or more). */
export function stockVelocity(views: readonly { inStock: boolean; listed: boolean; daysListed: number | null }[]): Velocity {
  const out: Velocity = { FRESH: 0, WATCH: 0, STALE: 0, unknown: 0 };
  for (const v of views) {
    if (!v.inStock || !v.listed) continue;
    const r = rotation(v.daysListed, null, null).state;
    if (r) out[r]++;
    else out.unknown++;
  }
  return out;
}

/** How many events fell on each of the last `days` days (oldest first, today last), by local calendar day. */
export function perDay(times: readonly number[], now: number, days = 14): number[] {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const out = new Array<number>(days).fill(0);
  for (const at of times) {
    if (at > now) continue;
    const back = Math.round((today - new Date(at).setHours(0, 0, 0, 0)) / DAY);
    if (back >= 0 && back < days) out[days - 1 - back]!++;
  }
  return out;
}

/** The last copy's age against the reminder: days since it (Infinity when there was never one). */
export const backupAgeDays = (last: number | null, now: number): number => (last === null ? Infinity : Math.max(0, (now - last) / DAY));
