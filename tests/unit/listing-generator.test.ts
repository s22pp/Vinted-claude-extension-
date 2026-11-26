import { describe, expect, it } from 'vitest';
import { generatedDescription, generatedPrice, generatedTitle, hashtags, listingBundle, measureBlock } from '@/intelligence/listing-generator';

const veste = { category: 'JACKET' as const, brand: 'Ralph Lauren', model: 'Harrington', size: 'M', era: 'vintage', condition: 'VERY_GOOD' as const, fit: 'Regular' };

describe('listing generator', () => {
  it('title: [Emoji] [Accroche] [Marque] [Modèle] – [Style] ([Taille] [Coupe]); unknown parts leave no hole', () => {
    expect(generatedTitle(veste)).toBe('🧥 Ralph Lauren Harrington – Vintage (M Regular)');
    // The seller's hook and vibe, as in « 💥 Unique Ecko Unltd. Zip Jacket – Y2K Urban Streetwear (L Oversize) ».
    expect(generatedTitle({ category: 'JACKET', brand: 'Ecko', model: 'Zip Jacket', size: 'L', era: null, condition: 'VERY_GOOD', hook: 'Unique', vibe: 'Y2K Streetwear', fit: 'Oversize' })).toBe(
      '🧥 Unique Ecko Zip Jacket – Y2K Streetwear (L Oversize)',
    );
    // A new article says so (a fact); no praise is made up for the others.
    expect(generatedTitle({ ...veste, condition: 'NEW_WITH_TAGS' })).toBe('🧥 Neuf Ralph Lauren Harrington – Vintage (M Regular)');
    expect(generatedTitle({ category: 'JEANS', brand: 'Inconnue', model: null, size: null, era: null, condition: null })).toBe('👖 Jean');
    expect(generatedTitle({ ...veste, model: 'x'.repeat(200) }).length).toBeLessThanOrEqual(60);
  });

  it('too long for Vinted’s search: the cut goes first, then the style is cut to two words', () => {
    const long = { category: 'JACKET' as const, brand: 'Ecko Unltd.', model: 'Vintage Zip Jacket', size: 'L', era: null, condition: null, hook: 'Unique', vibe: 'Y2K Urban Streetwear Graffiti', fit: 'Oversize' };
    const t = generatedTitle(long);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toBe('🧥 Unique Ecko Unltd. Vintage Zip Jacket – Y2K Urban (L)');
  });

  it('description: exact condition, cut, measures ready to fill, shipping within 24 h, then the hashtags', () => {
    const d = generatedDescription(veste);
    expect(d).toContain('• État : Très bon état, peu porté');
    expect(d).toContain('• Coupe : Regular');
    expect(d).toContain('• Composition : __ (étiquette, sinon « non lisible »)');
    expect(d).toContain('Longueur : __ cm | Aisselle à aisselle : __ cm');
    expect(d).toContain('Expédition rapide sous 24 h');
    expect(d.split('\n').at(-1)).toBe(hashtags(veste).join(' '));
  });

  it('measures: the core ones always, the others once typed; a number is in cm', () => {
    expect(measureBlock('JACKET', { length: '70', sleeve: '64' })).toBe('Longueur : 70 cm | Aisselle à aisselle : __ cm | Manche : 64 cm');
    expect(measureBlock('JEANS')).toBe('Tour de taille : __ cm | Entrejambe : __ cm | Longueur : __ cm');
  });

  it('hashtags: 10 to 15, only hashtags, from the brand, the kind, the era and the style', () => {
    const tags = hashtags({ ...veste, vibe: 'Y2K Urban Streetwear', gender: 'MEN' });
    expect(tags.length).toBeGreaterThanOrEqual(10);
    expect(tags.length).toBeLessThanOrEqual(15);
    expect(tags.every((x) => /^#[a-z0-9]+$/.test(x))).toBe(true);
    expect(tags.slice(0, 5)).toEqual(['#ralphlauren', '#ralphlaurenvintage', '#veste', '#jacket', '#vintage']);
    expect(tags).toEqual(expect.arrayContaining(['#y2k', '#urban', '#streetwear', '#regular', '#taillem', '#modehomme']));
    expect(new Set(tags).size).toBe(tags.length);
    // Little known: generic resale tags fill up to 10, never more than needed.
    expect(hashtags({ category: 'OTHER', brand: null, model: null, size: null, era: null, condition: null })).toHaveLength(8);
  });

  it('« Copier tout »: title, description and price in one text', () => {
    expect(listingBundle('T', 'D', '45 €')).toBe('T\n\nD\n\nPrix : 45 €');
    expect(listingBundle('T', 'D', null)).toBe('T\n\nD');
  });

  it('price: the comparables’ median + 10 %, to the euro; none without comparables', () => {
    expect(generatedPrice({ keptCount: 12, distribution: { p10: 2000, p25: 3000, p50: 4500, p75: 5500, p90: 7000, min: 1500, max: 9000, spread: 3.5 } })).toBe(5000);
    expect(generatedPrice({ keptCount: 0, distribution: null })).toBeNull();
    expect(generatedPrice(null)).toBeNull();
  });
});
