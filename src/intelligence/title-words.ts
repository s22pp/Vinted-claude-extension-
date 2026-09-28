import { COLOURS, brandAliases, brandKey, isSizeToken, normalizeText } from './normalize';

/**
 * Words the comparable listings (those ERA kept for your article) put in their titles, and yours does not.
 * A count, nothing more: it says what the competition writes, not what sells — and a word goes in your title
 * only if it is TRUE of your article (a colour, "vintage", a material…). Brands, sizes, filler and your
 * own words are left out.
 */

export interface TitleWord {
  /** As most comparables write it (accents kept). */
  word: string;
  /** Comparables using it. */
  count: number;
  share: number;
  /** COLOUR / CLAIM: only if true of yours — said next to the word. */
  kind: 'WORD' | 'COLOUR' | 'CLAIM';
}

export interface TitleWordsResult {
  /** Comparables read. Under MIN_BASE, no list (too few to say anything). */
  base: number;
  words: TitleWord[];
}

export const MIN_BASE = 5;

// Words that say nothing about the article, or that only the seller can know are true.
const STOP = new Set(
  'avec sans pour dans sur par une des les aux the and for with taille size tres bon bonne etat tbe neuf neuve new porte portee jamais etiquette etiquettes homme femme mixte unisexe enfant vends vend lot article pièce piece superbe magnifique joli jolie beau belle top parfait parfaite comme idee cadeau envoi rapide prix negociable'.split(
    ' ',
  ),
);
const CLAIMS = new Set('vintage retro rare authentique original originale collector limited edition limitee y2k made france usa italy italie japan japon deadstock'.split(' '));

/** Singular-ish key so "vestes" and "veste" count as one word. */
const stem = (w: string) => (w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w);

function tokens(title: string): { norm: string; shown: string }[] {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((shown) => ({ norm: normalizeText(shown).replace(/\s+/g, ''), shown }));
}

export function missingTitleWords(title: string, brand: string | null, comparables: readonly { title: string }[], max = 8): TitleWordsResult {
  const base = comparables.length;
  if (base < MIN_BASE) return { base, words: [] };
  const brandWords = new Set<string>();
  if (brand) {
    for (const a of [...brandAliases(brandKey(brand)), normalizeText(brand)]) for (const w of a.split(' ')) if (w) brandWords.add(stem(w));
  }
  const mine = new Set(tokens(title).map((x) => stem(x.norm)));
  const count = new Map<string, number>();
  const shown = new Map<string, Map<string, number>>();
  for (const c of comparables) {
    const seen = new Set<string>();
    for (const x of tokens(c.title)) {
      const key = stem(x.norm);
      if (key.length < 3 || /^\d+$/.test(key) || isSizeToken(x.norm) || STOP.has(x.norm) || STOP.has(key) || brandWords.has(key) || mine.has(key) || seen.has(key)) continue;
      seen.add(key);
      count.set(key, (count.get(key) ?? 0) + 1);
      const forms = shown.get(key) ?? new Map<string, number>();
      forms.set(x.shown, (forms.get(x.shown) ?? 0) + 1);
      shown.set(key, forms);
    }
  }
  const minCount = Math.max(3, Math.ceil(base * 0.2));
  const words = [...count.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([key, n]): TitleWord => {
      const word = [...shown.get(key)!.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const norm = normalizeText(word);
      return { word, count: n, share: n / base, kind: COLOURS.has(norm) ? 'COLOUR' : CLAIMS.has(norm) ? 'CLAIM' : 'WORD' };
    });
  return { base, words };
}

/** The title with one more word, placed before the ERA reference that ends it (never after). */
export function withWord(title: string, word: string, sku: string): string {
  const tail = ` · ${sku}`;
  return title.endsWith(tail) ? `${title.slice(0, -tail.length)} ${word}${tail}` : `${title} ${word}`;
}
