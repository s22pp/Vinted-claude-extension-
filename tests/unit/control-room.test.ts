import { describe, expect, it } from 'vitest';
import { controlQueue, dueText } from '@/intelligence/control-room';
import { startNow } from '@/intelligence/repost-now';

const NOW = Date.UTC(2026, 10, 25, 12);

describe('the Pilote’s live queue', () => {
  it('under way first, then the soonest; each with its own cancel', () => {
    const waiting = { ...startNow('i1', 'Veste Baracuta G9 M', NOW, 0, { minMin: 3, maxMin: 10 }), outcome: 'WAITING' as const, step: 'wait' as const, waitUntil: NOW + 5 * 60_000 };
    const running = { ...startNow('i2', 'Pull Lacoste', NOW, 0, { minMin: 3, maxMin: 10 }), outcome: 'RUNNING' as const };
    const queued = startNow('i3', 'Chemise', NOW, 0, { minMin: 3, maxMin: 10 });
    const q = controlQueue({
      fav: [{ key: '555:101', userId: '555', title: 'Veste Harrington', dueAt: NOW + 3 * 60_000 + 42_000, offerPct: 10 }],
      followUps: [{ conversationId: '9001', title: 'Jean 501', offerCents: null, at: NOW - 3_600_000, dueAt: NOW + 23 * 3_600_000 }],
      reposts: [waiting, running, queued],
      nextRound: NOW + 2 * 3_600_000,
      now: NOW,
    });
    expect(q.map((e) => e.id)).toEqual(['rp:i2', 'fav:555:101', 'rp:i1', 'round', 'fu:9001', 'rp:i3']);
    expect(q[1]).toMatchObject({ action: 'Offre −10 %', target: 'membre 555 · Veste Harrington', cancel: { type: 'fav', key: '555:101' } });
    expect(q.find((e) => e.id === 'rp:i3')!.cancel).toEqual({ type: 'repost', itemId: 'i3' });
    expect(q.find((e) => e.id === 'rp:i1')!.cancel).toBeNull();
  });

  it('countdowns as the seller reads them', () => {
    expect(dueText(NOW + 3 * 60_000 + 42_000, NOW)).toBe('dans 03m 42s');
    expect(dueText(NOW + 2 * 3_600_000 + 58 * 60_000, NOW)).toBe('dans 2 h 58');
    expect(dueText(NOW - 1000, NOW)).toBe('au prochain passage');
    expect(dueText(null, NOW)).toBe('en file');
    expect(dueText(null, NOW, true)).toBe('en cours');
  });
});
