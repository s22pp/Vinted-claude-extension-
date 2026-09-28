import { describe, expect, it } from 'vitest';
import { MIN_BASE, missingTitleWords, withWord } from '@/intelligence/title-words';

const comps = (...titles: string[]) => titles.map((title) => ({ title }));

describe('title words from comparable listings', () => {
  it('the words most comparables use and yours lacks — no brand, size, filler or word you already have', () => {
    const r = missingTitleWords(
      'Veste Harrington Ralph Lauren M · E1AB2',
      'Ralph Lauren',
      comps(
        'Veste Harrington Polo Ralph Lauren bleu marine taille L',
        'Harrington jacket Ralph Lauren marine vintage',
        'Veste Ralph Lauren Harrington tartan marine M',
        'Blouson Harrington Ralph Lauren tartan beige très bon état',
        'Veste harrington RALPH LAUREN vintage tartan',
        'Vestes Harrington Ralph Lauren marine XL',
      ),
    );
    expect(r.base).toBe(6);
    expect(r.words.map((w) => [w.word, w.count, w.kind])).toEqual([
      ['marine', 4, 'COLOUR'],
      ['tartan', 3, 'WORD'],
    ]);
    // "vintage" is used twice only (under the 20 % / 3 listings bar) — and would be flagged as a claim.
    const v = missingTitleWords('Veste Harrington', null, comps('Veste vintage', 'Veste vintage', 'Veste vintage', 'Veste', 'Veste'));
    expect(v.words).toEqual([{ word: 'vintage', count: 3, share: 0.6, kind: 'CLAIM' }]);
  });

  it('too few comparables: nothing said', () => {
    expect(missingTitleWords('Veste', null, comps('a b c', 'a b c')).words).toEqual([]);
    expect(MIN_BASE).toBe(5);
  });

  it('accents kept as written; the word goes before the ERA reference', () => {
    const r = missingTitleWords('Jean Levi’s 501', 'Levi’s', comps('Jean délavé 501', 'Jean délavé', 'Jean délavé brut', 'Jean', 'Jean Levis délavé'));
    expect(r.words[0]).toMatchObject({ word: 'délavé', count: 4 });
    expect(withWord('Jean Levi’s 501 · E1AB2', 'délavé', 'E1AB2')).toBe('Jean Levi’s 501 délavé · E1AB2');
    expect(withWord('Jean Levi’s 501', 'délavé', 'E1AB2')).toBe('Jean Levi’s 501 délavé');
  });
});
