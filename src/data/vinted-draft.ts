import { normalizeText } from '@/intelligence/normalize';
import { STATUS_ID_OF, pickBrandId, pickCatalogId, pickPackageId, pickSizeId, repostSource } from '@/intelligence/vinted-ids';
import { MarketplaceError, errorInfo } from './adapters/marketplace';
import * as budget from './adapters/vinted/budget-store';
import { leftEditPage, openEditTab } from './adapters/vinted/price-edit';
import type { ApiResult, DraftInput, DraftResult, EraMessage, PublishResult } from './adapters/vinted/protocol';
import { VintedTabAdapter, ensureVintedTab, sendToVinted } from './adapters/vinted/vinted-adapter';
import { journal } from './journal';
import { repo } from './repo';
import { vintedWrite } from './vinted-write';

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const idText = (x: unknown): string | null => (typeof x === 'number' ? String(x) : typeof x === 'string' && /^\d+$/.test(x) ? x : null);

/**
 * Background-only. A DRAFT on the seller's Vinted account from a ready workshop sheet: ids come from Vinted's own
 * upload helpers (category suggested for the title, brand search, the category's sizes and package sizes); what
 * cannot be matched stays empty for the seller. With the seller's own photos when chosen in ERA (uploaded as they are,
 * in their order); published only by the seller's click « Publier sur Vinted » (publishDraft). Read back before being
 * reported: no "created" or "published" without Vinted showing it. EXPERIMENTAL.
 */

const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 12_000_000;

