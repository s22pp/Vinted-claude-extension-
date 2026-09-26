import type { Category, Condition } from '@/domain/entities';
import { brandDisplay, brandInTitle, brandKey, categoriesInTitle, normalizeText } from './normalize';
import type { SellerModel } from './seller-model';

/**
 * A lot bought at once (a bag at a flea market, a bundle on Vinted): one line per article, typed as you would
 * say it ("Chemise Pierre Cardin L très bon état"), turned into articles to list, and the price paid split
 * between them. Nothing is guessed that the line does not say: an unread brand stays "Inconnue".
 */

export interface LotLine {
  title: string;
  brand: string;
  brandKnown: boolean;
  category: Category;
  size: string | null;
  condition: Condition | null;
}

const CONDITIONS: [RegExp, Condition][] = [
  [/\bneuf avec etiquettes?\b|\bnwt\b/, 'NEW_WITH_TAGS'],
  [/\bneuf sans etiquettes?\b|\bneuf\b/, 'NEW_WITHOUT_TAGS'],
  [/\btres bon etat\b|\btbe\b/, 'VERY_GOOD'],
  [/\bbon etat\b|\bbe\b/, 'GOOD'],
  [/\betat satisfaisant\b|\bsatisfaisant\b/, 'SATISFACTORY'],
];

/** The size as written: "taille M", "T42", or a size alone at the end ("… L", "… W32", "… 42"). */
const SIZE_WORD = /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|w\d{2}(l\d{2})?|t\d)$/i;
/** A number is a size only in the range sizes use (EU 30–58); "Air Max 90", "501" are models. */
const isSize = (w: string) => SIZE_WORD.test(w) || (/^\d{2}([.,]5)?$/.test(w) && Number(w.replace(',', '.')) >= 30 && Number(w.replace(',', '.')) <= 58);

function sizeOf(raw: string): { size: string | null; rest: string } {
  const named = /\btaille\s+([a-z0-9]{1,6})\b/i.exec(raw);
  if (named && isSize(named[1]!)) return { size: named[1]!.toUpperCase(), rest: raw.replace(named[0], ' ') };
  const words = raw.split(/\s+/);
  for (let i = words.length - 1; i >= Math.max(0, words.length - 3); i--) {
    const w = words[i]!.replace(/[^\w.,]/g, '');
    if (w && isSize(w) && i > 0) return { size: w.toUpperCase(), rest: [...words.slice(0, i), ...words.slice(i + 1)].join(' ') };
  }
  return { size: null, rest: raw };
}

export function parseLotLine(line: string): LotLine | null {
  const raw = line.replace(/^\s*[-•*\d.)]+\s+/, '').trim();
  if (!raw) return null;
  const norm = normalizeText(raw);
  const cond = CONDITIONS.find(([re]) => re.test(norm));
  // The condition words leave the title (they go to the condition field).
  let text = raw;
  if (cond) text = text.replace(/\s*[-–,·]?\s*(neuf (avec|sans) [ée]tiquettes?|neuf|tr[èe]s bon [ée]tat|bon [ée]tat|[ée]tat satisfaisant|satisfaisant|tbe|nwt)\b\s*/gi, ' ');
  const { size, rest } = sizeOf(text);
  const title = rest.replace(/\s*[-–,·|]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  const bk = brandInTitle(title);
  return {
    title: title || raw,
    brand: bk ? brandDisplay(bk) : 'Inconnue',
    brandKnown: !!bk,
    category: categoriesInTitle(normalizeText(title))[0] ?? 'OTHER',
    size,
    condition: cond ? cond[1] : null,
  };
}

export function parseLot(text: string): LotLine[] {
  return text
    .split('\n')
    .map(parseLotLine)
    .filter((l): l is LotLine => l !== null)
    .slice(0, 100);
}

/**
 * What an article of this kind usually sells for, from YOUR sales (niche, else brand, else category); null if
 * you never sold one. Used only to split a lot's price in proportion — never shown as a price.
 */
export function expectedValue(model: SellerModel, l: LotLine): number | null {
  const bk = l.brandKnown ? brandKey(l.brand) : null;
  const niche = bk ? model.byNiche.find((s) => s.brand === bk && s.category === l.category && s.sold >= 2) : undefined;
  const brand = bk ? model.byBrand.find((s) => s.brand === bk && s.sold >= 2) : undefined;
  const cat = model.byCategory.find((s) => s.category === l.category && s.sold >= 2);
  return niche?.medianSaleCents ?? brand?.medianSaleCents ?? cat?.medianSaleCents ?? null;
}

/**
 * Split `totalCents` over the lines, exactly (the parts add up to the total, to the cent). By expected value:
 * lines with no history weigh the average of the known ones; with no history at all, equal parts.
 */
export function splitLot(totalCents: number, values: readonly (number | null)[], mode: 'EQUAL' | 'VALUE'): number[] {
  const n = values.length;
  if (n === 0) return [];
  const known = values.filter((v): v is number => v !== null && v > 0);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const weights = mode === 'EQUAL' || known.length === 0 ? values.map(() => 1) : values.map((v) => (v !== null && v > 0 ? v : avg));
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (totalCents * w) / sum);
  const parts = exact.map(Math.floor);
  // Largest remainders get the leftover cents.
  let left = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left--;
  }
  return parts;
}
