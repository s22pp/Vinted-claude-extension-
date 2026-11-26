import { describe, expect, it } from 'vitest';
import { backupAgeDays, cutFivePct, perDay, profitWindow, stockVelocity } from '@/intelligence/telemetry';
import { barTone, litSegments, sparkPath } from '@/ui/charts/telemetry';

describe('telemetry: sparkline and segmented gauge', () => {
  it('the sparkline: a smooth path from the first value to the last, the area closed on the zero line', () => {
    const p = sparkPath([0, 10, 5, 20], 120, 24)!;
    expect(p.line.startsWith('M0,22')).toBe(true);
    expect(p.line.endsWith(' 120,2')).toBe(true);
    expect(p.area.endsWith('L120,22L0,22Z')).toBe(true);
    expect(p.last).toEqual({ x: 120, y: 2 });
    expect(sparkPath([5], 120, 24)).toBeNull();
  });

  it('never under zero: with values ≥ 0, no point of the drawing goes below the zero line', () => {
    const p = sparkPath([0, 30, 0, 0, 25, 0], 120, 24)!;
    const ys = [...p.line.matchAll(/,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(22);
  });

  it('the gauge: emerald under 80 %, amber to 99 %, coral from 100 %; blocks lit in proportion', () => {
    expect(barTone(0.5)).toBe('ok');
    expect(barTone(0.8)).toBe('warn');
    expect(barTone(0.99)).toBe('warn');
    expect(barTone(1)).toBe('over');
    expect(litSegments(15, 30, 24)).toBe(12);
    expect(litSegments(1, 1000, 24)).toBe(1);
    expect(litSegments(45, 30, 24)).toBe(24);
    expect(litSegments(0, 30, 24)).toBe(0);
    expect(litSegments(5, 0, 24)).toBe(0);
  });
});


describe('Aujourd’hui telemetry', () => {
  const DAY = 86_400_000;
  const now = new Date(2026, 10, 26, 15).getTime();
  it('net profit over 30 days: the known profit, the unknown counted apart, the curve accumulated day by day', () => {
    const w = profitWindow(
      [
        { soldAt: now - 2 * DAY, status: 'COMPLETED', profit: 1500 },
        { soldAt: now - 10 * DAY, status: 'COMPLETED', profit: 2000 },
        { soldAt: now - 5 * DAY, status: 'COMPLETED', profit: null },
        { soldAt: now - 3 * DAY, status: 'REFUNDED', profit: 900 },
        { soldAt: now - 40 * DAY, status: 'COMPLETED', profit: 5000 },
      ],
      now,
    );
    expect(w).toMatchObject({ knownCents: 3500, unknown: 1, sales: 3 });
    expect(w.cumulative).toHaveLength(31);
    expect(w.cumulative[0]).toBe(0);
    expect(w.cumulative.at(-1)).toBe(3500);
    expect(w.cumulative.every((v, i, a) => i === 0 || v >= a[i - 1]!)).toBe(true);
  });

  it('stock velocity: listings online by age — fresh, to watch, stalling', () => {
    const v = stockVelocity([
      { inStock: true, listed: true, daysListed: 3 },
      { inStock: true, listed: true, daysListed: 20 },
      { inStock: true, listed: true, daysListed: 45 },
      { inStock: true, listed: true, daysListed: 90 },
      { inStock: true, listed: true, daysListed: null },
      { inStock: true, listed: false, daysListed: 60 },
      { inStock: false, listed: true, daysListed: 60 },
    ]);
    expect(v).toEqual({ FRESH: 1, WATCH: 1, STALE: 2, unknown: 1 });
  });

  it('the gallery’s −5 %: rounded to 10 cents, nothing when the price is unknown', () => {
    expect(cutFivePct(4500)).toBe(4280);
    expect(cutFivePct(2000)).toBe(1900);
    expect(cutFivePct(1299)).toBe(1230);
    expect(cutFivePct(5)).toBe(10);
    expect(cutFivePct(null)).toBeNull();
    expect(cutFivePct(0)).toBeNull();
  });

  it('events per calendar day: oldest first, today last; the future and older days left out', () => {
    const h = 3_600_000;
    const xs = [now - 1 * h, now - 2 * h, now - DAY, now - 3 * DAY, now - 20 * DAY, now + h];
    const d = perDay(xs, now, 7);
    expect(d).toHaveLength(7);
    expect(d.at(-1)).toBe(2);
    expect(d.at(-2)).toBe(1);
    expect(d.at(-4)).toBe(1);
    expect(d.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('the backup’s age: in days, infinite when there was never one', () => {
    expect(backupAgeDays(now - 3 * DAY, now)).toBe(3);
    expect(backupAgeDays(null, now)).toBe(Infinity);
  });
});
