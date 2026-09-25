import { isAllowedWrite, isVintedImageUrl } from '@/data/adapters/vinted/protocol';
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

describe('repost source: a copy of the listing, with its own ids', async () => {
  const { repostSource } = await import('@/intelligence/vinted-ids');
  it('copies ids, texts and photos; reads favourites; never invents', () => {
    const s = repostSource({ item: { id: 101, title: 'Veste Harrington M', description: 'Belle veste', price: { amount: '59.0' }, brand_id: 88, brand: 'Ralph Lauren', size_id: 208, catalog_id: 2551, status_id: 2, package_size_id: 2, color1_id: 27, is_unisex: false, favourite_count: 0, photos: [{ id: 1, url: 'https://images1.vinted.net/a.jpg' }, { id: 2, full_size_url: 'https://images1.vinted.net/b-full.jpg', url: 'https://images1.vinted.net/b.jpg' }] } })!;
    expect(s.photoUrls).toEqual(['https://images1.vinted.net/a.jpg', 'https://images1.vinted.net/b-full.jpg']);
    expect(s.favorites).toBe(0);
    expect(s.fields).toMatchObject({ title: 'Veste Harrington M', price: '59.00', brand_id: 88, size_id: 208, catalog_id: 2551, status_id: 2, package_size_id: 2, color_ids: [27] });
    expect(repostSource({})).toBeNull();
    expect(repostSource({ item: { title: 'x' } })!.favorites).toBeNull();
  });
});

describe('repost safety rails', () => {
  it('photos are copied from Vinted’s image servers only', () => {
    expect(isVintedImageUrl('https://images1.vinted.net/t/01_abc/f800/1.jpeg')).toBe(true);
    expect(isVintedImageUrl('https://vinted.net/x.jpg')).toBe(true);
    expect(isVintedImageUrl('http://images1.vinted.net/x.jpg')).toBe(false);
    expect(isVintedImageUrl('https://evil.example/vinted.net/x.jpg')).toBe(false);
    expect(isVintedImageUrl('https://images1.vinted.net.evil.example/x.jpg')).toBe(false);
    expect(isVintedImageUrl('not a url')).toBe(false);
  });
  it('deleting a listing is whitelisted as POST items/{id}/delete only', () => {
    expect(isAllowedWrite('POST', '/api/v2/items/110/delete')).toBe(true);
    expect(isAllowedWrite('DELETE', '/api/v2/items/110')).toBe(false);
    expect(isAllowedWrite('POST', '/api/v2/items/110/delete?x=1')).toBe(false);
    expect(isAllowedWrite('POST', '/api/v2/photos')).toBe(false);
  });
});
