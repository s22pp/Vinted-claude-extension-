import { describe, expect, it } from 'vitest';
import { brandOf } from '@/data/adapters/vinted/parse';
import type { MarketCandidate } from '@/domain/entities';
import { analyzeComparables, brandFromResults, buildQueries, type ComparableSubject } from '@/intelligence/comparables';
import { brandDisplay, brandInTitle, isUnknownBrand, titleKeywords } from '@/intelligence/normalize';

const subject = (title: string, brand: string, over: Partial<ComparableSubject> = {}): ComparableSubject => ({
  title,
  brand,
  model: null,
  category: 'SHIRT',
  gender: null,
  size: 'L',
  condition: 'VERY_GOOD',
  material: null,
  era: null,
  priceCents: 2000,
  ...over,
});
const cand = (id: string, title: string, brand: string | null, price = 2000): MarketCandidate => ({ id, title, brand, priceCents: price, size: 'L', condition: 'VERY_GOOD', category: null, gender: null, url: null, photoUrl: null, favorites: null, listedAt: null, promoted: false, sellerId: id });

describe('brand: every source before giving up', () => {
  it('knows "Inconnue", empty and "Sans marque" are not brands', () => {
    for (const b of ['Inconnue', '', null, 'Sans marque', 'autre']) expect(isUnknownBrand(b)).toBe(true);
    expect(isUnknownBrand('Pierre Cardin')).toBe(false);
  });

  it('finds the brand written in the title, and writes it as people do', () => {
    expect(brandInTitle('Chemise Pierre Cardin taille L')).toBe('pierre cardin');
    expect(brandDisplay('pierre cardin')).toBe('Pierre Cardin');
    expect(brandDisplay(brandInTitle("Jean Levi's 501 W32")!)).toBe('Levi’s');
    expect(brandInTitle('Chemise bleue coton')).toBeNull();
  });

  it('reads Vinted’s brand field whatever its shape — never an id, never "Sans marque"', () => {
    expect(brandOf({ brand_title: 'Pierre Cardin' })).toBe('Pierre Cardin');
    expect(brandOf({ brand_title: '', brand_dto: { id: 5575, title: 'Pierre Cardin' } })).toBe('Pierre Cardin');
    expect(brandOf({ brand: { title: 'Celio' } })).toBe('Celio');
    expect(brandOf({ brand: 5575 })).toBeNull();
    expect(brandOf({ brand_title: 'Sans marque' })).toBeNull();
  });
});

describe('search without a known brand', () => {
  it('keeps the words that describe the article: no size, no ERA reference, model numbers kept', () => {
    expect(titleKeywords('Chemise Bonobo lin taille L très bon état E1C4G')).toBe('chemise bonobo lin');
    expect(titleKeywords("Jean Levi's 501 W32 L34")).toBe('jean levis 501');
  });

  it('never searches "inconnue chemise": the title words instead', () => {
    expect(buildQueries(subject('Chemise Bonobo lin L', 'Inconnue')).map((q) => q.text)).toEqual(['chemise bonobo lin']);
    expect(buildQueries(subject('Bonobo lin L', 'Inconnue')).map((q) => q.text)).toEqual(['chemise bonobo lin']);
    expect(buildQueries(subject('Chemise Pierre Cardin L', 'Pierre Cardin')).map((q) => q.text)).toEqual(['Pierre Cardin chemise']);
  });

  it('does not filter the comparables by an unknown brand', () => {
    const a = analyzeComparables(subject('Chemise Bonobo lin L', 'Inconnue'), [{ candidates: [cand('1', 'Chemise Bonobo lin', 'Bonobo'), cand('2', 'Chemise lin Bonobo L', 'Bonobo')], totalEntries: 2, totalCapped: false, fetchedAt: 0 }], { queries: ['q'], source: 'VINTED', now: 0 });
    expect(a.comparables.filter((c) => c.reason === 'BRAND_MISMATCH')).toHaveLength(0);
  });

  it('learns the brand from results that sell it under a name written in the title', () => {
    const results = [{ candidates: [cand('1', 'Chemise Bonobo', 'Bonobo'), cand('2', 'Chemise lin', 'Bonobo'), cand('3', 'Chemise Zara', 'Zara')], totalEntries: 3, totalCapped: false, fetchedAt: 0 }];
    expect(brandFromResults('Chemise Bonobo lin L', results)).toBe('Bonobo');
    expect(brandFromResults('Chemise lin L', results)).toBeNull();
  });
});
