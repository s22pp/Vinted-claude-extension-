import { useState } from 'react';
import { useI18n } from '@/i18n';
import { quantile } from '@/intelligence/stats';
import { DataTable, niceTicks, useWidth } from './charts';

export interface Lane {
  points: { v: number; w?: number; label: string }[];
  /** Pre-computed (weighted) quartiles; computed from points otherwise. */
  q?: { p25: number; p50: number; p75: number } | null;
}

/**
 * ASKING prices (market listings) and REALISED prices (your sales) on one axis, in two separate lanes.
 * The two distributions are never merged: the gap between the medians is the insight.
 */
export function DualDistribution({
  asking,
  realized,
  current,
  format,
  title,
  realizedScope,
  currentLabel,
}: {
  asking: Lane;
  realized: Lane;
  current: number | null;
  format: (v: number) => string;
  title: string;
  /** What the realised lane covers ("niche", "marque"…), shown with its sample size. */
  realizedScope: string | null;
  currentLabel?: string;
}) {
  const { t, pct } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ lane: 0 | 1; i: number } | null>(null);
  const quart = (l: Lane) => l.q ?? (l.points.length >= 3 ? { p25: quantile(l.points.map((p) => p.v), 0.25), p50: quantile(l.points.map((p) => p.v), 0.5), p75: quantile(l.points.map((p) => p.v), 0.75) } : null);
  const qa = quart(asking);
  const qr = quart(realized);
  const all = [...asking.points.map((p) => p.v), ...realized.points.map((p) => p.v), ...(current !== null ? [current] : [])];
  if (all.length === 0) return null;
  const pad = { l: 12, r: 12, t: 34, b: 30 };
  const w = Math.max(0, width - pad.l - pad.r);
  const lo = Math.min(...all) * 0.9;
  const hi = Math.max(...all) * 1.06;
  const X = (v: number) => ((v - lo) / (hi - lo || 1)) * w;
  const ticks = niceTicks(lo, hi, 5).filter((v) => v >= lo && v <= hi);
  const laneH = 74;
  const gap = 30;
  const laneY = [0, laneH + gap];
  const height = pad.t + laneH * 2 + gap + pad.b + 8;
  const colors = ['var(--cyan)', 'var(--emerald)'];

  const place = (pts: Lane['points'], mid: number) => {
    const out: { x: number; y: number; r: number; i: number }[] = [];
    pts
      .map((p, i) => ({ ...p, i }))
      .sort((a, b) => (b.w ?? 1) - (a.w ?? 1))
      .forEach((p) => {
        const r = 2.8 + (p.w ?? 0.7) * 2.6;
        const x = X(p.v);
        let y = mid;
        for (let k = 0; k < 14; k++) {
          const cand = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 6;
          if (!out.some((q) => Math.hypot(q.x - x, q.y - cand) < q.r + r + 0.8)) {
            y = cand;
            break;
          }
        }
        out.push({ x, y, r, i: p.i });
      });
    return out;
  };
  const lanes = [
    { lane: asking, q: qa, placed: place(asking.points, laneY[0]! + 44), label: t('dual.asking'), sub: t('dual.askingSub', { n: asking.points.length }) },
    { lane: realized, q: qr, placed: place(realized.points, laneY[1]! + 44), label: t('dual.realized'), sub: realizedScope ? t('dual.realizedSub', { n: realized.points.length, scope: realizedScope }) : t('dual.realizedNone') },
  ];
  const gapPct = qa && qr ? (qr.p50 - qa.p50) / qa.p50 : null;
  const hp = hover ? lanes[hover.lane]!.placed.find((p) => p.i === hover.i) : null;
  const hpt = hover ? lanes[hover.lane]!.lane.points[hover.i] : null;

  return (
    <div className="chart dual" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={title}>
          <g transform={`translate(${pad.l},${pad.t})`}>
            {lanes.map((L, li) => {
              const y0 = laneY[li]!;
              const c = colors[li]!;
              return (
                <g key={li}>
                  <rect x={0} y={y0 + 16} width={w} height={laneH - 16} rx={10} fill="var(--surface-sunken)" opacity={0.55} />
                  <text x={2} y={y0 + 8} fontSize="10.5" fontWeight={700} letterSpacing="0.08em" fill={c} stroke="var(--surface-solid)" strokeWidth={4} paintOrder="stroke">
                    {L.label.toUpperCase()}
                  </text>
                  <text x={w} y={y0 + 8} fontSize="11" fill="var(--text-3)" textAnchor="end" stroke="var(--surface-solid)" strokeWidth={4} paintOrder="stroke">
                    {L.sub}
                  </text>
                  {L.q && (
                    <g className="chart-fade">
                      <rect x={X(L.q.p25)} y={y0 + 24} width={Math.max(2, X(L.q.p75) - X(L.q.p25))} height={laneH - 32} rx={8} fill={`color-mix(in srgb, ${c} 14%, transparent)`} stroke={`color-mix(in srgb, ${c} 45%, transparent)`} />
                      <line x1={X(L.q.p50)} x2={X(L.q.p50)} y1={y0 + 22} y2={y0 + laneH - 6} stroke={c} strokeWidth={2.5} />
                    </g>
                  )}
                  {L.placed.map((p) => (
                    <circle
                      key={p.i}
                      className="chart-dot"
                      style={{ animationDelay: `${Math.min(p.i * 14, 500)}ms` }}
                      cx={p.x}
                      cy={p.y}
                      r={hover?.lane === li && hover.i === p.i ? p.r + 1.5 : p.r}
                      fill={c}
                      fillOpacity={0.78}
                      stroke="var(--surface-solid)"
                      strokeWidth={1.25}
                      onPointerEnter={() => setHover({ lane: li as 0 | 1, i: p.i })}
                      onPointerLeave={() => setHover(null)}
                    />
                  ))}
                  {!L.lane.points.length && (
                    <text x={w / 2} y={y0 + 48} textAnchor="middle" fontSize="12" fill="var(--text-3)">
                      {li === 0 ? t('dual.noAsking') : t('dual.noRealized')}
                    </text>
                  )}
                </g>
              );
            })}
            {qa && qr && gapPct !== null && (
              <g className="chart-fade">
                <line x1={X(qa.p50)} x2={X(qa.p50)} y1={laneH - 6} y2={laneH + gap / 2} stroke="var(--cyan)" strokeWidth={1} strokeDasharray="2 2" />
                <line x1={X(qr.p50)} x2={X(qr.p50)} y1={laneH + gap / 2} y2={laneH + gap + 22} stroke="var(--emerald)" strokeWidth={1} strokeDasharray="2 2" />
                <line x1={X(qa.p50)} x2={X(qr.p50)} y1={laneH + gap / 2} y2={laneH + gap / 2} stroke="var(--text-2)" strokeWidth={1.5} />
                <text
                  x={Math.max(X(qa.p50), X(qr.p50)) + 8}
                  y={laneH + gap / 2}
                  dy="0.32em"
                  fontSize="11"
                  fontWeight={650}
                  fill={gapPct < 0 ? 'var(--amber)' : 'var(--emerald)'}
                  className="num"
                  stroke="var(--surface-solid)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {t('dual.gap', { pct: pct(gapPct, { sign: true }) })}
                </text>
              </g>
            )}
            {current !== null && (
              <g className="chart-fade">
                <line x1={X(current)} x2={X(current)} y1={-10} y2={4} stroke="var(--amber)" strokeWidth={2} strokeDasharray="3 3" />
                <line x1={X(current)} x2={X(current)} y1={16} y2={laneH} stroke="var(--amber)" strokeWidth={2} strokeDasharray="3 3" />
                <line x1={X(current)} x2={X(current)} y1={laneH + gap + 16} y2={laneH * 2 + gap} stroke="var(--amber)" strokeWidth={2} strokeDasharray="3 3" />
                <rect x={X(current) - 38} y={-30} width={76} height={20} rx={10} fill="var(--surface-solid)" stroke="var(--amber)" strokeOpacity={0.7} />
                <text x={X(current)} y={-20} dy="0.32em" textAnchor="middle" fontSize="11" fontWeight={650} fill="var(--amber)" className="num">
                  {format(current)}
                </text>
              </g>
            )}
            {ticks.map((tk) => (
              <text key={tk} className="chart-axis" x={X(tk)} y={laneH * 2 + gap + 20} textAnchor="middle">
                {format(tk)}
              </text>
            ))}
          </g>
        </svg>
      )}
      {hp && hpt && hover && (
        <div className="chart__tooltip" style={{ left: pad.l + hp.x, top: pad.t + hp.y - hp.r }}>
          <div className="chart__tooltip-title">{hpt.label}</div>
          <div className="chart__tooltip-row">
            {hover.lane === 0 ? t('dual.asking') : t('dual.realized')} <b className="num">{format(hpt.v)}</b>
          </div>
        </div>
      )}
      <div className="dual__legend t-small">
        {qa && (
          <span>
            <i style={{ background: 'var(--cyan)' }} /> {t('dual.askingMedian')} <b className="num">{format(qa.p50)}</b>
          </span>
        )}
        {qr && (
          <span>
            <i style={{ background: 'var(--emerald)' }} /> {t('dual.realizedMedian')} <b className="num">{format(qr.p50)}</b>
          </span>
        )}
        {current !== null && (
          <span>
            <i style={{ background: 'var(--amber)' }} /> {currentLabel ?? t('dual.yourAsk')} <b className="num">{format(current)}</b>
          </span>
        )}
      </div>
      <DataTable
        caption={title}
        head={[t('dual.asking'), t('dual.realized')]}
        rows={Array.from({ length: Math.max(asking.points.length, realized.points.length) }, (_, i) => [asking.points[i] ? format(asking.points[i]!.v) : '', realized.points[i] ? format(realized.points[i]!.v) : ''])}
      />
    </div>
  );
}
