import { offerInMessage } from './ai-draft';

/**
 * Buyers' messages answered by the autopilot — only the plain questions ERA can answer for sure. Pure: reading a
 * conversation (Vinted's fields, UNVERIFIED on the seller's account), what is never answered automatically, and when a
 * drafted answer may leave. Everything else is left to the seller, said in the round's notice.
 */

export interface ConvMessage {
  id: string | null;
  fromMe: boolean;
  body: string;
  at: number | null;
}

export interface ConversationRead {
  messages: ConvMessage[];
  /** The listing the conversation is about (Vinted id), when Vinted says it. */
  itemVintedId: string | null;
  /** The order's status, when there is one (a sale under way: questions about it are the seller's). */
  transactionStatus: string | null;
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

/** A conversation as Vinted returns it: `{ conversation: { messages: [...] } }`, messages plain or wrapped in `entity`. */
export function readConversation(json: unknown, me: string | null): ConversationRead {
  const conv = isObj(json) && isObj(json.conversation) ? json.conversation : isObj(json) ? json : {};
  const raw = Array.isArray(conv.messages) ? conv.messages.filter(isObj) : [];
  const messages: ConvMessage[] = [];
  for (const m of raw) {
    if (typeof m.entity_type === 'string' && m.entity_type !== 'message') continue;
    const e = isObj(m.entity) ? m.entity : m;
    const body = typeof e.body === 'string' ? e.body.trim() : '';
    const author = idOf(e.user_id ?? m.user_id ?? e.sender_id);
    messages.push({ id: idOf(m.id ?? e.id), fromMe: !!me && author === me, body, at: timeOf(m.created_at_ts ?? m.created_time_ts ?? e.created_at_ts ?? m.created_at ?? e.created_at) });
  }
  const tx = isObj(conv.transaction) ? conv.transaction : null;
  const item = isObj(conv.item) ? conv.item : Array.isArray(conv.items) && isObj(conv.items[0]) ? conv.items[0] : null;
  const status = tx ? (typeof tx.status_title === 'string' ? tx.status_title : typeof tx.status === 'string' ? tx.status : null) : null;
  return { messages, itemVintedId: idOf(tx?.item_id ?? item?.id), transactionStatus: status };
}

/**
 * What a message is about. SENSITIVE: a problem with an order (refund, return, damage, not received, claim) — never
 * answered by a machine. CONTACT: off Vinted. OFFER: an amount — the offers' rules, or the seller. QUESTION: the rest.
 */
export type MessageTopic = 'SENSITIVE' | 'CONTACT' | 'OFFER' | 'QUESTION';

export function messageTopic(text: string): MessageTopic {
  const s = text.toLowerCase();
  if (/rembours|retour|renvo|litige|réclamation|reclamation|abîm|abim|cass[ée]|déchir|dechir|\btach[ée]|\btrous?\b|défaut|defaut|pas re[çc]u|jamais re[çc]u|non re[çc]u|perdu|arnaque|escroqu|\bfaux\b|contrefa|signal|annul|problème|probleme|pas conforme|ne correspond/.test(s)) return 'SENSITIVE';
  if (/whats?app|t[ée]l[ée]phone|\b0[67]\d{8}\b|\+33|e-?mail|@[a-z0-9-]+\.|paypal|virement|lydia|instagram|snap|hors (de )?vinted|en main propre|main propre/.test(s)) return 'CONTACT';
  if (offerInMessage(text) !== null || /\b(offre|négoci|negoci|dernier prix|meilleur prix|baisser|réduc|reduc|moins cher|lot)\b/.test(s)) return 'OFFER';
  return 'QUESTION';
}

/** A buyer's message is answered within this time; older ones are the seller's (an answer days later reads oddly). */
export const REPLY_MAX_AGE_MS = 3 * 24 * 3_600_000;

export type ReplyPlan =
  | { send: true; buyerText: string; messageId: string | null }
  | { send: false; reason: 'SELLER_LAST' | 'NO_TEXT' | 'TOO_OLD' | 'SENSITIVE' | 'CONTACT' | 'OFFER' | 'ORDER' | 'ANSWERED' };

/**
 * Whether the conversation waits for an answer ERA may give: the last message is the buyer's, has text, is recent, is a
 * plain question about a listing (no order under way), and was not answered by ERA already (`done`: message keys).
 * The buyer's messages since the seller's last one are read together.
 */
export function planReply(c: ConversationRead, convId: string, done: ReadonlySet<string>, now: number): ReplyPlan {
  const last = c.messages[c.messages.length - 1];
  if (!last || last.fromMe) return { send: false, reason: 'SELLER_LAST' };
  const key = replyKey(convId, last);
  if (done.has(key)) return { send: false, reason: 'ANSWERED' };
  let i = c.messages.length - 1;
  while (i > 0 && !c.messages[i - 1]!.fromMe) i--;
  const buyerText = c.messages
    .slice(i)
    .map((m) => m.body)
    .filter(Boolean)
    .join('\n');
  if (!buyerText) return { send: false, reason: 'NO_TEXT' };
  if (last.at !== null && now - last.at > REPLY_MAX_AGE_MS) return { send: false, reason: 'TOO_OLD' };
  const topic = messageTopic(buyerText);
  if (topic !== 'QUESTION') return { send: false, reason: topic };
  if (c.transactionStatus && !/en attente|pending|offre|offer/i.test(c.transactionStatus)) return { send: false, reason: 'ORDER' };
  return { send: true, buyerText, messageId: last.id };
}

/** The key that makes a buyer's message answered once: the conversation and the message (its id, else its text and time). */
export const replyKey = (convId: string, m: Pick<ConvMessage, 'id' | 'body' | 'at'>) => `${convId}:${m.id ?? `${m.at ?? ''}:${m.body.slice(0, 40)}`}`;

/**
 * Whether a drafted answer may leave by itself. DEFER: the draft says it will check (a fact ERA does not hold) — the
 * seller answers instead, never a promise sent in their name. UNSURE: the checks found something not in the facts.
 */
export function replyVerdict(draft: string, issues: readonly unknown[]): 'OK' | 'DEFER' | 'UNSURE' {
  if (/v[ée]rifi|reviens vers|revenir vers|je regarde|je vous (redis|tiens au courant|confirme)|je ne sais pas|pas s[ûu]r|aucune information|je n.ai pas (cette|l.)info/i.test(draft)) return 'DEFER';
  return issues.length ? 'UNSURE' : 'OK';
}

/** A buyer's message ERA did not answer by itself: shown in ERA with a drafted answer (when one is possible), sent on
 * the seller's click — the seller never has to open Vinted for it. */
export interface PendingReply {
  key: string;
  conversationId: string;
  /** When the buyer wrote (or when ERA read it). */
  at: number;
  title: string | null;
  buyer: string;
  /** The answer ERA proposes, null when none is possible (a problem with an order: the seller writes it). */
  draft: string | null;
  why: 'SENSITIVE' | 'CONTACT' | 'OFFER' | 'ORDER' | 'NO_ITEM' | 'UNSURE' | 'DEFER' | 'NO_KEY' | 'AI_FAILED';
  /** What the checks found in the draft (a number, a material… not in ERA's facts). */
  issues?: string[];
}

/** One waiting message per conversation (the latest), none older than 7 days. */
export function mergePending(list: readonly PendingReply[], p: PendingReply, now: number): PendingReply[] {
  return [...list.filter((x) => x.conversationId !== p.conversationId), p].filter((x) => now - x.at <= 7 * 24 * 3_600_000).sort((a, b) => b.at - a.at);
}

/** Drops what no longer waits: the seller (or ERA) wrote in the conversation since, per the inbox. */
export function prunePending(list: readonly PendingReply[], inbox: ReadonlyMap<string, { updatedAt: number | null; fromOther: boolean | null }>, now: number): PendingReply[] {
  return list.filter((p) => {
    if (now - p.at > 7 * 24 * 3_600_000) return false;
    const a = inbox.get(p.conversationId);
    return !(a && a.fromOther === false && a.updatedAt !== null && a.updatedAt > p.at);
  });
}
