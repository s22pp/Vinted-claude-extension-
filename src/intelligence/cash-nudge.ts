import { isDelivered } from './delivered';

/**
 * « Relance déblocage trésorerie »: a parcel delivered more than 24 h ago and the order still not validated — the
 * money waits until the buyer says all is fine (or Vinted closes the order by itself). One courteous message, on the
 * seller's click (copied, or sent in the order's conversation), once per order. Pure: which sales, and the text.
 */

export const NUDGE_AFTER_MS = 24 * 3_600_000;
/** Past this, a delivered status is stale: no nudge (the order is settled one way or another). */
export const NUDGE_MAX_MS = 14 * 24 * 3_600_000;
export const NUDGE_SENT_KEY = 'cashNudgeSent';

export const DEFAULT_NUDGE =
  'Bonjour ! J’espère que l’article vous plaît. Si tout est bon pour vous, pourriez-vous valider la commande sur Vinted (« Tout est OK ») ? Cela me permet de clôturer la vente. Merci beaucoup et belle journée !';

export interface NudgeSale {
  id: string;
  title: string;
  vintedStatus?: string | null;
  vintedStatusSince?: number | null;
  vintedConversationId?: string | null;
  status: string;
}

export interface NudgeCandidate {
  saleId: string;
  title: string;
  conversationId: string | null;
  /** Hours since ERA saw the order delivered. */
  hours: number;
}

/**
 * Sales Vinted shows delivered (and nothing after: not validated, no claim) for 24 h or more — counted from when ERA saw
 * the status appear, never guessed from the sale date — and not nudged yet; the longest waiting first.
 */
export function nudgeCandidates(sales: readonly NudgeSale[], sent: ReadonlySet<string>, now: number): NudgeCandidate[] {
  return sales
    .filter((s) => s.status !== 'REFUNDED' && !sent.has(s.id) && isDelivered(s.vintedStatus) && typeof s.vintedStatusSince === 'number')
    .map((s) => ({ saleId: s.id, title: s.title, conversationId: s.vintedConversationId ?? null, since: s.vintedStatusSince! }))
    .filter((s) => now - s.since >= NUDGE_AFTER_MS && now - s.since <= NUDGE_MAX_MS)
    .sort((a, b) => a.since - b.since)
    .map(({ since, ...c }) => ({ ...c, hours: Math.floor((now - since) / 3_600_000) }));
}
