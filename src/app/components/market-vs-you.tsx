import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { type MarketVsYouRow, type SegmentDim, marketVsYou } from '@/intelligence/market-vs-you';
import type { SegmentStats } from '@/intelligence/seller-model';
import { IconTile } from '@/ui/components/icons';
import { Badge, Card, ConfidenceMeter, Segmented } from '@/ui/components/primitives';
import { useEra } from '../state';

type SortKey = 'sold' | 'speed' | 'roi' | 'yield';
const MIN_STRONG = 5;

function best(segs: SegmentStats[], score: (s: SegmentStats) => number | null, dir: 1 | -1): SegmentStats | null {
  const xs = segs.filter((s) => s.sold >= MIN_STRONG && score(s) !== null);
  if (!xs.length) return null;
  return xs.sort((a, b) => (score(a)! - score(b)!) * dir)[0]!;
}

/** Your personal model in three lines: fastest, most profitable, best capital rotation (min. 5 sales). */
export function YouHighlights() {
  const { t, pct } = useI18n();
  const era = useEra();
  const brands = era.model.byBrand;
  const fast = best(brands, (s) => s.medianDays, 1);
  const roi = best(brands, (s) => s.roi, -1);
  const rot = best(brands, (s) => s.yield30, -1);
  const cards: { key: string; icon: 'clock' | 'trendUp' | 'capital'; tone: 'cyan' | 'emerald' | 'violet'; s: SegmentStats | null; v: string }[] = [
    { key: 'fastest', icon: 'clock', tone: 'cyan', s: fast, v: fast?.medianDays != null ? t('kpi.days', { n: Math.round(fast.medianDays) }) : '' },
    { key: 'mostProfitable', icon: 'trendUp', tone: 'emerald', s: roi, v: roi?.roi != null ? `ROI ${pct(roi.roi)}` : '' },
    { key: 'bestRotation', icon: 'capital', tone: 'violet', s: rot, v: rot?.yield30 != null ? t('mvy.per30', { pct: pct(rot.yield30) }) : '' },
  ];
  return (
    <div className="you-hl">
      {cards.map((c, k) => (
        <div key={c.key} className="you-hl__card" style={{ animationDelay: `${k * 60}ms` }}>
          <IconTile name={c.icon} tone={c.tone} />
          <div className="grow">
            <div className="t-caption">{t(`mvy.${c.key}`)}</div>
            {c.s ? (
              <>
                <div className="you-hl__label clamp-1">{c.s.label}</div>
                <div className="t-small t-muted num">
                  {c.v} · n={c.s.sold}
                </div>
              </>
            ) : (
              <div className="t-small t-faint">{t('mvy.notEnough', { n: MIN_STRONG })}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketVsYou() {
  const { t, money, pct } = useI18n();
  const era = useEra();
  const [dim, setDim] = useState<SegmentDim>('brand');
  const [sort, setSort] = useState<SortKey>('sold');
  const rows = useMemo(() => {
    const r = marketVsYou(dim, era.model, era.marketAnalyses);
    const val = (x: MarketVsYouRow): number | null =>
      sort === 'sold' ? x.you.sold : sort === 'speed' ? (x.you.medianDays === null ? null : -x.you.medianDays) : sort === 'roi' ? x.you.roi : x.you.yield30;
    return r.sort((a, b) => {
      // Thin segments never outrank solid ones.
      if ((a.you.sold >= 3) !== (b.you.sold >= 3)) return a.you.sold >= 3 ? -1 : 1;
      const x = val(a);
      const y = val(b);
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });
  }, [dim, sort, era.model, era.marketAnalyses]);
  const example = rows.find((r) => r.market?.askingMedianCents != null && r.you.medianSaleCents !== null && r.you.sold >= 3);

  return (
    <Card
      title={t('mvy.title')}
      hint={t('mvy.hint')}
      icon="compare"
      tone="cyan"
      actions={
        <Segmented
          label={t('mvy.dim')}
          value={dim}
          onChange={setDim}
          options={(['brand', 'category', 'niche', 'size', 'band'] as SegmentDim[]).map((d) => ({ value: d, label: t(`mvy.dims.${d}`) }))}
        />
      }
    >
      {example && (
        <div className="mvy mvy--example">
          <div className="mvy__side mvy__side--market">
            <span className="mvy__tag">
              {t('mvy.market')} · {example.label}
            </span>
            <span className="mvy__v num">{money(example.market!.askingMedianCents)}</span>
            <span className="t-small t-muted">{t('mvy.askingMedian', { n: example.market!.listings })}</span>
          </div>
          <div className="mvy__side mvy__side--you">
            <span className="mvy__tag">
              {t('mvy.you')} · {example.label}
            </span>
            <span className="mvy__v num">
              {money(example.you.medianSaleCents)}
              {example.you.medianDays !== null && <span className="mvy__days"> · {t('mvy.soldIn', { n: Math.round(example.you.medianDays) })}</span>}
            </span>
            <span className="t-small t-muted">{t('mvy.realizedMedian', { n: example.you.sold, scope: example.label })}</span>
          </div>
        </div>
      )}
      <div className="row-between wrap" style={{ margin: '14px 0 8px', gap: 8 }}>
        <span className="t-small t-faint">{t('mvy.never')}</span>
        <Segmented
          label={t('mvy.sort')}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'sold', label: t('mvy.sortSold') },
            { value: 'speed', label: t('mvy.sortSpeed') },
            { value: 'roi', label: t('mvy.sortRoi') },
            { value: 'yield', label: t('mvy.sortYield') },
          ]}
        />
      </div>
      <div className="table-wrap" style={{ maxHeight: 460 }}>
        <table className="dt dt--compact mvy-table">
          <thead>
            <tr className="mvy-table__groups">
              <th scope="col" />
              <th scope="colgroup" colSpan={2} className="g-market">
                {t('mvy.market')} · {t('mvy.askingPrices')}
              </th>
              <th scope="colgroup" colSpan={6} className="g-you">
                {t('mvy.you')} · {t('mvy.realizedPrices')}
              </th>
            </tr>
            <tr>
              <th scope="col">{t(`mvy.dims.${dim}`)}</th>
              <th scope="col" className="is-num g-market">{t('mvy.colAsking')}</th>
              <th scope="col" className="is-num g-market">{t('mvy.colListings')}</th>
              <th scope="col" className="is-num g-you">{t('mvy.colRealized')}</th>
              <th scope="col" className="is-num g-you">{t('mvy.colSold')}</th>
              <th scope="col" className="is-num">{t('mvy.colGap')}</th>
              <th scope="col" className="is-num g-you">{t('mvy.colDays')}</th>
              <th scope="col" className="is-num g-you">ROI</th>
              <th scope="col" className="is-num g-you">{t('mvy.colYield')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={r.key} className={r.you.sold < 3 ? 'is-weak' : undefined}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="clamp-1" style={{ fontWeight: 550, maxWidth: 220 }}>
                      {r.label}
                    </span>
                    {r.you.sold < 3 && <Badge tone="neutral">{t('insights.lowSample')}</Badge>}
                  </span>
                </td>
                <td className="is-num num">{r.market?.askingMedianCents != null ? money(r.market.askingMedianCents) : <span className="t-faint">—</span>}</td>
                <td className="is-num num t-muted">{r.market ? r.market.listings : dim === 'band' ? <span className="t-faint">n/a</span> : '—'}</td>
                <td className="is-num num">{r.you.medianSaleCents !== null ? money(r.you.medianSaleCents) : <span className="t-faint">—</span>}</td>
                <td className="is-num num t-muted">{r.you.sold}</td>
                <td className="is-num num">{r.gapPct === null ? <span className="t-faint">—</span> : <span className={r.gapPct < -0.1 ? 't-warn' : r.gapPct > 0 ? 't-pos' : ''}>{pct(r.gapPct, { sign: true })}</span>}</td>
                <td className="is-num num">{r.you.medianDays === null ? '—' : t('kpi.days', { n: Math.round(r.you.medianDays) })}</td>
                <td className="is-num num">{r.you.roi === null ? '—' : pct(r.you.roi)}</td>
                <td className="is-num num">{r.you.yield30 === null ? '—' : pct(r.you.yield30)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row wrap t-small t-faint" style={{ gap: 12, marginTop: 10 }}>
        <span>{t('mvy.gapExplain')}</span>
        <span className="row" style={{ gap: 6 }}>
          {t('confidence.label')} <ConfidenceMeter level="MEDIUM" /> {t('mvy.confRule')}
        </span>
      </div>
    </Card>
  );
}
