import type { Confidence, PricePrediction } from '@/domain/entities';
import { daysBetween } from '@/domain/time';
import { mean, median } from './stats';

type Resolved = NonNullable<PricePrediction['resolved']>;

/** Confront a stored prediction with what actually happened. */
export function resolvePrediction(p: PricePrediction, sale: { soldAt: number; salePriceCents: number }): Resolved {
  const mid = (p.priceMinCents + p.priceMaxCents) / 2;
  const days = daysBetween(p.at, sale.soldAt);
  const timeErrorDays = days < p.daysMin ? days - p.daysMin : days > p.daysMax ? days - p.daysMax : 0;
  return {
    at: sale.soldAt,
    salePriceCents: sale.salePriceCents,
    days,
    priceError: (sale.salePriceCents - mid) / mid,
    timeErrorDays,
    priceInRange: sale.salePriceCents >= p.priceMinCents && sale.salePriceCents <= p.priceMaxCents,
    timeInRange: timeErrorDays === 0,
  };
}

export interface CalibrationBucket {
  confidence: Confidence;
  n: number;
  hitRate: number | null;
  /** What a well-calibrated engine should hit at this confidence. */
  target: number;
}

export interface LearningSummary {
  resolved: number;
  open: number;
  /** Mean absolute percentage error on price (vs predicted range mid). */
  priceMape: number | null;
  /** Median signed error: −0.06 = you sell 6 % under ERA's mid. */
  priceBias: number | null;
  priceHitRate: number | null;
  timeHitRate: number | null;
  medianTimeErrorDays: number | null;
  calibration: CalibrationBucket[];
  /** Multiplicative correction applied to future expected sale prices (shrunk toward 1 on small samples). */
  priceCorrection: number;
  /** Rolling MAPE over time (oldest → newest), to show whether ERA improves. */
  trend: { at: number; mape: number }[];
}

const TARGET: Record<Confidence, number> = { LOW: 0.4, MEDIUM: 0.6, HIGH: 0.75 };

export function summarizeLearning(predictions: readonly PricePrediction[]): LearningSummary {
  const res = predictions.filter((p) => p.resolved).sort((a, b) => a.resolved!.at - b.resolved!.at);
  const errs = res.map((p) => p.resolved!.priceError);
  const calibration = (['LOW', 'MEDIUM', 'HIGH'] as Confidence[]).map((c) => {
    const bucket = res.filter((p) => p.confidence === c);
    const hits = bucket.filter((p) => p.resolved!.priceInRange).length;
    return { confidence: c, n: bucket.length, hitRate: bucket.length ? hits / bucket.length : null, target: TARGET[c] };
  });
  const bias = errs.length ? median(errs) : null;
  const n = errs.length;
  const shrink = n / (n + 10);
  const trend: { at: number; mape: number }[] = [];
  const window = 6;
  for (let i = window - 1; i < res.length; i++) {
    const slice = res.slice(i - window + 1, i + 1);
    trend.push({ at: res[i]!.resolved!.at, mape: mean(slice.map((p) => Math.abs(p.resolved!.priceError))) });
  }
  return {
    resolved: n,
    open: predictions.length - n,
    priceMape: n ? mean(errs.map(Math.abs)) : null,
    priceBias: bias,
    priceHitRate: n ? res.filter((p) => p.resolved!.priceInRange).length / n : null,
    timeHitRate: n ? res.filter((p) => p.resolved!.timeInRange).length / n : null,
    medianTimeErrorDays: n ? median(res.map((p) => p.resolved!.timeErrorDays)) : null,
    calibration,
    priceCorrection: n >= 5 && bias !== null ? 1 + bias * shrink : 1,
    trend,
  };
}
