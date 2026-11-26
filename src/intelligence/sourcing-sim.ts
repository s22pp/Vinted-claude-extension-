import { vintedLanded } from './shopping';

/**
 * « Est-ce que j'achète ? » in five seconds: a purchase price, the extra costs, the resale price expected, and the
 * verdict. The resale is taken 10 % lower (the average haggling on Vinted), so the profit shown is the one a seller
 * really keeps. Pure: no market call, nothing saved.
 *   GO        ROI ≥ 80 % and profit ≥ 20 €
 *   PASSER    profit < 12 € or ROI < 40 %
 *   NÉGOCIER  in between — with the most to pay to reach GO
 */

export const NEGOTIATION_PCT = 10;
export const GO_ROI = 0.8;
export const GO_PROFIT_CENTS = 2000;
export const PASS_ROI = 0.4;
export const PASS_PROFIT_CENTS = 1200;

export type SourcingVerdict = 'GO' | 'NEGOTIATE' | 'PASS';

export interface SourcingInput {
  /** The price asked for the piece (on Vinted: the listed price, before the buyer protection). */
  buyCents: number;
  /** Extra costs: shipping, a trip, cleaning (0 by default). */
  feesCents: number;
  /** The resale price expected (or the market's median from an analysis). */
  resaleCents: number;
  /** Bought on Vinted: the buyer protection (0,70 € + 5 %) is added to the cost. */
  onVinted?: boolean;
}

export interface SourcingResult {
  /** What the piece really costs: the price (+ protection on Vinted) + the extra costs. */
  costCents: number;
  /** The resale after the average haggling. */
  netResaleCents: number;
  profitCents: number;
  /** profit / cost; null when the cost is 0. */
  roi: number | null;
  /** net resale / cost (« x2,5 »); null when the cost is 0. */
  multiple: number | null;
  verdict: SourcingVerdict;
  /** The most to pay (the price asked, as the seller sees it) for ROI ≥ 80 % and profit ≥ 20 €; null when no price can. */
  maxBuyCents: number | null;
}

const euroDown = (c: number) => Math.floor(c / 100) * 100;

export function simulateSourcing(i: SourcingInput, negotiationPct = NEGOTIATION_PCT): SourcingResult {
  const buy = Math.max(0, Math.round(i.buyCents));
  const fees = Math.max(0, Math.round(i.feesCents));
  const netResaleCents = Math.round(Math.max(0, i.resaleCents) * (1 - negotiationPct / 100));
  const landed = i.onVinted ? vintedLanded(buy) : buy;
  const costCents = landed + fees;
  const profitCents = netResaleCents - costCents;
  const roi = costCents > 0 ? profitCents / costCents : null;
  const multiple = costCents > 0 ? netResaleCents / costCents : null;
  const go = profitCents >= GO_PROFIT_CENTS && (roi === null || roi >= GO_ROI);
  const pass = profitCents < PASS_PROFIT_CENTS || (roi !== null && roi < PASS_ROI);
  const verdict: SourcingVerdict = go ? 'GO' : pass ? 'PASS' : 'NEGOTIATE';
  // The landed cost that keeps both GO conditions, then the price asked that lands there.
  const maxLanded = Math.min(netResaleCents / (1 + GO_ROI), netResaleCents - GO_PROFIT_CENTS) - fees;
  const maxBuy = i.onVinted ? (maxLanded - 70) / 1.05 : maxLanded;
  return { costCents, netResaleCents, profitCents, roi, multiple, verdict, maxBuyCents: maxBuy >= 100 ? euroDown(maxBuy) : null };
}
