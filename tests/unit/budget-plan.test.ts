import { describe, expect, it } from 'vitest';
import { AUTO_FLOOR, SESSION_GAP_MS, autoAllowed, scheduleCost, sessionOver } from '@/data/budget-plan';

describe('the session budget shared between schedules and the seller’s clicks', () => {
  it('scheduled runs stop short of the reserve kept for the seller', () => {
    expect(autoAllowed(AUTO_FLOOR)).toBe(true);
    expect(autoAllowed(AUTO_FLOOR - 1)).toBe(false);
  });

  it('defaults (automations every 30 min, both on; refresh every 6 h with alerts): what they cost, how long they last', () => {
    const c = scheduleCost({ autoEveryMinutes: 30, fav: true, offers: true, refreshEveryHours: 6, alerts: true });
    // 3 calls a pass × 2 passes an hour + (5 + 3) / 6.
    expect(c.perHour).toBe(7.3);
    // (60 − 20) / 7.3.
    expect(c.hoursToReserve).toBe(5.5);
  });

  it('nothing scheduled: nothing spent, no deadline', () => {
    expect(scheduleCost({ autoEveryMinutes: null, fav: false, offers: false, refreshEveryHours: null, alerts: false })).toEqual({ perHour: 0, hoursToReserve: null });
  });

  it('never below the 15-minute floor the schedule itself applies', () => {
    expect(scheduleCost({ autoEveryMinutes: 5, fav: true, offers: false, refreshEveryHours: null, alerts: false }).perHour).toBe(4);
    // Parcels delivered: one more read per pass (the latest sales).
    expect(scheduleCost({ autoEveryMinutes: 30, fav: false, offers: false, delivered: true, refreshEveryHours: null, alerts: false }).perHour).toBe(2);
  });
});

describe('a session: the browser’s, or until 3 h without a call to Vinted', () => {
  const now = Date.UTC(2026, 10, 17, 13);
  it('a new session after 3 h of quiet (the next round of the day), never sooner', () => {
    expect(sessionOver({ lastAt: now - SESSION_GAP_MS, halted: null }, now)).toBe(true);
    expect(sessionOver({ lastAt: now - SESSION_GAP_MS + 60_000, halted: null }, now)).toBe(false);
  });
  it('never after a block (403/429): only a browser restart starts again', () => {
    expect(sessionOver({ lastAt: now - 10 * SESSION_GAP_MS, halted: 'NETWORK_403' }, now)).toBe(false);
  });
  it('no call recorded yet: nothing to end', () => {
    expect(sessionOver(undefined, now)).toBe(false);
    expect(sessionOver({ halted: null }, now)).toBe(false);
  });
});
