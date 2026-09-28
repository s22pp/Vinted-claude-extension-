import { describe, expect, it } from 'vitest';
import { EraDatabase } from '@/data/db';
import { EraRepository } from '@/data/repo';
import { newPrep } from '@/domain/entities';

describe('stored shapes', () => {
  it('an empty sheet has every default; given fields win', () => {
    expect(newPrep('i', 5, { seconds: 12 })).toEqual({
      itemId: 'i',
      measures: {},
      colors: '',
      material: '',
      productRef: '',
      defects: '',
      packageSize: null,
      checks: [],
      titleOverride: null,
      descriptionOverride: null,
      priceCents: null,
      startedAt: 5,
      seconds: 12,
      readyAt: null,
      publishedAt: null,
    });
  });

  it('an article without title or brand, or with money that is not whole cents, is never stored', async () => {
    const repo = new EraRepository(new EraDatabase(`t-${Math.random()}`));
    const base = { title: 'Veste', brand: 'Carhartt', model: null, category: 'JACKET' as const, gender: null, size: 'M', condition: null, purchasePriceCents: 2000, purchaseDate: null, purchaseSource: null, priceCents: null, listedAt: null, views: null, favorites: null, url: null };
    await expect(repo.addItem({ ...base, title: '' })).rejects.toThrow('titre vide');
    await expect(repo.addItem({ ...base, brand: '' })).rejects.toThrow('marque vide');
    await expect(repo.addItem({ ...base, purchasePriceCents: 12.5 })).rejects.toThrow('centimes');
    await expect(repo.addItem({ ...base, category: 'HAT' as never })).rejects.toThrow('catégorie');
    const id = await repo.addItem(base);
    expect((await repo.db.items.get(id))?.costDetail).toBeNull();
  });
});
