import { describe, expect, it } from 'vitest';
import { publishedAgo, startNow, stepStatuses } from '@/intelligence/repost-now';

const DAY = 86_400_000;

describe('« Republier maintenant », followed in three steps', () => {
  it('starts on « Publication en cours », nothing else yet', () => {
    expect(stepStatuses(startNow('a', 'Veste en denim', 0)).map((s) => s.status)).toEqual(['run', 'wait', 'wait']);
  });

  it('the verification follows; done only when all three were seen on Vinted', () => {
    const r = { ...startNow('a', 'Veste', 0), step: 'verify' as const };
    expect(stepStatuses(r).map((s) => s.status)).toEqual(['done', 'run', 'wait']);
    expect(stepStatuses({ ...r, step: 'done', outcome: 'DONE' }).map((s) => s.status)).toEqual(['done', 'done', 'done']);
  });

  it('a result Vinted does not show back stays « à vérifier »; a stop says where it stopped', () => {
    expect(stepStatuses({ ...startNow('a', 'Veste', 0), step: 'verify', outcome: 'UNCERTAIN' }).map((s) => s.status)).toEqual(['done', 'uncertain', 'wait']);
    expect(stepStatuses({ ...startNow('a', 'Veste', 0), outcome: 'FAILED' }).map((s) => s.status)).toEqual(['failed', 'wait', 'wait']);
  });

  it('when the listing went online, as the seller says it', () => {
    const now = new Date(2026, 10, 24, 15, 0).getTime();
    expect(publishedAgo(new Date(2026, 10, 23, 23, 30).getTime(), now)).toBe('Hier');
    expect(publishedAgo(new Date(2026, 10, 24, 8, 0).getTime(), now)).toBe('Aujourd’hui');
    expect(publishedAgo(now - 8 * DAY, now)).toBe('Il y a 8 jours');
    expect(publishedAgo(null, now)).toBeNull();
  });
});
