import { isUnknownBrand, normalizeText } from './normalize';
import { skusInText } from './listing';

/**
 * Messages to a member who favourited an item, written the way people write on Vinted: short, about "la veste
 * Ralph Lauren" rather than the full listing title (size, ERA reference). The seller ticks the ones they like;
 * with several, each member gets one of them (always the same for a given favourite).
 */

export interface FavPreset {
  id: string;
  /** With an offer ({prix_offre} present) or without. */
  offer: boolean;
  tone: 'tu' | 'vous';
  text: string;
}

export const FAV_PRESETS: readonly FavPreset[] = [
  // No verb agrees with {article} (it may be "les baskets"), no pronoun stands for it (le / la).
  { id: 'o1', offer: true, tone: 'tu', text: 'Hello ! J’ai vu ton favori sur {article} 🙂 Je te fais {prix_offre} au lieu de {prix}, l’offre t’attend dans la conversation.' },
  { id: 'o2', offer: true, tone: 'tu', text: 'Salut ! Merci pour ton favori sur {article}. Je te fais {prix_offre} au lieu de {prix}, l’offre est envoyée.' },
  { id: 'o3', offer: true, tone: 'tu', text: 'Coucou, merci pour le like ! Petit geste pour toi : {prix_offre} au lieu de {prix}. N’hésite pas si tu as une question.' },
  { id: 'o4', offer: true, tone: 'tu', text: 'Hello ! Pour {article}, je t’ai envoyé une offre à {prix_offre} (au lieu de {prix}). Envoi rapide et soigné !' },
  { id: 'o5', offer: true, tone: 'vous', text: 'Bonjour, merci pour votre intérêt ! Je vous propose {prix_offre} au lieu de {prix} pour {article}, l’offre est dans la conversation.' },
  { id: 'o6', offer: true, tone: 'vous', text: 'Bonjour ! Merci pour votre favori sur {article}. Je vous ai fait une offre à {prix_offre} au lieu de {prix} ; n’hésitez pas si vous avez une question.' },
  { id: 'n1', offer: false, tone: 'tu', text: 'Hello ! Merci pour ton favori 🙂 Si tu as une question sur {article} (mesures, état, photos), n’hésite pas !' },
  { id: 'n2', offer: false, tone: 'tu', text: 'Salut ! Merci pour ton favori sur {article}. Tu veux des photos en plus ou les mesures ? Demande-moi.' },
  { id: 'n3', offer: false, tone: 'tu', text: 'Coucou, merci pour le like ! Si tu veux faire une offre, je regarde vite.' },
  { id: 'n4', offer: false, tone: 'vous', text: 'Bonjour, merci pour votre favori ! Je reste disponible si vous avez des questions sur {article}.' },
  { id: 'n5', offer: false, tone: 'vous', text: 'Bonjour ! Merci pour votre favori. Mesures ou photos supplémentaires de {article} ? Je vous réponds rapidement.' },
];

export const DEFAULT_FAV_OFFER = [FAV_PRESETS[0]!.text, FAV_PRESETS[1]!.text];
export const DEFAULT_FAV_NO_OFFER = [FAV_PRESETS[6]!.text, FAV_PRESETS[7]!.text];

