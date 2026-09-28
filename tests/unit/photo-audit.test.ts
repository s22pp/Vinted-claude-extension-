import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditPhotos, photoAuditSummary, photosToRead } from '@/data/photo-audit';
import type { PhotoReport } from '@/intelligence/photo';

const img = (n: number) => `https://images1.vinted.net/t/${n}/f800/x.jpeg`;
const listings = [
  { itemId: 'a', title: 'Veste', url: 'https://www.vinted.fr/items/1', photoUrls: [img(1), img(2), 'https://evil.example/x.jpg'] },
  { itemId: 'b', title: 'Jean', url: null, photoUrls: [img(3)] },
  { itemId: 'c', title: 'Sans photo', url: null, photoUrls: [] },
];

afterEach(() => vi.unstubAllGlobals());

describe('photo check of the live listings', () => {
  it('only Vinted’s image servers, each photo once; worst listings first; unread photos counted, never guessed', () => {
    expect(photosToRead(listings, {})).toEqual([img(1), img(2), img(3)]);
    const cache = { [img(1)]: { at: 1, score: 30, verdict: 'RETAKE' as const, issues: ['BLURRY' as const] }, [img(3)]: { at: 1, score: 90, verdict: 'OK' as const, issues: [] } };
    expect(photosToRead(listings, cache)).toEqual([img(2)]);
    const s = photoAuditSummary(listings, cache);
    expect(s.map((x) => [x.itemId, x.photos, x.read, x.retake.length])).toEqual([
      ['a', 2, 1, 1],
      ['b', 1, 1, 0],
    ]);
    expect(s[0]!.retake[0]).toEqual({ url: img(1), issues: ['BLURRY'] });
  });

  it('reads and scores what is missing; a photo that cannot be read is skipped, tried again next time', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url === img(2) ? new Response('x', { status: 404 }) : new Response(new Blob(['jpeg']))));
    const report: PhotoReport = { score: 55, verdict: 'IMPROVE', issues: ['TOO_DARK'], metrics: { sharpness: 1, brightness: 1, clipped: 0, contrast: 1, border: 0, cast: 0, minSide: 800 } };
    const seen: number[] = [];
    const r = await auditPhotos([img(1), img(2)], {}, async () => report, (done) => seen.push(done), 7, 0);
    expect(r).toMatchObject({ read: 1, failed: 1 });
    expect(r.cache[img(1)]).toEqual({ at: 7, score: 55, verdict: 'IMPROVE', issues: ['TOO_DARK'] });
    expect(r.cache[img(2)]).toBeUndefined();
    expect(seen).toEqual([1, 2]);
  });
});
