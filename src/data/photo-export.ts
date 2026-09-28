import { photoFileName } from '@/intelligence/shipping';
import { repostSource } from '@/intelligence/vinted-ids';
import { errorInfo } from './adapters/marketplace';
import * as budget from './adapters/vinted/budget-store';
import { isVintedImageUrl } from './adapters/vinted/protocol';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { db } from './db';

/**
 * Every photo of your listings, saved as files (Téléchargements/ERA-photos/<article>_<id>/01.jpg…), downloaded by
 * the browser from Vinted's image servers. The photo addresses come from the last import; a listing whose
 * addresses the wardrobe did not give is read once in full (a budgeted call). Only listings still on your
 * wardrobe: a deleted listing's photos are gone from Vinted.
 */
export type PhotoScope = 'LIVE' | 'ALL';
export interface PhotoExportResult {
  listings: number;
  photos: number;
  /** Listings whose photos could not be found (addresses unknown and not readable now). */
  missing: number;
  stopped: string | null;
}

export async function exportPhotos(scope: PhotoScope, onProgress: (done: number, total: number) => void = () => undefined): Promise<PhotoExportResult> {
  const listings = (await db.listings.filter((l) => !l.isDemo && /^\d+$/.test(l.platformListingId ?? '') && (scope === 'ALL' ? l.status !== 'REMOVED' : l.status === 'ACTIVE' || l.status === 'RESERVED' || l.status === 'HIDDEN')).toArray()).sort(
    (a, b) => b.listedAt - a.listedAt,
  );
  const adapter = new VintedTabAdapter();
  let photos = 0;
  let missing = 0;
  let stopped: string | null = null;
  for (const [i, l] of listings.entries()) {
    onProgress(i, listings.length);
    let urls = (l.photoUrls ?? []).filter(isVintedImageUrl);
    if (!urls.length && !stopped) {
      // Not given by the wardrobe: read this listing once (only while the read budget allows).
      const b = await budget.status();
      if (b.halted || b.remaining < 2) stopped = b.halted ?? 'budget d’appels de la session épuisé';
      else {
        try {
          urls = repostSource(await adapter.rawGet(`/api/v2/item_upload/items/${l.platformListingId}`))?.photoUrls.filter(isVintedImageUrl) ?? [];
          if (urls.length) await db.listings.update(l.id, { photoUrls: urls });
        } catch (e) {
          const { code, detail } = errorInfo(e);
          if (['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED'].includes(code)) stopped = detail ?? code;
        }
      }
    }
    if (!urls.length) {
      missing++;
      continue;
    }
    for (const [n, url] of urls.entries()) {
      await browser.downloads.download({ url, filename: photoFileName(l.title, l.platformListingId!, n, url), conflictAction: 'uniquify', saveAs: false }).catch(() => undefined);
      photos++;
      // Gentle on the image servers.
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  onProgress(listings.length, listings.length);
  return { listings: listings.length, photos, missing, stopped };
}
