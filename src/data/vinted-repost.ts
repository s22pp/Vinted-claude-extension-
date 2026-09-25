import type { Listing } from '@/domain/entities';
import { isLiveListing } from '@/domain/status';
import { repostSource } from '@/intelligence/vinted-ids';
import { MarketplaceError, errorInfo } from './adapters/marketplace';
import * as budget from './adapters/vinted/budget-store';
import { type ApiResult, type EraMessage, type PendingRepost, type RepostFinishResult, type RepostResult, isVintedImageUrl } from './adapters/vinted/protocol';
import { VintedTabAdapter, ensureVintedTab } from './adapters/vinted/vinted-adapter';
import { type AutoLogRow, db, uid } from './db';
import { repo } from './repo';
import { vintedWrite } from './vinted-write';

/**
 * Repost WITHOUT losing anything, in two steps, each from one click of the seller. EXPERIMENTAL.
 *  1. `repostAsDraft`: the listing is read on Vinted, refused if it has favourites (they would be lost), and copied
 *     into a DRAFT with the same fields and the same photos (uploaded again). Nothing is published or deleted:
 *     the seller checks the draft and publishes it on Vinted.
 *  2. `finishRepost`: once the copy is live on Vinted, and the old listing still has 0 favourites, the old one is
 *     deleted — after the seller's confirmation — and read back. ERA's history stays on the same article.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const idText = (x: unknown): string | null => (typeof x === 'number' ? String(x) : typeof x === 'string' && /^\d+$/.test(x) ? x : null);
const log = (row: Omit<AutoLogRow, 'id' | 'at' | 'dryRun'>) => db.autoLog.put({ id: uid('al'), at: Date.now(), dryRun: false, ...row });

export const PENDING_REPOSTS_KEY = 'pendingReposts';
/** A draft copy nobody published within this delay is forgotten by ERA (the draft stays on Vinted). */
export const PENDING_REPOST_DAYS = 30;
/** ERA's own favourites count must be this recent when Vinted's upload data does not give one. */
const FRESH_MS = 6 * 3_600_000;
const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 12_000_000;

export async function pendingReposts(now = Date.now()): Promise<PendingRepost[]> {
  const all = await repo.getSetting<PendingRepost[]>(PENDING_REPOSTS_KEY, []);
  return all.filter((p) => now - p.at < PENDING_REPOST_DAYS * 86_400_000);
}

async function savePending(list: PendingRepost[]): Promise<void> {
  await repo.setSetting(PENDING_REPOSTS_KEY, list);
}

/** The item's live Vinted listing (the latest one). */
async function liveVintedListing(itemId: string): Promise<Listing | null> {
  const ls = (await db.listings.where('inventoryItemId').equals(itemId).toArray()).filter((l) => !l.isDemo && isLiveListing(l.status) && /^\d+$/.test(l.platformListingId ?? ''));
  return ls.sort((a, b) => b.listedAt - a.listedAt)[0] ?? null;
}

/**
 * Favourites of a listing, from Vinted when its upload data says it, else from ERA's last import when recent.
 * null = not known well enough to delete or copy anything.
 */
function favouritesOf(vinted: number | null, l: Listing, now: number): number | null {
  if (vinted !== null) return vinted;
  return l.favorites !== null && l.lastObservedAt !== null && now - l.lastObservedAt < FRESH_MS ? l.favorites : null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One photo: downloaded from Vinted's image server, uploaded again through the vinted.fr tab. */
async function copyPhoto(url: string, index: number, tempUuid: string, tabId: number): Promise<number> {
  if (!isVintedImageUrl(url)) throw new MarketplaceError('NOT_APPLIED', `photo ${index + 1} hors des serveurs de Vinted`);
  const res = await fetch(url, { credentials: 'omit' }).catch(() => null);
  if (!res?.ok) throw new MarketplaceError('UNAVAILABLE', `photo ${index + 1} non téléchargée${res ? ` (HTTP ${res.status})` : ''}`);
  const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_PHOTO_BYTES) throw new MarketplaceError('NOT_APPLIED', `photo ${index + 1} vide ou trop lourde`);
  let r: ApiResult;
  try {
    r = (await browser.tabs.sendMessage(tabId, { type: 'era:photo:upload', base64: toBase64(buf), mime, tempUuid, name: `photo${index + 1}.jpg` } satisfies EraMessage)) as ApiResult;
  } catch {
    throw new MarketplaceError('NO_VINTED_TAB', 'CONTENT_SCRIPT_UNREACHABLE');
  }
  if (!r.ok) throw new MarketplaceError(r.code, `photo ${index + 1} · ${r.detail ?? r.code}`);
  const id = Number(idText(obj(r.json).id) ?? idText(obj(obj(r.json).photo).id));
  if (!id) throw new MarketplaceError('UNAVAILABLE', `photo ${index + 1} : Vinted n’a pas renvoyé d’identifiant`);
  return id;
}

