import { describe, expect, it } from 'vitest';
import { LEARN_EXPLORE_EVERY, LEARN_MIN_SETTLED, type VariantStat, chooseTemplate, learningStatus, variantStats } from '@/intelligence/message-learning';
import type { ContactRow } from '@/intelligence/outcomes';

const A = 'Hello {pseudo} ! Merci pour le favori sur {titre} 🙂';
const B = 'Bonjour {pseudo}, {titre} vous plaît ? Je peux faire un geste.';
const C = 'Coucou {pseudo} ! Toujours intéressé(e) par {titre} ?';
const s = (variant: string, n: number, replyN: number, replied: number): VariantStat => ({ variant, n, replyN, replied });
const keys = Array.from({ length: 200 }, (_, i) => `fav:${i}`);
const share = (list: string[], stats: VariantStat[], tpl: string) => keys.filter((k) => chooseTemplate(list, k, stats)?.tpl === tpl).length / keys.length;

describe('the wording ERA sends next, learnt from the seller’s own results', () => {
  it('no wording, nothing; one wording, that one', () => {
    expect(chooseTemplate([' ', ''], 'k', [])).toBeNull();
    expect(chooseTemplate([A], 'k', [s(A, 30, 30, 3)])).toEqual({ tpl: A, why: 'BALANCE' });
  });

  it('still measuring: the least tried goes out — a wording the seller just added is tried first', () => {
    const stats = [s(A, 12, 12, 6), s(B, 12, 12, 2)];
    const c = chooseTemplate([A, B, C], 'fav:1', stats);
    expect(c).toEqual({ tpl: C, why: 'BALANCE' });
    // Equal counts: spread over the wordings, the same member always getting the same one.
    const even = [s(A, 3, 3, 1), s(B, 3, 3, 1)];
    expect(share([A, B], even, A)).toBeGreaterThan(0.3);
    expect(share([A, B], even, B)).toBeGreaterThan(0.3);
    expect(chooseTemplate([A, B], 'fav:7', even)).toEqual(chooseTemplate([A, B], 'fav:7', even));
  });

  it('never a conclusion on a handful: below the threshold of settled contacts, only balance', () => {
    const few = [s(A, 9, LEARN_MIN_SETTLED - 1, 8), s(B, 9, LEARN_MIN_SETTLED - 1, 0)];
    expect(keys.every((k) => chooseTemplate([A, B], k, few)?.why === 'BALANCE')).toBe(true);
  });

  it('one clearly better: sent about four times in five, the rest kept for testing — and it says why', () => {
    const stats = [s(A, 20, 20, 9), s(B, 20, 20, 3)];
    const best = keys.map((k) => chooseTemplate([A, B], k, stats)).find((c) => c?.why === 'BEST')!;
    expect(best).toEqual({ tpl: A, why: 'BEST', pct: 45, sample: 20 });
    expect(share([A, B], stats, A)).toBeGreaterThan(0.7);
    expect(share([A, B], stats, B)).toBeGreaterThan(1 / LEARN_EXPLORE_EVERY - 0.1);
    expect(keys.filter((k) => chooseTemplate([A, B], k, stats)?.why === 'EXPLORE').every((k) => chooseTemplate([A, B], k, stats)?.tpl === B)).toBe(true);
  });

  it('close results are not a winner: still balanced', () => {
    const close = [s(A, 20, 20, 8), s(B, 20, 20, 7)];
    expect(keys.every((k) => chooseTemplate([A, B], k, close)?.why === 'BALANCE')).toBe(true);
  });

  it('the wording is matched as written (spaces around it do not make a new one)', () => {
    expect(chooseTemplate([` ${A} `, B], 'fav:3', [s(A, 20, 20, 10), s(B, 20, 20, 1)])?.tpl).toMatch(/^Hello|^Bonjour/);
    expect(chooseTemplate([A, A, B], 'k', [s(A, 1, 0, 0), s(B, 0, 0, 0)])).toEqual({ tpl: B, why: 'BALANCE' });
  });

  it('reads the contact base wording by wording: answered, or old enough to count as no answer', () => {
    const NOW = 10 * 86_400_000;
    const c = (p: Partial<ContactRow>): ContactRow => ({ id: 'c', at: NOW - 3 * 86_400_000, kind: 'FAV_MESSAGE', conversationId: '1', itemId: null, title: 'Veste', variant: A, askCents: null, offerCents: null, delayMs: null, repliedAt: null, soldAt: null, soldCents: null, ...p });
    const stats = variantStats([c({ repliedAt: NOW - 86_400_000 }), c({}), c({ at: NOW - 3_600_000 }), c({ variant: ` ${B} ` }), c({ kind: 'DELIVERED', variant: B })], 'FAV_MESSAGE', NOW);
    expect(stats).toEqual([
      { variant: A, n: 3, replyN: 2, replied: 1 },
      { variant: B, n: 1, replyN: 1, replied: 0 },
    ]);
  });

  it('says where the learning stands: measuring (and how far), a tie, or the wording now preferred', () => {
    expect(learningStatus([A], [])).toBeNull();
    expect(learningStatus([A, B], [s(A, 14, 12, 6), s(B, 6, 4, 1)])).toEqual({ state: 'MEASURING', least: 4, need: LEARN_MIN_SETTLED });
    expect(learningStatus([A, B], [s(A, 20, 20, 8), s(B, 20, 20, 7)])).toEqual({ state: 'TIE' });
    expect(learningStatus([A, B], [s(A, 20, 20, 9), s(B, 20, 20, 3)])).toEqual({ state: 'BEST', tpl: A, pct: 45, sample: 20, nextPct: 15 });
  });
});
