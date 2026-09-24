import { useState } from 'react';
import { MarketplaceError } from '@/data/adapters/marketplace';
import { useI18n } from '@/i18n';
import type { ComparableAnalysis } from '@/intelligence/comparables';
import type { PricingResult } from '@/intelligence/pricing';
import { DistributionStrip, Legend } from '@/ui/charts/charts';
import { IllustrationAnalysis, IllustrationNoComparables } from '@/ui/components/illustrations';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, ConfidenceMeter, DemoBadge, EmptyState, ErrorState, Metric, Select, Stages, Tabs } from '@/ui/components/primitives';
import { StrategyCards } from '../components/domain';
import { analyzeItem } from '../market-run';
import { useBulkAnalyze } from '../components/tools';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';

type Stage = 'COLLECTING' | 'COMPARING' | 'READY';
const QUALITY_TONE = { HIGH: 'emerald', MEDIUM: 'cyan', LOW: 'amber', INSUFFICIENT: 'coral' } as const;

export function Market({ route }: { route: Route }) {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const candidates = era.intel.filter((x) => x.view.current).sort((a, b) => (b.recommendation?.priority ?? 0) - (a.recommendation?.priority ?? 0));
  const itemId = route.query.get('item') ?? candidates.find((c) => c.analysis)?.view.item.id ?? candidates[0]?.view.item.id ?? null;
  const intel = itemId ? (era.intelById.get(itemId) ?? null) : null;
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bulk = useBulkAnalyze();

  const run = async () => {
    if (!intel) return;
    setError(null);
    try {
      await analyzeItem(intel.view, era.mode, era.model, era.learning, setStage);
      setTimeout(() => setStage(null), 900);
    } catch (e) {
      setStage(null);
      const code = e instanceof MarketplaceError ? (e.message === 'NO_VINTED_TAB' ? 'NO_VINTED_TAB' : e.code) : 'UNAVAILABLE';
      setError(code);
      toast('error', t(`errors.${code}`));
    }
  };

  return (
    <>
      <PageHead
        title={t('market.title')}
        sub={t('market.subtitle')}
        actions={
          bulk.pending > 0 ? (
            <Button icon="layers" loading={!!bulk.busy} onClick={() => bulk.run()}>
              {bulk.busy ? `${bulk.busy.done}/${bulk.busy.total}` : t('today.analyzeStock', { n: bulk.pending })}
            </Button>
          ) : null
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field grow" style={{ minWidth: 260 }}>
            <label className="field__label" htmlFor="mk-item">
              {t('market.pickItem')}
            </label>
            <Select
              id="mk-item"
              value={itemId ?? ''}
              onChange={(e) => go(`market?item=${e.target.value}`)}
              options={[
                { value: '', label: t('market.pickPlaceholder') },
                ...candidates.map((c) => ({ value: c.view.item.id, label: `${c.view.item.title}${c.analysis ? ' ·  ✓' : ''}` })),
              ]}
            />
          </div>
          <Button variant="primary" icon="market" disabled={!intel} loading={stage !== null && stage !== 'READY'} onClick={run}>
            {t('market.run')}
          </Button>
          {stage && <Stages stages={['COLLECTING', 'COMPARING', 'READY'] as Stage[]} current={stage} labelKey={(s) => t(`market.stage${s}`)} />}
        </div>
      </Card>
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState code={error} onRetry={run} />
        </div>
      )}
      {!intel?.analysis ? (
        <Card>
          <EmptyState art={<IllustrationAnalysis />} title={t('market.empty')} why={t('market.emptyWhy')} action={intel ? <Button variant="primary" onClick={run}>{t('market.run')}</Button> : null} />
        </Card>
      ) : (
        <AnalysisView analysis={intel.analysis} pricing={intel.pricing} current={intel.view.askPrice} onRetry={() => document.getElementById('mk-item')?.focus()} />
      )}
    </>
  );
}

export function AnalysisView({ analysis, pricing, current, onRetry }: { analysis: ComparableAnalysis; pricing: PricingResult | null; current: number | null; onRetry?: () => void }) {
  const i = useI18n();
  const { t, money, pct } = i;
  const [tab, setTab] = useState<'kept' | 'excluded'>('kept');
  const d = analysis.distribution;
  const kept = analysis.comparables.filter((c) => c.kept);
  const excluded = analysis.comparables.filter((c) => !c.kept);
  const insufficient = analysis.quality === 'INSUFFICIENT' || !d;
  const pos = analysis.position;

  return (
    <div className="stack-4">
      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
        <div className="kpi">
          <Metric small label={t('market.quality')} value={<Badge tone={QUALITY_TONE[analysis.quality]}>{t(`compQuality.${analysis.quality}`)}</Badge>} foot={analysis.source === 'DEMO' ? <DemoBadge /> : t('market.sourceVINTED')} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.effectiveSample')} value={<span className="num">{analysis.effectiveSample}</span>} foot={t('market.kept', { kept: analysis.keptCount, collected: analysis.collected })} />
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
        </Card>
      ) : (
        <div className="grid-12">
          <Card
            className="span-7"
            title={t('market.suggested')}
            hint={t('market.never')}
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
        <div className="table-wrap" style={{ maxHeight: 420, boxShadow: 'none' }}>
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