/** Step 1 — the draft copy. The original listing is not touched. */
export async function repostAsDraft(itemId: string, now = Date.now()): Promise<RepostResult> {
  const item = await db.items.get(itemId);
  const title = item?.title ?? itemId;
  try {
    if (!item || item.isDemo) throw new MarketplaceError('NOT_APPLIED', 'article inconnu');
    if (item.status !== 'LISTED') throw new MarketplaceError('NOT_APPLIED', 'seule une annonce en ligne, ni réservée ni masquée, se republie');
    if ((await pendingReposts(now)).some((p) => p.itemId === itemId)) throw new MarketplaceError('NOT_APPLIED', 'une copie attend déjà d’être publiée pour cet article');
    const old = await liveVintedListing(itemId);
    if (!old) throw new MarketplaceError('NOT_APPLIED', 'aucune annonce Vinted en ligne pour cet article');
    if (old.favorites !== null && old.favorites > 0) throw new MarketplaceError('NOT_APPLIED', `${old.favorites} favori(s) : une republication les perdrait`);

    const adapter = new VintedTabAdapter();
    const src = repostSource(await adapter.rawGet(`/api/v2/item_upload/items/${old.platformListingId}`));
    if (!src) throw new MarketplaceError('UNAVAILABLE', 'annonce illisible sur Vinted');
    const favs = favouritesOf(src.favorites, old, now);
    if (favs === null) throw new MarketplaceError('NOT_APPLIED', 'favoris non confirmés : importez depuis Vinted puis réessayez');
    if (favs > 0) throw new MarketplaceError('NOT_APPLIED', `${favs} favori(s) : une republication les perdrait`);
    if (src.photoUrls.length === 0) throw new MarketplaceError('NOT_APPLIED', 'aucune photo lisible sur l’annonce');
    const photos = src.photoUrls.slice(0, MAX_PHOTOS);
    // Everything or nothing: never start a copy the read budget cannot finish.
    const b = await budget.status();
    if (b.halted) throw new MarketplaceError(b.halted);
    if (b.remaining < photos.length + 2) throw new MarketplaceError('BUDGET_EXHAUSTED', `${photos.length + 2} appels nécessaires, ${b.remaining} restants`);

    const { tabId } = await ensureVintedTab();
    const session = globalThis.crypto.randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < photos.length; i++) ids.push(await copyPhoto(photos[i]!, i, session, tabId));

    const draft = { ...src.fields, id: null, assigned_photos: ids.map((id) => ({ id, orientation: 0 })), temp_uuid: session };
    const res = obj(await vintedWrite('POST', '/api/v2/item_upload/drafts', { draft, feedback_id: null, parcel: null, upload_session_id: session }));
    const draftId = idText(obj(res.draft).id) ?? idText(res.id);
    if (!draftId) throw new MarketplaceError('UNAVAILABLE', 'Vinted n’a pas renvoyé de brouillon');

    // Read back: the title and the photos (field `photos`) must be there.
    const back = obj(obj(await adapter.rawGet(`/api/v2/item_upload/items/${draftId}`)).item);
    if (typeof back.title === 'string' && back.title.trim() !== src.title.trim()) throw new MarketplaceError('NOT_APPLIED', `brouillon ${draftId} relu avec un autre titre`);
    const photosBack = Array.isArray(back.photos) ? back.photos.length : null;

    await savePending([...(await pendingReposts(now)).filter((p) => p.itemId !== itemId), { itemId, draftId, oldListingId: old.id, oldPlatformListingId: old.platformListingId!, title: src.title, at: now }]);
    await log({ kind: 'REPOST', ok: true, target: title, detail: `copie en brouillon ${draftId} · ${ids.length} photo(s) envoyée(s)${photosBack !== null ? `, ${photosBack} relue(s)` : ''} · ancienne annonce ${old.platformListingId} intacte` });
    return { ok: true, draftId, photos: ids.length, photosBack };
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await log({ kind: 'REPOST', ok: false, target: title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}

/** Step 2 — the old listing goes, only once the copy is live and the old one still has no favourite. */
export async function finishRepost(itemId: string, now = Date.now()): Promise<RepostFinishResult> {
  const pending = (await pendingReposts(now)).find((p) => p.itemId === itemId);
  const title = pending?.title ?? (await db.items.get(itemId))?.title ?? itemId;
  try {
    if (!pending) throw new MarketplaceError('NOT_APPLIED', 'aucune republication en cours pour cet article');
    const old = await db.listings.get(pending.oldListingId);
    if (!old || !isLiveListing(old.status)) throw new MarketplaceError('NOT_APPLIED', 'l’ancienne annonce n’est plus en ligne dans ERA');
    const adapter = new VintedTabAdapter();
    // The copy must be published: Vinted says it is no longer a draft, or ERA's last import saw it live.
    const copy = obj(obj(await adapter.rawGet(`/api/v2/item_upload/items/${pending.draftId}`)).item);
    const copySeenLive = (await db.listings.where('inventoryItemId').equals(itemId).toArray()).some((l) => l.platformListingId === pending.draftId && isLiveListing(l.status));
    if (copy.is_draft === true || (copy.is_draft !== false && !copySeenLive)) throw new MarketplaceError('NOT_APPLIED', 'la copie n’est pas encore publiée sur Vinted');
    const src = repostSource(await adapter.rawGet(`/api/v2/item_upload/items/${pending.oldPlatformListingId}`));
    const favs = favouritesOf(src?.favorites ?? null, old, now);
    if (favs === null) throw new MarketplaceError('NOT_APPLIED', 'favoris de l’ancienne annonce non confirmés : importez depuis Vinted puis réessayez');
    if (favs > 0) throw new MarketplaceError('NOT_APPLIED', `l’ancienne annonce a reçu ${favs} favori(s) : elle est gardée`);

    await vintedWrite('POST', `/api/v2/items/${pending.oldPlatformListingId}/delete`, {});
    // Read back: gone means Vinted no longer returns it.
    let verified = false;
    try {
      const still = obj(obj(await adapter.rawGet(`/api/v2/item_upload/items/${pending.oldPlatformListingId}`)).item);
      verified = still.is_deleted === true || still.is_closed === true;
    } catch (e) {
      verified = e instanceof MarketplaceError && /HTTP 404/.test(e.message);
    }
    if (!verified) {
      // Sent, not confirmed: ERA's data does not move; the next import (the listing gone or not) decides.
      await savePending((await pendingReposts(now)).map((p) => (p.itemId === itemId ? { ...p, deleteSentAt: now } : p)));
      await log({ kind: 'DELETE', ok: true, target: title, detail: `suppression de ${pending.oldPlatformListingId} envoyée ; la relecture la montre encore (non confirmé) · le prochain import tranchera` });
      return { ok: true, verified: false };
    }

    await db.transaction('rw', [db.listings, db.events], async () => {
      await db.listings.put({ ...old, status: 'REMOVED', removedAt: now });
      await db.events.put({ id: uid('ev'), type: 'LISTING_REMOVED', at: now, inventoryItemId: itemId, listingId: old.id, data: { views: old.views, favorites: old.favorites, price: old.priceCents }, provenance: 'OBSERVED', isDemo: false });
    });
    await savePending((await pendingReposts(now)).filter((p) => p.itemId !== itemId));
    await log({ kind: 'DELETE', ok: true, target: title, detail: `ancienne annonce ${pending.oldPlatformListingId} supprimée, confirmé par Vinted · la copie ${pending.draftId} reste en ligne` });
    return { ok: true, verified };
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await log({ kind: 'DELETE', ok: false, target: title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}

/** Forget a draft copy (nothing is sent to Vinted: the draft, if any, stays there for the seller). */
export async function dropPendingRepost(itemId: string): Promise<void> {
  await savePending((await pendingReposts()).filter((p) => p.itemId !== itemId));
}
