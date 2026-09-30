import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { JOURNAL_KEEP, JOURNAL_MAX, journal, pruneJournal } from '@/data/journal';

beforeEach(async () => {
  await db.autoLog.clear();
});

describe('journal of Vinted writes: short, but never at the cost of the proof', () => {
  it('past the maximum, the oldest lines go — except each route’s latest verified success and latest failure', async () => {
    // Long ago: a label that worked, an offer that failed, a hide Vinted did not show back, a simulated message.
    await journal({ kind: 'LABEL', dryRun: false, ok: true, target: 'a', detail: 'bordereau récupéré' }, 1);
    await journal({ kind: 'FAV_OFFER', dryRun: false, ok: false, target: 'b', detail: 'UNAVAILABLE · HTTP 404' }, 2);
    await journal({ kind: 'HIDE', dryRun: false, ok: true, target: 'c', detail: 'envoyé ; Vinted ne dit pas l’état (non vérifié)' }, 3);
    await journal({ kind: 'FAV_MESSAGE', dryRun: true, ok: true, target: 'd', detail: 'simulation' }, 4);
    // Then many passes that prove nothing.
    await db.autoLog.bulkPut(Array.from({ length: JOURNAL_MAX }, (_, i) => ({ id: `s${i}`, at: 10 + i, kind: 'SKIP' as const, dryRun: false, ok: true, target: 'x', detail: 'déjà engagée' })));
    await pruneJournal();
    const left = await db.autoLog.toArray();
    expect(left.length).toBeLessThanOrEqual(JOURNAL_KEEP + 4);
    const kinds = left.map((r) => r.kind);
    expect(kinds).toContain('LABEL');
    expect(kinds).toContain('FAV_OFFER');
    // Neither proves a route: they go like any old line.
    expect(kinds).not.toContain('HIDE');
    expect(kinds).not.toContain('FAV_MESSAGE');
  });

  it('under the maximum, nothing is removed', async () => {
    for (let i = 0; i < 20; i++) await journal({ kind: 'SKIP', dryRun: false, ok: true, target: 'x', detail: 'y' }, i);
    expect(await db.autoLog.count()).toBe(20);
  });
});
