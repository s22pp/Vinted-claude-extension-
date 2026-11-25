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
}

export type LotProblem = 'COUNT' | 'NOT_IN_STOCK' | 'NO_PRICE';

/** What stops a lot from these articles, or null when it can be made. */
export function lotProblem(items: readonly LotCandidate[]): LotProblem | null {
  if (items.length < LOT_MIN || items.length > LOT_MAX) return 'COUNT';
  if (items.some((i) => !i.inStock)) return 'NOT_IN_STOCK';
  if (items.some((i) => i.askCents === null || i.askCents <= 0)) return 'NO_PRICE';
  return null;
}

export function planSaleLot(items: readonly LotCandidate[], discountPct = LOT_DISCOUNT_PCT): SaleLotPlan | null {
  if (lotProblem(items)) return null;
  const totalAskCents = items.reduce((s, i) => s + (i.askCents ?? 0), 0);
  const costCents = items.reduce((s, i) => s + (i.costCents ?? 0), 0);
  const costComplete = items.every((i) => i.costCents !== null);
  const raw = Math.floor((totalAskCents * (1 - discountPct / 100)) / 100) * 100;
  const floor = Math.ceil(costCents / 100) * 100;
  const lotCents = Math.max(100, raw, floor);
  return { itemIds: items.map((i) => i.itemId), totalAskCents, lotCents, costCents, costComplete, profitCents: costComplete ? lotCents - costCents : null, atCost: floor > raw };
}

/** The articles asleep in the stock (≥ 30 days online), the longest first: what a lot is for. */
export function dormant(items: readonly LotCandidate[]): LotCandidate[] {
  return items.filter((i) => i.inStock && i.askCents !== null && (i.daysListed ?? 0) >= DORMANT_DAYS).sort((a, b) => (b.daysListed ?? 0) - (a.daysListed ?? 0));
}

/** The lot's listing text, for the seller to post: the title and one line per article. */
export function lotListing(items: readonly LotCandidate[], plan: SaleLotPlan, eur: (cents: number) => string): { title: string; description: string } {
  const title = `Lot de ${items.length} articles · ${eur(plan.lotCents)} au lieu de ${eur(plan.totalAskCents)}`;
  const description = [`Lot de ${items.length} articles, vendus ensemble :`, ...items.map((i) => `– ${i.title}${i.askCents !== null ? ` (${eur(i.askCents)} à l’unité)` : ''}`), '', `Prix du lot : ${eur(plan.lotCents)} au lieu de ${eur(plan.totalAskCents)} (−${LOT_DISCOUNT_PCT} %). Envoi groupé.`].join('\n');
  return { title, description };
}
