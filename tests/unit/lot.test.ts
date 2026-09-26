import { describe, expect, it } from 'vitest';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import { parseLot, parseLotLine, splitLot } from '@/intelligence/lot';

describe('a lot, one line per article', () => {
  it('reads brand, kind, size and condition from the line — and nothing it does not say', () => {
    expect(parseLotLine('Chemise Pierre Cardin L très bon état')).toMatchObject({ title: 'Chemise Pierre Cardin', brand: 'Pierre Cardin', brandKnown: true, category: 'SHIRT', size: 'L', condition: 'VERY_GOOD' });
    expect(parseLotLine('- Jean Levi’s 501 W32')).toMatchObject({ category: 'JEANS', size: 'W32', condition: null });
    expect(parseLotLine('Pull taille M bon état')).toMatchObject({ title: 'Pull', brand: 'Inconnue', brandKnown: false, category: 'KNIT', size: 'M', condition: 'GOOD' });
    // A model number is not a size.
    expect(parseLotLine('Baskets Nike Air Max 90')).toMatchObject({ size: null, category: 'SHOES' });
    expect(parseLotLine('Baskets Nike Air Max 90 42')).toMatchObject({ size: '42' });
    expect(parseLotLine('Veste Carhartt Detroit neuf avec étiquette')).toMatchObject({ title: 'Veste Carhartt Detroit', size: null, condition: 'NEW_WITH_TAGS' });
    expect(parseLot('Polo Lacoste M\n\n  \nT-shirt Nike S\n')).toHaveLength(2);
  });

  it('splits the price paid exactly, to the cent', () => {
    expect(splitLot(1000, [null, null, null], 'EQUAL')).toEqual([334, 333, 333]);
    const v = splitLot(4000, [6000, 2000, null], 'VALUE');
    expect(v.reduce((a, b) => a + b, 0)).toBe(4000);
    // 6000 : 2000 : (average 4000) → 50 % / 16.7 % / 33.3 %.
    expect(v).toEqual([2000, 667, 1333]);
    // No history at all: equal parts, whatever the mode.
    expect(splitLot(900, [null, null], 'VALUE')).toEqual([450, 450]);
    expect(splitLot(0, [1, 2], 'VALUE')).toEqual([0, 0]);
  });

  it('creates articles to list, each with its share, marked as derived', async () => {
    const db = new EraDatabase(`t-${Math.random()}`);
    const repo = new EraRepository(db);
    const lines = parseLot('Chemise Pierre Cardin L tbe\nPull Lacoste M');
    const ids = await repo.addLot(lines, { costs: [1200, 800], purchaseDate: Date.UTC(2026, 8, 20), source: 'Emmaüs', totalCents: 2000 });
    const items = await db.items.bulkGet(ids);
    expect(items.map((i) => [i!.status, i!.purchasePriceCents, i!.meta.purchasePriceCents?.p])).toEqual([
      ['DRAFT', 1200, 'INFERRED'],
      ['DRAFT', 800, 'INFERRED'],
    ]);
    expect(items[0]!.purchaseSource).toBe('Emmaüs · lot de 2 · 20,00 €');
  });
});
