import { repo } from '../../repo';
import { MarketplaceError, errorInfo } from '../marketplace';
import { reserve, reserveWrite } from './budget-store';
import { firstArray, priceCents } from './parse';
import type { DescEditResult, EditFormResult, EraMessage, PriceEditResult, PriceStage } from './protocol';
import { sameText } from './edit-form';
import { db } from '../../db';
import { journal as writeJournal } from '../../journal';
import { VintedTabAdapter, ping, waitForLoad } from './vinted-adapter';
import { eurText } from '@/domain/money';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Change the price of ONE of the seller's own listings, from a single click in ERA (background worker):
 * open the edit page in a background tab → set only the price → save → read Vinted back to verify.
 * Never reports success without seeing the new price in Vinted's own data.
 */
export async function applyPriceOnVinted(platformListingId: string, cents: number, itemId: string, onStage: (s: PriceStage) => void): Promise<PriceEditResult> {
  if (!/^\d+$/.test(platformListingId)) throw new MarketplaceError('EDIT_FORM', 'annonce sans identifiant Vinted');
  await reserveWrite();
  const r = await reserve('WRITE');
  if (!r.ok) throw new MarketplaceError(r.code);

  onStage('OPENING');
  let tabId: number;
  try {
    tabId = await openEditTab(platformListingId);
  } catch (e) {
    await journal('PRICE', false, platformListingId, failText(e));
    throw e;
  }
  let keepOpen = false;
  try {
    onStage('FILLING');
    const res = (await browser.tabs.sendMessage(tabId, { type: 'era:edit:form', cents } satisfies EraMessage)) as EditFormResult;
    if (!res.ok) throw new MarketplaceError('EDIT_FORM', res.detail);
    const before = priceCentsOrNull(res.before);

    onStage('SAVING');
    await leftEditPage(tabId);

    onStage('VERIFYING');
    const after = await readListingPrice(platformListingId);
    if (after !== cents) {
      keepOpen = true; // let the seller see what Vinted shows
      await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
      throw new MarketplaceError('NOT_APPLIED', after === null ? 'prix introuvable à la relecture' : `Vinted affiche toujours ${eurText(after, 2)}`);
    }
    await repo.updatePrice(itemId, cents, Date.now(), 'OBSERVED');
    await journal('PRICE', true, platformListingId, `${before !== null ? `${eurText(before, 2)} → ` : ''}${eurText(after, 2)}, relu sur Vinted`);
    onStage('DONE');
    return { ok: true, before, after };
  } catch (e) {
    await journal('PRICE', false, platformListingId, failText(e));
    throw e;
  } finally {
    if (!keepOpen) await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

/** The edit page of one of the seller's listings, in a background tab, with ERA's content script answering. */
async function openEditTab(platformListingId: string): Promise<number> {
  const url = `https://www.vinted.fr/items/${platformListingId}/edit`;
  const tabId = (await browser.tabs.create({ url, active: false })).id!;
  await waitForLoad(tabId, 20_000);
  if (!(await ping(tabId))) {
    await browser.tabs.update(tabId, { url });
    await waitForLoad(tabId, 20_000);
  }
  for (let i = 0; i < 40; i++) {
    if (await ping(tabId)) return tabId;
    await sleep(250);
  }
  await browser.tabs.remove(tabId).catch(() => undefined);
  throw new MarketplaceError('NO_VINTED_TAB', 'la page de modification n’a pas répondu');
}

/** Saving navigates away from /edit. Wait for it (or give up after ~15 s and verify anyway). */
async function leftEditPage(tabId: number): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const t = await browser.tabs.get(tabId).catch(() => null);
    if (!t?.url || !/\/edit(\b|$|\?)/.test(new URL(t.url).pathname)) return;
  }
}

/**
 * Replace the description of ONE of the seller's own listings, from a single click (EXPERIMENTAL): same path as
 * the price — the edit page in a background tab, only the description field written, saved, then Vinted read back.
 * A text with blanks left ("__") never leaves ERA; success is said only once Vinted shows the new text.
 */
export async function applyDescriptionOnVinted(platformListingId: string, text: string): Promise<DescEditResult> {
  if (!/^\d+$/.test(platformListingId)) throw new MarketplaceError('EDIT_FORM', 'annonce sans identifiant Vinted');
  if (!text.trim() || text.includes('__')) throw new MarketplaceError('EDIT_FORM', 'description vide ou avec des « __ » à remplir : rien envoyé');
  await reserveWrite();
  const r = await reserve('WRITE');
  if (!r.ok) throw new MarketplaceError(r.code);
  const tabId = await openEditTab(platformListingId);
  let keepOpen = false;
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'era:edit:desc', text } satisfies EraMessage)) as EditFormResult;
    if (!res.ok) throw new MarketplaceError('EDIT_FORM', res.detail);
    await leftEditPage(tabId);
    const after = await readListingDescription(platformListingId);
    if (after === null || !sameText(after, text)) {
      keepOpen = true; // let the seller see what Vinted shows
      await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
      throw new MarketplaceError('NOT_APPLIED', after === null ? 'description introuvable à la relecture' : 'Vinted affiche toujours l’ancienne description');
    }
    await db.listings.filter((l) => l.platformListingId === platformListingId).modify({ description: after });
    await journal('DESCRIPTION', true, platformListingId, `description remplacée (${after.length} caractères), relue sur Vinted`);
    return { ok: true };
  } catch (e) {
    await journal('DESCRIPTION', false, platformListingId, failText(e));
    throw e;
  } finally {
    if (!keepOpen) await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

/** What Vinted (or the page) answered, as every journal line says it: code, then detail. */
function failText(e: unknown): string {
  const { code, detail } = errorInfo(e);
  return `${code}${detail ? ` · ${detail}` : ''}`;
}

/** Every price or description sent is written in the local journal (what was done, or why not), like the other writes. */
function journal(kind: 'PRICE' | 'DESCRIPTION', ok: boolean, listingId: string, detail: string) {
  return writeJournal({ kind, dryRun: false, ok, target: `annonce ${listingId}`, detail }).catch(() => undefined);
}

/** Verified read of one of MY listings' description (item_upload, `.item.description`). */
async function readListingDescription(id: string): Promise<string | null> {
  const j = (await new VintedTabAdapter().rawGet(`/api/v2/item_upload/items/${id}`)) as { item?: { description?: unknown } } | null;
  return typeof j?.item?.description === 'string' ? j.item.description : null;
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
