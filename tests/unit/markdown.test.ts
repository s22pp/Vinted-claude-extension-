import { describe, expect, it } from 'vitest';
import type { Listing } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { DEFAULT_MARKDOWN, markdownPlan, niceDown, normalizeSteps, startPriceOf } from '@/intelligence/markdown';

const T0 = Date.UTC(2026, 5, 1, 12);
const base = { askCents: 4500, startCents: 4500, listedAt: T0, floorCents: 2000 };

describe('plan de baisse', () => {
  it('waits for the first step, then says −5 % at D+14 and −10 % at D+30 from the starting price', () => {
    const p0 = markdownPlan({ ...base, now: T0 + 3 * DAY }, DEFAULT_MARKDOWN);
    expect(p0.status).toBe('WAIT');
    if (p0.status === 'WAIT') expect(p0.next).toMatchObject({ day: 14, targetCents: 4200, at: T0 + 14 * DAY });

    const p1 = markdownPlan({ ...base, now: T0 + 15 * DAY }, DEFAULT_MARKDOWN);
    expect(p1.status).toBe('DUE');
    if (p1.status === 'DUE') expect(p1.step).toMatchObject({ day: 14, pct: 5, targetCents: 4200 });

    // Step 1 applied: the next one counts from the START price (45 € → 40 €), not from 42 € (no compounding).
    const p2 = markdownPlan({ ...base, askCents: 4200, now: T0 + 20 * DAY }, DEFAULT_MARKDOWN);
    expect(p2.status).toBe('WAIT');
    if (p2.status === 'WAIT') expect(p2.next.targetCents).toBe(4000);

    // Listed 40 days and never lowered: straight to the step the calendar is at.
    const p3 = markdownPlan({ ...base, now: T0 + 40 * DAY }, DEFAULT_MARKDOWN);
    expect(p3.status === 'DUE' && p3.step.day).toBe(30);

    const p4 = markdownPlan({ ...base, askCents: 4000, now: T0 + 40 * DAY }, DEFAULT_MARKDOWN);
    expect(p4).toMatchObject({ status: 'DONE', atFloor: false });
  });

  it('never below the floor; at the floor it stops', () => {
    const p = markdownPlan({ ...base, floorCents: 4150, now: T0 + 31 * DAY }, DEFAULT_MARKDOWN);
    expect(p.status).toBe('DUE');
    if (p.status === 'DUE') expect(p.step).toMatchObject({ targetCents: 4200, clamped: true }); // floor 41,50 → 42 €
    const q = markdownPlan({ ...base, askCents: 4200, floorCents: 4150, now: T0 + 31 * DAY }, DEFAULT_MARKDOWN);
    expect(q).toMatchObject({ status: 'DONE', atFloor: true, floorCents: 4200 });
    const r = markdownPlan({ ...base, floorCents: 4500, now: T0 + 31 * DAY }, DEFAULT_MARKDOWN);
    expect(r).toMatchObject({ status: 'DONE', atFloor: true });
  });

  it('unknown cost = unknown floor: the step is shown, never offered to apply', () => {
    const p = markdownPlan({ ...base, floorCents: null, now: T0 + 15 * DAY }, DEFAULT_MARKDOWN);
    expect(p.status).toBe('NO_COST');
    if (p.status === 'NO_COST') expect(p.due?.targetCents).toBe(4200);
  });

  it('prices that read well; steps cleaned', () => {
    expect(niceDown(4275)).toBe(4200);
    expect(niceDown(1140)).toBe(1100);
    expect(niceDown(1190)).toBe(1150);
    expect(normalizeSteps([{ day: 30, pct: 10 }, { day: 14, pct: 5 }, { day: 20, pct: 3 }, { day: 0, pct: 5 }, { day: 60, pct: 90 }])).toEqual([
      { day: 14, pct: 5 },
      { day: 30, pct: 10 },
    ]);
    expect(markdownPlan({ ...base, now: T0 + 40 * DAY }, [])).toEqual({ status: 'NONE' });
  });

  it('starting price: first price ERA saw on the listing, else the first change’s "from"', () => {
    const l = { id: 'L', priceCents: 4000 } as Listing;
    const obs = [
      { id: 'o2', listingId: 'L', inventoryItemId: 'i', at: 20, priceCents: 4000, views: null, favorites: null, provenance: 'OBSERVED' as const },
      { id: 'o1', listingId: 'L', inventoryItemId: 'i', at: 10, priceCents: 4500, views: null, favorites: null, provenance: 'OBSERVED' as const },
    ];
    expect(startPriceOf(l, obs, [])).toBe(4500);
    const ev = [{ id: 'e', type: 'PRICE_CHANGED' as const, at: 5, inventoryItemId: 'i', listingId: 'L', data: { from: 5000, to: 4000 }, provenance: 'OBSERVED' as const, isDemo: false }];
    expect(startPriceOf(l, [], ev)).toBe(5000);
    expect(startPriceOf(l, [], [])).toBe(4000);
  });
});
