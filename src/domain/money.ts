/**
 * Money is always stored and computed as integer cents.
 * `null` means UNKNOWN — never coerce it to 0.
 */
export type Cents = number;
export type MaybeCents = Cents | null;

export function assertCents(value: number): Cents {
  if (!Number.isInteger(value)) throw new Error(`Money must be integer cents, got ${value}`);
  return value;
}

export function euros(amount: number): Cents {
  return Math.round(amount * 100);
}

export function toEuros(cents: Cents): number {
  return cents / 100;
}

/** Parse a user-typed amount ("18", "18,5", "18.50 €", "1 250,00") into cents. Empty → null (unknown). */
export function parseMoneyInput(raw: string): MaybeCents | undefined {
  const cleaned = raw.replace(/[€\s  ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined; // invalid
  return Math.round(Number(cleaned) * 100);
}

export function addKnown(a: MaybeCents, b: MaybeCents): MaybeCents {
  return a === null || b === null ? null : a + b;
}

export function subKnown(a: MaybeCents, b: MaybeCents): MaybeCents {
  return a === null || b === null ? null : a - b;
}

/** Round cents to a whole-euro price, which is how resale prices are set. */
export function roundToEuro(cents: Cents): Cents {
  return Math.round(cents / 100) * 100;
}

export function roi(profit: MaybeCents, cost: MaybeCents): number | null {
  if (profit === null || cost === null || cost <= 0) return null;
  return profit / cost;
}

/**
 * Aggregated money metric. The invariant UNKNOWN ≠ ZERO lives here:
 * - `known`   : every contributing value was known
 * - `partial` : some values were unknown; `value` covers only the known ones
 * - `unknown` : no contributing value was known
 */
export type MoneyMetric =
  | { status: 'known'; value: Cents; count: number }
  | { status: 'partial'; value: Cents; count: number; missing: number }
  | { status: 'unknown'; missing: number };

export function sumMetric(values: readonly MaybeCents[]): MoneyMetric {
  let value = 0;
  let count = 0;
  let missing = 0;
  for (const v of values) {
    if (v === null) missing++;
    else {
      value += v;
      count++;
    }
  }
  if (count === 0) return { status: 'unknown', missing };
  if (missing > 0) return { status: 'partial', value, count, missing };
  return { status: 'known', value, count };
}

export function metricValue(m: MoneyMetric): Cents | null {
  return m.status === 'unknown' ? null : m.value;
}

export interface MoneyRange {
  min: Cents;
  max: Cents;
}

export function rangeMid(r: MoneyRange): Cents {
  return Math.round((r.min + r.max) / 2);
}
