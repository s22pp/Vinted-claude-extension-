import { priceCents } from '@/data/adapters/vinted/parse';
import { DEFAULT_FAV_NO_OFFER, DEFAULT_FAV_OFFER } from './fav-messages';

/**
 * Automations on the seller's own account — decisions only (pure, tested). What is sent to Vinted, and
 * how, lives in the background runner. EXPERIMENTAL: the routes and fields come from production tools on
 * the same site and were never verified by ERA on this account; the journal shows what really happened.
 */

export type FavMode = 'MESSAGE' | 'MESSAGE_OFFER' | 'OFFER';

export interface AutoConfig {
  /** Master switch for the schedule. Manual runs ("Lancer maintenant") work with it off. */
  enabled: boolean;
  everyMinutes: number;
  /** Floor = known purchase cost + this margin. No floor without a known cost (UNKNOWN ≠ 0). */
  minMarginCents: number;
  fav: {
    enabled: boolean;
    mode: FavMode;
    /** Messages sent with an offer; several = one of them per member (see fav-messages.ts). */
    templates: string[];
    /** Used when no offer can be made (cost unknown, floor reaches the price): never a message promising one. */
    templatesNoOffer: string[];
    /** % off the listed price for the offer sent to a new favourite. */
    discountPct: number;
    /** Several of your articles favourited by one member: one message proposing the bundle (off = one each). */
    bundle: boolean;
    /** % off the bundle's total, never under the sum of the floors. */
    bundlePct: number;
    /** A favourite this recent is left alone (the buyer may still be browsing). */
    minDelayMin: number;
    perDay: number;
  };
  offers: {
    enabled: boolean;
    /** Offer ≥ this % of the price (and ≥ floor): accepted. */
    acceptPct: number;
    /** Offer < this % of the price: declined. */
    rejectBelowPct: number;
    /** In between: one counter-offer at this % of the price (never below the floor). */
    counterPct: number;
    /** Sent after an acceptance (empty = no message). */
    acceptMessage: string;
  };
}

export const DEFAULT_AUTO: AutoConfig = {
  enabled: false,
  everyMinutes: 30,
  minMarginCents: 300,
  fav: {
    enabled: false,
    mode: 'MESSAGE_OFFER',
    templates: DEFAULT_FAV_OFFER,
    templatesNoOffer: DEFAULT_FAV_NO_OFFER,
    discountPct: 10,
    bundle: true,
    bundlePct: 15,
    minDelayMin: 15,
    perDay: 15,
  },
  offers: {
    enabled: false,
    acceptPct: 90,
    rejectBelowPct: 60,
    counterPct: 92,
    acceptMessage: 'Merci ! Offre acceptée, j’envoie dès le paiement reçu.',
  },
};

/** The single messages of versions ≤ 0.16, as they shipped (replaced by the new defaults when never edited). */
const OLD_DEFAULTS = [
  'Bonjour {pseudo} ! Merci pour le favori sur « {titre} ». Je peux vous le faire à {prix_offre} au lieu de {prix} : l’offre est dans la conversation.',
  'Bonjour {pseudo} ! Merci pour le favori sur « {titre} ». Une question sur l’article ? Je réponds vite.',
];
type StoredFav = Partial<AutoConfig['fav']> & { template?: string; templateNoOffer?: string };

