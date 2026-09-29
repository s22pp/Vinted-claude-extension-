import { describe, expect, it } from 'vitest';
import { completeDescription } from '@/intelligence/listing-quality';

const label = (k: string) => ({ length: 'Longueur', pitToPit: 'Aisselle à aisselle', shoulders: 'Épaules', sleeve: 'Manche' })[k] ?? k;
const sweat = { category: 'SWEATSHIRT' as const, size: 'M', condition: 'VERY_GOOD' as const, material: null };

describe('completing a live listing’s description', () => {
  it('keeps the seller’s text word for word and adds only what is missing, below it', () => {
    const current = 'Sweat Ralph Lauren bleu marine, très peu porté.';
    const r = completeDescription(current, sweat, { measures: { pitToPit: '56', length: '68' }, defects: 'petite bouloche sous le bras', material: '' }, label);
    expect(r.text.startsWith(current)).toBe(true);
    expect(r.added).toEqual(['size', 'condition', 'defects', 'measures']);
    expect(r.text).toContain('• Taille : M');
    expect(r.text).toContain('• Défauts : petite bouloche sous le bras');
    expect(r.text).toContain('Aisselle à aisselle 56 cm');
    // Measures ERA does not know are left to fill, never guessed.
    expect(r.text).toContain('Épaules __ cm');
    expect(r.blanks).toBe(2);
  });

  it('adds nothing the description already says (size, condition, measures, material)', () => {
    const current = 'Taille M, très bon état. 100 % coton. Aisselle à aisselle 56 cm, longueur 68 cm.';
    const r = completeDescription(current, { ...sweat, material: 'coton' }, null, label);
    expect(r.added).toEqual([]);
    expect(r.text).toBe(current);
    expect(r.blanks).toBe(0);
  });

  it('an accessory needs no flat measures; an empty description gets the facts alone', () => {
    const r = completeDescription('', { category: 'ACCESSORY', size: null, condition: 'GOOD', material: 'cuir' }, null, label);
    expect(r.added).toEqual(['condition', 'material']);
    expect(r.text.split('\n')).toHaveLength(2);
    expect(r.text).toMatch(/^• État : Bon état/);
    expect(r.text).toContain('\n• Composition : cuir');
  });
});
