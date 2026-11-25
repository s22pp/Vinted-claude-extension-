import { describe, expect, it } from 'vitest';
import { generatedDescription, generatedPrice, generatedTitle, hashtags } from '@/intelligence/listing-generator';

const veste = { category: 'JACKET' as const, brand: 'Ralph Lauren', model: 'Harrington', size: 'M', era: 'vintage', condition: 'VERY_GOOD' as const, fit: 'Regular' };

describe('listing generator', () => {
  it('title: [Emoji] [Marque] [Modèle] – [Style] ([Taille] [Coupe]); unknown parts leave no hole', () => {
    expect(generatedTitle(veste)).toBe('🧥 Ralph Lauren Harrington – Vintage (M Regular)');
    expect(generatedTitle({ category: 'JEANS', brand: 'Inconnue', model: null, size: null, era: null, condition: null })).toBe('👖 Jean');
    expect(generatedTitle({ ...veste, model: 'x'.repeat(200) }).length).toBeLessThanOrEqual(60);
  });

  it('description: structured, the unknown left « __ » to fill (never invented), hashtags from the facts', () => {
    const d = generatedDescription(veste);
    expect(d).toContain('✦ Détails');
    expect(d).toContain('• Taille : M · coupe Regular');
    expect(d).toContain('• Composition : __ (étiquette, sinon « non lisible »)');
    expect(d.split('\n').at(-1)).toBe(hashtags(veste).join(' '));
    expect(hashtags(veste)).toEqual(['#ralphlauren', '#veste', '#vintage', '#ralphlaurenvintage', '#taillem', '#friperie']);
  });

  it('price: the comparables’ median + 10 %, to the euro; none without comparables', () => {
    expect(generatedPrice({ keptCount: 12, distribution: { p10: 2000, p25: 3000, p50: 4500, p75: 5500, p90: 7000, min: 1500, max: 9000, spread: 3.5 } })).toBe(5000);
    expect(generatedPrice({ keptCount: 0, distribution: null })).toBeNull();
    expect(generatedPrice(null)).toBeNull();
  });
});
