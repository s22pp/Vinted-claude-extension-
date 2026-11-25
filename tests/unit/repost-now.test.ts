import { describe, expect, it } from 'vitest';
import { DEFAULT_WAIT, clampWindow, drawWaitMs, leftText, nextMove, publishedAgo, type RepostNow, startNow, stepStatuses } from '@/intelligence/repost-now';

const DAY = 86_400_000;
const MIN = 60_000;
const job = (patch: Partial<RepostNow> = {}): RepostNow => ({ ...startNow('a', 'Veste en denim', 0, 0, DEFAULT_WAIT), ...patch });

describe('« Republier maintenant »: copy, delete, wait, publish — in the seller’s order', () => {
  it('queued: nothing started yet; then the copy runs first', () => {
    expect(stepStatuses(job()).map((s) => s.status)).toEqual(['wait', 'wait', 'wait', 'wait']);
    expect(stepStatuses(job({ outcome: 'RUNNING' })).map((s) => s.status)).toEqual(['run', 'wait', 'wait', 'wait']);
  });

  it('the wait runs once the old listing is gone; done only when the four steps were seen on Vinted', () => {
    expect(stepStatuses(job({ step: 'wait', outcome: 'WAITING' })).map((s) => s.status)).toEqual(['done', 'done', 'run', 'wait']);
    expect(stepStatuses(job({ step: 'done', outcome: 'DONE' })).map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('a result Vinted does not show back stays « à vérifier »; a stop says where it stopped', () => {
    expect(stepStatuses(job({ step: 'delete', outcome: 'UNCERTAIN' })).map((s) => s.status)).toEqual(['done', 'uncertain', 'wait', 'wait']);
    expect(stepStatuses(job({ outcome: 'FAILED' })).map((s) => s.status)).toEqual(['failed', 'wait', 'wait', 'wait']);
    expect(stepStatuses(job({ step: 'publish', outcome: 'FAILED' })).map((s) => s.status)).toEqual(['done', 'done', 'done', 'failed']);
  });
});

describe('the wait between deletion and publication', () => {
  it('drawn evenly between the seller’s minimum and maximum (3 to 10 minutes unless changed)', () => {
    expect(DEFAULT_WAIT).toEqual({ minMin: 3, maxMin: 10 });
    expect(drawWaitMs(DEFAULT_WAIT, 0)).toBe(3 * MIN);
    expect(drawWaitMs(DEFAULT_WAIT, 0.5)).toBe(6.5 * MIN);
    expect(drawWaitMs(DEFAULT_WAIT, 0.999999)).toBeLessThanOrEqual(10 * MIN);
    expect(drawWaitMs({ minMin: 0, maxMin: 0 }, 0.7)).toBe(0);
  });

  it('a window typed wrong is made valid: whole minutes, minimum ≤ maximum, an hour at most', () => {
    expect(clampWindow({ minMin: 8, maxMin: 4 })).toEqual({ minMin: 8, maxMin: 8 });
    expect(clampWindow({ minMin: -2, maxMin: 500 })).toEqual({ minMin: 0, maxMin: 60 });
    expect(clampWindow({ minMin: 2.6, maxMin: Number.NaN })).toEqual({ minMin: 3, maxMin: 10 });
    expect(clampWindow(null)).toEqual(DEFAULT_WAIT);
  });

  it('what is left, as the seller reads it', () => {
    expect(leftText(6 * MIN + 12_000)).toBe('6 min 12 s');
    expect(leftText(45_000)).toBe('45 s');
    expect(leftText(-5)).toBe('0 s');
  });
});

describe('one article at a time, the wait slept on', () => {
  it('the first active job goes first; finished or stopped ones are passed', () => {
    const jobs = [job({ itemId: 'x', outcome: 'DONE', step: 'done' }), job({ itemId: 'y', outcome: 'FAILED' }), job({ itemId: 'z' })];
    expect(nextMove(jobs, 0)).toEqual({ kind: 'step', itemId: 'z', step: 'copy' });
    expect(nextMove([jobs[0]!], 0)).toEqual({ kind: 'idle' });
  });

  it('a wait not over is slept on until its end; over, the publication comes', () => {
    const w = job({ step: 'wait', outcome: 'WAITING', waitUntil: 10 * MIN });
    expect(nextMove([w], 4 * MIN)).toEqual({ kind: 'sleep', itemId: 'a', until: 10 * MIN });
    expect(nextMove([w], 10 * MIN)).toEqual({ kind: 'step', itemId: 'a', step: 'publish' });
  });
});

describe('when the listing went online', () => {
  it('as the seller says it', () => {
    const now = new Date(2026, 10, 24, 15, 0).getTime();
    expect(publishedAgo(new Date(2026, 10, 23, 23, 30).getTime(), now)).toBe('Hier');
    expect(publishedAgo(new Date(2026, 10, 24, 8, 0).getTime(), now)).toBe('Aujourd’hui');
    expect(publishedAgo(now - 8 * DAY, now)).toBe('Il y a 8 jours');
    expect(publishedAgo(null, now)).toBeNull();
  });
});
