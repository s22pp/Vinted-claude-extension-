import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { type PrecisionRow, precisionSummary } from '@/intelligence/precision';
import { LineChart, ScatterChart } from '@/ui/charts/charts';
import { Badge, Card, ConfidenceMeter, EmptyState, Metric, Segmented } from '@/ui/components/primitives';
import { go, useEra } from '../state';

/** Prévision 49 € · 8–18 j → Réalité 47 € · 11 j, with the data the forecast used. */
export function PredictionRow({ row, title }: { row: PrecisionRow; title?: string }) {
  const { t, money, pct, date } = useI18n();
  const era = useEra();
  const b = row.basis;
  const open = !row.actual;
  const heldFor = Math.max(0, Math.round((era.now - row.at) / 86_400_000));
  return (
    <article className={`pred ${open ? 'pred--open' : row.priceInRange && row.delayInRange ? 'pred--hit' : 'pred--miss'}`}>
      <header className="pred__head">
        {title && (
          <a className="pred__title clamp-1" href={`#/item/${row.itemId}`}>
            {title}
          </a>
        )}
        <span className="t-small t-faint">
          {date(row.at)} · {t(`precision.kind.${row.kind}`)} · {t(`strategy.${row.strategy}`)}
        </span>
        <ConfidenceMeter level={row.confidence} />
      </header>
      <div className="pred__grid">
        <div className="pred__side">
          <span className="pred__tag">{t('precision.forecast')}</span>
          <span className="pred__v num">{money(Math.round(row.predictedCents / 100) * 100)}</span>
          <span className="t-small t-muted num">
            {money(row.range.min)} – {money(row.range.max)} · {t('buy.daysRange', { lo: row.days.min, hi: row.days.max })}
          </span>
        </div>
        <span className="pred__arrow" aria-hidden="true">
          →
        </span>
        <div className="pred__side pred__side--real">
          <span className="pred__tag">{t('precision.reality')}</span>
          {row.actual ? (
            <>
              <span className="pred__v num">{money(row.actual.cents)}</span>
              <span className="t-small t-muted num">{t('precision.soldIn', { n: row.actual.days })}</span>
            </>
          ) : (
            <>
              <span className="pred__v t-faint">{t('precision.pending')}</span>
              <span className="t-small t-muted">{t('precision.pendingFor', { n: heldFor })}</span>
            </>
          )}
        </div>
        {row.actual && (
          <div className="pred__err">
            <span className={`num ${Math.abs(row.priceErrorPct!) <= 0.08 ? 't-pos' : 't-warn'}`}>
              {t('precision.priceErr', { e: money(Math.round(row.priceErrorCents! / 100) * 100, { sign: true }) })} ({pct(row.priceErrorPct!, { sign: true })})
            </span>
            <span className={`num ${row.delayInRange ? 't-pos' : 't-warn'}`}>
              {row.delayInRange ? t('precision.delayOk') : t('precision.delayErr', { n: row.delayErrorDays! > 0 ? `+${row.delayErrorDays}` : String(row.delayErrorDays) })}
            </span>
          </div>
        )}
      </div>
      {b && (
        <p className="pred__basis t-small t-faint">
          {t('precision.basis', { n: b.comparables })}
          {b.p50 !== null ? ` · P25 ${money(b.p25 ?? 0)} · ${t('market.median').toLowerCase()} ${money(b.p50)} · P75 ${money(b.p75 ?? 0)}` : ''}
          {b.source ? ` · ${t(`market.source${b.source}`)}` : ''}
          {b.personalN > 0 ? ` · ${t('precision.basisPersonal', { n: b.personalN })}${b.personalMedianCents !== null ? ` ${money(b.personalMedianCents)}` : ''}` : ` · ${t('precision.basisNoPersonal')}`}
          {b.correction !== 1 ? ` · ${t('precision.basisCorrection', { f: b.correction.toFixed(2) })}` : ''}
        </p>
      )}
    </article>
  );
}

