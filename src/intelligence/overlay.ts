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
  sold: number;
  avoid: boolean;
}

export const OVERLAY_KEY = 'eraOverlayNiches';
export const OVERLAY_ON_KEY = 'eraOverlayOn';

export function overlayNiches(list: { buy: readonly ShoppingLine[]; avoid: readonly ShoppingLine[] }): OverlayNiche[] {
  const pick = (l: ShoppingLine, avoid: boolean): OverlayNiche | null =>
    l.brand ? { brand: l.brand, category: l.category, label: l.label, maxVintedPriceCents: l.maxVintedPriceCents, medianSaleCents: l.medianSaleCents, sold: l.sold, avoid } : null;
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
  return { kind, niche: n.label, landedCents: landed, maxVintedPriceCents: n.maxVintedPriceCents, marginCents: n.medianSaleCents - landed, sold: n.sold };
}
