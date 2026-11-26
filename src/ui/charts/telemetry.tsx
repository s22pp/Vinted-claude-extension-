import { useId } from 'react';

/**
 * Telemetry micro-components (v4.0): a sparkline and a segmented gauge, pure SVG/CSS, no dependency. The geometry is
 * exported and tested; the components only draw it.
 */

/**
 * A smooth path through the points (monotone cubic: never overshoots between two values), in a w × h box, the lowest
 * value at the bottom. The curve never goes under the zero line when every value is ≥ 0 (y ≤ yZero).
 */
export function sparkPath(data: readonly number[], w: number, h: number, pad = 2): { line: string; area: string; last: { x: number; y: number } } | null {
  const pts = data.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const lo = Math.min(0, ...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * w);
  const ys = pts.map((v) => pad + (1 - (v - lo) / span) * (h - 2 * pad));
  const yZero = pad + (1 - (0 - lo) / span) * (h - 2 * pad);
  // Fritsch–Carlson tangents: a monotone cubic Hermite spline, flat at local extremes.
  const n = pts.length;
  const d = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!));
  const m = xs.map((_, i) => (i === 0 ? d[0]! : i === n - 1 ? d[n - 2]! : d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i]!;
      m[i + 1] = tau * b * d[i]!;
    }
  }
  const f = (v: number) => Math.round(v * 10) / 10;
  // The control points are clamped to the zero line: the drawing never dips under 0.
  const clampY = (y: number) => (lo >= 0 ? Math.min(y, yZero) : y);
  let line = `M${f(xs[0]!)},${f(ys[0]!)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1]! - xs[i]!) / 3;
    line += `C${f(xs[i]! + dx)},${f(clampY(ys[i]! + m[i]! * dx))} ${f(xs[i + 1]! - dx)},${f(clampY(ys[i + 1]! - m[i + 1]! * dx))} ${f(xs[i + 1]!)},${f(ys[i + 1]!)}`;
  }
  const area = `${line}L${f(w)},${f(yZero)}L0,${f(yZero)}Z`;
  return { line, area, last: { x: xs[n - 1]!, y: ys[n - 1]! } };
}

/** A smooth curve over the values, a faint vertical gradient under it; stretches to its container's width. */
export function Sparkline({ data, color = '#34D399', height = 24, label }: { data: readonly number[]; color?: string; height?: number; label?: string }) {
  const id = useId().replace(/:/g, '');
  const W = 120;
  const p = sparkPath(data, W, height);
  if (!p) return null;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={p.area} fill={`url(#sg-${id})`} />
      <path d={p.line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type BarTone = 'ok' | 'warn' | 'over';
/** Emerald under 80 %, amber from 80 to 99 %, coral from 100 %. */
export const barTone = (ratio: number): BarTone => (ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok');
/** How many of the blocks light up for value / max (a value above 0 lights at least one; never more than all). */
export function litSegments(value: number, max: number, segments: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(segments, Math.max(1, Math.round((value / max) * segments)));
}

/**
 * The architectural gauge: `segments` blocks of 4 px, 2 px apart, lit up to value / max — emerald, amber from 80 %,
 * coral from 100 %. `parts` instead splits it in coloured runs (« frais / à surveiller / stagnant »).
 */
export function SegmentedBar({ value = 0, max = 1, segments = 24, parts, label }: { value?: number; max?: number; segments?: number; parts?: { n: number; tone: BarTone }[]; label: string }) {
  const tones: (BarTone | null)[] = [];
  if (parts) {
    const total = parts.reduce((a, p) => a + p.n, 0);
    let used = 0;
    for (const [k, p] of parts.entries()) {
      const count = k === parts.length - 1 ? segments - used : total > 0 ? Math.round((p.n / total) * segments) : 0;
      for (let i = 0; i < count && used < segments; i++, used++) tones.push(total > 0 ? p.tone : null);
    }
  } else {
    const lit = litSegments(value, max, segments);
    const tone = barTone(max > 0 ? value / max : 0);
    for (let i = 0; i < segments; i++) tones.push(i < lit ? tone : null);
  }
  return (
    <span className="segbar" role="img" aria-label={label}>
      {tones.map((tone, i) => (
        <i key={i} className={tone ? `is-${tone}` : undefined} />
      ))}
    </span>
  );
}
