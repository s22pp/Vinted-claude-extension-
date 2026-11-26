import type { Category, Condition, Gender } from '@/domain/entities';
import type { ComparableAnalysis } from './comparables';
import { CONDITION_TEXT, TITLE_MAX, TITLE_WORD } from './listing';
import { normalizeText } from './normalize';

/**
 * The listing generator: a title in the house's template, a structured description, 10 to 15 hashtags, and a price at
 * the market's median + 10 %. Built only from what ERA knows about the article and what the seller typed (never an
 * invented material, measure or defect: an unknown stays « __ » for the seller to fill); the price only from
 * comparables actually read.
 *   Title: « [Emoji] [Accroche/État] [Marque] [Modèle] – [Style/Époque] ([Taille] [Coupe]) »
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
/** The generated price: the comparables' median plus this (room for the offers). */
export const MEDIAN_MARKUP_PCT = 10;
export const HASHTAGS_MIN = 10;
export const HASHTAGS_MAX = 15;
/** The shipping promise written in every generated description. */
export const SHIPPING_LINE = 'Expédition rapide sous 24 h, emballage soigné. Photos non retouchées : l’article est tel que photographié.';

export interface GenFacts {
  category: Category;
  brand: string | null;
  model: string | null;
  size: string | null;
  /** « vintage » or null. */
  era: string | null;
  condition: Condition | null;
  gender?: Gender | null;
  /** The seller's hook (« Unique », « Rare »…); else « Neuf » for a new article, nothing otherwise. */
  hook?: string | null;
  /** Style, era or vibe (« Y2K Urban Streetwear »); else « Vintage » or the kind of article. */
  vibe?: string | null;
  /** The cut (Slim, Regular, Oversize…), when known. */
  fit?: string | null;
  colors?: string | null;
  material?: string | null;
  defects?: string | null;
  /** Flat measures typed by the seller, by field (length, pitToPit, waist…): « 70 » means 70 cm. */
  measureValues?: Partial<Record<string, string>>;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const known = (brand: string | null) => (brand && !/^(inconnue?|sans marque)$/i.test(brand.trim()) ? brand.trim() : '');

/** The style word: the seller's vibe, else « Vintage » when the article is, else its kind (« Veste », « Jean »…). */
export function styleOf(f: Pick<GenFacts, 'era' | 'category' | 'vibe'>): string {
  if (clean(f.vibe)) return clean(f.vibe);
  if (f.era === 'vintage') return 'Vintage';
  return TITLE_WORD[f.category] || '';
}

/** The word after the emoji: the seller's hook, else « Neuf » for a new article (a fact), never a made-up praise. */
export function hookOf(f: Pick<GenFacts, 'hook' | 'condition'>): string {
  if (clean(f.hook)) return clean(f.hook);
  return f.condition === 'NEW_WITH_TAGS' || f.condition === 'NEW_WITHOUT_TAGS' ? 'Neuf' : '';
}

export function generatedTitle(f: GenFacts): string {
  const named = [known(f.brand), clean(f.model)].filter(Boolean).join(' ');
  const hook = hookOf(f);
  const style = styleOf(f);
  const build = (o: { hook: string; style: string; fit: boolean }) => {
    const inner = [clean(f.size), o.fit ? clean(f.fit) : ''].filter(Boolean).join(' ');
    // Nothing to name it by: the emoji and the kind alone (« 👖 Jean »), never a dangling dash.
    const head = [CATEGORY_EMOJI[f.category], o.hook, named || (o.style ? '' : TITLE_WORD[f.category])].filter(Boolean).join(' ');
    const tail = named ? (o.style ? ` – ${o.style}` : '') : o.style ? ` ${o.style}` : '';
    return `${head}${tail}${inner ? ` (${inner})` : ''}`.replace(/\s+/g, ' ').trim();
  };
  // Too long for Vinted's search: the cut goes first, then the style is cut to two words, then the hook.
  const shortStyle = style.split(' ').slice(0, 2).join(' ');
  for (const o of [
    { hook, style, fit: true },
    { hook, style, fit: false },
    { hook, style: shortStyle, fit: false },
    { hook: '', style: shortStyle, fit: false },
  ]) {
    const title = build(o);
    if (title.length <= GEN_TITLE_MAX) return title;
  }
  const title = build({ hook: '', style: shortStyle, fit: false });
  return `${title.slice(0, GEN_TITLE_MAX - 1).trimEnd()}…`;
}

const KIND_EN: Record<Category, string> = {
  JACKET: 'jacket',
  COAT: 'coat',
  SWEATSHIRT: 'sweatshirt',
  KNIT: 'knitwear',
  SHIRT: 'shirt',
  POLO: 'polo',
  TSHIRT: 'tshirt',
  JEANS: 'denim',
  TROUSERS: 'pants',
  SHORTS: 'shorts',
  SHOES: 'sneakers',
  ACCESSORY: 'accessoires',
  OTHER: '',
};
/** Tags every resale listing can carry, used only to reach the minimum. */
const GENERIC_TAGS = ['friperie', 'secondemain', 'modedurable', 'thrift', 'vintagestyle', 'ootd', 'look', 'style'];

/**
 * 10 to 15 hashtags, only hashtags (« #y2k », never a bare keyword): the brand, the kind (French and English), the era,
 * each word of the style, the cut, the size, the gender, then generic resale tags to reach 10. No duplicates.
 */
export function hashtags(f: GenFacts): string[] {
  const tag = (s: string) => `#${normalizeText(s).replace(/[^a-z0-9]+/g, '')}`;
  const brand = known(f.brand);
  const vintage = f.era === 'vintage' || /vintage/i.test(clean(f.vibe));
  const words = clean(f.vibe)
    .split(/[\s,/·–-]+/)
    .filter((w) => w.length >= 2);
  const raw = [
    brand,
    brand && vintage ? `${brand}vintage` : '',
    TITLE_WORD[f.category],
    KIND_EN[f.category],
    vintage ? 'vintage' : '',
    ...words,
    clean(f.fit),
    f.size ? `taille${f.size}` : '',
    f.gender === 'MEN' ? 'modehomme' : f.gender === 'WOMEN' ? 'modefemme' : '',
    ...GENERIC_TAGS,
  ];
  const tags = [...new Set(raw.filter(Boolean).map(tag).filter((x) => x.length > 2))];
  return tags.slice(0, Math.max(HASHTAGS_MIN, Math.min(HASHTAGS_MAX, tags.length)));
}

/** The flat measures to give, by kind of article: these always, the others when the seller typed them. */
const CORE_MEASURES: Partial<Record<Category, string[]>> = { JEANS: ['waist', 'inseam', 'length'], TROUSERS: ['waist', 'inseam', 'length'], SHORTS: ['waist', 'length'], SHOES: ['insole'], ACCESSORY: ['width', 'height'], OTHER: ['width', 'height'] };
const ALL_MEASURES: Partial<Record<Category, string[]>> = { JEANS: ['waist', 'inseam', 'length'], TROUSERS: ['waist', 'inseam', 'length'], SHORTS: ['waist', 'length'], SHOES: ['insole'], ACCESSORY: ['width', 'height', 'depth'], OTHER: ['width', 'height', 'depth'] };
export const MEASURE_LABEL: Record<string, string> = {
  length: 'Longueur',
  pitToPit: 'Aisselle à aisselle',
  shoulders: 'Épaules',
  sleeve: 'Manche',
  waist: 'Tour de taille',
  inseam: 'Entrejambe',
  insole: 'Semelle intérieure',
  width: 'Largeur',
  height: 'Hauteur',
  depth: 'Profondeur',
};

/** « Longueur : 70 cm | Aisselle à aisselle : __ cm »: ready to fill; a measure typed by the seller is written in. */
export function measureBlock(category: Category, values: Partial<Record<string, string>> = {}): string {
  const core = CORE_MEASURES[category] ?? ['length', 'pitToPit'];
  const all = ALL_MEASURES[category] ?? ['length', 'pitToPit', 'shoulders', 'sleeve'];
  const shown = all.filter((k) => core.includes(k) || clean(values[k]));
  return shown
    .map((k) => {
      const v = clean(values[k]);
      return `${MEASURE_LABEL[k] ?? k} : ${v ? (/^\d+([.,]\d+)?$/.test(v) ? `${v} cm` : v) : '__ cm'}`;
    })
    .join(' | ');
}

export function generatedDescription(f: GenFacts): string {
  const blank = (v: string | null | undefined, hint = '') => clean(v) || `__${hint}`;
  const lines = [
    `${[TITLE_WORD[f.category], known(f.brand), clean(f.model)].filter(Boolean).join(' ')}${f.era === 'vintage' ? ' — vintage' : ''}`,
    '',
    '✦ Détails',
    `• État : ${f.condition ? CONDITION_TEXT[f.condition] : '__'}`,
    `• Taille : ${blank(f.size, ' (étiquette)')}`,
    `• Coupe : ${blank(f.fit)}`,
    `• Défauts : ${blank(f.defects)}`,
    ...(f.colors ? [`• Couleur : ${clean(f.colors)}`] : []),
    `• Composition : ${blank(f.material, ' (étiquette, sinon « non lisible »)')}`,
    '',
    '✦ Mesures à plat',
    measureBlock(f.category, f.measureValues),
    '',
    '✦ Envoi',
    SHIPPING_LINE,
    '',
    hashtags(f).join(' '),
  ];
  return lines.join('\n');
}

/** « Copier tout »: the title, the description (its hashtags at the end) and the price, ready to paste. */
export function listingBundle(title: string, description: string, priceText: string | null): string {
  return [title, '', description, ...(priceText ? ['', `Prix : ${priceText}`] : [])].join('\n');
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
