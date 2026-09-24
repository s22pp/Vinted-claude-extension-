import { repo } from '../../repo';
import { MarketplaceError } from '../marketplace';
import { reserve, reserveWrite } from './budget-store';
import { firstArray, priceCents } from './parse';
import type { EditFormResult, EraMessage, PriceEditResult, PriceStage } from './protocol';
import { VintedTabAdapter, ping, waitForLoad } from './vinted-adapter';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Change the price of ONE of the seller's own listings, from a single click in ERA (background worker):
 * open the edit page in a background tab → set only the price → save → read Vinted back to verify.
 * Never reports success without seeing the new price in Vinted's own data.
 */
export async function applyPriceOnVinted(platformListingId: string, cents: number, itemId: string, onStage: (s: PriceStage) => void): Promise<PriceEditResult> {
  if (!/^\d+$/.test(platformListingId)) throw new MarketplaceError('EDIT_FORM', 'annonce sans identifiant Vinted');
  await reserveWrite();
  const r = await reserve();
  if (!r.ok) throw new MarketplaceError(r.code);

  onStage('OPENING');
  const url = `https://www.vinted.fr/items/${platformListingId}/edit`;
  const tab = await browser.tabs.create({ url, active: false });
  const tabId = tab.id!;
  let keepOpen = false;
  try {
    await waitForLoad(tabId, 20_000);
    if (!(await ping(tabId))) {
      await browser.tabs.update(tabId, { url });
      await waitForLoad(tabId, 20_000);
    }
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await ping(tabId);
      if (!ready) await sleep(250);
    }
    if (!ready) throw new MarketplaceError('NO_VINTED_TAB', 'la page de modification n’a pas répondu');

    onStage('FILLING');
    const res = (await browser.tabs.sendMessage(tabId, { type: 'era:edit:form', cents } satisfies EraMessage)) as EditFormResult;
    if (!res.ok) throw new MarketplaceError('EDIT_FORM', res.detail);
    const before = priceCentsOrNull(res.before);

    onStage('SAVING');
    // Saving navigates away from /edit. Wait for it (or give up after ~15 s and verify anyway).
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const t = await browser.tabs.get(tabId).catch(() => null);
      if (!t?.url || !/\/edit(\b|$|\?)/.test(new URL(t.url).pathname)) break;
    }

    onStage('VERIFYING');
    const after = await readListingPrice(platformListingId);
    if (after !== cents) {
      keepOpen = true; // let the seller see what Vinted shows
      await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
      throw new MarketplaceError('NOT_APPLIED', after === null ? 'prix introuvable à la relecture' : `Vinted affiche toujours ${(after / 100).toFixed(2).replace('.', ',')} €`);
    }
    await repo.updatePrice(itemId, cents, Date.now(), 'OBSERVED');
    onStage('DONE');
    return { ok: true, before, after };
  } finally {
    if (!keepOpen) await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

function priceCentsOrNull(v: string): number | null {
  const n = Number.parseFloat(v.replace(/[^\d,.]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Verified read of one of MY listings: item_upload first, wardrobe (verified `price`) as fallback. */
async function readListingPrice(id: string): Promise<number | null> {
  const adapter = new VintedTabAdapter();
  try {
    const j = (await adapter.rawGet(`/api/v2/item_upload/items/${id}`)) as { item?: { price?: unknown } } | null;
    const p = priceCents(j?.item?.price);
    if (p !== null) return p;
  } catch {
    /* fall back to the wardrobe */
  }
  const uid = await adapter.userId();
  for (let page = 1; page <= 2; page++) {
    const items = firstArray(await adapter.rawGet(`/api/v2/wardrobe/${uid}/items?page=${page}&per_page=96`), ['items']);
    const hit = items.find((i) => String(i.id) === id);
    if (hit) return priceCents(hit.price);
    if (items.length < 96) break;
  }
  return null;
}
