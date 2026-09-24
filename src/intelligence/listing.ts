import type { Category, Condition, InventoryItem } from '@/domain/entities';
import { EXCLUDED_TERMS, brandAliases, brandKey, normalizeText } from './normalize';

/** Short, stable reference derived from the item id. Put in the title, it lets sales be matched to listings. */
export function skuOf(itemId: string): string {
  let h = 2166136261;
  for (let i = 0; i < itemId.length; i++) h = Math.imul(h ^ itemId.charCodeAt(i), 16777619);
  return `E${(h >>> 0).toString(36).toUpperCase().slice(0, 4).padStart(4, '0')}`;
}

const TITLE_WORD: Record<Category, string> = {
  JACKET: 'Veste',
  COAT: 'Manteau',
  SWEATSHIRT: 'Sweat',
  KNIT: 'Pull',
  SHIRT: 'Chemise',
  POLO: 'Polo',
  TSHIRT: 'T-shirt',
  JEANS: 'Jean',
  TROUSERS: 'Pantalon',
  SHORTS: 'Short',
  SHOES: 'Chaussures',
  ACCESSORY: '',
  OTHER: '',
};

const CONDITION_TEXT: Record<Condition, string> = {
  NEW_WITH_TAGS: 'Neuf avec étiquette',
  NEW_WITHOUT_TAGS: 'Neuf sans étiquette, jamais porté',
  VERY_GOOD: 'Très bon état, peu porté',
  GOOD: 'Bon état, traces d’usage légères (voir photos)',
  SATISFACTORY: 'État satisfaisant, défauts visibles en photo',
};

/** Title: type + brand + model + era + size + SKU. Deterministic, no colour stuffing, no other brand. */
export function buildTitle(item: Pick<InventoryItem, 'id' | 'brand' | 'model' | 'category' | 'size' | 'era'>, withSku = true): string {
  const parts = [TITLE_WORD[item.category], item.brand, item.model, item.era === 'vintage' ? 'vintage' : null, item.size ? `T.${item.size}` : null];
  const base = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return withSku ? `${base} · ${skuOf(item.id)}` : base;
}

/** Description skeleton: only facts ERA knows; everything unknown is an explicit blank to fill, never invented. */
export function buildDescription(item: Pick<InventoryItem, 'id' | 'brand' | 'model' | 'category' | 'size' | 'condition' | 'material'>): string {
  const lines = [
    `${TITLE_WORD[item.category]} ${item.brand}${item.model ? ` ${item.model}` : ''}`.trim(),
    '',
    `• Taille : ${item.size ?? '__ (étiquette)'}`,
    `• État : ${item.condition ? CONDITION_TEXT[item.condition] : '__'}`,
    `• Composition : ${item.material ?? '__ (lire l’étiquette — sinon « non lisible »)'}`,
    '• Mesures à plat : longueur __ cm · aisselle-aisselle __ cm · manche __ cm',
    '',
    'Envoi rapide et soigné. Photos non retouchées : l’article est tel que photographié.',
    `Réf. ${skuOf(item.id)}`,
  ];
  return lines.join('\n');
}

export type ShieldSeverity = 'block' | 'warn' | 'info';
export interface ShieldIssue {
  code: 'COUNTERFEIT_TERM' | 'OTHER_BRAND' | 'OFF_PLATFORM' | 'CONTACT' | 'KID_LOT_TERM' | 'SHOUTING' | 'TOO_LONG' | 'NO_BRAND';
  severity: ShieldSeverity;
  match: string;
}

const COUNTERFEIT = /\b(replica|r[eé]plique|copie|fake|contrefa[cç]on|inspir[eé]e?|fa[cç]on|type|style|imitation)\b/i;
const OFF_PLATFORM = /\b(paypal|lydia|virement|whatsapp|wa\.me|telegram|snap(chat)?|insta(gram)?|hors vinted|en main propre)\b/i;
const CONTACT = /(\b[\w.+-]+@[\w-]+\.[\w.]+\b)|(\b0[67](?:[\s.-]?\d{2}){4}\b)|(\+33\s?\d)/i;
const KNOWN_BRANDS = ['ralph lauren', 'carhartt', 'levis', 'nike', 'adidas', 'the north face', 'stone island', 'lacoste', 'tommy hilfiger', 'burberry', 'barbour', 'patagonia', 'arcteryx', 'marlboro', 'quiksilver', 'asics', 'schott', 'dickies', 'stussy', 'napapijri', 'fred perry', 'supreme', 'gucci', 'louis vuitton', 'moncler', 'canada goose'];

/**
 * Listing shield: flags wording that gets listings removed or accounts flagged.
 * Rule-based and local. It warns — it never rewrites or publishes anything.
 */
export function shieldCheck(text: string, brand: string | null): ShieldIssue[] {
  const issues: ShieldIssue[] = [];
  const norm = normalizeText(text);
  const c = text.match(COUNTERFEIT);
  if (c) issues.push({ code: 'COUNTERFEIT_TERM', severity: 'block', match: c[0] });
  const own = brand ? brandKey(brand) : null;
  for (const b of KNOWN_BRANDS) {
    if (b === own) continue;
    const aliases = brandAliases(b);
    const hit = aliases.find((a) => ` ${norm} `.includes(` ${a} `));
    // "Polo Ralph Lauren" contains "polo"; only flag real other brands.
    if (hit && !(own && brandAliases(own).some((a) => a.includes(hit)))) issues.push({ code: 'OTHER_BRAND', severity: 'block', match: hit });
  }
  const o = text.match(OFF_PLATFORM);
  if (o) issues.push({ code: 'OFF_PLATFORM', severity: 'block', match: o[0] });
  const ct = text.match(CONTACT);
  if (ct) issues.push({ code: 'CONTACT', severity: 'block', match: ct[0] });
  const k = norm.match(EXCLUDED_TERMS);
  if (k && !c) issues.push({ code: 'KID_LOT_TERM', severity: 'info', match: k[0] });
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 12 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.6) issues.push({ code: 'SHOUTING', severity: 'warn', match: text.slice(0, 20) });
  if (brand && !` ${norm} `.includes(` ${normalizeText(brand)} `) && !brandAliases(brandKey(brand)).some((a) => ` ${norm} `.includes(` ${a} `)))
    issues.push({ code: 'NO_BRAND', severity: 'warn', match: brand });
  return issues;
}

export const TITLE_MAX = 60;
export function titleIssues(title: string, brand: string | null): ShieldIssue[] {
  const out = shieldCheck(title, brand);
  if (title.length > TITLE_MAX) out.push({ code: 'TOO_LONG', severity: 'warn', match: `${title.length}` });
  return out;
}
