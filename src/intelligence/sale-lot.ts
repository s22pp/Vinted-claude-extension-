import type { Category } from '@/domain/entities';
import { TITLE_WORD } from './listing';
import { normalizeText } from './normalize';

/**
 * « Créer un lot »: two to five articles that sleep in the stock, sold together. The lot's price is the sum of their
 * asking prices minus 15 %, rounded down to the euro; the sum of the purchase costs is shown beside it (a cost unknown
 * stays unknown — never counted as 0). The lot never goes under the sum of the known costs.
 */

export const LOT_MIN = 2;
export const LOT_MAX = 5;
export const LOT_DISCOUNT_PCT = 15;
/** Asleep: online this many days or more. */
export const DORMANT_DAYS = 30;

export interface LotCandidate {
  itemId: string;
  title: string;
  askCents: number | null;
  costCents: number | null;
  daysListed: number | null;
  inStock: boolean;
  /** For the lot's title and hashtags (absent: left out). */
  brand?: string | null;
  size?: string | null;
  category?: Category | null;
}

export interface SaleLotPlan {
  itemIds: string[];
  totalAskCents: number;
  lotCents: number;
  /** Sum of the known costs; `costComplete` false when one at least is unknown. */
  costCents: number;
  costComplete: boolean;
  /** lotCents − costs, only when every cost is known. */
  profitCents: number | null;
  /** The known costs held the price up (the −15 % would have gone under them). */
  atCost: boolean;
  /** The discount applied (−15 % unless the seller changed it). */
  discountPct: number;
}

export type LotProblem = 'COUNT' | 'NOT_IN_STOCK' | 'NO_PRICE';

/** What stops a lot from these articles, or null when it can be made. */
export function lotProblem(items: readonly LotCandidate[]): LotProblem | null {
  if (items.length < LOT_MIN || items.length > LOT_MAX) return 'COUNT';
  if (items.some((i) => !i.inStock)) return 'NOT_IN_STOCK';
  if (items.some((i) => i.askCents === null || i.askCents <= 0)) return 'NO_PRICE';
  return null;
}

/** The discount a seller may type: 0 to 60 %, whole percents. */
export const clampDiscount = (pct: number) => (Number.isFinite(pct) ? Math.min(60, Math.max(0, Math.round(pct))) : LOT_DISCOUNT_PCT);

export function planSaleLot(items: readonly LotCandidate[], discount = LOT_DISCOUNT_PCT): SaleLotPlan | null {
  if (lotProblem(items)) return null;
  const discountPct = clampDiscount(discount);
  const totalAskCents = items.reduce((s, i) => s + (i.askCents ?? 0), 0);
  const costCents = items.reduce((s, i) => s + (i.costCents ?? 0), 0);
  const costComplete = items.every((i) => i.costCents !== null);
  const raw = Math.floor((totalAskCents * (1 - discountPct / 100)) / 100) * 100;
  const floor = Math.ceil(costCents / 100) * 100;
  const lotCents = Math.max(100, raw, floor);
  return { itemIds: items.map((i) => i.itemId), totalAskCents, lotCents, costCents, costComplete, profitCents: costComplete ? lotCents - costCents : null, atCost: floor > raw, discountPct };
}

/** The articles asleep in the stock (≥ 30 days online), the longest first: what a lot is for. */
export function dormant(items: readonly LotCandidate[]): LotCandidate[] {
  return items.filter((i) => i.inStock && i.askCents !== null && (i.daysListed ?? 0) >= DORMANT_DAYS).sort((a, b) => (b.daysListed ?? 0) - (a.daysListed ?? 0));
}

const known = (b: string | null | undefined) => (b && !/^(inconnue?|sans marque)$/i.test(b.trim()) ? b.trim() : '');

/** The lot's hashtags: #lot, then each brand and kind of article, then resale tags — 10 to 15, no duplicates. */
export function lotHashtags(items: readonly LotCandidate[]): string[] {
  const tag = (x: string) => `#${normalizeText(x).replace(/[^a-z0-9]+/g, '')}`;
  const raw = ['lot', 'lotvetements', ...items.map((i) => known(i.brand)), ...items.map((i) => (i.category ? TITLE_WORD[i.category] : '')), ...items.map((i) => (i.size ? `taille${i.size}` : '')), 'bonplan', 'friperie', 'secondemain', 'modedurable', 'thrift', 'vintagestyle', 'ootd', 'style'];
  const tags = [...new Set(raw.filter(Boolean).map(tag).filter((x) => x.length > 2))];
  return tags.slice(0, Math.max(10, Math.min(15, tags.length)));
}

/** The lot's listing, for the seller to post: the title, one line per piece, the price and the hashtags. */
export function lotListing(items: readonly LotCandidate[], plan: SaleLotPlan, eur: (cents: number) => string): { title: string; description: string; hashtags: string[] } {
  const brands = [...new Set(items.map((i) => known(i.brand)).filter(Boolean))];
  const named = brands.length ? ` ${brands.slice(0, 2).join(' · ')}${brands.length > 2 ? '…' : ''}` : '';
  // Its brands when the title still fits Vinted's 60 characters (the « au lieu de » then goes to the description).
  const branded = `Lot de ${items.length} articles${named} · ${eur(plan.lotCents)} (−${plan.discountPct} %)`;
  const title = named && branded.length <= 60 ? branded : `Lot de ${items.length} articles · ${eur(plan.lotCents)} au lieu de ${eur(plan.totalAskCents)}`;
  const tags = lotHashtags(items);
  const description = [
    `Lot de ${items.length} articles, vendus ensemble :`,
    ...items.map((i) => `– ${i.title}${i.askCents !== null ? ` (${eur(i.askCents)} à l’unité)` : ''}`),
    '',
    `Prix du lot : ${eur(plan.lotCents)} au lieu de ${eur(plan.totalAskCents)} (−${plan.discountPct} %). Envoi groupé, sous 24 h.`,
    '',
    tags.join(' '),
  ].join('\n');
  return { title, description, hashtags: tags };
}
