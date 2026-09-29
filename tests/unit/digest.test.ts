import { describe, expect, it } from 'vitest';
import { nextMonday9 } from '@/data/digest';
import { weeklyDigest } from '@/intelligence/review';

const week = { from: 0, to: 0, revenueCents: 12800, sales: 3, profitCents: 0, profitPartial: false, basketCents: 4000, refunds: 1, refundedCents: 2000, refundRate: 0.25, listed: 2, bought: 0, spentCents: 0, spentPartial: false, daysToSell: null, daysToSellN: 0 };

describe('Monday’s digest', () => {
  it('the week in three lines: sales and revenue, listings against the goal’s pace, the workshop', () => {
    const d = weeklyDigest(week, 9, 5);
    expect(d.title).toBe('Semaine : 3 ventes · 128 €');
    expect(d.lines).toEqual(['Mises en ligne : 2 (votre objectif en demande 9 par semaine)', 'Atelier : 5 articles attendent d’être mis en ligne', 'Remboursements : 1']);
  });

  it('a quiet week says so; no goal, no pace invented; an empty workshop is not mentioned', () => {
    const d = weeklyDigest({ ...week, sales: 0, revenueCents: 0, refunds: 0, listed: 0 }, null, 0);
    expect(d.title).toBe('Semaine : aucune vente');
    expect(d.lines).toEqual(['Mises en ligne : 0']);
  });

  it('next Monday at 9:00, local time', () => {
    const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).getTime();
    // Tuesday 29 September 2026 → Monday 5 October.
    expect(nextMonday9(at(2026, 8, 29, 11))).toBe(at(2026, 9, 5, 9));
    // Monday before 9:00 → the same day; after 9:00 → a week later.
    expect(nextMonday9(at(2026, 9, 5, 7))).toBe(at(2026, 9, 5, 9));
    expect(nextMonday9(at(2026, 9, 5, 10))).toBe(at(2026, 9, 12, 9));
    // Sunday → the next day.
    expect(nextMonday9(at(2026, 9, 4, 20))).toBe(at(2026, 9, 5, 9));
  });
});
