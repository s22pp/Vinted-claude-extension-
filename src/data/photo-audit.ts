import type { PhotoIssue, PhotoReport } from '@/intelligence/photo';
import { isVintedImageUrl } from './adapters/vinted/protocol';

/**
 * Photo check of the live listings: every photo, read from Vinted's image servers (no API call), scored in the
 * browser — sharpness, light, contrast, background, resolution — and never modified, generated or sent anywhere.
 * Results are kept per photo address, so a photo is read once.
 */

export const PHOTO_AUDIT_KEY = 'photoAudit';

export interface PhotoVerdict {
  at: number;
  score: number;
  verdict: PhotoReport['verdict'];
  issues: PhotoIssue[];
}
export type PhotoAuditCache = Record<string, PhotoVerdict>;

export interface AuditListing {
  itemId: string;
  title: string;
  url: string | null;
  photoUrls: string[];
}

export interface ListingPhotoAudit {
  itemId: string;
  title: string;
  url: string | null;
  photos: number;
  read: number;
  retake: { url: string; issues: PhotoIssue[] }[];
  improve: { url: string; issues: PhotoIssue[] }[];
}

/** Per listing: photos to retake, to improve; worst listings first. Unread photos are counted, never guessed. */
export function photoAuditSummary(listings: readonly AuditListing[], cache: PhotoAuditCache): ListingPhotoAudit[] {
  return listings
    .map((l) => {
      const urls = l.photoUrls.filter(isVintedImageUrl);
      const read = urls.filter((u) => cache[u]);
      const pick = (v: PhotoVerdict['verdict']) => read.filter((u) => cache[u]!.verdict === v).map((u) => ({ url: u, issues: cache[u]!.issues }));
      return { itemId: l.itemId, title: l.title, url: l.url, photos: urls.length, read: read.length, retake: pick('RETAKE'), improve: pick('IMPROVE') };
    })
    .filter((x) => x.photos > 0)
    .sort((a, b) => b.retake.length - a.retake.length || b.improve.length - a.improve.length);
}

/** The photos still to read (Vinted's image servers only). */
export function photosToRead(listings: readonly AuditListing[], cache: PhotoAuditCache): string[] {
  return [...new Set(listings.flatMap((l) => l.photoUrls).filter((u) => isVintedImageUrl(u) && !cache[u]))];
}

/**
 * Reads and scores the photos not read yet, one at a time and gently (a pause between two), and returns the cache
 * with them. A photo that cannot be read is skipped (tried again next time).
 */
export async function auditPhotos(
  urls: readonly string[],
  cache: PhotoAuditCache,
  analyze: (blob: Blob) => Promise<PhotoReport>,
  onProgress: (done: number, total: number) => void = () => undefined,
  now = Date.now(),
  pauseMs = 150,
): Promise<{ cache: PhotoAuditCache; read: number; failed: number }> {
  const next: PhotoAuditCache = { ...cache };
  let read = 0;
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      const r = await analyze(await res.blob());
      next[url] = { at: now, score: r.score, verdict: r.verdict, issues: r.issues };
      read++;
    } catch {
      failed++;
    }
    onProgress(i + 1, urls.length);
    if (pauseMs && i < urls.length - 1) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { cache: next, read, failed };
}
