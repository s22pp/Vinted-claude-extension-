import type { ContactRow } from './outcomes';

/**
 * « Relance sans réponse » : a member ERA wrote to (a favourite's message or offer, a counter-offer) who has not
 * answered after 24 h gets ONE short follow-up in the same conversation — never a second one, never after 72 h, never
 * once they answered or the article sold. Before sending, the conversation is read: the last message must be the
 * seller's own (they may have answered in a way the inbox did not show). Pure: the choice and the words.
 */

const HOUR = 3_600_000;
export const FOLLOW_AFTER_H = 24;
/** Past this, a follow-up would come too late to help: left alone. */
export const FOLLOW_MAX_H = 72;
/** Contacts a follow-up may answer. */
export const FOLLOW_KINDS: readonly ContactRow['kind'][] = ['FAV_MESSAGE', 'FAV_OFFER', 'FAV_BUNDLE', 'OFFER_COUNTER'];
/** The conversations already followed up, kept (one follow-up per conversation, ever). */
export const FOLLOWED_KEY = 'autoFollowed';

export interface FollowUp {
  conversationId: string;
  title: string;
  /** The offer made in that contact, when there was one (said again in the follow-up). */
  offerCents: number | null;
  /** When the contact was sent. */
  at: number;
  /** When the follow-up becomes due. */
  dueAt: number;
}

/** The latest unanswered contact of each conversation, between 24 h and 72 h old, not yet followed up. */
export function followUpCandidates(contacts: readonly ContactRow[], followed: ReadonlySet<string>, now: number, afterH = FOLLOW_AFTER_H, maxH = FOLLOW_MAX_H): FollowUp[] {
  const latest = new Map<string, ContactRow>();
  for (const c of contacts) {
    if (!c.conversationId || !FOLLOW_KINDS.includes(c.kind)) continue;
    const prev = latest.get(c.conversationId);
    if (!prev || c.at > prev.at) latest.set(c.conversationId, c);
  }
  const out: FollowUp[] = [];
  for (const [conversationId, c] of latest) {
    if (followed.has(conversationId) || c.repliedAt !== null || c.soldAt !== null) continue;
    const age = now - c.at;
    if (age > maxH * HOUR) continue;
    out.push({ conversationId, title: c.title, offerCents: c.offerCents, at: c.at, dueAt: c.at + afterH * HOUR });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

/** Due now (24 h passed). */
export const isDue = (f: FollowUp, now: number) => f.dueAt <= now;

const eur = (cents: number) => `${(cents / 100).toFixed(cents % 100 ? 2 : 0).replace('.', ',')} €`;

/** The follow-up: short, polite, the offer said again when there was one. Never a new price. */
export function followUpText(f: Pick<FollowUp, 'title' | 'offerCents'>): string {
  const what = f.title.trim() || 'l’article';
  return f.offerCents !== null
    ? `Bonjour ! Je me permets de revenir vers vous pour « ${what} » : l’offre à ${eur(f.offerCents)} tient toujours. Belle journée 🙂`
    : `Bonjour ! Toujours intéressé(e) par « ${what} » ? Je reste disponible si vous avez une question. Belle journée 🙂`;
}

/** The conversation as read just before sending: its last message must be the seller's own (else: no follow-up). */
export function lastIsMine(messages: readonly { fromMe: boolean }[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.fromMe;
}
