import type { Category } from '@/domain/entities';
import type { ItemIntel } from './decision';
import { titleIssues } from './listing';

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
