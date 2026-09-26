import { type AutoConfig, type FavItem, decideOffer, fillTemplate, floorFor, parseFavoriteNotifications, parseInboxOffers, planFavorite, withDefaults } from '@/intelligence/automation';
import { DEFAULT_FAV_NO_OFFER, DEFAULT_FAV_OFFER, articleOf, cleanTitle, pickMessage } from '@/intelligence/fav-messages';
import { MarketplaceError, errorInfo } from './adapters/marketplace';
import { currentUserId, priceCents } from './adapters/vinted/parse';
import type { AutoRunResult } from './adapters/vinted/protocol';
import { VintedTabAdapter, findVintedTab, ping } from './adapters/vinted/vinted-adapter';
import { type AutoLogRow, db, uid } from './db';
import { repo } from './repo';
import { vintedWrite } from './vinted-write';

/**
 * Background-only. Runs ONE automation pass on the seller's own account: reads through the whitelisted GET
 * routes, writes through the whitelisted write routes only, one at a time (≥ 12 s apart, ≤ 40 a day), every
 * request still inside the read budget. Any block (403/429), logout or spent budget stops the pass at once.
 * Every action — or simulated action — is written to the journal. EXPERIMENTAL.
 */

const PER_RUN = 5;
const STOPPING = new Set(['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED', 'NO_VINTED_TAB']);

export async function loadAutoConfig(): Promise<AutoConfig> {
  return withDefaults(await repo.getSetting<Partial<AutoConfig> | null>('automations', null));
}

async function log(row: Omit<AutoLogRow, 'id' | 'at'>): Promise<void> {
  await db.autoLog.put({ id: uid('al'), at: Date.now(), ...row });
  const n = await db.autoLog.count();
  if (n > 600) await db.autoLog.orderBy('at').limit(n - 500).delete();
}

const write = (method: 'POST' | 'PUT', path: string, body: unknown) => vintedWrite(method, path, body);

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const idOf = (x: unknown): string | null => (typeof x === 'number' ? String(x) : typeof x === 'string' && /^\d+$/.test(x) ? x : null);
const eur = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** ERA's view of the seller's live listings, by Vinted id: title, price and known cost (for the floor). */
async function itemsByVintedId(): Promise<Map<string, FavItem>> {
  const listings = await db.listings.filter((l) => !l.isDemo && l.platformListingId !== null && (l.status === 'ACTIVE' || l.status === 'RESERVED' || l.status === 'HIDDEN')).toArray();
  const items = new Map((await db.items.bulkGet(listings.map((l) => l.inventoryItemId))).filter((i) => !!i).map((i) => [i!.id, i!]));
  return new Map(
    listings.map((l) => {
      const it = items.get(l.inventoryItemId);
      return [l.platformListingId!, { title: l.title, priceCents: l.priceCents, costCents: it?.purchasePriceCents ?? null, brand: it?.brand ?? null }];
    }),
  );
}

/** One of the seller's chosen messages for this favourite, filled in. */
function favText(cfg: AutoConfig, key: string, offerCents: number | null, v: { pseudo: string | null; title: string; brand: string | null; price: number | null }): string {
  const list = offerCents === null ? cfg.fav.templatesNoOffer : cfg.fav.templates;
  const tpl = pickMessage(list, key) ?? pickMessage(offerCents === null ? DEFAULT_FAV_NO_OFFER : DEFAULT_FAV_OFFER, key)!;
  return fillTemplate(tpl, { pseudo: v.pseudo, titre: cleanTitle(v.title), article: articleOf(v.title, v.brand), prix: v.price, prixOffre: offerCents });
}

function stopReason(e: unknown): string | null {
  const { code, detail } = errorInfo(e);
  return STOPPING.has(code) ? `${code}${detail ? ` · ${detail}` : ''}` : null;
}

