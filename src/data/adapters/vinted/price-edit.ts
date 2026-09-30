import { repo } from '../../repo';
import { MarketplaceError, errorInfo } from '../marketplace';
import { reserve, reserveWrite } from './budget-store';
import { firstArray, priceCents } from './parse';
import type { DescEditResult, EditFormResult, EditTextResult, EraMessage, PriceEditResult, PriceStage, TextEditResult } from './protocol';
import { type TextField, type TextOp, sameFieldText, textOpProblem } from '@/intelligence/text-edit';
import { readCents, sameText } from './edit-form';
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
    const before = readCents(res.before);

    onStage('SAVING');
    await leftEditPage(tabId);

    onStage('VERIFYING');
    const after = await readListingPrice(platformListingId);
    if (after !== cents) {
      keepOpen = true; // let the seller see what Vinted shows
      await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
      throw new MarketplaceError('NOT_APPLIED', after === null ? 'prix introuvable à la relecture' : `Vinted affiche toujours ${eurText(after, 2)}`);
    }
    // Vinted shows the new price: done, whatever happens to ERA's own copy (the next import aligns it).
    const local = await repo.updatePrice(itemId, cents, Date.now(), 'OBSERVED').then(
      () => '',
      () => ' · copie locale non mise à jour (le prochain import l’alignera)',
    );
    await journal('PRICE', true, platformListingId, `${before !== null ? `${eurText(before, 2)} → ` : ''}${eurText(after, 2)}, relu sur Vinted${local}`);
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
export async function applyDescriptionOnVinted(platformListingId: string, text: string, expectBefore?: string): Promise<DescEditResult> {
  if (!/^\d+$/.test(platformListingId)) throw new MarketplaceError('EDIT_FORM', 'annonce sans identifiant Vinted');
  if (!text.trim() || text.includes('__')) throw new MarketplaceError('EDIT_FORM', 'description vide ou avec des « __ » à remplir : rien envoyé');
  await reserveWrite();
  const r = await reserve('WRITE');
  if (!r.ok) throw new MarketplaceError(r.code);
  let tabId: number;
  try {
    tabId = await openEditTab(platformListingId);
  } catch (e) {
    await journal('DESCRIPTION', false, platformListingId, failText(e));
    throw e;
  }
  let keepOpen = false;
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'era:edit:desc', text, ...(expectBefore !== undefined ? { expectBefore } : {}) } satisfies EraMessage)) as EditFormResult;
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

/**
 * Title or description of ONE of the seller's own listings changed by an operation (prefix, suffix, replacement),
 * from one click (EXPERIMENTAL): the operation is applied to what Vinted's edit page holds, never to ERA's copy; the
 * result is saved, then read back on Vinted. Already there: nothing saved, said so. Never several listings from one
 * click: series are walked one listing per click, within the write limits (15 per session, 20 s apart).
 */
export async function applyTextOnVinted(platformListingId: string, field: TextField, op: TextOp): Promise<TextEditResult> {
  if (!/^\d+$/.test(platformListingId)) throw new MarketplaceError('EDIT_FORM', 'annonce sans identifiant Vinted');
  const problem = textOpProblem(field, op);
  if (problem) throw new MarketplaceError('EDIT_FORM', `${problem} : rien envoyé`);
  const kind = field === 'title' ? 'TITLE' : 'DESCRIPTION';
  await reserveWrite();
  const r = await reserve('WRITE');
  if (!r.ok) throw new MarketplaceError(r.code);
  let tabId: number;
  try {
    tabId = await openEditTab(platformListingId);
  } catch (e) {
    await journal(kind, false, platformListingId, failText(e));
    throw e;
  }
  let keepOpen = false;
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'era:edit:text', field, op } satisfies EraMessage)) as EditTextResult;
    if (!res.ok) throw new MarketplaceError('EDIT_FORM', res.detail);
    // Already there on Vinted: nothing written, nothing saved (the page is closed unsaved).
    if (res.after === null) return { ok: true, changed: false, before: res.before, after: res.before };
    const after = res.after;
    await leftEditPage(tabId);
    const shown = field === 'title' ? await readListingTitle(platformListingId) : await readListingDescription(platformListingId);
    if (shown === null || !sameFieldText(field, shown, after)) {
      keepOpen = true; // let the seller see what Vinted shows
      await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
      const what = field === 'title' ? 'titre' : 'description';
      throw new MarketplaceError('NOT_APPLIED', shown === null ? `${what} introuvable à la relecture` : `Vinted affiche toujours ${field === 'title' ? 'l’ancien titre' : 'l’ancienne description'}`);
    }
    // Vinted shows it: ERA's copy follows (the next import would align it anyway).
    await db.listings
      .filter((l) => l.platformListingId === platformListingId)
      .modify(field === 'title' ? { title: shown } : { description: shown })
      .catch(() => undefined);
    const detail = field === 'title' ? `titre « ${shown} », relu sur Vinted (avant : « ${res.before.trim()} »)` : `description modifiée (${shown.length} caractères), relue sur Vinted`;
    await journal(kind, true, platformListingId, detail);
    return { ok: true, changed: true, before: res.before, after: shown };
  } catch (e) {
    await journal(kind, false, platformListingId, failText(e));
    throw e;
  } finally {
    if (!keepOpen) await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

/** Verified read of one of MY listings' title (item_upload, `.item.title`). */
async function readListingTitle(id: string): Promise<string | null> {
  const j = (await new VintedTabAdapter().rawGet(`/api/v2/item_upload/items/${id}`)) as { item?: { title?: unknown } } | null;
  return typeof j?.item?.title === 'string' ? j.item.title : null;
}

/** What Vinted (or the page) answered, as every journal line says it: code, then detail. */
function failText(e: unknown): string {
  const { code, detail } = errorInfo(e);
  return `${code}${detail ? ` · ${detail}` : ''}`;
}

/** Every price or description sent is written in the local journal (what was done, or why not), like the other writes. */
function journal(kind: 'PRICE' | 'DESCRIPTION' | 'TITLE', ok: boolean, listingId: string, detail: string) {
  return writeJournal({ kind, dryRun: false, ok, target: `annonce ${listingId}`, detail }).catch(() => undefined);
}

/** Verified read of one of MY listings' description (item_upload, `.item.description`). */
async function readListingDescription(id: string): Promise<string | null> {
  const j = (await new VintedTabAdapter().rawGet(`/api/v2/item_upload/items/${id}`)) as { item?: { description?: unknown } } | null;
  return typeof j?.item?.description === 'string' ? j.item.description : null;
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