/** The seller's photos sent to Vinted through the vinted.fr tab (the upload route of Vinted's own form), their ids back. */
async function uploadPhotos(photos: readonly { base64: string; mime: string }[], session: string): Promise<number[]> {
  await ensureVintedTab();
  const ids: number[] = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]!;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(p.mime)) throw new MarketplaceError('NOT_APPLIED', `photo ${i + 1} : format ${p.mime} non accepté`);
    if (!p.base64 || p.base64.length * 0.75 > MAX_PHOTO_BYTES) throw new MarketplaceError('NOT_APPLIED', `photo ${i + 1} vide ou trop lourde`);
    // Sent once more only if it never arrived (the tab still loading, or reloaded meanwhile).
    const r = await sendToVinted<ApiResult>({ type: 'era:photo:upload', base64: p.base64, mime: p.mime, tempUuid: session, name: `photo${i + 1}.jpg` } satisfies EraMessage, 'write');
    if (!r.ok) throw new MarketplaceError(r.code, `photo ${i + 1} · ${r.detail ?? r.code}`);
    const id = Number(idText(obj(r.json).id) ?? idText(obj(obj(r.json).photo).id));
    if (!id) throw new MarketplaceError('UNAVAILABLE', `photo ${i + 1} : Vinted n’a pas renvoyé d’identifiant`);
    ids.push(id);
  }
  return ids;
}
export async function createVintedDraft(input: DraftInput): Promise<DraftResult> {
  const adapter = new VintedTabAdapter();
  // A helper Vinted does not answer (not found, odd reply) leaves its field for the seller; a block, a logout, an
  // exhausted budget stop everything — never a draft sent in the middle of a block.
  const soft = <T,>(p: Promise<T>): Promise<T | null> =>
    p.catch((e) => {
      if (errorInfo(e).code === 'UNAVAILABLE') return null;
      throw e;
    });
  const filled: string[] = [];
  const missing: string[] = [];
  try {
    // 0. A similar article sold before: its own listing carries Vinted's ids for this very kind of article.
    const tpl = input.template ? (repostSource(await soft(adapter.rawGet(`/api/v2/item_upload/items/${input.template.listingId}`)))?.fields ?? null) : null;
    const tplId = (k: string) => (tpl && typeof tpl[k] === 'number' ? (tpl[k] as number) : null);
    // 1. Category first (on Vinted, changing it resets brand, size and condition): the model's, else the one Vinted suggests.
    const catalogId =
      tplId('catalog_id') ??
      pickCatalogId(await soft(vintedWrite('POST', '/api/v2/item_upload/suggestions/categories', { title: input.title.slice(0, 200), description: input.description.slice(0, 1000) }, { spaced: false })));
    (catalogId ? filled : missing).push('category');
    // 2. Brand, by its exact name — an approximate brand gets a listing banned. The model's only if it is the same name.
    const sameBrand = tplId('brand_id') !== null && typeof tpl?.brand === 'string' && normalizeText(tpl.brand) === normalizeText(input.brand);
    const brand = sameBrand
      ? { id: tplId('brand_id')!, title: tpl!.brand as string }
      : pickBrandId(await soft(adapter.rawGet(`/api/v2/item_upload/brands?keyword=${encodeURIComponent(input.brand)}`)), input.brand);
    (brand ? filled : missing).push('brand');
    // 3. Size: the model's when it is the same size in the same category, else an exact match in this category's sizes.
    const sizeId =
      input.template?.sameSize && tplId('size_id') && catalogId === tplId('catalog_id')
        ? tplId('size_id')
        : catalogId && input.size
          ? pickSizeId(await soft(adapter.rawGet(`/api/v2/item_upload/size_groups?catalog_ids=${catalogId}`)), input.size)
          : null;
    (sizeId ? filled : missing).push('size');
    // 4. Package: the one the sheet chose, if the category allows it.
    const packageId = catalogId ? pickPackageId(await soft(adapter.rawGet(`/api/v2/catalogs/${catalogId}/package_sizes`)), input.packageSize) : null;
    (packageId ? filled : missing).push('package');
    const statusId = input.condition ? STATUS_ID_OF[input.condition] : null;
    (statusId ? filled : missing).push('condition');
    filled.unshift('title', 'description', 'price');

    const session = globalThis.crypto.randomUUID();
    // The seller's photos first (all or nothing: never a draft with half of them), within the read budget.
    const photos = (input.photos ?? []).slice(0, MAX_PHOTOS);
    if (photos.length) {
      const b = await budget.status();
      if (b.halted) throw new MarketplaceError(b.halted);
      if (b.remaining < photos.length + 2) throw new MarketplaceError('BUDGET_EXHAUSTED', `${photos.length + 2} appels nécessaires, ${b.remaining} restants`);
    }
    const photoIds = photos.length ? await uploadPhotos(photos, session) : [];
    if (photoIds.length) filled.push('photos');
    else missing.push('photos');
    const draft = {
      id: null,
      title: input.title,
      description: input.description,
      price: (input.priceCents / 100).toFixed(2),
      currency: 'EUR',
      brand_id: brand?.id ?? null,
      brand: brand?.title ?? null,
      size_id: sizeId,
      catalog_id: catalogId,
      status_id: statusId,
      package_size_id: packageId,
      color_ids: [],
      is_unisex: false,
      assigned_photos: photoIds.map((id) => ({ id, orientation: 0 })),
      temp_uuid: session,
    };
    const res = obj(await vintedWrite('POST', '/api/v2/item_upload/drafts', { draft, feedback_id: null, parcel: null, upload_session_id: session }));
    const draftId = idText(obj(res.draft).id) ?? idText(res.id);
    if (!draftId) throw new MarketplaceError('UNAVAILABLE', 'Vinted n’a pas renvoyé de brouillon');

    // 5. Read it back on Vinted: the title must be there, as a draft. The draft exists from here on: whatever the
    // read-back says, it is kept on the sheet (never created twice on a retry) and named in the answer.
    await repo.savePrep(input.itemId, { vintedDraftId: draftId });
    let back: Record<string, unknown>;
    try {
      back = obj(obj(await adapter.rawGet(`/api/v2/item_upload/items/${draftId}`)).item);
    } catch (e) {
      const { code, detail } = errorInfo(e);
      throw new MarketplaceError(code, `brouillon ${draftId} créé sur Vinted, relecture impossible (${detail ?? code}) : vérifiez-le sur Vinted avant de le compléter`);
    }
    if (typeof back.title === 'string' && back.title.trim() !== input.title.trim())
      throw new MarketplaceError('NOT_APPLIED', `brouillon ${draftId} relu avec un autre titre : vérifiez-le ou supprimez-le sur Vinted`);

    await journal({ kind: 'DRAFT', dryRun: false, ok: true, target: input.title, detail: `brouillon ${draftId} · rempli : ${filled.join(', ')}${missing.length ? ` · à compléter sur Vinted : ${missing.join(', ')}` : ''}` });
    return { ok: true, draftId, filled, missing };
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await journal({ kind: 'DRAFT', dryRun: false, ok: false, target: input.title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}

/**
 * The seller's click « Publier sur Vinted »: the draft's page opened in the background, its one publish button clicked
 * (as the seller would on Vinted), then read back — published only when Vinted no longer lists it as a draft. One draft
 * per click, never chained. When Vinted keeps it as a draft (a field it requires), the page is shown to the seller.
 */
export async function publishDraft(draftId: string, itemId: string, title: string): Promise<PublishResult> {
  try {
    if (!/^\d+$/.test(draftId)) throw new MarketplaceError('NOT_APPLIED', 'brouillon sans identifiant Vinted');
    await budget.reserveWrite();
    const r = await budget.reserve('WRITE');
    if (!r.ok) throw new MarketplaceError(r.code);
    const tabId = await openEditTab(draftId);
    let keep = false;
    try {
      const res = (await browser.tabs.sendMessage(tabId, { type: 'era:edit:publish' } satisfies EraMessage)) as { ok: boolean; detail?: string };
      if (!res.ok) throw new MarketplaceError('EDIT_FORM', res.detail ?? 'bouton de publication introuvable');
      await leftEditPage(tabId);
      const back = obj(obj(await new VintedTabAdapter().rawGet(`/api/v2/item_upload/items/${draftId}`)).item);
      if (back.is_draft === true) {
        keep = true;
        await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
        throw new MarketplaceError('NOT_APPLIED', 'Vinted garde le brouillon (un champ obligatoire manque ?) : la page est ouverte pour le compléter');
      }
      const verified = back.is_draft === false;
      await repo.savePrep(itemId, { publishedAt: Date.now() });
      await journal({ kind: 'PUBLISH', dryRun: false, ok: true, unconfirmed: !verified, target: title, detail: `brouillon ${draftId} publié${verified ? ', relu sur Vinted (plus un brouillon)' : ' · relecture sans réponse claire (non confirmé)'}` });
      return { ok: true, verified };
    } finally {
      if (!keep) await browser.tabs.remove(tabId).catch(() => undefined);
    }
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await journal({ kind: 'PUBLISH', dryRun: false, ok: false, target: title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}
