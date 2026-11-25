import type { Category } from '@/domain/entities';
import { EXCLUDED_TERMS, brandInTitle, categoriesInTitle, categoryAffinity, normalizeText } from './normalize';
import type { ShoppingLine } from './shopping';
import { vintedLanded } from './shopping';

/**
 * ERA's marks on Vinted's own pages: for a listing shown there (a search, a profile, an item), whether it falls
 * in one of YOUR niches and what it would leave you. Only what the page itself shows (title, price) is read —
 * no extra request. The niches come from your own sales (the shopping list), never from the market alone.
 */

/** What the page script needs of a niche: small, JSON, stored in chrome.storage for the vinted.fr pages. */
export interface OverlayNiche {
  brand: string;
  category: Category | null;
  label: string;
  maxVintedPriceCents: number;
  medianSaleCents: number;
  /** Your own price range in the niche (25th–75th percentile of what you cashed in); absent from older data. */
  lowSaleCents?: number;
  highSaleCents?: number;
  sold: number;
  avoid: boolean;
}

export const OVERLAY_KEY = 'eraOverlayNiches';
export const OVERLAY_ON_KEY = 'eraOverlayOn';

export function overlayNiches(list: { buy: readonly ShoppingLine[]; avoid: readonly ShoppingLine[] }): OverlayNiche[] {
  const pick = (l: ShoppingLine, avoid: boolean): OverlayNiche | null =>
    l.brand
      ? {
          brand: l.brand,
          category: l.category,
          label: l.label,
          maxVintedPriceCents: l.maxVintedPriceCents,
          medianSaleCents: l.medianSaleCents,
          ...(l.lowSaleCents != null && l.highSaleCents != null ? { lowSaleCents: l.lowSaleCents, highSaleCents: l.highSaleCents } : {}),
          sold: l.sold,
          avoid,
        }
      : null;
  return [...list.buy.map((l) => pick(l, false)), ...list.avoid.map((l) => pick(l, true))].filter((x): x is OverlayNiche => x !== null);
}

export type MarkKind = 'DEAL' | 'ABOVE_MAX' | 'AVOID';
export interface Mark {
  kind: MarkKind;
  niche: string;
  landedCents: number;
  maxVintedPriceCents: number;
  /** Your usual sale price minus what it would cost you (shipping excluded). */
  marginCents: number;
  sold: number;
  /** What you usually sell this niche for: the median, and the middle half when known (« Cote ERA »). */
  medianSaleCents: number;
  range: { lo: number; hi: number } | null;
}

/** « 24–35 € », or « ~30 € » when there is no range (or a single price). */
export function coteText(m: Pick<Mark, 'medianSaleCents' | 'range'>): string {
  const e = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace('.', ','));
  return m.range && m.range.hi > m.range.lo ? `${e(m.range.lo)}–${e(m.range.hi)} €` : `~${e(m.medianSaleCents)} €`;
}

/** « +18,80 € », « −3,05 € »: an estimated margin always carries its sign. */
export function signedEur(cents: number): string {
  const abs = Math.abs(cents);
  const txt = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2).replace('.', ',');
  return `${cents < 0 ? '−' : '+'}${txt} €`;
}

/** Price as a page shows it: "45,00 €", "€45.00", "45 €" — the first amount. */
export function priceFromText(text: string): number | null {
  const m = /(\d{1,5}(?:[ \u00a0\u202f.]\d{3})*(?:[.,]\d{1,2})?)\s?€|€\s?(\d{1,5}(?:[.,]\d{1,2})?)/.exec(text);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const n = Number(raw.replace(/[ \u00a0\u202f]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** The mark for one listing (its title/description text and its price), or null when no niche of yours applies. */
export function markFor(text: string, priceCents: number | null, niches: readonly OverlayNiche[]): Mark | null {
  if (priceCents === null) return null;
  const nt = normalizeText(text);
  if (EXCLUDED_TERMS.test(nt)) return null;
  const brand = brandInTitle(text);
  if (!brand) return null;
  const cats = categoriesInTitle(nt);
  const n = niches.find((x) => x.brand === brand && (x.category === null || x.category === 'OTHER' || cats.length === 0 || cats.some((c) => categoryAffinity(x.category!, c) >= 0.5)));
  if (!n) return null;
  const landed = vintedLanded(priceCents);
  const kind: MarkKind = n.avoid ? 'AVOID' : priceCents <= n.maxVintedPriceCents ? 'DEAL' : 'ABOVE_MAX';
  const range = typeof n.lowSaleCents === 'number' && typeof n.highSaleCents === 'number' && n.highSaleCents >= n.lowSaleCents ? { lo: n.lowSaleCents, hi: n.highSaleCents } : null;
  return { kind, niche: n.label, landedCents: landed, maxVintedPriceCents: n.maxVintedPriceCents, marginCents: n.medianSaleCents - landed, sold: n.sold, medianSaleCents: n.medianSaleCents, range };
}
