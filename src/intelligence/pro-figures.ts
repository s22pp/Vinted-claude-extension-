/**
 * A professional seller's figures (pure), in cents:
 *  - the projected net: the asking price less the usual negotiation (an assumption, 10 % unless the seller changes it —
 *    said as such, never mixed with realised profit), less the full cost (purchase + extras);
 *  - three offer tiers: the floor (30 % return on the cost, rounded up to the euro), the target (−10 %), the firm price;
 *  - the rotation of a listing by days online: fresh, to watch, stalling.
 * An unknown cost gives no profit, no ROI and no floor: never zero.
 */

export const NEGOTIATION_DEFAULT = 0.1;
export const FLOOR_ROI = 0.3;

const euroUp = (cents: number) => Math.ceil(cents / 100) * 100;
const euroRound = (cents: number) => Math.round(cents / 100) * 100;

export interface Projection {
  /** Asking price after the assumed negotiation. */
  netSaleCents: number;
  profitCents: number | null;
  /** Profit over total cost, as a fraction (0.42 = 42 %); null without a cost. */
  roi: number | null;
}

export function projectNet(askCents: number, costCents: number | null, extraCents = 0, negotiation = NEGOTIATION_DEFAULT): Projection {
  const n = Math.min(Math.max(negotiation, 0), 0.9);
  const netSaleCents = Math.round(askCents * (1 - n));
  if (costCents === null) return { netSaleCents, profitCents: null, roi: null };
  const total = costCents + Math.max(0, extraCents);
  const profitCents = netSaleCents - total;
  return { netSaleCents, profitCents, roi: total > 0 ? profitCents / total : null };
}

export interface OfferTiers {
  /** 30 % return on the full cost, rounded up to the euro; null without a cost. */
  floor: number | null;
  /** −10 %, to the nearest euro. */
  target: number;
  firm: number;
}

export function offerTiers(askCents: number, costCents: number | null, extraCents = 0): OfferTiers {
  return {
    floor: costCents === null ? null : euroUp((costCents + Math.max(0, extraCents)) * (1 + FLOOR_ROI)),
    target: euroRound(askCents * 0.9),
    firm: askCents,
  };
}

export type Rotation = 'FRESH' | 'WATCH' | 'STALE';
export type RotationAdvice = null | 'GROUP_OFFER' | 'REPOST_CUT';

/** 0–14 days: fresh. 15–29: to watch (5 favourites or more and no offer: a group offer). 30 or more: stalling. */
export function rotation(daysOnline: number | null, favourites: number | null, offers: number | null): { state: Rotation | null; advice: RotationAdvice } {
  if (daysOnline === null || !Number.isFinite(daysOnline) || daysOnline < 0) return { state: null, advice: null };
  if (daysOnline < 15) return { state: 'FRESH', advice: null };
  if (daysOnline < 30) return { state: 'WATCH', advice: (favourites ?? 0) >= 5 && (offers ?? 0) === 0 ? 'GROUP_OFFER' : null };
  return { state: 'STALE', advice: 'REPOST_CUT' };
}
