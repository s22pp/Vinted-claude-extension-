import { describe, expect, it } from 'vitest';
import { LIVE_KEEP_MS, ROUND_STEPS, currentStep, finishRound, progress, showLive, startRound, stepBegin, stepEnd } from '@/intelligence/round-live';

describe('the round, live', () => {
  it('starts with every step waiting, nothing used', () => {
    const r = startRound(1000, false, true);
    expect(ROUND_STEPS.every((s) => r.steps[s].state === 'WAIT')).toBe(true);
    expect(r).toMatchObject({ startedAt: 1000, endedAt: null, calls: 0, manual: true, dryRun: false });
    expect(currentStep(r)).toBeNull();
  });

  it('a step runs, then is done with what it did — one running at a time', () => {
    let r = startRound(0, false, false);
    r = stepBegin(r, 'refresh', 10);
    expect(currentStep(r)).toBe('refresh');
    r = stepEnd(r, 'refresh', 20, null);
    r = stepBegin(r, 'fav', 30);
    expect(currentStep(r)).toBe('fav');
    r = stepEnd(r, 'fav', 40, 2);
    expect(r.steps.fav).toEqual({ state: 'DONE', n: 2, startedAt: 30, endedAt: 40 });
    expect(currentStep(r)).toBeNull();
  });

  it('at the end, steps never begun are skipped; one cut short is stopped; why it stopped is kept', () => {
    let r = stepBegin(stepEnd(stepBegin(startRound(0, false, false), 'refresh', 1), 'refresh', 2, null), 'offers', 3);
    r = finishRound(r, 9, 'RATE_LIMITED · HTTP 429');
    expect(r.steps.refresh.state).toBe('DONE');
    expect(r.steps.offers).toMatchObject({ state: 'STOP', endedAt: 9 });
    expect(r.steps.backup.state).toBe('SKIP');
    expect(r).toMatchObject({ endedAt: 9, stopped: 'RATE_LIMITED · HTTP 429' });
  });

  it('progress counts the steps that run; a finished round stays shown a while, then the usual summary', () => {
    let r = startRound(0, false, false);
    expect(progress(r)).toEqual({ done: 0, total: ROUND_STEPS.length });
    r = stepEnd(stepBegin(r, 'refresh', 1), 'refresh', 2, null);
    expect(progress(r).done).toBe(1);
    r = finishRound(r, 100, null);
    expect(progress(r)).toEqual({ done: 1, total: 1 });
    expect(showLive(r, 100 + LIVE_KEEP_MS - 1)).toBe(true);
    expect(showLive(r, 100 + LIVE_KEEP_MS)).toBe(false);
    expect(showLive(startRound(0, true, true), 10 * LIVE_KEEP_MS)).toBe(true);
    expect(showLive(null, 0)).toBe(false);
  });
});
