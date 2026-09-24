import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { MarketplaceError } from '@/data/adapters/marketplace';
import { db } from '@/data/db';
import { qualityOf } from '@/domain/provenance';
import { useI18n } from '@/i18n';
import { DistributionStrip, LineChart } from '@/ui/charts/charts';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, ConfidenceMeter, DemoBadge, EmptyState, ErrorState, Metric, Money, QualityTag, Stages } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { RecommendationCard, StagnationBadge, StrategyCards, Timeline } from '../components/domain';
import { CostEditor, SaleModal } from '../components/forms';
import { ListingAssistant, OfferCalculator } from '../components/tools';
import { analyzeItem } from '../market-run';
import { BackLink } from '../Shell';
import { useEra } from '../state';

type Stage = 'COLLECTING' | 'COMPARING' | 'READY';

export function ItemDetail({ id }: { id: string }) {
  const i = useI18n();
  const { t, money, date, pct } = i;
  const era = useEra();
  const toast = useToast();
  const v = era.viewById.get(id);
  const intel = era.intelById.get(id) ?? null;
  const obs = useLiveQuery(() => db.observations.where('inventoryItemId').equals(id).sortBy('at'), [id]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editCost, setEditCost] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);

  if (!v) {
    return era.ready ? (
      <Card>
        <EmptyState title={t('item.notFound')} why={t('item.notFoundWhy')} action={<BackLink href="#/stock" label={t('item.back')} />} />
      </Card>
    ) : null;
  }

  const item = v.item;
  const analysis = intel?.analysis ?? era.analyses.get(id) ?? null;
  const pricing = intel?.pricing ?? null;
  const st = intel?.stagnation ?? null;

  const runAnalysis = async () => {
    setError(null);
    try {
      await analyzeItem(v, era.mode, era.model, era.learning, setStage);
      setTimeout(() => setStage(null), 900);
    } catch (e) {
      setStage(null);
      const code = e instanceof MarketplaceError ? (e.message === 'NO_VINTED_TAB' ? 'NO_VINTED_TAB' : e.code) : 'UNAVAILABLE';
      setError(code);
      toast('error', t(`errors.${code}`));
    }
  };

  const priceSeries = (obs ?? []).map((o) => ({ at: o.at, price: o.priceCents, views: o.views, favs: o.favorites }));
  const d = analysis?.distribution ?? null;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <BackLink href="#/stock" label={t('item.back')} />
      </div>

      <header className="card" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 20, alignItems: 'center', marginBottom: 16 }}>
        <Thumb photoUrl={item.photoUrl} category={item.category} alt={item.title} size="lg" />
        <div className="stack-3" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Badge tone={item.status === 'SOLD' ? 'emerald' : item.status === 'LISTED' ? 'cobalt' : 'neutral'}>{t(`status.${item.status}`)}</Badge>
            {st && <StagnationBadge d={st} />}
            {item.isDemo && <DemoBadge />}
          </div>
          <h1 className="t-h1" style={{ overflowWrap: 'anywhere' }}>
            {item.title}
          </h1>
          <p className="t-muted">
            {[item.brand, item.model, item.size, item.condition ? t(`condition.${item.condition}`) : null].filter(Boolean).join(' · ')}
          </p>
          <div className="row wrap" style={{ gap: 28, rowGap: 14 }}>
            <Metric small label={t('item.purchase')} value={<Money cents={v.cost} unknownLabel={t('data.notProvided')} />} foot={<QualityTag quality={qualityOf(v.cost, item.meta.purchasePriceCents)} />} />
            <Metric small label={t('item.currentPrice')} value={<Money cents={v.askPrice ?? v.sale?.salePriceCents ?? null} />} foot={analysis?.position ? <span className="num">{pct(analysis.position.deltaPct, { sign: true })} vs {t('market.median').toLowerCase()}</span> : null} />
            <Metric small label={t('item.potentialProfit')} value={v.inStock ? <Money cents={v.potentialProfit} sign /> : <span className="t-faint">—</span>} foot={v.cost === null && v.inStock ? <QualityTag quality="UNKNOWN" text={t('reco.w.missingCost')} /> : null} />
            <Metric small label={t('item.held')} value={v.daysHeld === null ? <span className="t-faint">—</span> : <span className="num">{t('kpi.days', { n: v.daysHeld })}</span>} foot={v.daysHeldInferred ? <QualityTag quality="INFERRED" /> : null} />
          </div>
        </div>
      </header>

      <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
        {v.inStock && v.current && (
          <Button variant="primary" icon="market" loading={stage !== null && stage !== 'READY'} onClick={runAnalysis}>
            {analysis ? t('item.reanalyze') : t('item.analyze')}
          </Button>
        )}
        <Button icon="edit" onClick={() => setEditCost((x) => !x)} aria-expanded={editCost}>
          {t('item.editCost')}
        </Button>
        {v.inStock && (
          <Button icon="check" onClick={() => setSaleOpen(true)}>
            {t('item.recordSale')}
          </Button>
        )}
        {stage && <Stages stages={['COLLECTING', 'COMPARING', 'READY'] as Stage[]} current={stage} labelKey={(s) => t(`market.stage${s}`)} />}
      </div>
      {editCost && (
        <Card style={{ marginBottom: 16 }}>
          <CostEditor itemId={id} initial={v.cost} onDone={() => setEditCost(false)} />
        </Card>
      )}
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState code={error} onRetry={runAnalysis} />
        </div>
      )}

      <div className="grid-12">
        <div className="span-8 stack-4">
          {intel?.recommendation && <RecommendationCard r={intel.recommendation} onAddCost={() => setEditCost(true)} onAnalyze={runAnalysis} />}

          <Card
            title={t('item.field.market')}
            icon="market"
            tone="cobalt"
            hint={analysis ? `${t('market.analyzedAt', { when: i.relative(analysis.at, era.now) })} · ${t(`market.source${analysis.source}`)}` : undefined}
            actions={analysis ? <Badge tone={analysis.quality === 'HIGH' ? 'emerald' : analysis.quality === 'MEDIUM' ? 'cyan' : 'amber'}>{t('market.quality')} · {t(`compQuality.${analysis.quality}`)}</Badge> : null}
          >
            {!analysis ? (
              <p className="t-muted">{t('reco.w.noAnalysis')}</p>
            ) : d && analysis.quality !== 'INSUFFICIENT' ? (
              <div className="stack-4">
                <DistributionStrip
                  title={t('market.distribution')}
                  points={analysis.comparables.filter((c) => c.kept).map((c) => ({ v: c.candidate.priceCents, w: c.similarity, label: c.candidate.title }))}
                  p25={d.p25}
                  p50={d.p50}
                  p75={d.p75}
                  current={v.askPrice}
                  format={(x) => money(Math.round(x / 100) * 100)}
                />
                {pricing?.status === 'OK' && <StrategyCards pricing={pricing} current={v.askPrice} />}
                <div className="row wrap t-small t-muted" style={{ gap: 16 }}>
                  <span>
                    {t('market.effectiveSample')} <b className="num">{analysis.effectiveSample}</b>
                  </span>
                  <span>{t('market.kept', { kept: analysis.keptCount, collected: analysis.collected })}</span>
                  {pricing && (
                    <span className="row" style={{ gap: 6 }}>
                      {t('confidence.label')} <ConfidenceMeter level={pricing.confidence} />
                    </span>
                  )}
                  <a href={`#/market?item=${id}`}>{t('market.comparables')} →</a>
                </div>
              </div>
            ) : (
              <EmptyState compact title={t('market.insufficient')} why={t('market.insufficientWhy')} />
            )}
          </Card>

          <div className="grid-12">
            <Card className="span-6" title={t('item.priceHistory')} icon="price" tone="amber">
              <LineChart
                title={t('item.priceHistory')}
                labels={priceSeries.map((p) => date(p.at))}
                series={[{ key: 'p', label: t('charts.price'), color: 'var(--chart-3)', values: priceSeries.map((p) => p.price) }]}
                format={(x) => money(Math.round(x / 100) * 100)}
                height={170}
                zeroBased={false}
                step
              />
            </Card>
            <Card className="span-6" title={t('item.engagement')} icon="eye" tone="cyan" hint={v.current ? t('item.viewsFavs', { views: v.current.views ?? '—', favorites: v.current.favorites ?? '—' }) : undefined}>
              <LineChart
                title={t('charts.views')}
                labels={priceSeries.map((p) => date(p.at))}
                series={[{ key: 'v', label: t('charts.views'), color: 'var(--chart-2)', values: priceSeries.map((p) => p.views), area: true }]}
                format={(x) => i.num(x)}
                height={170}
              />
            </Card>
          </div>

          {intel && (
            <Card title={t('listing.title')} hint={t('listing.hint')} icon="edit" tone="pink">
              <ListingAssistant intel={intel} />
            </Card>
          )}

          <Card title={t('item.listingHistory')} icon="repost" tone="cobalt">
            {v.listings.length === 0 ? (
              <p className="t-muted">{t('item.noListing')}</p>
            ) : (
              <div className="list">
                {v.listings.map((l, idx) => (
                  <div key={l.id} className="list__row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', cursor: 'default' }}>
                    <span>
                      <span className="list__title">
                        {t('item.listingN', { n: idx + 1 })} {idx > 0 && <Badge tone="cobalt">{t('item.republished')}</Badge>}
                      </span>
                      <span className="list__meta" style={{ display: 'block' }}>
                        {date(l.listedAt)} → {l.soldAt ? date(l.soldAt) : l.removedAt ? date(l.removedAt) : t('common.today')} · {t('item.viewsFavs', { views: l.views ?? '—', favorites: l.favorites ?? '—' })}
                      </span>
                    </span>
                    <Badge tone={l.status === 'ACTIVE' ? 'emerald' : l.status === 'SOLD' ? 'violet' : 'neutral'}>{t(`item.${l.status === 'ACTIVE' ? 'active' : l.status === 'SOLD' ? 'sold' : 'removed'}`)}</Badge>
                    <Money cents={l.priceCents} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="span-4 stack-4">
          {st && (
            <Card title={t('item.stagnation')} icon="hourglass" tone={st.stagnant ? 'coral' : 'emerald'}>
              <div className="stack">
                <StagnationBadge d={st} />
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
                  <Metric small label={t('item.listedFor')} value={<span className="num">{t('kpi.days', { n: st.daysListed })}</span>} />
                  <Metric small label={t('item.field.views')} value={<span className="num">{st.views ?? '—'}</span>} foot={st.viewsPerDay !== null ? `${i.num(st.viewsPerDay, 1)} / j` : null} />
                  <Metric small label={t('item.field.favorites')} value={<span className="num">{st.favorites ?? '—'}</span>} foot={st.favoriteRate !== null ? pct(st.favoriteRate, { digits: 1 }) : null} />
                  <Metric small label={t('market.positioning')} value={<span className="num">{st.priceDeltaPct === null ? '—' : pct(st.priceDeltaPct, { sign: true })}</span>} />
                </div>
                <p className="t-small t-faint">{t('stagnation.threshold', { n: st.thresholdDays })}</p>
              </div>
            </Card>
          )}

          {intel && v.askPrice !== null && v.inStock && (
            <Card title={t('offer.title')} hint={t('offer.hint')} icon="scale" tone="amber">
              <OfferCalculator intel={intel} compact />
            </Card>
          )}

          <Card title={t('item.financials')} icon="capital" tone="amber">
            <dl className="reco__grid" style={{ margin: 0, gridTemplateColumns: '1fr auto' }}>
              <dt className="t-muted">{t('item.purchase')}</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>
                <Money cents={v.cost} unknownLabel={t('data.notProvided')} />
              </dd>
              <dt className="t-muted">{v.sale ? t('item.salePrice') : t('item.currentPrice')}</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>
                <Money cents={v.sale?.salePriceCents ?? v.askPrice} />
              </dd>
              {pricing?.expectedSaleCents != null && v.inStock && (
                <>
                  <dt className="t-muted">
                    {t('item.expectedSale')} <QualityTag quality="PREDICTED" />
                  </dt>
                  <dd style={{ margin: 0, textAlign: 'right' }} className="num">
                    {money(pricing.expectedSaleCents)}
                  </dd>
                </>
              )}
              <dt className="t-muted">{v.sale ? t('insights.niche.profit') : t('item.potentialProfit')}</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontWeight: 600 }}>
                <Money cents={v.sale ? (v.cost === null ? null : v.sale.salePriceCents - v.cost) : v.potentialProfit} sign />
              </dd>
              <dt className="t-muted">ROI</dt>
              <dd style={{ margin: 0, textAlign: 'right' }} className="num">
                {v.cost && (v.sale || v.potentialProfit !== null) ? pct(((v.sale?.salePriceCents ?? v.askPrice ?? 0) - v.cost) / v.cost) : '—'}
              </dd>
            </dl>
          </Card>

          <Card title={t('item.timeline')} icon="clock" tone="violet">
            <Timeline itemId={id} />
          </Card>

          <Card title={t('item.dataQuality')} icon="info" tone="neutral">
            <dl className="reco__grid" style={{ margin: 0, gridTemplateColumns: '1fr auto', rowGap: 8 }}>
              {(
                [
                  ['item.field.purchasePrice', qualityOf(item.purchasePriceCents, item.meta.purchasePriceCents)],
                  ['item.field.purchaseDate', item.purchaseDate ? 'KNOWN' : v.daysHeldInferred ? 'INFERRED' : 'UNKNOWN'],
                  ['item.field.purchaseSource', item.purchaseSource ? 'KNOWN' : 'UNKNOWN'],
                  ['item.field.size', item.size ? 'KNOWN' : 'UNKNOWN'],
                  ['item.field.condition', item.condition ? 'KNOWN' : 'UNKNOWN'],
                  ['item.field.views', v.current?.views != null ? 'KNOWN' : 'UNKNOWN'],
                  ['item.field.market', analysis ? (intel?.analysisStale ? 'PARTIAL' : 'KNOWN') : 'UNKNOWN'],
                ] as const
              ).map(([k, q]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt className="t-small t-muted">{t(k)}</dt>
                  <dd style={{ margin: 0, textAlign: 'right' }}>
                    <QualityTag quality={q} />
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
      <SaleModal open={saleOpen} onClose={() => setSaleOpen(false)} itemId={id} suggested={v.askPrice} />
    </>
  );
}
