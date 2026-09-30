import { describe, expect, it } from 'vitest';
import { applyTextOp, sameFieldText, textOpProblem } from '@/intelligence/text-edit';

describe('title and description changed by an operation, applied to what Vinted shows', () => {
  it('a suffix on a title: one space, one line; already at the end → nothing to change', () => {
    expect(applyTextOp('Veste Harrington  Ralph Lauren M ', { kind: 'suffix', text: 'vintage' }, 'title')).toBe('Veste Harrington Ralph Lauren M vintage');
    expect(applyTextOp('Veste Harrington Ralph Lauren M Vintage', { kind: 'suffix', text: 'vintage' }, 'title')).toBeNull();
  });

  it('a prefix on a title; already at the start (any case) → nothing to change', () => {
    expect(applyTextOp('Veste Harrington', { kind: 'prefix', text: 'E1C4G' }, 'title')).toBe('E1C4G Veste Harrington');
    expect(applyTextOp('e1c4g Veste Harrington', { kind: 'prefix', text: 'E1C4G' }, 'title')).toBeNull();
  });

  it('a description gets its addition as a paragraph of its own; the seller’s text is kept as it is', () => {
    const before = 'Veste Harrington, bon état.\nPortée deux fois.';
    expect(applyTextOp(before, { kind: 'suffix', text: 'Envoi sous 48 h.' }, 'description')).toBe('Veste Harrington, bon état.\nPortée deux fois.\n\nEnvoi sous 48 h.');
    expect(applyTextOp(`${before}\n\nEnvoi sous 48 h.\n`, { kind: 'suffix', text: 'Envoi sous 48 h.' }, 'description')).toBeNull();
    // An empty description on the page: the text alone.
    expect(applyTextOp('', { kind: 'prefix', text: 'Mesures en photo.' }, 'description')).toBe('Mesures en photo.');
  });

  it('a replacement: every occurrence, exactly as written; not found → nothing to change; empty → the word removed', () => {
    expect(applyTextOp('Veste Carhartt Detroit Carhartt', { kind: 'replace', find: 'Carhartt', text: 'Marlboro' }, 'title')).toBe('Veste Marlboro Detroit Marlboro');
    expect(applyTextOp('Veste carhartt', { kind: 'replace', find: 'Carhartt', text: 'Marlboro' }, 'title')).toBeNull();
    expect(applyTextOp('Veste neuve Harrington', { kind: 'replace', find: 'neuve', text: '' }, 'title')).toBe('Veste Harrington');
  });

  it('refused before anything is opened: empty text, blanks to fill, a title on two lines, a no-op replacement', () => {
    expect(textOpProblem('title', { kind: 'suffix', text: '  ' })).toBe('texte vide');
    expect(textOpProblem('description', { kind: 'suffix', text: 'Taille __ cm' })).toMatch(/__/);
    expect(textOpProblem('title', { kind: 'prefix', text: 'a\nb' })).toMatch(/une ligne/);
    expect(textOpProblem('title', { kind: 'replace', find: 'x', text: 'x' })).toMatch(/identique/);
    expect(textOpProblem('title', { kind: 'replace', find: 'neuve', text: '' })).toBeNull();
    expect(textOpProblem('description', { kind: 'suffix', text: 'Envoi rapide.' })).toBeNull();
  });

  it('read back: the same words, whatever spaces (title) or line endings (description) Vinted normalised', () => {
    expect(sameFieldText('title', 'Veste  Harrington ', 'Veste Harrington')).toBe(true);
    expect(sameFieldText('title', 'Veste Harrington M', 'Veste Harrington')).toBe(false);
    expect(sameFieldText('description', 'a\r\n\r\nb\n', 'a\n\nb')).toBe(true);
  });
});
