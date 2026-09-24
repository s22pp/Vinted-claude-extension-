export function sortedAsc(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** Linear-interpolated quantile (R type 7) on a pre-sorted array. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export function quantile(xs: readonly number[], q: number): number {
  return quantileSorted(sortedAsc(xs), q);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Weighted quantile: each value's weight is centred on its position in the cumulative
 * distribution, then linearly interpolated. With equal weights this matches type 7 closely.
 */
export function weightedQuantile(points: readonly { v: number; w: number }[], q: number): number {
  const pts = points.filter((p) => p.w > 0).sort((a, b) => a.v - b.v);
  if (pts.length === 0) return NaN;
  if (pts.length === 1) return pts[0]!.v;
  const total = pts.reduce((s, p) => s + p.w, 0);
  const centres: number[] = [];
  let acc = 0;
  for (const p of pts) {
    centres.push((acc + p.w / 2) / total);
    acc += p.w;
  }
  // rescale centres to span [0,1] so q=0 → min and q=1 → max
  const c0 = centres[0]!;
  const cN = centres[centres.length - 1]!;
  const scaled = centres.map((c) => (c - c0) / (cN - c0 || 1));
  for (let i = 1; i < pts.length; i++) {
    if (q <= scaled[i]!) {
      const t = (q - scaled[i - 1]!) / (scaled[i]! - scaled[i - 1]! || 1);
      return pts[i - 1]!.v + (pts[i]!.v - pts[i - 1]!.v) * t;
    }
  }
  return pts[pts.length - 1]!.v;
}

/** Kish effective sample size for weighted observations. */
export function effectiveSampleSize(weights: readonly number[]): number {
  const s = weights.reduce((a, w) => a + w, 0);
  const s2 = weights.reduce((a, w) => a + w * w, 0);
  return s2 === 0 ? 0 : (s * s) / s2;
}

/** Share of the (weighted) distribution strictly below `x`, 0..1. */
export function percentileRank(points: readonly { v: number; w: number }[], x: number): number {
  const total = points.reduce((s, p) => s + p.w, 0);
  if (total === 0) return NaN;
  let below = 0;
  for (const p of points) {
    if (p.v < x) below += p.w;
    else if (p.v === x) below += p.w / 2;
  }
  return below / total;
}

export function clamp(x: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, x));
}
