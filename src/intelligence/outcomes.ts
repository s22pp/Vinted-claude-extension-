/**
 * What makes buyers answer and buy. Every contact ERA makes for the seller — a message to a member who favourited, an
 * offer, an answer to an offer, the delivered-parcel message, a reply — is kept with what followed: an answer from the
 * buyer (read in Vinted's inbox: EXPERIMENTAL), a sale of the article within 14 days (from the sales ERA imported).
 * Reposts are measured from the listings ERA holds. Pure: the outcome rules and the tables. A rate on fewer than
 * MIN_SAMPLE settled contacts is never given: a count is not a conclusion.
 */

export type ContactKind = 'FAV_MESSAGE' | 'FAV_OFFER' | 'FAV_BUNDLE' | 'OFFER_ACCEPT' | 'OFFER_COUNTER' | 'OFFER_REJECT' | 'DELIVERED' | 'REPLY';

export interface ContactRow {
  id: string;
  at: number;
  kind: ContactKind;
  conversationId: string | null;
  /** ERA's article (inventory id), when known: a sale of it after the contact is the contact's outcome. */
  itemId: string | null;
  title: string;
  /** The wording used — the seller's template before it was filled — to compare messages with each other. */
  variant: string | null;
  askCents: number | null;
  /** The buyer's offer (an answer to an offer) or ERA's (an offer sent). */
  offerCents: number | null;
  /** From what triggered the contact (the favourite, the offer, the delivery) to the contact; null when unknown. */
  delayMs: number | null;
  repliedAt: number | null;
  soldAt: number | null;
  soldCents: number | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A sale of the article this long after the contact is counted as its outcome. */
export const SOLD_WINDOW_MS = 14 * DAY;
/** A contact without an answer after this long is settled as "no answer". */
export const REPLY_WINDOW_MS = 2 * DAY;
/** Below this many settled contacts, no rate: a count only. */
export const MIN_SAMPLE = 5;

/** The first sale of the contact's article after it, within the window. */
export function saleAfter(c: Pick<ContactRow, 'itemId' | 'at'>, sales: readonly { inventoryItemId: string; soldAt: number; salePriceCents: number }[]): { soldAt: number; cents: number } | null {
  if (!c.itemId) return null;
  const s = sales.filter((x) => x.inventoryItemId === c.itemId && x.soldAt >= c.at - 60_000 && x.soldAt <= c.at + SOLD_WINDOW_MS).sort((a, b) => a.soldAt - b.soldAt)[0];
  return s ? { soldAt: s.soldAt, cents: s.salePriceCents } : null;
}

export interface InboxActivity {
  updatedAt: number | null;
  /** The last message is the other member's (true), the seller's (false), unknown (null). */
  fromOther: boolean | null;
  unread: boolean | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const idOf = (x: unknown) => (typeof x === 'number' || (typeof x === 'string' && x !== '') ? String(x) : null);
const timeOf = (x: unknown): number | null => {
  if (typeof x === 'number' && Number.isFinite(x)) return x < 1e12 ? x * 1000 : x;
  if (typeof x === 'string') {
    const t = Date.parse(x);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

/** The inbox's conversations, as Vinted lists them (fields UNVERIFIED on the seller's account): last activity, by whom. */
export function inboxActivity(json: unknown, me: string | null): Map<string, InboxActivity> {
  const list = isObj(json) ? ((Array.isArray(json.conversations) ? json.conversations : Array.isArray(json.items) ? json.items : []) as unknown[]).filter(isObj) : [];
  const out = new Map<string, InboxActivity>();
  for (const c of list) {
    const id = idOf(c.id);
    if (!id) continue;
    const last = isObj(c.last_message) ? c.last_message : null;
    const author = idOf(last?.user_id ?? last?.sender_id ?? c.last_message_user_id);
    const unread = typeof c.is_unread === 'boolean' ? c.is_unread : typeof c.unread === 'boolean' ? c.unread : null;
    out.set(id, { updatedAt: timeOf(c.updated_at ?? last?.created_at ?? c.last_message_at), fromOther: author && me ? author !== me : null, unread });
  }
  return out;
}

/** The buyer answered after the contact: a later message of theirs, or (author unknown) an unread conversation since. */
export function repliedIn(c: Pick<ContactRow, 'conversationId' | 'at'>, inbox: ReadonlyMap<string, InboxActivity>): boolean {
  const a = c.conversationId ? inbox.get(c.conversationId) : undefined;
  if (!a || a.updatedAt === null || a.updatedAt <= c.at + 60_000) return false;
  return a.fromOther === true || (a.fromOther === null && a.unread === true);
}

export interface Rate {
  /** Contacts in the group. */
  n: number;
  /** Settled for the answer (answered, or old enough) and answered; same for the sale. */
  replyN: number;
  replied: number;
  soldN: number;
  sold: number;
  /** null below MIN_SAMPLE settled contacts. */
  replyPct: number | null;
  soldPct: number | null;
}

export function rateOf(rows: readonly ContactRow[], now: number): Rate {
  const replyN = rows.filter((r) => r.repliedAt !== null || now - r.at >= REPLY_WINDOW_MS);
  const soldN = rows.filter((r) => r.soldAt !== null || now - r.at >= SOLD_WINDOW_MS);
  const replied = replyN.filter((r) => r.repliedAt !== null).length;
  const sold = soldN.filter((r) => r.soldAt !== null).length;
  const pct = (k: number, n: number) => (n >= MIN_SAMPLE ? Math.round((k / n) * 100) : null);
  return { n: rows.length, replyN: replyN.length, replied, soldN: soldN.length, sold, replyPct: pct(replied, replyN.length), soldPct: pct(sold, soldN.length) };
}

const byRate = (a: Rate, b: Rate, key: 'replyPct' | 'soldPct') => (b[key] ?? -1) - (a[key] ?? -1) || b.n - a.n;

/** Messages, wording by wording: which ones get answers (and sales). */
export function messageTable(rows: readonly ContactRow[], now: number): ({ kind: ContactKind; variant: string } & Rate)[] {
  const groups = new Map<string, ContactRow[]>();
  for (const r of rows) {
    if (!['FAV_MESSAGE', 'FAV_BUNDLE', 'DELIVERED', 'REPLY'].includes(r.kind) || !r.variant) continue;
    const k = `${r.kind}\u0000${r.variant}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()].map(([k, g]) => ({ kind: g[0]!.kind, variant: k.split('\u0000')[1]!, ...rateOf(g, now) })).sort((a, b) => byRate(a, b, 'replyPct'));
}

export const OFFER_BRACKETS = [
  { key: 'ge95', min: 95 },
  { key: 'ge90', min: 90 },
  { key: 'ge85', min: 85 },
  { key: 'ge80', min: 80 },
  { key: 'lt80', min: 0 },
] as const;
export type OfferBracket = (typeof OFFER_BRACKETS)[number]['key'];

/** Offers by depth (offer ÷ asking price): which ones make people buy. Offers sent, counters and accepted offers. */
export function offerTable(rows: readonly ContactRow[], now: number): ({ kind: ContactKind; bracket: OfferBracket } & Rate)[] {
  const out: ({ kind: ContactKind; bracket: OfferBracket } & Rate)[] = [];
  for (const kind of ['FAV_OFFER', 'OFFER_COUNTER', 'OFFER_ACCEPT'] as const) {
    for (const b of OFFER_BRACKETS) {
      const g = rows.filter((r) => {
        if (r.kind !== kind || !r.offerCents || !r.askCents) return false;
        const pct = (r.offerCents / r.askCents) * 100;
        return pct >= b.min && OFFER_BRACKETS.every((x) => x.min <= b.min || pct < x.min);
      });
      if (g.length) out.push({ kind, bracket: b.key, ...rateOf(g, now) });
    }
  }
  return out;
}

export const DELAY_BUCKETS = [
  { key: 'h1', max: HOUR },
  { key: 'h6', max: 6 * HOUR },
  { key: 'h24', max: DAY },
  { key: 'd3', max: 3 * DAY },
  { key: 'more', max: Number.POSITIVE_INFINITY },
] as const;
export type DelayBucket = (typeof DELAY_BUCKETS)[number]['key'];

const bucketOf = (ms: number): DelayBucket => DELAY_BUCKETS.find((b) => ms < b.max)!.key;

/** Time from the favourite to the message (or offer): which delay gets answers and sales. */
export function delayTable(rows: readonly ContactRow[], now: number): ({ bucket: DelayBucket } & Rate)[] {
  const fav = rows.filter((r) => (r.kind === 'FAV_MESSAGE' || r.kind === 'FAV_OFFER' || r.kind === 'FAV_BUNDLE') && r.delayMs !== null && r.delayMs >= 0);
  return DELAY_BUCKETS.map((b) => ({ bucket: b.key, ...rateOf(fav.filter((r) => bucketOf(r.delayMs!) === b.key), now) })).filter((x) => x.n > 0);
}

export const REPOST_BUCKETS = [
  { key: 'd7', max: 7 },
  { key: 'd14', max: 14 },
  { key: 'd30', max: 30 },
  { key: 'd60', max: 60 },
  { key: 'more', max: Number.POSITIVE_INFINITY },
] as const;
export type RepostBucket = (typeof REPOST_BUCKETS)[number]['key'];

export interface RepostRate {
  bucket: RepostBucket;
  /** Reposts whose copy has been online 14 days (or sold): settled. */
  n: number;
  sold: number;
  soldPct: number | null;
  /** Median days from the repost to the sale, among the sold ones. */
  medianDays: number | null;
}

type ListingLike = { inventoryItemId: string; listedAt: number; listedAtKnown?: boolean; soldAt: number | null; isDemo?: boolean };

/**
 * Reposts: an article listed again (a new listing of the same article), by how long the previous listing had been
 * online — and whether the new one sold within 14 days. Only listings with a known publication date count.
 */
export function repostTable(listings: readonly ListingLike[], now: number): RepostRate[] {
  const byItem = new Map<string, ListingLike[]>();
  for (const l of listings) if (!l.isDemo && l.listedAtKnown !== false) byItem.set(l.inventoryItemId, [...(byItem.get(l.inventoryItemId) ?? []), l]);
  const pairs: { gapDays: number; soldDays: number | null }[] = [];
  for (const ls of byItem.values()) {
    const sorted = [...ls].sort((a, b) => a.listedAt - b.listedAt);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const next = sorted[i]!;
      const soldDays = next.soldAt !== null && next.soldAt - next.listedAt <= SOLD_WINDOW_MS ? (next.soldAt - next.listedAt) / DAY : null;
      if (soldDays === null && now - next.listedAt < SOLD_WINDOW_MS) continue;
      pairs.push({ gapDays: (next.listedAt - prev.listedAt) / DAY, soldDays });
    }
  }
  return REPOST_BUCKETS.map((b, i) => {
    const min = i === 0 ? 0 : REPOST_BUCKETS[i - 1]!.max;
    const g = pairs.filter((p) => p.gapDays >= min && p.gapDays < b.max);
    const sold = g.filter((p) => p.soldDays !== null).map((p) => p.soldDays!).sort((a, b) => a - b);
    return {
      bucket: b.key,
      n: g.length,
      sold: sold.length,
      soldPct: g.length >= MIN_SAMPLE ? Math.round((sold.length / g.length) * 100) : null,
      medianDays: sold.length ? Math.round(sold[Math.floor((sold.length - 1) / 2)]! * 10) / 10 : null,
    };
  }).filter((r) => r.n > 0);
}

/** The best group, only when its rate rests on enough contacts and beats the others: else null (no conclusion). */
export function bestOf<T extends { replyPct?: number | null; soldPct: number | null }>(rows: readonly T[], key: 'replyPct' | 'soldPct'): T | null {
  const rated = rows.filter((r) => typeof r[key] === 'number');
  if (rated.length < 2) return null;
  const sorted = [...rated].sort((a, b) => (b[key] as number) - (a[key] as number));
  return (sorted[0]![key] as number) > (sorted[1]![key] as number) ? sorted[0]! : null;
}
