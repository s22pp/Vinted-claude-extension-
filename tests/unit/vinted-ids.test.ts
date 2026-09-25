import { describe, expect, it } from 'vitest';
import { STATUS_ID_OF, pickBrandId, pickCatalogId, pickPackageId, pickSizeId } from '@/intelligence/vinted-ids';

describe('ids for a Vinted draft: matched, never guessed', () => {
  it('reads the suggested category in its known shapes', () => {
    expect(pickCatalogId({ suggested_category_id: 1803 })).toBe(1803);
    expect(pickCatalogId({ suggested_category_ids: ['1806'] })).toBe(1806);
    expect(pickCatalogId({ catalog_ids: [267] })).toBe(267);
    expect(pickCatalogId({})).toBeNull();
  });

  it('takes the brand with our exact name, not the first approximate one', () => {
    const brands = { brands: [{ id: 1, title: 'Marlboro Classics' }, { id: 2, title: 'Marlboro' }] };
    expect(pickBrandId(brands, 'Marlboro')).toEqual({ id: 2, title: 'Marlboro' });
    expect(pickBrandId({ brands: [{ id: 4273, title: 'Polo Ralph Lauren' }] }, 'Ralph Lauren')).toEqual({ id: 4273, title: 'Polo Ralph Lauren' });
    expect(pickBrandId({ brands: [{ id: 9, title: 'Carhartt' }] }, 'Marlboro')).toBeNull();
  });

  it('matches the size exactly within the category, else leaves it empty', () => {
    const groups = { size_groups: [{ sizes: [{ id: 207, title: 'S' }, { id: 208, title: 'M / 38 / 10' }, { id: 209, title: 'L' }] }] };
    expect(pickSizeId(groups, 'M')).toBe(208);
    expect(pickSizeId(groups, 'taille L')).toBe(209);
    expect(pickSizeId(groups, 'XL')).toBeNull();
  });

  it('keeps the chosen package when the category allows it, and the verified condition ids', () => {
    expect(pickPackageId({ package_sizes: [{ id: 1 }, { id: 2 }] }, 'MEDIUM')).toBe(2);
    expect(pickPackageId({ package_sizes: [{ id: 3 }] }, 'SMALL')).toBeNull();
    expect(STATUS_ID_OF.VERY_GOOD).toBe(2);
  });
});