/** "Précision ERA": every forecast confronted with the real sale. */
export function PrecisionView() {
  const { t, money, pct, month } = useI18n();
  const era = useEra();
  const [show, setShow] = useState<'resolved' | 'open'>('resolved');
  const [all, setAll] = useState(false);
  const s = useMemo(() => precisionSummary(era.precision), [era.precision]);
  const resolved = era.precision.filter((r) => r.actual);
  const open = era.precision.filter((r) => !r.actual && era.viewById.get(r.itemId)?.inStock);
  const learning = era.learning;
  const pts = resolved.map((r) => ({
    x: r.predictedCents,
    y: r.actual!.cents,
    r: 5,
    label: era.viewById.get(r.itemId)?.item.title ?? '',
    color: r.priceInRange ? 'var(--emerald)' : 'var(--amber)',
    id: r.itemId,
    detail: (
      <div className="chart__tooltip-row">
        {t('precision.error')} <b className="num">{pct(r.priceErrorPct!, { sign: true })}</b>
      </div>
    ),
  }));
  const list = show === 'resolved' ? resolved : open;

  if (era.precision.length === 0) {
    return (
      <Card>
        <EmptyState title={t('precision.empty')} why={t('precision.emptyWhy')} />
      </Card>
    );
  }

  return (
    <div className="stack-4">
      <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }} aria-label={t('precision.title')}>
        <div className="kpi">
          <Metric small label={t('precision.medianError')} icon="target" tone="violet" value={<span className="num">{s.medianAbsErrorCents === null ? '—' : money(Math.round(s.medianAbsErrorCents / 100) * 100)}</span>} foot={s.medianAbsErrorPct === null ? null : pct(s.medianAbsErrorPct)} />
        </div>
        <div className="kpi">
          <Metric small label={t('precision.bias')} icon="scale" tone="amber" value={<span className="num">{s.medianSignedErrorPct === null ? '—' : pct(s.medianSignedErrorPct, { sign: true })}</span>} foot={s.medianSignedErrorPct === null ? null : s.medianSignedErrorPct < 0 ? t('precision.biasUnder') : t('precision.biasOver')} />
        </div>
        <div className="kpi">
          <Metric small label={t('precision.priceHit')} icon="check" tone="emerald" value={<span className="num">{s.priceHitRate === null ? '—' : pct(s.priceHitRate)}</span>} foot={t('precision.inRange')} />
        </div>
        <div className="kpi">
          <Metric small label={t('precision.delayHit')} icon="clock" tone="cobalt" value={<span className="num">{s.delayHitRate === null ? '—' : pct(s.delayHitRate)}</span>} foot={s.medianAbsDelayErrorDays === null ? null : t('precision.delayMedian', { n: Math.round(s.medianAbsDelayErrorDays) })} />
        </div>
        <div className="kpi">
          <Metric small label={t('precision.sample')} icon="layers" tone="cyan" value={<span className="num">{s.resolved}</span>} foot={t('precision.openN', { n: s.open })} />
        </div>
      </section>
      {s.resolved > 0 && s.resolved < 10 && <p className="t-small t-warn">{t('precision.smallSample', { n: s.resolved })}</p>}

      <div className="grid-12">
        <Card className="span-7" title={t('precision.chartTitle')} hint={t('precision.chartHint')} icon="target" tone="violet">
          <ScatterChart
            title={t('precision.chartTitle')}
            points={pts}
            diagonal
            zeroBased={false}
            xLabel={t('precision.forecast')}
            yLabel={t('precision.reality')}
            xFormat={(v) => money(Math.round(v / 100) * 100)}
            yFormat={(v) => money(Math.round(v / 100) * 100)}
            height={300}
            minPoints={3}
            onSelect={(i) => go(`item/${pts[i]!.id}`)}
          />
          <p className="t-small t-faint" style={{ marginTop: 6 }}>
            {t('precision.chartRead')}
          </p>
        </Card>
        <div className="span-5 stack-4">
          <Card title={t('insights.calibration')} hint={t('insights.calibrationHint')} icon="scale" tone="cyan">
            <div className="stack-3">
              {learning.calibration.map((c) => (
                <div key={c.confidence} className="calib">
                  <span className="t-small" style={{ width: 70 }}>
                    {t(`confidence.${c.confidence}`)}
                  </span>
                  <span className="calib__track">
                    <span className="calib__fill" style={{ width: `${(c.hitRate ?? 0) * 100}%` }} />
                    <span className="calib__target" style={{ left: `${c.target * 100}%` }} title={t('insights.target', { pct: pct(c.target) })} />
                  </span>
                  <span className="num t-small" style={{ width: 90, textAlign: 'right' }}>
                    {c.hitRate === null ? '—' : pct(c.hitRate)} <span className="t-faint">n={c.n}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="t-small t-muted" style={{ marginTop: 10 }}>
              {learning.priceCorrection !== 1 ? t('insights.correction', { f: learning.priceCorrection.toFixed(2) }) : t('insights.noCorrection')}
            </p>
          </Card>
          <Card title={t('insights.trend')} hint={t('insights.trendHint')} icon="trendDown" tone="emerald">
            <LineChart
              title={t('insights.trend')}
              labels={learning.trend.map((p) => month(p.at))}
              series={[{ key: 'mape', label: t('precision.error'), color: 'var(--emerald)', values: learning.trend.map((p) => p.mape * 100) }]}
              format={(v) => `${Math.round(v)} %`}
              height={150}
              minPoints={3}
            />
          </Card>
        </div>
      </div>

      <Card
        title={t('precision.listTitle')}
        icon="rows"
        tone="neutral"
        actions={
          <Segmented
            label={t('precision.listTitle')}
            value={show}
            onChange={setShow}
            options={[
              { value: 'resolved', label: `${t('precision.tabResolved')} · ${resolved.length}` },
              { value: 'open', label: `${t('precision.tabOpen')} · ${open.length}` },
            ]}
          />
        }
      >
        {list.length === 0 ? (
          <p className="t-muted">{show === 'resolved' ? t('precision.noneResolved') : t('precision.noneOpen')}</p>
        ) : (
          <div className="stack">
            {list.slice(0, all ? 60 : 6).map((r) => (
              <PredictionRow key={r.id} row={r} title={era.viewById.get(r.itemId)?.item.title ?? '—'} />
            ))}
            {list.length > 6 && (
              <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll((x) => !x)}>
                {all ? t('precision.showLess') : t('precision.showAll', { n: Math.min(60, list.length) })}
              </button>
            )}
          </div>
        )}
        {era.precision.some((r) => r.basis?.source === 'DEMO') && (
          <p className="t-small t-faint" style={{ marginTop: 10 }}>
            <Badge tone="amber">{t('app.demoBadge')}</Badge> {t('precision.demoNote')}
          </p>
        )}
      </Card>
    </div>
  );
}
