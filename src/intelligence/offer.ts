import type { Cents } from '@/domain/money';
import { roundToEuro } from '@/domain/money';
import type { PricingResult } from './pricing';

export type OfferVerdict = 'ACCEPT' | 'COUNTER' | 'DECLINE';

export interface OfferLadder {
  /** Accept any offer at or above this. */
  acceptFrom: Cents;
  /** Below this, decline (or counter at the floor). */
  floor: Cents;
  /** The floor's basis: known cost + minimum profit, or the fast-sale range when cost is unknown. */
  floorBasis: 'COST' | 'MARKET' | 'ASK';
  ask: Cents;
}

export interface OfferDecision {
  verdict: OfferVerdict;
  counter: Cents | null;
  profit: Cents | null;
  roi: number | null;
  ladder: OfferLadder;
  reason: 'NEAR_ASK' | 'ABOVE_FLOOR_AGED' | 'ABOVE_FLOOR' | 'BELOW_FLOOR' | 'FAR_BELOW';
}

export interface OfferContext {
  ask: Cents;
  cost: Cents | null;
  pricing: PricingResult | null;
  daysListed: number | null;
  favorites: number | null;
  /** Stagnation threshold (days) from the seller's own rhythm. */
  thresholdDays: number;
}

/** Minimum acceptable profit on a known cost: max(5 €, 25 % of cost). */
export function minProfit(cost: Cents): Cents {
  return Math.max(500, Math.round(cost * 0.25));
}

/**
 * Pre-computed thresholds for an item, so answering an offer takes seconds.
 * The more favourites (demand) the item has, the less room is given; the older it is, the more.
 */
export function offerLadder(c: OfferContext): OfferLadder {
  const fast = c.pricing?.status === 'OK' ? c.pricing.options.find((o) => o.strategy === 'FAST') : undefined;
  const aged = (c.daysListed ?? 0) >= c.thresholdDays;
  const demand = (c.favorites ?? 0) >= 3;
  let floor: Cents;
  let floorBasis: OfferLadder['floorBasis'];
  if (c.cost !== null) {
    floor = c.cost + minProfit(c.cost);
    floorBasis = 'COST';
    if (fast && !aged) floor = Math.max(floor, Math.round(fast.range.min * 0.95));
  } else if (fast) {
    floor = Math.round(fast.range.min * 0.95);
    floorBasis = 'MARKET';
  } else {
    floor = Math.round(c.ask * 0.8);
    floorBasis = 'ASK';
  }
  floor = Math.min(roundToEuro(floor), c.ask);
  const room = demand ? 0.95 : aged ? 0.88 : 0.92;
  const acceptFrom = Math.max(floor, roundToEuro(c.ask * room));
  return { acceptFrom, floor, floorBasis, ask: c.ask };
}

export function evaluateOffer(offer: Cents, c: OfferContext): OfferDecision {
  const ladder = offerLadder(c);
  const profit = c.cost === null ? null : offer - c.cost;
  const roi = c.cost && c.cost > 0 && profit !== null ? profit / c.cost : null;
  const aged = (c.daysListed ?? 0) >= c.thresholdDays;
  if (offer >= ladder.acceptFrom) return { verdict: 'ACCEPT', counter: null, profit, roi, ladder, reason: 'NEAR_ASK' };
  if (offer >= ladder.floor && aged) return { verdict: 'ACCEPT', counter: null, profit, roi, ladder, reason: 'ABOVE_FLOOR_AGED' };
  if (offer >= ladder.floor) {
    const counter = Math.min(ladder.ask, Math.max(ladder.acceptFrom - 100, roundToEuro((offer + ladder.ask) / 2)));
    return { verdict: 'COUNTER', counter, profit, roi, ladder, reason: 'ABOVE_FLOOR' };
  }
  if (offer >= ladder.floor * 0.7) return { verdict: 'COUNTER', counter: ladder.floor === ladder.ask ? ladder.ask : roundToEuro((ladder.floor + ladder.acceptFrom) / 2), profit, roi, ladder, reason: 'BELOW_FLOOR' };
  return { verdict: 'DECLINE', counter: null, profit, roi, ladder, reason: 'FAR_BELOW' };
}
