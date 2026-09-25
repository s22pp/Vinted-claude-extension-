import type { Confidence, PricePrediction, Strategy } from '@/domain/entities';
import { type Cents, roundToEuro } from '@/domain/money';
import type { ComparableAnalysis } from './comparables';
import { predictedPrice } from './learning';
import type { PricingResult } from './pricing';
import type { SegmentStats } from './seller-model';
import { median } from './stats';

/**
 * Freeze what ERA predicts NOW — price, delay, confidence and the exact data used — so it can be
 * confronted with the real sale later. Pure: the caller stores it.
 */
export function buildPrediction(args: {
  itemId: string;
  at: number;
  analysis: ComparableAnalysis;
  pricing: PricingResult;
  personal: SegmentStats | null;
  askCents: Cents | null;
  correction: number;
  kind: PricePrediction['kind'];
  isDemo: boolean;
  /** Accepted recommendation: the price the seller chose. Defaults to the recommended strategy's range mid. */
  suggestedCents?: Cents | null;
  strategy?: Strategy | null;
}): Omit<PricePrediction, 'id' | 'resolved'> | null {
  const { pricing, analysis } = args;
  if (pricing.status !== 'OK') return null;
  const dist = (x: PricingResult['options'][number], c: number) => (c < x.range.min ? x.range.min - c : c > x.range.max ? c - x.range.max : 0);
  const target = args.suggestedCents ?? null;
  // A chosen price is judged with the delay of the strategy whose range it falls in (or is closest to).
  const strategy =
    args.strategy ?? (target !== null ? [...pricing.options].sort((a, b) => dist(a, target) - dist(b, target))[0]?.strategy : pricing.recommended);
  const o = pricing.options.find((x) => x.strategy === strategy);
  if (!o) return null;
  const suggested = args.suggestedCents ?? roundToEuro((o.range.min + o.range.max) / 2);
  const d = analysis.distribution;
  return {
    inventoryItemId: args.itemId,
    at: args.at,
    strategy: o.strategy,
    // A price the seller picked outside the strategy range still gets judged on its own range.
    priceMinCents: Math.min(o.range.min, suggested),
    priceMaxCents: Math.max(o.range.max, suggested),
    daysMin: o.days.min,
    daysMax: o.days.max,
    confidence: pricing.confidence,
    sampleSize: analysis.keptCount,
    kind: args.kind,
    suggestedCents: suggested,
    basis: {
      comparables: analysis.keptCount,
      p25: d?.p25 ?? null,
      p50: d?.p50 ?? null,
      p75: d?.p75 ?? null,
      source: analysis.source,
      quality: analysis.quality,
      personalN: args.personal?.sold ?? 0,
      personalMedianCents: args.personal?.medianSaleCents ?? null,
      personalMedianDays: args.personal?.medianDays ?? null,
      askCents: args.askCents,
      correction: args.correction,
    },
    isDemo: args.isDemo,
  };
}

export interface PrecisionRow {
  id: string;
  itemId: string;
  at: number;
  kind: PricePrediction['kind'];
  strategy: Strategy;
  confidence: Confidence;
  predictedCents: number;
  range: { min: Cents; max: Cents };
  days: { min: number; max: number };
  basis: PricePrediction['basis'];
  actual: { cents: Cents; days: number; at: number } | null;
  /** Real − predicted, in cents and relative. Null while the item is unsold. */
  priceErrorCents: number | null;
  priceErrorPct: number | null;
  /** 0 when the real delay fell inside the forecast range; otherwise days outside it (signed). */
  delayErrorDays: number | null;
  priceInRange: boolean | null;
  delayInRange: boolean | null;
}

export function precisionRows(predictions: readonly PricePrediction[]): PrecisionRow[] {
  return predictions
    .map((p) => {
      const predicted = predictedPrice(p);
      const r = p.resolved;
      return {
        id: p.id,
        itemId: p.inventoryItemId,
        at: p.at,
        kind: p.kind ?? 'ANALYSIS',
        strategy: p.strategy,
        confidence: p.confidence,
        predictedCents: predicted,
        range: { min: p.priceMinCents, max: p.priceMaxCents },
        days: { min: p.daysMin, max: p.daysMax },
        basis: p.basis ?? null,
        actual: r ? { cents: r.salePriceCents, days: r.days, at: r.at } : null,
        priceErrorCents: r ? r.salePriceCents - predicted : null,
        priceErrorPct: r ? (r.salePriceCents - predicted) / predicted : null,
        delayErrorDays: r ? r.timeErrorDays : null,
        priceInRange: r ? r.priceInRange : null,
        delayInRange: r ? r.timeInRange : null,
      };
    })
    .sort((a, b) => (b.actual?.at ?? b.at) - (a.actual?.at ?? a.at));
}

export interface PrecisionSummary {
  resolved: number;
  open: number;
  /** Median absolute price error in cents and %. */
  medianAbsErrorCents: number | null;
  medianAbsErrorPct: number | null;
  /** Median signed error: < 0 = you sell under ERA's price. */
  medianSignedErrorPct: number | null;
  priceHitRate: number | null;
  delayHitRate: number | null;
  medianAbsDelayErrorDays: number | null;
}

export function precisionSummary(rows: readonly PrecisionRow[]): PrecisionSummary {
  const done = rows.filter((r) => r.actual);
  const n = done.length;
  return {
    resolved: n,
    open: rows.length - n,
    medianAbsErrorCents: n ? median(done.map((r) => Math.abs(r.priceErrorCents!))) : null,
    medianAbsErrorPct: n ? median(done.map((r) => Math.abs(r.priceErrorPct!))) : null,
    medianSignedErrorPct: n ? median(done.map((r) => r.priceErrorPct!)) : null,
    priceHitRate: n ? done.filter((r) => r.priceInRange).length / n : null,
    delayHitRate: n ? done.filter((r) => r.delayInRange).length / n : null,
    medianAbsDelayErrorDays: n ? median(done.map((r) => Math.abs(r.delayErrorDays!))) : null,
  };
}