/** Stored config merged over the defaults: a new field never arrives undefined; an edited old message is kept. */
export function withDefaults(c: (Partial<Omit<AutoConfig, 'fav'>> & { fav?: StoredFav }) | null | undefined): AutoConfig {
  const f = c?.fav ?? {};
  const legacy = (one: string | undefined, fallback: string[]) => (one && !OLD_DEFAULTS.includes(one) ? [one] : fallback);
  const { template, templateNoOffer, ...rest } = f;
  const fav: AutoConfig['fav'] = {
    ...DEFAULT_AUTO.fav,
    ...rest,
    templates: f.templates?.length ? f.templates : legacy(template, DEFAULT_FAV_OFFER),
    templatesNoOffer: f.templatesNoOffer?.length ? f.templatesNoOffer : legacy(templateNoOffer, DEFAULT_FAV_NO_OFFER),
  };
  return { ...DEFAULT_AUTO, ...c, fav, offers: { ...DEFAULT_AUTO.offers, ...c?.offers } };
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const id = (x: unknown): string | null => (typeof x === 'number' && Number.isFinite(x) ? String(x) : typeof x === 'string' && /^\d+$/.test(x) ? x : null);

/** Whole euro, rounded up: an automatic price never lands on odd cents. */
export const ceilEuro = (cents: number) => Math.ceil(cents / 100) * 100;

export function floorFor(costCents: number | null, cfg: Pick<AutoConfig, 'minMarginCents'>): number | null {
  return costCents === null ? null : costCents + cfg.minMarginCents;
}

/* ── New favourites ─────────────────────────────────────── */

export interface FavoriteNotice {
  /** Stable per (member, item): processed once. */
  key: string;
  userId: string;
  itemId: string;
  at: number;
}

/** `entry_type` 20 = someone added one of your items to favourites (as read by a production tool). */
export function parseFavoriteNotifications(json: unknown): FavoriteNotice[] {
  const list = isObj(json) && Array.isArray(json.notifications) ? json.notifications.filter(isObj) : [];
  const out: FavoriteNotice[] = [];
  for (const n of list) {
    if (n.entry_type !== 20) continue;
    const userId = typeof n.link === 'string' ? (/=(\d+)/.exec(n.link)?.[1] ?? null) : null;
    const itemId = id(n.subject_id);
    const at = typeof n.updated_at === 'string' ? Date.parse(n.updated_at) : Number.NaN;
    if (!userId || !itemId || Number.isNaN(at)) continue;
    out.push({ key: `${userId}:${itemId}`, userId, itemId, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface FavItem {
  title: string;
  priceCents: number;
  costCents: number | null;
  /** Known brand (for "la veste Ralph Lauren" in messages), null when unknown. */
  brand?: string | null;
}

export type FavPlan =
  | { send: true; message: boolean; offerCents: number | null; note: string | null }
  | { send: false; reason: 'SEEN' | 'TOO_RECENT' | 'TOO_OLD' | 'DAY_CAP'; final: boolean };

export function planFavorite(n: FavoriteNotice, item: FavItem | null, cfg: AutoConfig, ctx: { seen: ReadonlySet<string>; sentToday: number; now: number }): FavPlan {
  if (ctx.seen.has(n.key)) return { send: false, reason: 'SEEN', final: true };
  if (ctx.now - n.at < cfg.fav.minDelayMin * 60_000) return { send: false, reason: 'TOO_RECENT', final: false };
  // A favourite from days ago is no longer a warm lead: skipped for good, not messaged late.
  if (ctx.now - n.at > 3 * 86_400_000) return { send: false, reason: 'TOO_OLD', final: true };
  if (ctx.sentToday >= cfg.fav.perDay) return { send: false, reason: 'DAY_CAP', final: false };
  const message = cfg.fav.mode !== 'OFFER';
  if (cfg.fav.mode === 'MESSAGE') return { send: true, message, offerCents: null, note: null };
  const offer = favoriteOffer(item, cfg);
  return { send: true, message, offerCents: offer.cents, note: offer.note };
}

/** The offer for a new favourite: the discount, never under the floor; none when the floor is unknown. */
export function favoriteOffer(item: FavItem | null, cfg: AutoConfig): { cents: number | null; note: string | null } {
  if (!item) return { cents: null, note: 'article inconnu d’ERA : pas d’offre' };
  const floor = floorFor(item.costCents, cfg);
  if (floor === null) return { cents: null, note: 'coût d’achat inconnu : pas d’offre sous un plancher inconnu' };
  const target = Math.max(ceilEuro(item.priceCents * (1 - cfg.fav.discountPct / 100)), ceilEuro(floor));
  if (target >= item.priceCents) return { cents: null, note: 'le plancher atteint le prix : pas d’offre' };
  return { cents: target, note: null };
}

/* ── Offers received ────────────────────────────────────── */

export interface PendingOffer {
  offerId: string;
  conversationId: string | null;
  transactionId: string | null;
  itemId: string | null;
  itemTitle: string;
  itemPriceCents: number;
  offerCents: number;
}

/** Pending buyer offers in the inbox (conversation → transaction.offer / offer), never the seller's own. */
export function parseInboxOffers(json: unknown, myUserId: string | null): PendingOffer[] {
  const list = isObj(json) ? ((Array.isArray(json.conversations) ? json.conversations : Array.isArray(json.items) ? json.items : []) as unknown[]).filter(isObj) : [];
  const out: PendingOffer[] = [];
  for (const c of list) {
    const tx = isObj(c.transaction) ? c.transaction : null;
    const offer = isObj(tx?.offer) ? tx!.offer : isObj(c.offer) ? c.offer : null;
    if (!offer || offer.status !== 'pending') continue;
    const author = id(offer.user_id ?? offer.from_user_id ?? offer.author_id ?? offer.by_user_id);
    if (author && myUserId && author === myUserId) continue;
    const item = isObj(c.item) ? c.item : null;
    const itemPrice = priceCents(tx?.item_price ?? item?.price);
    const offered = priceCents(offer.price ?? offer.amount);
    const offerId = id(offer.id);
    if (!offerId || itemPrice === null || offered === null || itemPrice <= 0 || offered <= 0) continue;
    out.push({
      offerId,
      conversationId: id(c.id),
      transactionId: id(tx?.id),
      itemId: id(tx?.item_id ?? item?.id),
      itemTitle: (typeof tx?.item_title === 'string' ? tx.item_title : typeof item?.title === 'string' ? item.title : null) ?? `annonce ${id(tx?.item_id ?? item?.id) ?? '?'}`,
      itemPriceCents: itemPrice,
      offerCents: offered,
    });
  }
  return out;
}

export type OfferDecision =
  | { action: 'ACCEPT'; reason: string }
  | { action: 'REJECT'; reason: string }
  | { action: 'COUNTER'; counterCents: number; reason: string }
  | { action: 'SKIP'; reason: string };

export function decideOffer(o: PendingOffer, floorCents: number | null, cfg: AutoConfig, alreadyCountered: boolean): OfferDecision {
  const pct = (o.offerCents / o.itemPriceCents) * 100;
  const pctTxt = `${Math.round(pct)} % du prix`;
  const counter = () => {
    const c = Math.min(o.itemPriceCents, Math.max(ceilEuro((o.itemPriceCents * cfg.offers.counterPct) / 100), floorCents === null ? 0 : ceilEuro(floorCents)));
    // Our counter would not be above their offer: their offer is already as good.
    if (c <= o.offerCents) return floorCents === null || o.offerCents >= floorCents ? ({ action: 'ACCEPT', reason: `${pctTxt}, au niveau de la contre-offre` } as const) : null;
    return { action: 'COUNTER', counterCents: c, reason: `${pctTxt} : contre-offre` } as const;
  };
  if (floorCents !== null && o.offerCents < floorCents) {
    if (alreadyCountered) return { action: 'SKIP', reason: 'sous le plancher, contre-offre déjà faite : à vous de voir' };
    return counter() ?? { action: 'SKIP', reason: 'sous le plancher' };
  }
  if (pct >= cfg.offers.acceptPct) return { action: 'ACCEPT', reason: `${pctTxt} ≥ ${cfg.offers.acceptPct} %` };
  if (pct < cfg.offers.rejectBelowPct) return { action: 'REJECT', reason: `${pctTxt} < ${cfg.offers.rejectBelowPct} %` };
  if (alreadyCountered) return { action: 'SKIP', reason: 'contre-offre déjà faite : à vous de voir' };
  return counter() ?? { action: 'SKIP', reason: 'aucune contre-offre utile' };
}

/* ── Messages ───────────────────────────────────────────── */

const eur = (cents: number | null) => (cents === null ? '' : `${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace('.', ',')} €`);

/**
 * {article} ("la veste Ralph Lauren") {titre} {pseudo} {prix} {prix_offre}; an empty variable leaves no dangling
 * space, and a sentence opened by a variable starts with a capital.
 */
export function fillTemplate(template: string, v: { pseudo: string | null; titre: string; article?: string; prix: number | null; prixOffre: number | null }): string {
  return template
    .replaceAll('{pseudo}', v.pseudo ?? '')
    .replaceAll('{article}', v.article ?? v.titre)
    .replaceAll('{titre}', v.titre)
    .replaceAll('{prix_offre}', eur(v.prixOffre))
    .replaceAll('{prix}', eur(v.prix))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/(\S)[ \t]*([!?])/g, '$1 $2')
    .replace(/^\s*[,.]\s*/, '')
    .replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    .trim();
}

/* ── Bundles ────────────────────────────────────────────── */

export interface BundlePlan {
  userId: string;
  notices: FavoriteNotice[];
  itemIds: string[];
  totalCents: number;
  /** null: a floor is unknown (a cost is missing) or the floors reach the total — no price is promised. */
  bundleCents: number | null;
}

/**
 * Members who favourited 2 articles or more (each one sendable now): one bundle each. The price is the total
 * minus `bundlePct`, never under the sum of the floors; unknown if any article's cost is unknown.
 */
export function planBundles(notices: readonly FavoriteNotice[], items: ReadonlyMap<string, FavItem>, cfg: AutoConfig, ctx: { seen: ReadonlySet<string>; sentToday: number; now: number }): BundlePlan[] {
  if (!cfg.fav.bundle || cfg.fav.mode === 'OFFER') return [];
  const byUser = new Map<string, FavoriteNotice[]>();
  for (const n of notices) {
    const p = planFavorite(n, items.get(n.itemId) ?? null, cfg, { ...ctx, sentToday: 0 });
    if (!p.send || !items.has(n.itemId)) continue;
    const list = byUser.get(n.userId) ?? [];
    if (!list.some((x) => x.itemId === n.itemId)) list.push(n);
    byUser.set(n.userId, list);
  }
  const out: BundlePlan[] = [];
  for (const [userId, list] of byUser) {
    if (list.length < 2) continue;
    const its = list.map((n) => items.get(n.itemId)!);
    const total = its.reduce((a, i) => a + i.priceCents, 0);
    const floors = its.map((i) => floorFor(i.costCents, cfg));
    const floor = floors.every((f): f is number => f !== null) ? floors.reduce((a, b) => a + b, 0) : null;
    const target = floor === null ? null : Math.max(ceilEuro(total * (1 - cfg.fav.bundlePct / 100)), ceilEuro(floor));
    out.push({ userId, notices: list, itemIds: list.map((n) => n.itemId), totalCents: total, bundleCents: target !== null && target < total ? target : null });
  }
  return out;
}

/** {articles} {n} {prix_lot} {prix_total}. */
export function fillBundle(template: string, v: { articles: string; n: number; lot: number | null; total: number }): string {
  return fillTemplate(template.replaceAll('{articles}', v.articles).replaceAll('{n}', String(v.n)).replaceAll('{prix_lot}', eur(v.lot)).replaceAll('{prix_total}', eur(v.total)), { pseudo: null, titre: '', prix: null, prixOffre: null });
}
