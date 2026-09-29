import { describe, expect, it } from 'vitest';
import { parseCatalogCard } from '@/data/adapters/vinted/parse';

// Test data only: card titles written the way Vinted's search page labels its listing links (EXPERIMENTAL format —
// these tests prove ERA's reading of that format, not that Vinted still writes it).
describe('parseCatalogCard', () => {
  it('reads title, brand, condition, size and the item price — never the one with the buyer protection', () => {
    const c = parseCatalogCard('/items/4812345-veste-harrington?referrer=catalog', 'Veste Harrington, marque: Ralph Lauren, état: Très bon état, taille: M, 45,00 €, 48,85 € inclus')!;
    expect(c).toMatchObject({ id: '4812345', title: 'Veste Harrington', brand: 'Ralph Lauren', size: 'M', condition: 'VERY_GOOD', priceCents: 4500 });
    expect(c.url).toBe('https://www.vinted.fr/items/4812345-veste-harrington?referrer=catalog');
  });

  it('keeps a title with its own commas, a thousands separator and a missing brand', () => {
    const c = parseCatalogCard('/items/77', 'Manteau laine, doublé, taille: L, 1 250,00 €, 1 313,20 € inclus')!;
    expect(c).toMatchObject({ title: 'Manteau laine, doublé', brand: null, size: 'L', priceCents: 125000, condition: null });
  });

  it('"Sans marque" is no brand', () => {
    expect(parseCatalogCard('/items/5', 'Pull, marque: Sans marque, 9,00 €')!.brand).toBeNull();
  });

  it('skips what does not read as a listing card: no id, no price, only the protection price', () => {
    expect(parseCatalogCard('/member/12', 'Veste, 10,00 €')).toBeNull();
    expect(parseCatalogCard('/items/9', 'Veste Ralph Lauren')).toBeNull();
    expect(parseCatalogCard('/items/9', 'Veste, 12,00 € inclus')).toBeNull();
    expect(parseCatalogCard('/items/9', '')).toBeNull();
  });
});
