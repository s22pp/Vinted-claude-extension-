/**
 * Reply templates for buyer messages: filled with what ERA knows about the item, copied by the seller,
 * sent by the seller on Vinted. ERA never sends a message.
 */
export type ReplyKey = 'MEASURES' | 'AVAILABLE' | 'CONDITION' | 'SHIPPING' | 'BUNDLE' | 'OFFER_COUNTER' | 'OFFER_DECLINE' | 'THANKS';
export const REPLY_KEYS: ReplyKey[] = ['MEASURES', 'AVAILABLE', 'CONDITION', 'SHIPPING', 'BUNDLE', 'OFFER_COUNTER', 'OFFER_DECLINE', 'THANKS'];

export const DEFAULT_REPLIES: Record<ReplyKey, string> = {
  MEASURES: 'Bonjour ! Mesures à plat de {title} : {measures}. Taille indiquée sur l’étiquette : {size}. N’hésitez pas si vous avez une autre question.',
  AVAILABLE: 'Bonjour, oui l’article est toujours disponible. Je peux l’envoyer rapidement après l’achat.',
  CONDITION: 'Bonjour ! État : {condition}. {defects} Tout est visible sur les photos, non retouchées.',
  SHIPPING: 'Bonjour, j’envoie sous 1 à 2 jours ouvrés après l’achat, soigneusement emballé.',
  BUNDLE: 'Bonjour ! Avec plaisir pour un lot : ajoutez les articles à un lot depuis mon dressing et je vous fais une proposition.',
  OFFER_COUNTER: 'Bonjour, merci pour votre offre ! Je peux vous le laisser à {counter}, c’est mon meilleur prix.',
  OFFER_DECLINE: 'Bonjour, merci pour votre offre, mais je ne peux pas descendre aussi bas : {price} est déjà un prix juste pour cette pièce.',
  THANKS: 'Merci pour votre achat ! Le colis part très vite, je vous tiens au courant.',
};

export interface ReplyContext {
  title: string | null;
  size: string | null;
  condition: string | null;
  defects: string | null;
  /** Measures as "longueur 70 cm · aisselle-aisselle 55 cm", or null when none was read. */
  measures: string | null;
  price: string | null;
  counter: string | null;
}

const MISSING = '[à compléter]';

/** Fill {placeholders}; anything ERA does not know stays visibly blank, never invented. */
export function fillReply(template: string, c: ReplyContext): string {
  const map: Record<string, string | null> = {
    title: c.title,
    size: c.size,
    condition: c.condition,
    defects: c.defects ? `Défauts : ${c.defects}.` : '',
    measures: c.measures,
    price: c.price,
    counter: c.counter,
  };
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = map[k];
      return v === null || v === undefined ? MISSING : v;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function hasBlanks(text: string): boolean {
  return text.includes(MISSING);
}

/* ── Replies inside Vinted's messaging (EXPERIMENTAL) ───── */

/** What the dashboard publishes for the vinted.fr pages: your templates, and what ERA knows of each live listing. */
export const REPLY_KIT_KEY = 'eraReplyKit';
/** Off switch for the "Réponses ERA" button in Vinted's messaging (on unless switched off). */
export const REPLIES_ON_KEY = 'eraRepliesOn';

export interface ReplyKit {
  templates: { key: ReplyKey; label: string; text: string }[];
  /** By Vinted listing id: the context to fill the templates with (real data only). */
  items: Record<string, ReplyContext>;
}

export interface KitReply {
  key: ReplyKey;
  label: string;
  text: string;
  blanks: boolean;
}

const UNKNOWN: ReplyContext = { title: null, size: null, condition: null, defects: null, measures: null, price: null, counter: null };

/** The conversation's listing among those the page links to: the first one ERA knows. */
export function conversationItem(kit: ReplyKit, linkedIds: readonly string[]): string | null {
  return linkedIds.find((id) => id in kit.items) ?? null;
}

/** Every template, filled for this listing (or left visibly blank when ERA does not know it). */
export function kitReplies(kit: ReplyKit, itemId: string | null): KitReply[] {
  const c = (itemId && kit.items[itemId]) || UNKNOWN;
  return kit.templates.map((x) => {
    const text = fillReply(x.text, c);
    return { key: x.key, label: x.label, text, blanks: hasBlanks(text) };
  });
}
