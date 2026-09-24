import type { Condition, Confidence, Strategy } from '@/domain/entities';
import { type Cents, type MoneyRange, roundToEuro } from '@/domain/money';
import type { ComparableAnalysis } from './comparables';
import type { SegmentStats } from './seller-model';

export interface StrategyOption {
  strategy: Strategy;
  range: MoneyRange;
  /** Expected days to sell at this price — a PREDICTION, always a range. */
  days: { min: number; max: number };
}

export type RecommendationBasis = 'DEMAND_PROVEN' | 'NO_VIEWS' | 'CONDITION' | 'DEFAULT';

export interface PricingResult {
  status: 'OK' | 'INSUFFICIENT_DATA';
  options: StrategyOption[];
  recommended: Strategy | null;
  basis: RecommendationBasis | null;
  confidence: Confidence;
  currentPriceCents: Cents | null;
  /** Where the current price sits vs the recommended range. */
  currentVsRecommended: 'BELOW' | 'WITHIN' | 'ABOVE' | null;
  /** Highest comparable kept: the category ceiling, never exceeded. */
  ceilingCents: Cents | null;
  sampleSize: number;
  personalSample: number;
  /** Expected realised price after typical personal discount/bias. */
  expectedSaleCents: Cents | null;
}

export interface PricingSignals {
  priceCents: Cents | null;
  views: number | null;
  favorites: number | null;
  daysListed: number | null;
  condition: Condition | null;
}

const DEFAULT_DAYS: Record<Strategy, [number, number]> = {
  FAST: [2, 10],
  BALANCED: [5, 21],
  MAX_MARGIN: [14, 45],
};

const DAY_FACTORS: Record<Strategy, [number, number]> = {
  FAST: [0.5, 1],
  BALANCED: [0.8, 1.8],
  MAX_MARGIN: [1.5, 3.5],
};

export function priceStrategies(
  analysis: ComparableAnalysis,
  signals: PricingSignals,
  personal: SegmentStats | null,
  priceCorrection = 1,
): PricingResult {
  const d = analysis.distribution;
  const base: PricingResult = {
    status: 'INSUFFICIENT_DATA',
    options: [],
    recommended: null,
    basis: null,
    confidence: 'LOW',
    currentPriceCents: signals.priceCents,
    currentVsRecommended: null,
    ceilingCents: d?.max ?? null,
    sampleSize: analysis.keptCount,
    personalSample: personal?.sold ?? 0,
    expectedSaleCents: null,
  };
  if (analysis.quality === 'INSUFFICIENT' || !d) return base;

  // "Bon état" and below compete with better-condition listings: shift down.
  const condFactor = signals.condition === 'GOOD' ? 0.9 : signals.condition === 'SATISFACTORY' ? 0.78 : 1;
  const p40 = d.p25 + (d.p50 - d.p25) * 0.6;
  const ceiling = d.max;
  const r = (lo: number, hi: number): MoneyRange => {
    const min = roundToEuro(Math.min(lo * condFactor, ceiling));
    const max = roundToEuro(Math.min(Math.max(hi * condFactor, lo * condFactor), ceiling));
    return { min, max: Math.max(min, max) };
  };

  const personalDays = personal && personal.sold >= 3 ? personal.medianDays : null;
  const days = (s: Strategy) => {
    if (personalDays !== null) {
      const [a, b] = DAY_FACTORS[s];
      return { min: Math.max(1, Math.round(personalDays * a)), max: Math.max(2, Math.round(personalDays * b + 1)) };
    }
    const [a, b] = DEFAULT_DAYS[s];
    return { min: a, max: b };
  };

  const options: StrategyOption[] = [
    { strategy: 'FAST', range: r(d.p25, p40), days: days('FAST') },
    // Base positioning rule: median to median × 1.25, capped by Q3.
    { strategy: 'BALANCED', range: r(d.p50, Math.min(d.p50 * 1.25, d.p75)), days: days('BALANCED') },
    { strategy: 'MAX_MARGIN', range: r(d.p75, d.p75 + (d.p90 - d.p75) * 0.5), days: days('MAX_MARGIN') },
  ];

  let recommended: Strategy = 'BALANCED';
  let basis: RecommendationBasis = 'DEFAULT';
  if ((signals.favorites ?? 0) >= 3 || (signals.views ?? 0) >= 30) {
    recommended = 'MAX_MARGIN';
    basis = 'DEMAND_PROVEN';
  } else if (signals.views === 0 && (signals.daysListed ?? 0) >= 5) {
    recommended = 'BALANCED';
    basis = 'NO_VIEWS';
  } else if (condFactor < 1) {
    basis = 'CONDITION';
  }

  const rec = options.find((o) => o.strategy === recommended)!;
  let currentVsRecommended: PricingResult['currentVsRecommended'] = null;
  if (signals.priceCents !== null) {
    currentVsRecommended =
      signals.priceCents < rec.range.min ? 'BELOW' : signals.priceCents > rec.range.max ? 'ABOVE' : 'WITHIN';
  }

  const personalN = personal?.sold ?? 0;
  const confidence: Confidence =
    analysis.quality === 'HIGH' && personalN >= 5
      ? 'HIGH'
      : analysis.quality === 'HIGH' || (analysis.quality === 'MEDIUM' && personalN >= 3)
        ? 'MEDIUM'
        : 'LOW';

  const discount = personal?.avgDiscount ?? 0;
  const mid = (rec.range.min + rec.range.max) / 2;
  const expectedSaleCents = roundToEuro(mid * (1 + Math.min(0, discount)) * priceCorrection);

  return {
    ...base,
    status: 'OK',
    options,
    recommended,
    basis,
    confidence,
    currentVsRecommended,
    expectedSaleCents,
  };
}
