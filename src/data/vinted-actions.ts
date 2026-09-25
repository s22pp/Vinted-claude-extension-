import { MarketplaceError, errorInfo } from './adapters/marketplace';
import type { HideResult, LabelResult } from './adapters/vinted/protocol';
import { VintedTabAdapter } from './adapters/vinted/vinted-adapter';
import { type AutoLogRow, db, uid } from './db';
import { vintedWrite, waitAlive } from './vinted-write';

/**
 * Background-only, each from ONE click of the seller, each journalled. EXPERIMENTAL: routes as read in
 * production tools, verified by ERA only through what Vinted answers here.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const idText = (x: unknown): string | null => (typeof x === 'number' ? String(x) : typeof x === 'string' && /^\d+$/.test(x) ? x : null);
const urlOf = (j: unknown): string | null => {
  const u = obj(j).label_url;
  return typeof u === 'string' && /^https:\/\//.test(u) ? u : null;
};
const log = (row: Omit<AutoLogRow, 'id' | 'at' | 'dryRun'>) => db.autoLog.put({ id: uid('al'), at: Date.now(), dryRun: false, ...row });

/**
 * The printable label of one order, like "Obtenir le bordereau" on Vinted: an existing label is simply fetched;
 * otherwise it is ordered (printable, the drop-off Vinted proposes), then Vinted is given up to ~25 s to make it.
 */
export async function getShippingLabel(conversationId: string, title: string): Promise<LabelResult> {
  const adapter = new VintedTabAdapter();
  try {
    const tx = obj(obj(obj(await adapter.rawGet(`/api/v2/conversations/${conversationId}`)).conversation).transaction);
    const txId = idText(tx.id);
    const shipmentId = idText(tx.shipment_id) ?? idText(obj(tx.shipment).id);
    if (!txId || !shipmentId) throw new MarketplaceError('NOT_APPLIED', 'commande pas encore prête pour un bordereau (pas d’expédition chez Vinted)');
    let url = urlOf(await adapter.rawGet(`/api/v2/shipments/${shipmentId}/label_url`).catch(() => null));
    const ordered = !url;
    if (!url) {
      const address = idText(obj(obj(await adapter.rawGet('/api/v2/user_addresses/default_shipping_address')).user_address).id);
      if (!address) throw new MarketplaceError('NOT_APPLIED', 'aucune adresse d’expédition par défaut sur votre compte Vinted');
      await vintedWrite('PUT', `/api/v2/transactions/${txId}/shipment/order`, { seller_address_id: Number(address), drop_off_type: null, label_type: 'printable' });
      // Vinted makes the label asynchronously: a few spaced looks, not a hammering.
      for (const ms of [2000, 4000, 7000, 11000]) {
        await waitAlive(ms);
        url = urlOf(await adapter.rawGet(`/api/v2/shipments/${shipmentId}/label_url`).catch(() => null));
        if (url) break;
      }
    }
    if (!url) throw new MarketplaceError('NOT_APPLIED', 'bordereau commandé, pas encore fabriqué par Vinted : réessayez dans une minute');
    await log({ kind: 'LABEL', ok: true, target: title, detail: ordered ? 'bordereau commandé puis récupéré' : 'bordereau déjà prêt, récupéré' });
    return { ok: true, url, ordered };
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await log({ kind: 'LABEL', ok: false, target: title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}

/** Hide or show one listing, then read it back; ERA's status follows only what Vinted confirms. */
export async function setListingHidden(platformListingId: string, itemId: string, hidden: boolean): Promise<HideResult> {
  const adapter = new VintedTabAdapter();
  const item = await db.items.get(itemId);
  const title = item?.title ?? `annonce ${platformListingId}`;
  try {
    await vintedWrite('PUT', `/api/v2/items/${platformListingId}/is_hidden`, { is_hidden: hidden });
    const back = obj(obj(await adapter.rawGet(`/api/v2/item_upload/items/${platformListingId}`)).item);
    const verified = typeof back.is_hidden === 'boolean' ? back.is_hidden === hidden : null;
    if (verified === false) throw new MarketplaceError('NOT_APPLIED', hidden ? 'Vinted montre toujours l’annonce' : 'Vinted cache toujours l’annonce');
    const now = Date.now();
    if (item && (item.status === 'LISTED' || item.status === 'HIDDEN')) {
      const to = hidden ? 'HIDDEN' : 'LISTED';
      await db.items.put({ ...item, status: to, updatedAt: now, meta: { ...item.meta, status: { p: verified ? 'OBSERVED' : 'USER_PROVIDED', at: now } } });
      await db.listings.where('inventoryItemId').equals(itemId).filter((l) => l.platformListingId === platformListingId).modify({ status: hidden ? 'HIDDEN' : 'ACTIVE' });
      await db.events.put({ id: uid('ev'), type: 'STATUS_CHANGED', at: now, inventoryItemId: itemId, listingId: null, data: { from: item.status, to }, provenance: verified ? 'OBSERVED' : 'USER_PROVIDED', isDemo: false });
    }
    await log({ kind: hidden ? 'HIDE' : 'UNHIDE', ok: true, target: title, detail: verified ? 'confirmé par Vinted' : 'envoyé ; Vinted ne dit pas l’état (non vérifié)' });
    return { ok: true, verified };
  } catch (e) {
    const { code, detail } = errorInfo(e);
    await log({ kind: hidden ? 'HIDE' : 'UNHIDE', ok: false, target: title, detail: `${code}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, code, detail: detail ?? undefined };
  }
}
