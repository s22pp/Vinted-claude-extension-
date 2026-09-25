import { STATUS_ID_OF, pickBrandId, pickCatalogId, pickPackageId, pickSizeId } from '@/intelligence/vinted-ids';
import { MarketplaceError, errorInfo } from './adapters/marketplace';
import type { DraftInput, DraftResult } from './adapters/vinted/protocol';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { db, uid } from './db';
import { repo } from './repo';
import { vintedWrite } from './vinted-write';

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const idText = (x: unknown): string | null => (typeof x === 'number' ? String(x) : typeof x === 'string' && /^\d+$/.test(x) ? x : null);

/**
 * Background-only. A DRAFT on the seller's Vinted account from a ready workshop sheet: ids come from Vinted's own
 * upload helpers (category suggested for the title, brand search, the category's sizes and package sizes); what
 * cannot be matched stays empty for the seller. Never published: photos and "Ajouter" stay on Vinted, by hand.
 * Read back before being reported: no "created" without Vinted showing it. EXPERIMENTAL.
 */
export async function createVintedDraft(input: DraftInput): Promise<DraftResult> {
  const adapter = new VintedTabAdapter();
  const filled: string[] = [];
  const missing: string[] = [];
  try {
    // 1. Category first (on Vinted, changing it resets brand, size and condition): the one Vinted suggests.
    const catalogId = pickCatalogId(await vintedWrite('POST', '/api/v2/item_upload/suggestions/categories', { title: input.title.slice(0, 200), description: input.description.slice(0, 1000) }, { spaced: false }).catch(() => null));
    (catalogId ? filled : missing).push('category');
    // 2. Brand, by its exact name — an approximate brand gets a listing banned.
    const brand = pickBrandId(await adapter.rawGet(`/api/v2/item_upload/brands?keyword=${encodeURIComponent(input.brand)}`).catch(() => null), input.brand);
    (brand ? filled : missing).push('brand');
    // 3. Size: only an exact match in this category's sizes.
    const sizeId = catalogId && input.size ? pickSizeId(await adapter.rawGet(`/api/v2/item_upload/size_groups?catalog_ids=${catalogId}`).catch(() => null), input.size) : null;
    (sizeId ? filled : missing).push('size');
    // 4. Package: the one the sheet chose, if the category allows it.
    const packageId = catalogId ? pickPackageId(await adapter.rawGet(`/api/v2/catalogs/${catalogId}/package_sizes`).catch(() => null), input.packageSize) : null;
    (packageId ? filled : missing).push('package');
    const statusId = input.condition ? STATUS_ID_OF[input.condition] : null;
    (statusId ? filled : missing).push('condition');
    filled.unshift('title', 'description', 'price');

    const session = globalThis.crypto.randomUUID();
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
      assigned_photos: [],
      temp_uuid: session,
    };
    const res = obj(await vintedWrite('POST', '/api/v2/item_upload/drafts', { draft, feedback_id: null, parcel: null, upload_session_id: session }));
    const draftId = idText(obj(res.draft).id) ?? idText(res.id);
    if (!draftId) throw new MarketplaceError('UNAVAILABLE', 'Vinted n’a pas renvoyé de brouillon');

    // 5. Read it back on Vinted: the title must be there, as a draft.
    const back = obj(obj(await adapter.rawGet(`/api/v2/item_upload/items/${draftId}`)).item);
    if (typeof back.title === 'string' && back.title.trim() !== input.title.trim())
      throw new MarketplaceError('NOT_APPLIED', `brouillon ${draftId} relu avec un autre titre`);

    await repo.savePrep(input.itemId, { vintedDraftId: draftId });
    await db.autoLog.put({ id: uid('al'), at: Date.now(), kind: 'DRAFT', dryRun: false, ok: true, target: input.title, detail: `brouillon ${draftId} · rempli : ${filled.join(', ')}${missing.length ? ` · à compléter sur Vinted : ${missing.join(', ')}` : ''}` });
    return { ok: true, draftId, filled, missing };
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await db.autoLog.put({ id: uid('al'), at: Date.now(), kind: 'DRAFT', dryRun: false, ok: false, target: input.title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}