/** Kinds of article, as written in titles → the noun and its article in French. */
const KINDS: readonly [RegExp, string, 'm' | 'f' | 'v' | 'p'][] = [
  [/\bsurchemise\b/, 'surchemise', 'f'],
  [/\bchemise\b/, 'chemise', 'f'],
  [/\b(t shirt|tee shirt|tshirt|tee)\b/, 't-shirt', 'm'],
  [/\b(sweat shirt|sweatshirt|sweat)\b/, 'sweat', 'm'],
  [/\bhoodie\b/, 'hoodie', 'm'],
  [/\bpull\b/, 'pull', 'm'],
  [/\bgilet\b/, 'gilet', 'm'],
  [/\bcardigan\b/, 'cardigan', 'm'],
  [/\bpolo\b/, 'polo', 'm'],
  [/\bdoudoune\b/, 'doudoune', 'f'],
  [/\bparka\b/, 'parka', 'f'],
  [/\bblouson\b/, 'blouson', 'm'],
  [/\bmanteau\b/, 'manteau', 'm'],
  [/\btrench\b/, 'trench', 'm'],
  [/\bblazer\b/, 'blazer', 'm'],
  [/\bveste\b/, 'veste', 'f'],
  [/\b(jean|jeans)\b/, 'jean', 'm'],
  [/\bpantalon\b/, 'pantalon', 'm'],
  [/\bjogging\b/, 'jogging', 'm'],
  [/\bshort\b/, 'short', 'm'],
  [/\bjupe\b/, 'jupe', 'f'],
  [/\brobe\b/, 'robe', 'f'],
  [/\bcasquette\b/, 'casquette', 'f'],
  [/\bbonnet\b/, 'bonnet', 'm'],
  [/\becharpe\b/, 'écharpe', 'v'],
  [/\bceinture\b/, 'ceinture', 'f'],
  [/\bsac\b/, 'sac', 'm'],
  [/\b(baskets|sneakers)\b/, 'baskets', 'p'],
  [/\bchaussures\b/, 'chaussures', 'p'],
  [/\bbottes\b/, 'bottes', 'p'],
  [/\bmaillot\b/, 'maillot', 'm'],
  [/\bsurvetement\b/, 'survêtement', 'm'],
];

const DET = { m: 'le ', f: 'la ', v: 'l’', p: 'les ' } as const;

/** "la veste Ralph Lauren", "le pull", "l’article" — never the size or ERA's reference. */
export function articleOf(title: string, brand: string | null): string {
  const t = normalizeText(title);
  const kind = KINDS.find(([re]) => re.test(t));
  const b = brand && !isUnknownBrand(brand) ? ` ${brand.trim()}` : '';
  if (!kind) return b ? `l’article${b}` : 'l’article';
  return `${DET[kind[2]]}${kind[1]}${b}`;
}

/** The listing title without ERA's reference (E1C4G) — for {titre}. */
export function cleanTitle(title: string): string {
  let out = title;
  // The reference and the separator before it ("… · E1C4G", "… - E1C4G", "Réf. E1C4G").
  for (const k of skusInText(title)) out = out.replace(new RegExp(`\\s*(?:[·|•\\-–—]|r[ée]f\\.?)?\\s*\\b${k}\\b`, 'i'), '');
  return out.replace(/\s{2,}/g, ' ').replace(/[\s·|•\-–—]+$/, '').trim();
}

/** One of the chosen messages for this favourite: stable for a key, spread across members. */
export function pickMessage(list: readonly string[], key: string): string | null {
  const usable = list.map((s) => s.trim()).filter(Boolean);
  if (!usable.length) return null;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return usable[(h >>> 0) % usable.length]!;
}

/** "la veste Ralph Lauren et le pull Lacoste", "a, b et c". */
export function articleList(items: readonly { title: string; brand: string | null }[]): string {
  const names = items.map((i) => articleOf(i.title, i.brand));
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** One message for a member who favourited several of your articles: the bundle, in their words. */
export const BUNDLE_WITH_PRICE = [
  'Hello ! J’ai vu tes favoris sur {articles} 🙂 Si tu les prends ensemble en lot, je te fais {prix_lot} au lieu de {prix_total}.',
  'Salut ! Tu as mis {n} de mes articles en favori : {articles}. Ensemble, je te les laisse à {prix_lot} au lieu de {prix_total}, fais-moi un lot !',
];
export const BUNDLE_NO_PRICE = ['Hello ! J’ai vu tes favoris sur {articles} 🙂 Si tu les prends ensemble en lot, je te fais un prix : dis-moi !'];
