/**
 * The message sent to a buyer once Vinted says their parcel was delivered: thanks, validate the order if the article
 * suits them, a review, and the seller's account to follow. Pure: which orders get it, and its text. The status is
 * Vinted's own wording on the order (UNVERIFIED on the seller's account): read strictly, so "livraison prévue" or
 * "en cours de livraison" never count as delivered. One message per order, never twice.
 */

export const DEFAULT_DELIVERED =
  'Bonjour ! Votre colis est bien arrivé. Si l’article vous plaît, n’hésitez pas à valider la commande et à me laisser une évaluation. Je vais remettre en ligne plusieurs articles qui pourraient vous intéresser : n’hésitez pas à vous abonner à mon compte. {salutation} !';

/** An order older than this is never messaged, whatever its status says (a stale status is not a delivery). */
export const DELIVERED_MAX_DAYS = 21;

/** Vinted's status says delivered (or collected), and nothing else: "livré(e)", "delivered", "récupéré(e)". */
export function isDelivered(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  if (/\b(non|pas)\s+(encore\s+)?(livr|récup|recup)/.test(s)) return false;
  // Cancelled or already completed (validated: nothing left to ask), or still on its way.
  if (/annul|rembours|cancel|refund|termin|complet|finalis/.test(s)) return false;
  if (/en cours de livraison|en cours d.achemin|transit|prévu|prevu|estim|attente d.envoi|attente de paiement|à envoyer|a envoyer/.test(s)) return false;
  return /livr[ée]|delivered|r[ée]cup[ée]r[ée]|picked up/.test(s);
}

export interface DeliveredOrder {
  title: string;
  status: string | null;
  date: number | null;
  conversationId: string | null;
  transactionId: string | null;
}

/** The key that makes an order messaged once: its conversation, else its transaction. */
export const deliveredKey = (o: Pick<DeliveredOrder, 'conversationId' | 'transactionId'>) => (o.conversationId ? `c:${o.conversationId}` : o.transactionId ? `t:${o.transactionId}` : null);

export type DeliveredPlan = { order: DeliveredOrder; key: string; send: true } | { order: DeliveredOrder; key: string | null; send: false; reason: 'NO_CONVERSATION' | 'TOO_OLD' };

/** The delivered orders to message now (not messaged yet), and those that cannot be, with why. Others are left out. */
export function planDelivered(orders: readonly DeliveredOrder[], sent: ReadonlySet<string>, now: number): DeliveredPlan[] {
  const out: DeliveredPlan[] = [];
  for (const o of orders) {
    if (!isDelivered(o.status)) continue;
    const key = deliveredKey(o);
    if (key && sent.has(key)) continue;
    if (o.date !== null && now - o.date > DELIVERED_MAX_DAYS * 86_400_000) out.push({ order: o, key, send: false, reason: 'TOO_OLD' });
    else if (!o.conversationId || !key) out.push({ order: o, key, send: false, reason: 'NO_CONVERSATION' });
    else out.push({ order: o, key, send: true });
  }
  return out;
}

/** "Bonne journée" until 18 h, "Bonne soirée" after (the seller's own clock): a message sent at 9 h never says good evening. */
export const salutation = (now: number) => (new Date(now).getHours() >= 18 ? 'Bonne soirée' : 'Bonne journée');

/** The seller's text with {article} (the order's title) and {salutation} filled. */
export function deliveredText(template: string, order: Pick<DeliveredOrder, 'title'>, now: number): string {
  return (template.trim() || DEFAULT_DELIVERED)
    .replace(/\{article\}/g, order.title.trim())
    .replace(/\{salutation\}/g, salutation(now))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
