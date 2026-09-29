import { useState } from 'react';
import { useI18n } from '@/i18n';
import type { ComparableAnalysis } from '@/intelligence/comparables';
import type { PricingResult } from '@/intelligence/pricing';
import { realizedFor } from '@/intelligence/seller-model';
import { DistributionStrip, Legend } from '@/ui/charts/charts';
import { DualDistribution } from '@/ui/charts/dual';
import { IllustrationNoComparables } from '@/ui/components/illustrations';
import { Badge, Button, Card, ConfidenceMeter, DemoBadge, EmptyState, Flag, Metric, Tabs } from '@/ui/components/primitives';
import { useEra } from '../state';
import { StrategyCards } from './domain';
import { SearchTrace } from './search-trace';

const QUALITY_TONE = { HIGH: 'emerald', MEDIUM: 'cyan', LOW: 'amber', INSUFFICIENT: 'coral' } as const;

/** One price analysis in full: the market's spread, the prices it rests on, the comparables kept and excluded. */
export function AnalysisView({ analysis, pricing, current, onRetry }: { analysis: ComparableAnalysis; pricing: PricingResult | null; current: number | null; onRetry?: () => void }) {
  const i = useI18n();
  const { t, money, pct } = i;
  const [tab, setTab] = useState<'kept' | 'excluded'>('kept');
  const d = analysis.distribution;
  const kept = analysis.comparables.filter((c) => c.kept);
  const excluded = analysis.comparables.filter((c) => !c.kept);
  const insufficient = analysis.quality === 'INSUFFICIENT' || !d;
  const pos = analysis.position;
  const era = useEra();
  const realized = realizedFor(era.sales, analysis.subject);

  return (
    <div className="stack-4">
      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
        <div className="kpi">
          <Metric small label={t('market.quality')} value={<Badge tone={QUALITY_TONE[analysis.quality]}>{t(`compQuality.${analysis.quality}`)}</Badge>} foot={analysis.source === 'DEMO' ? <DemoBadge /> : analysis.via ? <Flag kind="UNVERIFIED" title={t(analysis.via === 'PAGE' ? 'flag.pageSearch' : 'flag.learnedEndpoint')} /> : t('market.sourceVINTED')} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.effectiveSample')} value={<span className="num">{i.num(analysis.effectiveSample, 1)}</span>} foot={t('market.kept', { kept: analysis.keptCount, collected: analysis.collected })} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.p25')} value={<span className="num">{d ? money(d.p25) : '—'}</span>} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.median')} value={<span className="num">{d ? money(d.p50) : '—'}</span>} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.p75')} value={<span className="num">{d ? money(d.p75) : '—'}</span>} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.yourPrice')} value={<span className="num">{current !== null ? money(current) : '—'}</span>} />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('market.positioning')}
            value={<span className={`num ${pos && pos.deltaPct > 0.15 ? 't-warn' : ''}`}>{pos ? pct(pos.deltaPct, { sign: true }) : '—'}</span>}
            foot={pos ? `P${Math.round(pos.percentile * 100)}` : null}
          />
        </div>
      </div>

      {insufficient ? (
        <Card>
          <EmptyState art={<IllustrationNoComparables />} title={t('market.insufficient')} why={t('market.insufficientWhy')} action={onRetry ? <Button onClick={onRetry}>{t('market.insufficientCta')}</Button> : null} />
          <SearchTrace analysis={analysis} />
        </Card>
      ) : (
        <div className="grid-12">
          <Card
            className="span-7"
            title={t('market.suggested')}
            hint={`${t('market.never')} ${t('market.asking')}`}
            icon="target"
            tone="violet"
            actions={pricing?.status === 'OK' ? <ConfidenceMeter level={pricing.confidence} /> : null}
          >
            <DistributionStrip
              title={t('market.distribution')}
              points={kept.map((c) => ({ v: c.candidate.priceCents, w: c.similarity, label: c.candidate.title }))}
              p25={d!.p25}
              p50={d!.p50}
              p75={d!.p75}
              current={current}
              bands={
                pricing?.status === 'OK'
                  ? pricing.options.map((o, k) => ({ from: o.range.min, to: Math.max(o.range.max, o.range.min + 100), label: o.strategy, color: ['var(--emerald)', 'var(--violet)', 'var(--amber)'][k]! }))
                  : undefined
              }
              format={(x) => money(Math.round(x / 100) * 100)}
              height={170}
            />
            <div className="row-between wrap" style={{ marginTop: 6 }}>
              <Legend
                items={[
                  { label: t('market.comparables'), color: 'var(--chart-2)', dot: true },
                  { label: 'P25–P75', color: 'var(--violet)' },
                  { label: t('market.yourPrice'), color: 'var(--amber)', dashed: true },
                ]}
              />
              {pricing?.ceilingCents != null && <span className="t-small t-faint">{t('market.ceiling', { price: pricing.ceilingCents })}</span>}
            </div>
          </Card>
          <Card className="span-5" title={t('market.pricesUsed')} icon="info" tone="cyan">
            <dl className="reco__grid" style={{ margin: 0, gridTemplateColumns: '110px minmax(0,1fr)' }}>
              <dt className="reco__k">{t('market.queries')}</dt>
              <dd style={{ margin: 0 }}>
                {analysis.queries.map((q) => (
                  <code key={q} className="badge b-neutral" style={{ marginRight: 4, marginBottom: 4 }}>
                    {q}
                  </code>
                ))}
              </dd>
              <dt className="reco__k">{t('market.supply')}</dt>
              <dd style={{ margin: 0 }} className="num">
                {analysis.totalEntries === null ? '—' : analysis.totalCapped ? t('market.supplyCapped', { n: 960 }) : t('market.supplyExact', { n: analysis.totalEntries })}
              </dd>
              <dt className="reco__k">{t('market.priceNature')}</dt>
              <dd style={{ margin: 0 }}>{t('market.askingShort')}</dd>
              <dt className="reco__k">{t('market.source')}</dt>
              <dd style={{ margin: 0 }}>{t(`market.source${analysis.source}`)}</dd>
              <dt className="reco__k">{t('market.reason')}</dt>
              <dd style={{ margin: 0 }} className="stack" >
                {Object.entries(analysis.exclusions)
                  .filter(([, n]) => n > 0)
                  .map(([r, n]) => (
                    <span key={r} className="row-between t-small">
                      <span className="t-muted">{t(`market.excl.${r}`)}</span>
                      <b className="num">{n}</b>
                    </span>
                  ))}
              </dd>
            </dl>
            {analysis.notes.length > 0 && (
              <ul className="stack t-small" style={{ margin: '14px 0 0', paddingLeft: 18, color: 'var(--amber)' }}>
                {analysis.notes.map((n) => (
                  <li key={n}>{t(`market.note.${n}`)}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="span-12" title={t('dual.title')} hint={t('dual.hint')} icon="compare" tone="cyan">
            <DualDistribution
              title={t('dual.title')}
              asking={{ points: kept.map((c) => ({ v: c.candidate.priceCents, w: c.similarity, label: c.candidate.title })), q: { p25: d!.p25, p50: d!.p50, p75: d!.p75 } }}
              realized={{ points: realized?.points ?? [] }}
              realizedScope={realized ? t(`dual.scope.${realized.scope}`) : null}
              current={current}
              format={(x) => money(Math.round(x / 100) * 100)}
            />
          </Card>
          {pricing?.status === 'OK' && (
            <Card className="span-12" title={t('market.strategies')} hint={t('market.tradeoff')} icon="scale" tone="violet">
              <StrategyCards pricing={pricing} current={current} />
            </Card>
          )}
        </div>
      )}

      <Card title={t('market.comparables')} icon="layers" tone="cobalt">
        <Tabs
          label={t('market.comparables')}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'kept', label: t('market.keptTab', { n: kept.length }) },
            { value: 'excluded', label: t('market.excludedTab', { n: excluded.length }) },
          ]}
        />
        <div className="table-wrap cv-auto" tabIndex={0} style={{ maxHeight: 420, boxShadow: 'none' }}>
          <table className="dt dt--compact">
            <thead>
              <tr>
                <th scope="col">{t('stock.col.item')}</th>
                <th scope="col">{t('stock.col.size')}</th>
                <th scope="col">{t('item.field.condition')}</th>
                <th scope="col" className="is-num">
                  {t('stock.col.price')}
                </th>
                <th scope="col" className="is-num">
                  {t('stock.col.favorites')}
                </th>
                <th scope="col">{tab === 'kept' ? t('market.similarity') : t('market.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {(tab === 'kept' ? kept : excluded).map((c) => (
                <tr key={c.candidate.id} style={{ cursor: c.candidate.url ? 'pointer' : 'default' }} onClick={() => c.candidate.url && window.open(c.candidate.url, '_blank', 'noopener')}>
                  <td style={{ maxWidth: 360 }}>
                    <span className="clamp-1" style={{ display: 'block' }}>
                      {c.candidate.title}
                    </span>
                  </td>
                  <td>{c.candidate.size ?? '—'}</td>
                  <td className="t-muted">{c.candidate.condition ? t(`condition.${c.candidate.condition}`) : '—'}</td>
                  <td className="is-num num">{money(c.candidate.priceCents)}</td>
                  <td className="is-num num">{c.candidate.favorites ?? '—'}</td>
                  <td>
                    {c.kept ? (
                      <span className="row" style={{ gap: 8 }}>
                        <span className="meter" style={{ width: 70 }} aria-hidden="true">
                          <span className="meter__fill" style={{ display: 'block', width: `${Math.round(c.similarity * 100)}%` }} />
                        </span>
                        <span className="num t-small">{Math.round(c.similarity * 100)} %</span>
                      </span>
                    ) : (
                      <Badge tone="neutral">{t(`market.excl.${c.reason}`)}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
