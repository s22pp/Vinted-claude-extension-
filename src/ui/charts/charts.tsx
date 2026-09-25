import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';

/* ── helpers ─────────────────────────────────────────────── */

/** Callback-ref width observer: works even when the measured element mounts after an empty state. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** Monotone cubic (Fritsch–Carlson): smooth without overshooting below real values. */
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    m.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  t.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i]!;
      t[i + 1] = k * b * m[i]!;
    }
  }
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${x0 + h},${y0 + t[i]! * h} ${x1 - h},${y1 - t[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function ChartEmpty({ height, text }: { height: number; text: string }) {
  return (
    <div className="chart-empty" style={{ height }}>
      {text}
    </div>
  );
}

export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  const { t } = useI18n();
  return (
    <details className="chart-table">
      <summary>{t('charts.table')}</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="num">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dot?: boolean; dashed?: boolean }[] }) {
  return (
    <div className="chart__legend">
      {items.map((i) => (
        <span key={i.label} className="chart__key">
          <span
            className={`chart__swatch ${i.dot ? 'chart__swatch--dot' : ''}`}
            style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 3px, transparent 3px 5px)` : i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ── Line chart ─────────────────────────────────────────── */

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  area?: boolean;
  dashed?: boolean;
}

export function LineChart({
  labels,
  series,
  height = 220,
  format,
  title,
  minPoints = 2,
  zeroBased = true,
  step = false,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  format: (v: number) => string;
  title: string;
  minPoints?: number;
  zeroBased?: boolean;
  step?: boolean;
}) {
  const { t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const pad = { l: 52, r: 16, t: 12, b: 28 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const geo = useMemo(() => {
    if (all.length < minPoints) return null;
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (zeroBased) lo = Math.min(0, lo);
    else {
      const m = (hi - lo) * 0.15 || hi * 0.1;
      lo -= m;
      hi += m;
    }
    const ticks = niceTicks(lo, hi, 4);
    const y0 = ticks[0]!;
    const y1 = ticks[ticks.length - 1]!;
    const n = labels.length;
    const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
    const y = (v: number) => h - ((v - y0) / (y1 - y0 || 1)) * h;
    return { ticks, x, y };
  }, [all.join(','), w, h, labels.length, zeroBased, minPoints]);

  if (!geo) return <ChartEmpty height={height} text={all.length === 0 ? t('charts.noData') : t('charts.insufficient')} />;
  const { ticks, x, y } = geo;

  const pathOf = (vals: (number | null)[]) => {
    // Split into runs of known values: a gap (unknown) is never interpolated.
    const runs: [number, number][][] = [];
    let cur: [number, number][] = [];
    vals.forEach((v, i) => {
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
        return;
      }
      cur.push([x(i), y(v)]);
    });
    if (cur.length) runs.push(cur);
    if (step) return runs.map((r) => r.map(([px, py], k) => (k === 0 ? `M${px},${py}` : `H${px}V${py}`)).join('')).join('');
    return runs.map(monotonePath).join('');
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(rel * (labels.length - 1)))));
  };
  const everyN = Math.ceil(labels.length / Math.max(2, Math.floor(w / 70)));
  const showLabel = (i: number) => (i === labels.length - 1 ? true : i % everyN === 0 && labels.length - 1 - i >= everyN * 0.6);

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={title}>
          <g transform={`translate(${pad.l},${pad.t})`}>
            {ticks.map((tk) => (
              <g key={tk}>
                <line className="chart-grid" x1={0} x2={w} y1={y(tk)} y2={y(tk)} />
                <text className="chart-axis" x={-10} y={y(tk)} dy="0.32em" textAnchor="end">
                  {format(tk)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              showLabel(i) ? (
                <text key={i} className="chart-axis" x={x(i)} y={h + 18} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
                  {l}
                </text>
              ) : null,
            )}
            {series.map((s, si) => {
              const d = pathOf(s.values);
              const firstI = s.values.findIndex((v) => v !== null);
              const lastI = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
              return (
                <g key={s.key}>
                  {s.area && firstI >= 0 && (
                    <path className="chart-fade" d={`${d}L${x(lastI)},${h}L${x(firstI)},${h}Z`} fill={s.color} opacity={0.1} />
                  )}
                  <path
                    className={`chart-line ${s.dashed ? '' : 'chart-draw'}`}
                    d={d}
                    stroke={s.color}
                    strokeDasharray={s.dashed ? '4 5' : undefined}
                    style={{ ['--len' as string]: 4000, animationDelay: `${si * 120}ms` }}
                  />
                  {lastI >= 0 && s.values[lastI] !== null && (
                    <circle className="chart-dot" cx={x(lastI)} cy={y(s.values[lastI]!)} r={4} fill={s.color} stroke="var(--surface-solid)" strokeWidth={2} />
                  )}
                </g>
              );
            })}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--border-strong)" />
                {series.map((s) =>
                  s.values[hover] !== null && s.values[hover] !== undefined ? (
                    <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={5} fill={s.color} stroke="var(--surface-solid)" strokeWidth={2} />
                  ) : null,
                )}
              </g>
            )}
            <rect width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart__tooltip" style={{ left: pad.l + x(hover), top: pad.t + Math.min(...series.map((s) => (s.values[hover] == null ? h : y(s.values[hover]!)))) }}>
          <div className="chart__tooltip-title">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="chart__tooltip-row">
              <span className="chart__key">
                <span className="chart__swatch" style={{ background: s.color }} />
                {s.label}
              </span>
              <b className="num">{s.values[hover] == null ? '—' : format(s.values[hover]!)}</b>
            </div>
          ))}
        </div>
      )}
      <DataTable caption={title} head={['', ...series.map((s) => s.label)]} rows={labels.map((l, i) => [l, ...series.map((s) => (s.values[i] == null ? '—' : format(s.values[i]!)))])} />
    </div>
  );
}

/* ── Bar chart ──────────────────────────────────────────── */

export interface BarDatum {
  label: string;
  value: number | null;
  color?: string;
  note?: string;
  sub?: ReactNode;
}

export function BarChart({
  data,
  format,
  title,
  orientation = 'horizontal',
  height = 200,
  color = 'var(--chart-1)',
  onSelect,
}: {
  data: BarDatum[];
  format: (v: number) => string;
  title: string;
  orientation?: 'horizontal' | 'vertical';
  height?: number;
  color?: string;
  /** Makes each bar a way into the underlying items. */
  onSelect?: (index: number) => void;
}) {
  const { t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const known = data.filter((d) => d.value !== null) as (BarDatum & { value: number })[];
  if (known.length === 0) return <ChartEmpty height={orientation === 'vertical' ? height : 120} text={t('charts.noData')} />;
  const max = Math.max(...known.map((d) => d.value), 0);
  const min = Math.min(...known.map((d) => d.value), 0);

  if (orientation === 'horizontal') {
    const labelW = Math.min(170, Math.max(90, width * 0.34));
    const valueW = 64;
    const barArea = Math.max(40, width - labelW - valueW);
    const rowH = 30;
    const x0 = min < 0 ? (-min / (max - min)) * barArea : 0;
    const scale = (v: number) => (Math.abs(v) / (max - min || 1)) * barArea;
    return (
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg height={data.length * rowH} role="img" aria-label={title}>
            {data.map((d, i) => {
              const v = d.value;
              const bw = v === null ? 0 : Math.max(2, scale(v));
              const bx = labelW + (v !== null && v < 0 ? x0 - bw : x0);
              return (
                <g key={d.label} transform={`translate(0,${i * rowH})`} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={onSelect ? () => onSelect(i) : undefined} opacity={hover === null || hover === i ? 1 : 0.55} style={{ transition: 'opacity 120ms', cursor: onSelect ? 'pointer' : undefined }}>
                  <rect x={0} y={0} width={width} height={rowH} fill="transparent" />
                  <text x={0} y={rowH / 2} dy="0.32em" fontSize="12.5" fill="var(--text-2)">
                    {d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label}
                  </text>
                  {v === null ? (
                    <text x={labelW} y={rowH / 2} dy="0.32em" fontSize="12" fill="var(--text-3)">
                      — {t('data.unknown')}
                    </text>
                  ) : (
                    <rect className="chart-bar chart-bar--h" style={{ animationDelay: `${i * 40}ms` }} x={bx} y={(rowH - 12) / 2} width={bw} height={12} rx={4} fill={d.color ?? (v < 0 ? 'var(--coral)' : color)} />
                  )}
                  {v !== null && (
                    <text x={width} y={rowH / 2} dy="0.32em" textAnchor="end" fontSize="12.5" fontWeight={600} fill="var(--text)" className="num">
                      {format(v)}
                    </text>
                  )}
                  {d.note && hover === i && <title>{d.note}</title>}
                </g>
              );
            })}
          </svg>
        )}
        <DataTable caption={title} head={['', title]} rows={data.map((d) => [d.label, d.value === null ? '—' : format(d.value)])} />
      </div>
    );
  }

  const pad = { l: 44, r: 8, t: 18, b: 26 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const ticks = niceTicks(Math.min(0, min), max, 4);
  const top = ticks[ticks.length - 1]!;
  const band = w / data.length;
  const bw = Math.min(28, band * 0.62);
  const y = (v: number) => h - (v / (top || 1)) * h;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={title}>
          <g transform={`translate(${pad.l},${pad.t})`}>
            {ticks.map((tk) => (
              <g key={tk}>
                <line className="chart-grid" x1={0} x2={w} y1={y(tk)} y2={y(tk)} />
                <text className="chart-axis" x={-8} y={y(tk)} dy="0.32em" textAnchor="end">
                  {format(tk)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = band * i + band / 2;
              const v = d.value ?? 0;
              return (
                <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={onSelect ? () => onSelect(i) : undefined} style={{ cursor: onSelect ? 'pointer' : undefined }}>
                  <rect x={band * i} y={0} width={band} height={h} fill={hover === i ? 'var(--highlight)' : 'transparent'} rx={6} />
                  {d.value !== null && (
                    <path
                      className="chart-bar chart-bar--v"
                      style={{ animationDelay: `${i * 50}ms` }}
                      d={`M${cx - bw / 2},${h} V${y(v) + 4} Q${cx - bw / 2},${y(v)} ${cx - bw / 2 + 4},${y(v)} H${cx + bw / 2 - 4} Q${cx + bw / 2},${y(v)} ${cx + bw / 2},${y(v) + 4} V${h} Z`}
                      fill={d.color ?? color}
                    />
                  )}
                  <text className="chart-axis" x={cx} y={h + 17} textAnchor="middle">
                    {d.label}
                  </text>
                  {hover === i && d.value !== null && (
                    <text x={cx} y={y(v) - 7} textAnchor="middle" fontSize="11.5" fontWeight={600} fill="var(--text)" className="num">
                      {format(d.value)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover !== null && data[hover]?.sub && width > 0 && (
        <div className="chart__tooltip" style={{ left: pad.l + (w / data.length) * (hover + 0.5), top: pad.t + y(data[hover]!.value ?? 0) - 16 }}>
          <div className="chart__tooltip-title">{data[hover]!.label}</div>
          {data[hover]!.sub}
        </div>
      )}
      <DataTable caption={title} head={['', title]} rows={data.map((d) => [d.label, d.value === null ? '—' : format(d.value)])} />
    </div>
  );
}

/* ── Scatter ────────────────────────────────────────────── */

export interface ScatterPoint {
  x: number;
  y: number;
  r?: number;
  label: string;
  color?: string;
  detail?: ReactNode;
}

export function ScatterChart({
  points,
  xFormat,
  yFormat,
  xLabel,
  yLabel,
  title,
  height = 240,
  guides,
  minPoints = 5,
  diagonal,
  onSelect,
  zeroBased = true,
}: {
  points: ScatterPoint[];
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  xLabel: string;
  yLabel: string;
  title: string;
  height?: number;
  guides?: { x?: number; y?: number };
  minPoints?: number;
  /** y = x reference: on the line = perfect forecast. Axes share the same scale. */
  diagonal?: boolean;
  onSelect?: (index: number) => void;
  zeroBased?: boolean;
}) {
  const { t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < minPoints) return <ChartEmpty height={height} text={points.length ? t('charts.insufficient') : t('charts.noData')} />;
  const pad = { l: 52, r: 16, t: 26, b: 38 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const lo = (vs: number[]) => (zeroBased ? Math.min(0, ...vs) : Math.min(...vs) * 0.9);
  const shared = diagonal ? [lo([...xs, ...ys]), Math.max(...xs, ...ys)] : null;
  const xt = shared ? niceTicks(shared[0]!, shared[1]!, 5) : niceTicks(lo(xs), Math.max(...xs), 5);
  const yt = shared ? xt : niceTicks(lo(ys), Math.max(...ys), 4);
  const X = (v: number) => ((v - xt[0]!) / (xt[xt.length - 1]! - xt[0]! || 1)) * w;
  const Y = (v: number) => h - ((v - yt[0]!) / (yt[yt.length - 1]! - yt[0]! || 1)) * h;
  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={title}>
          <g transform={`translate(${pad.l},${pad.t})`}>
            {yt.map((tk) => (
              <g key={`y${tk}`}>
                <line className="chart-grid" x1={0} x2={w} y1={Y(tk)} y2={Y(tk)} />
                <text className="chart-axis" x={-10} y={Y(tk)} dy="0.32em" textAnchor="end">
                  {yFormat(tk)}
                </text>
              </g>
            ))}
            {xt.map((tk) => (
              <text key={`x${tk}`} className="chart-axis" x={X(tk)} y={h + 17} textAnchor="middle">
                {xFormat(tk)}
              </text>
            ))}
            <text className="chart-axis" x={w} y={h + 33} textAnchor="end">
              {xLabel} →
            </text>
            <text className="chart-axis" x={-44} y={-14} textAnchor="start">
              ↑ {yLabel}
            </text>
            {diagonal && (
              <line x1={X(xt[0]!)} y1={Y(xt[0]!)} x2={X(xt[xt.length - 1]!)} y2={Y(xt[xt.length - 1]!)} stroke="var(--violet)" strokeOpacity={0.55} strokeDasharray="5 5" strokeWidth={1.5} />
            )}
            {guides?.x !== undefined && <line x1={X(guides.x)} x2={X(guides.x)} y1={0} y2={h} stroke="var(--border-strong)" strokeDasharray="3 4" />}
            {guides?.y !== undefined && <line x1={0} x2={w} y1={Y(guides.y)} y2={Y(guides.y)} stroke="var(--border-strong)" strokeDasharray="3 4" />}
            {points.map((p, i) => (
              <circle
                key={i}
                className="chart-dot"
                cx={X(p.x)}
                cy={Y(p.y)}
                r={hover === i ? (p.r ?? 5) + 2 : (p.r ?? 5)}
                fill={p.color ?? 'var(--chart-1)'}
                fillOpacity={hover === null || hover === i ? 0.85 : 0.35}
                stroke="var(--surface-solid)"
                strokeWidth={2}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={onSelect ? () => onSelect(i) : undefined}
                style={{ animationDelay: `${Math.min(i * 12, 500)}ms`, cursor: onSelect ? 'pointer' : undefined }}
              />
            ))}
          </g>
        </svg>
      )}
      {hp && (
        <div className="chart__tooltip" style={{ left: pad.l + X(hp.x), top: pad.t + Y(hp.y) }}>
          <div className="chart__tooltip-title">{hp.label}</div>
          <div className="chart__tooltip-row">
            {yLabel} <b className="num">{yFormat(hp.y)}</b>
          </div>
          <div className="chart__tooltip-row">
            {xLabel} <b className="num">{xFormat(hp.x)}</b>
          </div>
          {hp.detail}
        </div>
      )}
      <DataTable caption={title} head={['', yLabel, xLabel]} rows={points.map((p) => [p.label, yFormat(p.y), xFormat(p.x)])} />
    </div>
  );
}

/* ── Comparable distribution strip ──────────────────────── */

export function DistributionStrip({
  points,
  p25,
  p50,
  p75,
  current,
  bands,
  format,
  title,
  height = 196,
}: {
  points: { v: number; w: number; label: string }[];
  p25: number;
  p50: number;
  p75: number;
  current: number | null;
  bands?: { from: number; to: number; label: string; color: string }[];
  format: (v: number) => string;
  title: string;
  height?: number;
}) {
  const { t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 36, r: 36, t: 26, b: 28 };
  const w = Math.max(0, width - pad.l - pad.r);
  const vals = [...points.map((p) => p.v), p25, p75, ...(current !== null ? [current] : [])];
  const lo = Math.min(...vals) * 0.9;
  const hi = Math.max(...vals) * 1.06;
  const X = (v: number) => ((v - lo) / (hi - lo || 1)) * w;
  const ticks = niceTicks(lo, hi, 5).filter((v) => v >= lo && v <= hi);
  const midY = 64;
  // Beeswarm-lite: stack dots that collide.
  const placed: { x: number; y: number; r: number; i: number }[] = [];
  points
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.w - a.w)
    .forEach((p) => {
      const r = 3 + p.w * 3.2;
      const x = X(p.v);
      let y = midY;
      for (let k = 0; k < 30; k++) {
        const cand = midY + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 7;
        if (!placed.some((q) => Math.hypot(q.x - x, q.y - cand) < q.r + r + 1)) {
          y = cand;
          break;
        }
      }
      placed.push({ x, y, r, i: p.i });
    });
  const hp = hover !== null ? placed.find((p) => p.i === hover) : null;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={title}>
          <g transform={`translate(${pad.l},${pad.t})`}>
            {bands?.map((b) => (
              <g key={b.label}>
                <rect x={X(b.from)} y={midY + 34} width={Math.max(2, X(b.to) - X(b.from))} height={6} rx={3} fill={b.color} opacity={0.9} className="chart-bar chart-bar--h" />
              </g>
            ))}
            <rect x={X(p25)} y={midY - 30} width={Math.max(2, X(p75) - X(p25))} height={60} rx={8} fill="var(--violet-soft)" stroke="color-mix(in srgb, var(--violet) 35%, transparent)" className="chart-fade" />
            <line x1={X(p50)} x2={X(p50)} y1={midY - 30} y2={midY + 30} stroke="var(--violet)" strokeWidth={2} />
            <text x={X(p25)} y={midY - 36} fontSize="11" fill="var(--text-3)" textAnchor="middle" className="num">
              P25 {format(p25)}
            </text>
            <text x={X(p50)} y={-8} fontSize="11.5" fontWeight={600} fill="var(--text)" textAnchor="middle" className="num">
              {t('market.median')} {format(p50)}
            </text>
            <text x={X(p75)} y={midY - 36} fontSize="11" fill="var(--text-3)" textAnchor="middle" className="num">
              P75 {format(p75)}
            </text>
            {placed.map((p) => (
              <circle
                key={p.i}
                className="chart-dot"
                style={{ animationDelay: `${Math.min(p.i * 18, 600)}ms` }}
                cx={p.x}
                cy={p.y}
                r={hover === p.i ? p.r + 1.5 : p.r}
                fill="var(--chart-2)"
                fillOpacity={0.75}
                stroke="var(--surface-solid)"
                strokeWidth={1.5}
                onPointerEnter={() => setHover(p.i)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
            {current !== null && (
              <g className="chart-fade">
                <line x1={X(current)} x2={X(current)} y1={midY - 44} y2={midY + 46} stroke="var(--amber)" strokeWidth={2} strokeDasharray="3 3" />
                <rect x={X(current) - 34} y={midY + 46} width={68} height={20} rx={10} fill="var(--surface-solid)" stroke="var(--amber)" strokeOpacity={0.7} />
                <text x={X(current)} y={midY + 56} dy="0.32em" textAnchor="middle" fontSize="11" fontWeight={650} fill="var(--amber)" className="num">
                  {format(current)}
                </text>
              </g>
            )}
            {ticks.map((tk) => (
              <text key={tk} className="chart-axis" x={X(tk)} y={midY + 94} textAnchor="middle">
                {format(tk)}
              </text>
            ))}
          </g>
        </svg>
      )}
      {hp && (
        <div className="chart__tooltip" style={{ left: pad.l + hp.x, top: pad.t + hp.y - hp.r }}>
          <div className="chart__tooltip-title">{points[hp.i]!.label}</div>
          <div className="chart__tooltip-row">
            {t('charts.price')} <b className="num">{format(points[hp.i]!.v)}</b>
          </div>
          <div className="chart__tooltip-row">
            {t('market.similarity')} <b className="num">{Math.round(points[hp.i]!.w * 100)} %</b>
          </div>
        </div>
      )}
      <DataTable caption={title} head={[t('charts.price'), t('market.similarity')]} rows={points.map((p) => [format(p.v), `${Math.round(p.w * 100)} %`])} />
    </div>
  );
}

/* ── Sparkline & ring ───────────────────────────────────── */

export function Sparkline({ values, color = 'var(--chart-1)', width = 96, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" className="chart-draw" style={{ ['--len' as string]: 400 }} />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
    </svg>
  );
}

export function Ring({ value, max, size = 64, stroke = 6, children, color = 'url(#ring-grad)' }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, value / (max || 1)));
  return (
    <span style={{ position: 'relative', display: 'inline-grid', placeItems: 'center', width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8f6dff" />
            <stop offset="1" stopColor="#2a66ff" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          style={{ transition: 'stroke-dashoffset 900ms var(--ease)' }}
        />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</span>
    </span>
  );
}
