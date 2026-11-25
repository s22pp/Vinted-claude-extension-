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
export type PhotoScope = 'LIVE' | 'ALL' | 'SELECTED';
export interface PhotoExportResult {
  listings: number;
  photos: number;
  /** Listings whose photos could not be found (addresses unknown and not readable now). */
  missing: number;
  stopped: string | null;
}

/**
 * `SELECTED`: only the articles the seller ticked (their current listing), gathered in one dated folder
 * (ERA-photos/ChatGPT-<date>/…) with an « articles.txt » that names each one — ready to drop into ChatGPT.
 */
export async function exportPhotos(scope: PhotoScope, onProgress: (done: number, total: number) => void = () => undefined, itemIds: readonly string[] = [], now = Date.now()): Promise<PhotoExportResult> {
  const chosen = new Set(itemIds);
  const all = await db.listings
    .filter((l) => !l.isDemo && /^\d+$/.test(l.platformListingId ?? '') && (scope === 'LIVE' ? l.status === 'ACTIVE' || l.status === 'RESERVED' || l.status === 'HIDDEN' : l.status !== 'REMOVED') && (scope !== 'SELECTED' || chosen.has(l.inventoryItemId)))
    .toArray();
  // One listing per article when chosen by article: its latest.
  const listings = (scope === 'SELECTED' ? [...new Map(all.sort((a, b) => a.listedAt - b.listedAt).map((l) => [l.inventoryItemId, l])).values()] : all).sort((a, b) => b.listedAt - a.listedAt);
  const folder = scope === 'SELECTED' ? chatGptFolder(now) : null;
  const sheet: string[] = [];
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
    if (folder) sheet.push(sheetLine(sheet.length + 1, l.title, l.priceCents, urls.length, photoFileName(l.title, l.platformListingId!, 0, urls[0]!).split('/')[1]!));
    for (const [n, url] of urls.entries()) {
      // Same article, same file name: exporting again replaces the copy instead of piling up « 01 (1).jpg ».
      const name = photoFileName(l.title, l.platformListingId!, n, url);
      await browser.downloads.download({ url, filename: folder ? name.replace(/^[^/]+/, folder) : name, conflictAction: 'overwrite', saveAs: false }).catch(() => undefined);
      photos++;
      // Gentle on the image servers.
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  onProgress(listings.length, listings.length);
  if (folder && sheet.length) {
    const text = [CHATGPT_HEAD, '', ...sheet, ''].join('\n');
    const data = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    await browser.downloads.download({ url: data, filename: `${folder}/articles.txt`, conflictAction: 'overwrite', saveAs: false }).catch(() => undefined);
  }
  return { listings: listings.length, photos, missing, stopped };
}

/** ERA-photos/ChatGPT-2026-11-25: one folder per day's selection. */
export const chatGptFolder = (now: number) => `ERA-photos/ChatGPT-${new Date(now).toISOString().slice(0, 10)}`;

/** The note that goes with the photos: what each folder is, so ChatGPT knows which photos belong together. */
const CHATGPT_HEAD = 'Photos de mes articles Vinted, un dossier par article (photos dans l’ordre de l’annonce). Pour chacun : titre, prix demandé, nombre de photos, dossier.';

export function sheetLine(n: number, title: string, priceCents: number, photos: number, dir: string): string {
  return `${n}. ${title} — ${(priceCents / 100).toFixed(2).replace('.', ',')} € — ${photos} photo(s) — ${dir}/`;
}
