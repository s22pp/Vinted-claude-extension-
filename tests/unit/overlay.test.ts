import { describe, expect, it } from 'vitest';
import { coteText, markFor, overlayNiches, priceFromText, signedEur } from '@/intelligence/overlay';
import type { ShoppingLine } from '@/intelligence/shopping';

const niches = [
  { brand: 'ralph lauren', category: 'SHIRT' as const, label: 'Ralph Lauren · Chemise', maxVintedPriceCents: 1200, medianSaleCents: 3000, sold: 9, avoid: false },
  { brand: 'zara', category: 'JACKET' as const, label: 'Zara · Veste', maxVintedPriceCents: 500, medianSaleCents: 1500, sold: 4, avoid: true },
];

describe('ERA marks on Vinted pages', () => {
  it('reads the price the way pages write it', () => {
    expect(priceFromText('Chemise Ralph Lauren, taille: L, 11,00 €, 12,25 € inclus')).toBe(1100);
    expect(priceFromText('€9.50')).toBe(950);
    expect(priceFromText('1 250,00 €')).toBe(125000);
    // French number formatting: a narrow no-break space between thousands, a no-break space before the euro.
    expect(priceFromText('1\u202f250,00\u00a0€')).toBe(125000);
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
  it('« Cote ERA »: your own price range in the niche, else your median; the margin always carries its sign', () => {
    const ranged = [{ ...niches[0]!, lowSaleCents: 2400, highSaleCents: 3500 }];
    const m = markFor('Chemise Oxford Ralph Lauren L', 1000, ranged)!;
    expect(m.range).toEqual({ lo: 2400, hi: 3500 });
    expect(coteText(m)).toBe('24–35 €');
    expect(signedEur(m.marginCents)).toBe('+18,80 €');
    // Older stored niches have no range: the median alone, marked as approximate.
    const plain = markFor('Chemise Oxford Ralph Lauren L', 1000, niches)!;
    expect(plain.range).toBeNull();
    expect(coteText(plain)).toBe('~30 €');
    expect(coteText({ medianSaleCents: 2950, range: { lo: 2950, hi: 2950 } })).toBe('~29,50 €');
    expect(signedEur(-305)).toBe('−3,05 €');
    expect(signedEur(1200)).toBe('+12 €');
  });
  it('the range travels from the shopping list to the vinted.fr pages, and is left out when unknown', () => {
    const line = (over: Partial<ShoppingLine>): ShoppingLine => ({
      key: 'k', label: 'Ralph Lauren · Chemise', brand: 'ralph lauren', category: 'SHIRT', sold: 9, confidence: 'MEDIUM', medianSaleCents: 3000, medianDays: 12,
      avgProfitCents: null, profitPerDayCents: null, inStock: 0, maxLandedCents: 1300, maxVintedPriceCents: 1200, why: { code: 'none', params: {} }, ...over,
    });
    const [a, b] = overlayNiches({ buy: [line({ lowSaleCents: 2400, highSaleCents: 3500 }), line({ key: 'k2' })], avoid: [] });
    expect(a).toMatchObject({ lowSaleCents: 2400, highSaleCents: 3500 });
    expect(b).not.toHaveProperty('lowSaleCents');
  });
});
