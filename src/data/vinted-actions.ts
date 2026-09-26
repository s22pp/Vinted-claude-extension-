import { labelFileName } from '@/intelligence/shipping';
import { MarketplaceError, type MarketplaceErrorCode, errorInfo } from './adapters/marketplace';
import type { HideResult, LabelBatchResult, LabelResult } from './adapters/vinted/protocol';
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
export async function getShippingLabel(conversationId: string, title: string, soldAt: number): Promise<LabelResult> {
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
    // The PDF Vinted issued, saved as a file (the browser downloads it: no other site to allow).
    const saved = await saveFile(url, labelFileName(title, soldAt));
    await log({
      kind: 'LABEL',
      ok: true,
      target: title,
      detail: `${ordered ? 'bordereau commandé puis récupéré' : 'bordereau déjà prêt, récupéré'} · ${saved.ok ? `enregistré : ${saved.file}` : `PDF non enregistré (${saved.detail})`} · hôte ${new URL(url).host}`,
    });
    return { ok: true, url, ordered, file: saved.ok ? saved.file : null, saveError: saved.ok ? undefined : saved.detail };
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

type Saved = { ok: true; file: string } | { ok: false; detail: string };

/** Download one file into the browser's downloads folder and wait (≤ 20 s) to know whether it was saved. */
export async function saveFile(url: string, filename: string, timeoutMs = 20_000): Promise<Saved> {
  let id: number;
  try {
    id = await browser.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  return new Promise<Saved>((resolve) => {
    let over = false;
    const finish = (r: Saved) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      browser.downloads.onChanged.removeListener(onChanged);
      resolve(r);
    };
    const check = async () => {
      const [d] = await browser.downloads.search({ id });
      if (d?.state === 'complete') finish({ ok: true, file: d.filename.split(/[\\/]/).slice(-2).join('/') });
      else if (d?.state === 'interrupted') finish({ ok: false, detail: `téléchargement interrompu (${d.error ?? 'inconnu'})` });
    };
    const onChanged = (delta: { id: number; state?: unknown }) => {
      if (delta.id === id && delta.state) void check();
    };
    browser.downloads.onChanged.addListener(onChanged);
    const timer = setTimeout(() => finish({ ok: false, detail: 'toujours en cours de téléchargement' }), timeoutMs);
    void check();
  });
}

/** Errors after which the next orders are not even tried (the account must rest, or the seller act). */
const HALT: ReadonlySet<MarketplaceErrorCode> = new Set(['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED', 'NO_VINTED_TAB']);

/** The label of every order Vinted says waits for the seller, one after the other, each saved as a PDF. */
export async function getAllLabels(): Promise<LabelBatchResult> {
  const sales = (await db.sales.filter((s) => !s.isDemo && s.needsAction === true && s.status !== 'REFUNDED' && !!s.vintedConversationId).toArray()).sort((a, b) => a.soldAt - b.soldAt);
  const results: LabelBatchResult['results'] = [];
  for (const [i, s] of sales.entries()) {
    const title = (await db.items.get(s.inventoryItemId))?.title ?? 'commande';
    const r = await getShippingLabel(s.vintedConversationId!, title, s.soldAt);
    results.push({ saleId: s.id, title, ...r });
    if (!r.ok && HALT.has(r.code)) return { results, stopped: r.detail ?? r.code, left: sales.length - i - 1 };
  }
  return { results, stopped: null, left: 0 };
}
