import { describe, expect, it } from 'vitest';
import { cropRect, dragOffset, exportName, exportSize } from '@/intelligence/photo-crop';

describe('Studio photo: 3:4 frame, size, name', () => {
  it('the largest 3:4 frame, centred: a landscape photo loses its sides, a tall one its top and bottom', () => {
    expect(cropRect(4000, 3000)).toEqual({ sx: 875, sy: 0, sw: 2250, sh: 3000 });
    expect(cropRect(3000, 5000)).toEqual({ sx: 0, sy: 500, sw: 3000, sh: 4000 });
    expect(cropRect(1200, 1600)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 1600 });
  });

  it('moved by the seller within the photo, never out of it', () => {
    expect(cropRect(4000, 3000, -1)).toMatchObject({ sx: 0 });
    expect(cropRect(4000, 3000, 1)).toMatchObject({ sx: 1750 });
    expect(cropRect(4000, 3000, 7)).toMatchObject({ sx: 1750 });
    const r = cropRect(4000, 3000);
    // 100 px of drag on a preview at 1/10 scale = 1000 px of photo; 875 px of room each side → against the edge.
    expect(dragOffset({ x: 0, y: 0 }, 100, 50, r, 4000, 3000, 0.1)).toEqual({ x: 1, y: 0 });
    expect(dragOffset({ x: 0, y: 0 }, -43.75, 0, r, 4000, 3000, 0.1)).toEqual({ x: -0.5, y: 0 });
  });

  it('scaled down to 1600 px on the long side, never up', () => {
    expect(exportSize(2250, 3000)).toEqual({ width: 1200, height: 1600 });
    expect(exportSize(600, 800)).toEqual({ width: 600, height: 800 });
  });

  it('named after the article: accents and signs dropped, numbered from 01', () => {
    expect(exportName('E1C4G Veste Harrington Ralph Lauren — été', 0, 'jpg')).toBe('e1c4g-veste-harrington-ralph-lauren-ete-01.jpg');
    expect(exportName('   ', 11, 'webp')).toBe('photo-12.webp');
  });
});
