import { describe, expect, it } from 'vitest';
import { markFor, priceFromText } from '@/intelligence/overlay';

const niches = [
  { brand: 'ralph lauren', category: 'SHIRT' as const, label: 'Ralph Lauren · Chemise', maxVintedPriceCents: 1200, medianSaleCents: 3000, sold: 9, avoid: false },
  { brand: 'zara', category: 'JACKET' as const, label: 'Zara · Veste', maxVintedPriceCents: 500, medianSaleCents: 1500, sold: 4, avoid: true },
];

describe('ERA marks on Vinted pages', () => {
  it('reads the price the way pages write it', () => {
    expect(priceFromText('Chemise Ralph Lauren, taille: L, 11,00 €, 12,25 € inclus')).toBe(1100);
    expect(priceFromText('€9.50')).toBe(950);
    expect(priceFromText('1 250,00 €')).toBe(125000);
    expect(priceFromText('sans prix')).toBeNull();
  });
  it('a listing in one of your niches: a deal under your max, a note above it, a warning on a niche to avoid', () => {
    expect(markFor('Chemise Oxford Ralph Lauren L', 1100, niches)).toMatchObject({ kind: 'DEAL', landedCents: 1225, marginCents: 1775, sold: 9 });
    expect(markFor('Chemise Ralph Lauren slim', 2500, niches)).toMatchObject({ kind: 'ABOVE_MAX' });
    expect(markFor('Veste Zara noire', 400, niches)).toMatchObject({ kind: 'AVOID' });
    // Not your niche, another kind of article, a lot, a kids' item: nothing.
    expect(markFor('Chemise Lacoste', 900, niches)).toBeNull();
    expect(markFor('Jean Ralph Lauren', 900, niches)).toBeNull();
    expect(markFor('Lot de 3 chemises Ralph Lauren', 900, niches)).toBeNull();
    expect(markFor('Chemise Ralph Lauren 10 ans', 900, niches)).toBeNull();
  });
});