/** Scheduled passes never open Vinted by themselves: they run only when a vinted.fr tab is already open. */
export async function vintedTabOpen(): Promise<boolean> {
  const tab = await findVintedTab();
  return tab !== null && (await ping(tab));
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Members contacted today by the favourites automation (the daily cap counts people, not requests). */
async function favToday(now: number): Promise<number> {
  const c = await repo.getSetting<{ day: string; n: number } | null>('autoFavDay', null);
  return c && c.day === day(now) ? c.n : 0;
}

export async function runFavorites(dryRun: boolean, now = Date.now()): Promise<AutoRunResult> {
  const cfg = await loadAutoConfig();
  const out: AutoRunResult = { ok: true, kind: 'FAV', dryRun, done: 0, skipped: 0, failed: 0, stopped: null };
  const adapter = new VintedTabAdapter();
  const seen = new Set(await repo.getSetting<string[]>('autoFavSeen', []));
  try {
    const notices = parseFavoriteNotifications(await adapter.rawGet('/web/api/notifications/notifications?page=1&per_page=50'));
    const items = await itemsByVintedId();
    let sentToday = await favToday(now);
    for (const n of notices) {
      if (out.done >= PER_RUN) break;
      const item = items.get(n.itemId) ?? null;
      const plan = planFavorite(n, item, cfg, { seen, sentToday, now });
      if (!plan.send) {
        if (plan.final && !dryRun) seen.add(n.key);
        if (plan.reason === 'DAY_CAP') {
          out.stopped = 'plafond du jour atteint';
          break;
        }
        out.skipped++;
        continue;
      }
      const target = `${item?.title ?? `annonce ${n.itemId}`} → membre ${n.userId}`;
      if (dryRun) {
        const text = favText(cfg, n.key, plan.offerCents, { pseudo: 'pseudo', title: item?.title ?? `annonce ${n.itemId}`, brand: item?.brand ?? null, price: item?.priceCents ?? null });
        await log({ kind: 'FAV_MESSAGE', dryRun, ok: true, target, detail: `${plan.message ? `message : « ${text} »` : 'pas de message'}${plan.offerCents !== null ? ` · offre ${eur(plan.offerCents)}` : plan.note ? ` · ${plan.note}` : ''}` });
        out.done++;
        continue;
      }
      try {
        const conv = obj(obj(await write('POST', '/api/v2/conversations', { initiator: 'seller_enters_notification', item_id: Number(n.itemId), opposite_user_id: Number(n.userId) })).conversation);
        const convId = idOf(conv.id);
        if (!convId) throw new MarketplaceError('UNAVAILABLE', 'conversation sans identifiant');
        const detail = obj(obj(await adapter.rawGet(`/api/v2/conversations/${convId}`)).conversation);
        // Already talking with this member: nothing automatic on top of a real conversation.
        if (Array.isArray(detail.messages) && detail.messages.length > 0) {
          seen.add(n.key);
          out.skipped++;
          await log({ kind: 'SKIP', dryRun, ok: true, target, detail: 'conversation déjà engagée : rien envoyé' });
          continue;
        }
        const tx = obj(detail.transaction);
        const login = typeof obj(detail.opposite_user).login === 'string' ? (obj(detail.opposite_user).login as string) : null;
        const title = item?.title ?? (typeof tx.item_title === 'string' ? tx.item_title : `annonce ${n.itemId}`);
        const price = item?.priceCents ?? priceCents(tx.offer_price);
        if (plan.message) {
          const text = favText(cfg, n.key, plan.offerCents, { pseudo: login, title, brand: item?.brand ?? null, price });
          await write('POST', `/api/v2/conversations/${convId}/replies`, { reply: { body: text, photo_temp_uuids: null, is_personal_data_sharing_check_skipped: false } });
          await log({ kind: 'FAV_MESSAGE', dryRun, ok: true, target, detail: `« ${text} »` });
        }
        const txId = idOf(tx.id);
        if (plan.offerCents !== null && txId) {
          await write('POST', `/api/v2/transactions/${txId}/offers`, { offer: { price: (plan.offerCents / 100).toFixed(2), currency: 'EUR' } });
          await log({ kind: 'FAV_OFFER', dryRun, ok: true, target, detail: `offre ${eur(plan.offerCents)}${price !== null ? ` au lieu de ${eur(price)}` : ''}` });
        } else if (plan.note) {
          await log({ kind: 'SKIP', dryRun, ok: true, target, detail: plan.note });
        }
        seen.add(n.key);
        sentToday++;
        await repo.setSetting('autoFavDay', { day: day(now), n: sentToday });
        out.done++;
      } catch (e) {
        out.failed++;
        const { code, detail } = errorInfo(e);
        await log({ kind: 'FAV_MESSAGE', dryRun, ok: false, target, detail: `${code}${detail ? ` · ${detail}` : ''}` });
        const stop = stopReason(e);
        if (stop) {
          out.stopped = stop;
          break;
        }
      }
    }
  } catch (e) {
    out.ok = false;
    out.stopped = stopReason(e) ?? `${errorInfo(e).code} · ${errorInfo(e).detail ?? ''}`;
  }
  if (!dryRun) await repo.setSetting('autoFavSeen', [...seen].slice(-1000));
  await log({ kind: out.stopped && !out.ok ? 'STOP' : 'RUN', dryRun, ok: out.ok, target: 'Favoris → message / offre', detail: summary(out) });
  return out;
}

type OfferState = Record<string, { countered?: boolean; logged?: boolean; at: number }>;

export async function runOffers(dryRun: boolean, now = Date.now()): Promise<AutoRunResult> {
  const cfg = await loadAutoConfig();
  const out: AutoRunResult = { ok: true, kind: 'OFFERS', dryRun, done: 0, skipped: 0, failed: 0, stopped: null };
  const adapter = new VintedTabAdapter();
  const state = await repo.getSetting<OfferState>('autoOfferState', {});
  try {
    const me = currentUserId(await adapter.rawGet('/api/v2/users/current'));
    const offers = parseInboxOffers(await adapter.rawGet('/api/v2/inbox?page=1&per_page=20'), me);
    const items = await itemsByVintedId();
    for (const o of offers) {
      if (out.done >= PER_RUN) break;
      const item = o.itemId ? (items.get(o.itemId) ?? null) : null;
      const floor = floorFor(item?.costCents ?? null, cfg);
      const d = decideOffer(o, floor, cfg, !!state[o.offerId]?.countered);
      const target = `${o.itemTitle} · offre ${eur(o.offerCents)} sur ${eur(o.itemPriceCents)}`;
      if (d.action === 'SKIP') {
        out.skipped++;
        // Logged once per offer, not at every pass.
        if (!state[o.offerId]?.logged) {
          await log({ kind: 'SKIP', dryRun, ok: true, target, detail: d.reason });
          if (!dryRun) state[o.offerId] = { ...state[o.offerId], logged: true, at: now };
        }
        continue;
      }
      const kind = d.action === 'ACCEPT' ? 'OFFER_ACCEPT' : d.action === 'REJECT' ? 'OFFER_REJECT' : 'OFFER_COUNTER';
      const what = d.action === 'COUNTER' ? `contre-offre ${eur(d.counterCents)} — ${d.reason}` : d.reason;
      const floorTxt = floor === null ? ' · plancher inconnu (coût non renseigné)' : ` · plancher ${eur(floor)}`;
      if (dryRun) {
        await log({ kind, dryRun, ok: true, target, detail: `${what}${floorTxt}` });
        out.done++;
        continue;
      }
      try {
        if (d.action === 'COUNTER') {
          if (!o.transactionId) throw new MarketplaceError('UNAVAILABLE', 'transaction inconnue : contre-offre impossible');
          await write('POST', `/api/v2/transactions/${o.transactionId}/offers`, { offer: { price: (d.counterCents / 100).toFixed(2), currency: 'EUR' } });
          state[o.offerId] = { ...state[o.offerId], countered: true, at: now };
        } else {
          await answerOffer(o.offerId, o.transactionId, d.action === 'ACCEPT' ? 'accept' : 'reject');
          if (d.action === 'ACCEPT' && cfg.offers.acceptMessage.trim() && o.conversationId)
            await write('POST', `/api/v2/conversations/${o.conversationId}/replies`, { reply: { body: cfg.offers.acceptMessage.trim(), photo_temp_uuids: null, is_personal_data_sharing_check_skipped: false } });
          state[o.offerId] = { ...state[o.offerId], logged: true, at: now };
        }
        await log({ kind, dryRun, ok: true, target, detail: `${what}${floorTxt}` });
        out.done++;
      } catch (e) {
        out.failed++;
        const { code, detail } = errorInfo(e);
        await log({ kind, dryRun, ok: false, target, detail: `${code}${detail ? ` · ${detail}` : ''}` });
        const stop = stopReason(e);
        if (stop) {
          out.stopped = stop;
          break;
        }
      }
    }
  } catch (e) {
    out.ok = false;
    out.stopped = stopReason(e) ?? `${errorInfo(e).code} · ${errorInfo(e).detail ?? ''}`;
  }
  if (!dryRun) {
    // Old entries forgotten after 30 days.
    for (const [k, v] of Object.entries(state)) if (now - v.at > 30 * 86_400_000) delete state[k];
    await repo.setSetting('autoOfferState', state);
  }
  await log({ kind: out.stopped && !out.ok ? 'STOP' : 'RUN', dryRun, ok: out.ok, target: 'Offres reçues', detail: summary(out) });
  return out;
}

/** Two routes seen in production tools: the transaction's offer request first, the offer itself if that one is absent. */
async function answerOffer(offerId: string, transactionId: string | null, verb: 'accept' | 'reject'): Promise<void> {
  if (transactionId) {
    try {
      await write('PUT', `/api/v2/transactions/${transactionId}/offer_requests/${offerId}/${verb}`, {});
      return;
    } catch (e) {
      // Only "route not found" falls back; a block or a logout stops everything.
      if (errorInfo(e).code !== 'UNAVAILABLE') throw e;
    }
  }
  await write('POST', `/api/v2/offers/${offerId}/${verb}`, {});
}

function summary(r: AutoRunResult): string {
  return `${r.dryRun ? 'simulation · ' : ''}${r.done} ${r.dryRun ? 'prévues' : 'faites'} · ${r.skipped} ignorées · ${r.failed} échecs${r.stopped ? ` · arrêt : ${r.stopped}` : ''}`;
}
