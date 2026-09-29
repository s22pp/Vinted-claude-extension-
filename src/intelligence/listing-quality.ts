import type { Category, InventoryItem, Prep } from '@/domain/entities';
import type { ItemIntel } from './decision';
import { CONDITION_TEXT, titleIssues } from './listing';
import { normalizeText } from './normalize';
import { cm, measureFields } from './workshop';

/**
 * What holds each live listing back, from what Vinted shows of it (photos, title, description) and how it does
 * (views, favourites, price against the market). Only what was read: an unread description is "not read", never
 * "empty". The thresholds are ERA's working rules, not Vinted's.
 */

export type QualityIssue =
  | 'FEW_PHOTOS'
  | 'NO_LABEL_PHOTOS'
  | 'TITLE'
  | 'SHORT_DESC'
  | 'NO_MEASURES'
  | 'PRICE_HIGH'
  | 'LOW_VIEWS'
  | 'FAVS_NO_SALE';

export interface ListingQuality {
  itemId: string;
  platformListingId: string | null;
  title: string;
  priceCents: number;
  issues: { code: QualityIssue; params: Record<string, string | number> }[];
  /** Higher = more to gain: severity of the issues × the money waiting on the listing. */
  score: number;
  /** What was not read: shown so a clean-looking listing is not taken as checked. */
  unread: ('photos' | 'description')[];
}

const WEIGHT: Record<QualityIssue, number> = { FEW_PHOTOS: 3, NO_LABEL_PHOTOS: 1, TITLE: 2, SHORT_DESC: 2, NO_MEASURES: 2, PRICE_HIGH: 3, LOW_VIEWS: 2, FAVS_NO_SALE: 2 };
/** Clothing where fit matters: measures are expected. */
const MEASURED: Category[] = ['JACKET', 'COAT', 'SWEATSHIRT', 'KNIT', 'SHIRT', 'POLO', 'TSHIRT', 'JEANS', 'TROUSERS', 'SHORTS'];
const MEASURE_RE = /\b\d{2,3}([.,]\d)?\s?cm\b|\b(aisselle|epaule|épaule|longueur|tour de taille|entrejambe)\b/i;

export function listingQuality(x: ItemIntel): ListingQuality | null {
  const v = x.view;
  const l = v.current;
  if (!l || !v.inStock || v.item.isDemo) return null;
  const issues: ListingQuality['issues'] = [];
  const unread: ListingQuality['unread'] = [];
  if (l.photoCount == null) unread.push('photos');
  else if (l.photoCount < 5) issues.push({ code: 'FEW_PHOTOS', params: { n: l.photoCount } });
  else if (l.photoCount < 7 && !['OTHER', 'ACCESSORY'].includes(v.item.category)) issues.push({ code: 'NO_LABEL_PHOTOS', params: { n: l.photoCount } });
  const ti = titleIssues(l.title, v.item.brand).filter((i) => i.severity === 'block' || i.code === 'TOO_LONG');
  if (ti.length) issues.push({ code: 'TITLE', params: { what: ti.map((i) => i.code).join(',') } });
  if (l.description == null) unread.push('description');
  else {
    if (l.description.trim().length < 80) issues.push({ code: 'SHORT_DESC', params: { n: l.description.trim().length } });
    if (MEASURED.includes(v.item.category) && !MEASURE_RE.test(l.description)) issues.push({ code: 'NO_MEASURES', params: {} });
  }
  const pos = x.analysis && !x.analysisStale ? x.analysis.position : null;
  if (pos && pos.deltaPct > 0.15) issues.push({ code: 'PRICE_HIGH', params: { pct: Math.round(pos.deltaPct * 100) } });
  const st = x.stagnation;
  if (st?.state === 'LOW_VISIBILITY') issues.push({ code: 'LOW_VIEWS', params: { views: st.views ?? 0, days: st.daysListed } });
  if (st?.state === 'FAVORITES_NO_CONVERSION') issues.push({ code: 'FAVS_NO_SALE', params: { favs: st.favorites ?? 0 } });
  const severity = issues.reduce((a, i) => a + WEIGHT[i.code], 0);
  // Money waiting: a 60 € listing held back matters more than a 5 € one (log, so cheap ones still count).
  const score = severity * Math.log10(10 + l.priceCents / 100);
  return { itemId: v.item.id, platformListingId: l.platformListingId, title: l.title, priceCents: l.priceCents, issues, score, unread };
}

export function qualityReport(intel: readonly ItemIntel[]): { rows: ListingQuality[]; checked: number; unreadDesc: number } {
  const all = intel.map(listingQuality).filter((q): q is ListingQuality => q !== null);
  return {
    rows: all.filter((q) => q.issues.length > 0).sort((a, b) => b.score - a.score),
    checked: all.length,
    unreadDesc: all.filter((q) => q.unread.includes('description')).length,
  };
}

/* ── Completing a live listing's description ────────────── */

export type DescAddition = 'size' | 'condition' | 'defects' | 'material' | 'measures';

export interface CompletedDescription {
  text: string;
  /** What was added under the seller's own text, in order. */
  added: DescAddition[];
  /** "__" left to fill (a measure ERA does not know): the description cannot be sent to Vinted with any left. */
  blanks: number;
}

const MATERIAL_WORDS = /composition|matiere|coton|laine|polyester|cuir|\blin\b|soie|cachemire|viscose|elasthanne|nylon|acrylique|denim/;
const CONDITION_WORDS = /\betat\b|\bneuf\b|tres bon|bon etat|satisfaisant|jamais porte/;

/**
 * A live listing's description, completed — never rewritten: the seller's text stays as it is and only what is
 * missing is added below it, from what ERA knows (size, condition, the sheet's defects, material and measures).
 * A measure ERA does not know is left as "__" for the seller to fill: no measure or composition is ever invented.
 */
export function completeDescription(
  current: string,
  item: Pick<InventoryItem, 'category' | 'size' | 'condition' | 'material'>,
  prep: Pick<Prep, 'measures' | 'defects' | 'material'> | null,
  measureLabel: (k: string) => string,
): CompletedDescription {
  const base = current.trim();
  const low = normalizeText(base);
  const added: DescAddition[] = [];
  const lines: string[] = [];
  if (item.size && !/\btaille\b|\bsize\b/.test(low)) {
    lines.push(`• Taille : ${item.size}`);
    added.push('size');
  }
  if (item.condition && !CONDITION_WORDS.test(low)) {
    lines.push(`• État : ${CONDITION_TEXT[item.condition]}`);
    added.push('condition');
  }
  const defects = prep?.defects.trim();
  if (defects && !low.includes(normalizeText(defects).slice(0, 24))) {
    lines.push(`• Défauts : ${defects}`);
    added.push('defects');
  }
  const material = prep?.material.trim() || item.material || '';
  if (material && !MATERIAL_WORDS.test(low)) {
    lines.push(`• Composition : ${material}`);
    added.push('material');
  }
  if (MEASURED.includes(item.category) && !MEASURE_RE.test(base)) {
    const m = prep?.measures ?? {};
    lines.push(`• Mesures à plat : ${measureFields(item.category)
      // Unknown: "__ cm", so the seller types the number only and the unit stays.
      .map((k) => `${measureLabel(k)} ${m[k]?.trim() ? cm(m[k]) : '__ cm'}`)
      .join(' · ')}`);
    added.push('measures');
  }
  const text = lines.length ? `${base}${base ? '\n\n' : ''}${lines.join('\n')}` : base;
  return { text, added, blanks: (text.match(/__/g) ?? []).length };
}
