import type { Category, Condition } from '@/domain/entities';
import type { ComparableAnalysis } from './comparables';
import { CONDITION_TEXT, TITLE_MAX, TITLE_WORD } from './listing';
import { normalizeText } from './normalize';

/**
 * The listing generator: a title in the house's template, a structured description with hashtags, and a price at the
 * market's median + 10 %. Built only from what ERA knows about the article (never an invented material, measure or
 * defect: an unknown stays « __ » for the seller to fill); the price only from comparables actually read.
 *   Title: « [Emoji] [Marque] [Modèle] – [Style] ([Taille] [Coupe]) »
 */

export const CATEGORY_EMOJI: Record<Category, string> = {
  JACKET: '🧥',
  COAT: '🧥',
  SWEATSHIRT: '👕',
  KNIT: '🧶',
  SHIRT: '👔',
  POLO: '👕',
  TSHIRT: '👕',
  JEANS: '👖',
  TROUSERS: '👖',
  SHORTS: '🩳',
  SHOES: '👟',
  ACCESSORY: '👜',
  OTHER: '✨',
};

/** ERA's title limit (TITLE_MAX): what Vinted's search shows in full. */
export const GEN_TITLE_MAX = TITLE_MAX;
/** The generated price: the comparables' median plus this. */
export const MEDIAN_MARKUP_PCT = 10;

export interface GenFacts {
  category: Category;
  brand: string | null;
  model: string | null;
  size: string | null;
  /** « vintage » or null. */
  era: string | null;
  condition: Condition | null;
  /** The cut (Slim, Regular, Oversize…), when known. */
  fit?: string | null;
  colors?: string | null;
  material?: string | null;
  defects?: string | null;
  /** « longueur 70 cm · aisselle-aisselle 55 cm », when read. */
  measures?: string | null;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const known = (brand: string | null) => (brand && !/^(inconnue?|sans marque)$/i.test(brand.trim()) ? brand.trim() : '');

/** The style word: « Vintage » when the article is, else its kind (« Veste », « Jean »…). */
export function styleOf(f: Pick<GenFacts, 'era' | 'category'>): string {
  if (f.era === 'vintage') return 'Vintage';
  return TITLE_WORD[f.category] || '';
}

export function generatedTitle(f: GenFacts): string {
  const named = [known(f.brand), clean(f.model)].filter(Boolean).join(' ');
  const style = styleOf(f);
  // Nothing to name it by: the emoji and the kind alone (« 👖 Jean »), never a dangling dash.
  if (!named) return [CATEGORY_EMOJI[f.category], style, clean(f.size) ? `(${[clean(f.size), clean(f.fit)].filter(Boolean).join(' ')})` : ''].filter(Boolean).join(' ');
  const head = `${CATEGORY_EMOJI[f.category]} ${named}`;
  const inner = [clean(f.size), clean(f.fit)].filter(Boolean).join(' ');
  let title = `${head}${style ? ` – ${style}` : ''}${inner ? ` (${inner})` : ''}`.replace(/\s+/g, ' ').trim();
  if (title.length > GEN_TITLE_MAX) title = `${title.slice(0, GEN_TITLE_MAX - 1).trimEnd()}…`;
  return title;
}

/** Hashtags from the facts only: the brand, the kind, vintage, the size — three to six, no duplicates. */
export function hashtags(f: GenFacts): string[] {
  const tag = (s: string) => `#${normalizeText(s).replace(/[^a-z0-9]+/g, '')}`;
  const raw = [known(f.brand), TITLE_WORD[f.category], f.era === 'vintage' ? 'vintage' : '', f.brand && f.era === 'vintage' ? `${known(f.brand)}vintage` : '', f.size ? `taille${f.size}` : '', 'friperie'];
  return [...new Set(raw.filter(Boolean).map(tag).filter((x) => x.length > 2))].slice(0, 6);
}

export function generatedDescription(f: GenFacts): string {
  const blank = (v: string | null | undefined, hint = '') => clean(v) || `__${hint}`;
  const lines = [
    `${[TITLE_WORD[f.category], known(f.brand), clean(f.model)].filter(Boolean).join(' ')}${f.era === 'vintage' ? ' — vintage' : ''}`,
    '',
    '✦ Détails',
    `• Taille : ${blank(f.size, ' (étiquette)')}${f.fit ? ` · coupe ${clean(f.fit)}` : ''}`,
    `• État : ${f.condition ? CONDITION_TEXT[f.condition] : '__'}`,
    `• Défauts : ${blank(f.defects)}`,
    ...(f.colors ? [`• Couleur : ${clean(f.colors)}`] : []),
    `• Composition : ${blank(f.material, ' (étiquette, sinon « non lisible »)')}`,
    `• Mesures à plat : ${blank(f.measures)}`,
    '',
    '✦ Envoi',
    'Envoi rapide et soigné. Photos non retouchées : l’article est tel que photographié.',
    '',
    hashtags(f).join(' '),
  ];
  return lines.join('\n');
}

/**
 * The comparables' median + 10 %, rounded to the euro — only from a market analysis that kept comparables; null
 * otherwise (no price is invented).
 */
export function generatedPrice(analysis: Pick<ComparableAnalysis, 'distribution' | 'keptCount'> | null, markupPct = MEDIAN_MARKUP_PCT): number | null {
  const median = analysis && analysis.keptCount > 0 ? (analysis.distribution?.p50 ?? null) : null;
  if (median === null || !Number.isFinite(median) || median <= 0) return null;
  return Math.max(100, Math.round((median * (1 + markupPct / 100)) / 100) * 100);
}
