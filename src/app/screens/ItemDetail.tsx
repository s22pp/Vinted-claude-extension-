import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { errorCode } from '@/data/adapters/marketplace';
import { db } from '@/data/db';
import { qualityOf } from '@/domain/provenance';
import { useI18n } from '@/i18n';
import { LineChart } from '@/ui/charts/charts';
import { DualDistribution } from '@/ui/charts/dual';
import { realizedFor } from '@/intelligence/seller-model';
import { IconTile } from '@/ui/components/icons';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, ConfidenceMeter, DemoBadge, EmptyState, ErrorState, Flag, Metric, Money, QualityTag, Stages } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { RecommendationCard, StagnationBadge, StatusBadge, StrategyCards, Timeline } from '../components/domain';
import { repo } from '@/data/repo';
import { CostEditor, SaleModal } from '../components/forms';
import { CostBreakdown, VintedCostForm } from '../components/cost';
import { PredictionRow } from '../components/precision';
import { Replies } from '../components/replies';
import { ListingAssistant, OfferCalculator } from '../components/tools';
import { PriceOnVintedButton, vintedIdOf } from '../components/vinted-price';
import { RepostButton, RepostPending } from '../components/repost';
import type { EraMessage, HideResult } from '@/data/adapters/vinted/protocol';
import { analyzeItem } from '../market-run';
import { BackLink } from '../Shell';
import { useEra } from '../state';

type Stage = 'COLLECTING' | 'COMPARING' | 'READY';

export function ItemDetail({ id }: { id: string }) {
  const i = useI18n();
  const { t, money, date, pct } = i;
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [hiding, setHiding] = useState(false);
  const v = era.viewById.get(id);
  const intel = era.intelById.get(id) ?? null;
  const obs = useLiveQuery(() => db.observations.where('inventoryItemId').equals(id).sortBy('at'), [id]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<unknown>(null);
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
      const code = errorCode(e);
      setError(e);
      errorToast(e);
    }
  };

  const priceSeries = (obs ?? []).map((o) => ({ at: o.at, price: o.priceCents, views: o.views, favs: o.favorites }));
  const d = analysis?.distribution ?? null;
  const pos = era.capital.positions.find((p) => p.itemId === id) ?? null;
  const realized = realizedFor(era.sales, item, id);
  const preds = era.precision.filter((r) => r.itemId === id);

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <BackLink href="#/stock" label={t('item.back')} />
      </div>

      <header className="card" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 20, alignItems: 'center', marginBottom: 16 }}>
        <Thumb photoUrl={item.photoUrl} category={item.category} alt={item.title} size="lg" />
        <div className="stack-3" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <StatusBadge status={item.status} />
            {st && <StagnationBadge d={st} />}
            {item.isDemo && <DemoBadge />}
          </div>
          <h1 className="t-h1" style={{ overflowWrap: 'anywhere' }}>
            {item.title}
          </h1>
          <p className="t-muted" data-testid="item-facts">
            {[item.brand, item.model, item.size, item.condition ? t(`condition.${item.condition}`) : null].filter(Boolean).join(' · ')}
          </p>
          <div className="item-kpis">
            <Metric
              small
              label={t('capital.invested')}
              value={<Money cents={v.cost} unknownLabel={t('data.notProvided')} />}
              foot={v.cost !== null && !v.costComplete ? <QualityTag quality="PARTIAL" text={t('cost.exShippingShort')} /> : <QualityTag quality={qualityOf(v.cost, item.meta.purchasePriceCents)} />}
            />
            <Metric
              small
              label={t('item.currentPrice')}
              value={<Money cents={v.askPrice ?? v.sale?.salePriceCents ?? null} />}
              foot={analysis?.position ? <span className="num">{pct(analysis.position.deltaPct, { sign: true })} vs {t('market.median').toLowerCase()}</span> : null}
            />
            <Metric
              small
              label={v.sale ? t('insights.niche.profit') : t('item.potentialProfit')}
              value={v.sale ? <Money cents={v.cost === null ? null : v.sale.salePriceCents - v.cost} sign /> : v.inStock ? <Money cents={v.potentialProfit} sign /> : <span className="t-faint">—</span>}
              foot={pos?.potentialRoi != null ? `ROI ${pct(pos.potentialRoi)}` : v.cost === null && v.inStock ? <QualityTag quality="UNKNOWN" text={t('reco.w.missingCost')} /> : null}
            />
            <Metric small label={t('item.held')} value={v.daysHeld === null ? <span className="t-faint">—</span> : <span className="num">{t('kpi.days', { n: v.daysHeld })}</span>} foot={v.daysHeldInferred ? <QualityTag quality="INFERRED" /> : null} />
            {v.inStock && (
              <Metric
                small
                label={t('capital.efficiencyCol')}
                help={t('kpi.efficiencyHint')}
                value={<span className={`num ${pos?.efficiency30 != null && pos.efficiency30 < 0.25 ? 't-warn' : ''}`}>{pos?.efficiency30 == null ? '—' : pct(pos.efficiency30)}</span>}
                foot={pos ? `${t('capital.demand')} : ${t(`capital.demandLevel.${pos.demand}`).toLowerCase()}` : null}
              />
            )}
          </div>
          {pos?.trap && (
            <div className="trap-note">
              <IconTile name="trap" tone="coral" size="sm" />
              <span>
                <b>{t('capital.trapTitle')}</b> — {pos.trap.reasons.map((r) => t(`capital.reason.${r}`)).join(' · ')}
              </span>
            </div>
          )}
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
        {(item.status === 'LISTED' || item.status === 'RESERVED') && (
          <Button
            icon={item.status === 'RESERVED' ? 'x' : 'clock'}
            onClick={async () => {
              await repo.setReserved(id, item.status !== 'RESERVED');
              toast('success', t('item.reservedSaved'), t(`status.${item.status === 'RESERVED' ? 'LISTED' : 'RESERVED'}`));
            }}
          >
            {item.status === 'RESERVED' ? t('item.unmarkReserved') : t('item.markReserved')}
          </Button>
        )}
        {era.mode === 'real' && vintedIdOf(v) && (item.status === 'LISTED' || item.status === 'HIDDEN') && (
          <Button
            icon={item.status === 'HIDDEN' ? 'eye' : 'lock'}
            loading={hiding}
            onClick={async () => {
              setHiding(true);
              try {
                const hidden = item.status !== 'HIDDEN';
                const r = (await browser.runtime.sendMessage({ type: 'era:item:hide', platformListingId: vintedIdOf(v)!, itemId: id, hidden } satisfies EraMessage)) as HideResult;
                if (!r.ok) errorToast(r);
                else toast('success', t(hidden ? 'item.hiddenDone' : 'item.shownDone'), t(r.verified ? 'item.hideVerified' : 'item.hideUnverified'));
              } finally {
                setHiding(false);
              }
            }}
          >
            {item.status === 'HIDDEN' ? t('item.show') : t('item.hide')}
          </Button>
        )}
        {era.mode === 'real' && <RepostButton v={v} />}
        {v.inStock && (
          <Button icon="check" onClick={() => setSaleOpen(true)}>
            {t('item.recordSale')}
          </Button>
        )}
        {item.status === 'SOLD' && (
          <Button variant={v.sale ? 'default' : 'primary'} icon={v.sale ? 'edit' : 'sales'} onClick={() => setSaleOpen(true)}>
            {v.sale ? t('item.editSale') : t('item.completeSale')}
          </Button>
        )}
        {stage && <Stages stages={['COLLECTING', 'COMPARING', 'READY'] as Stage[]} current={stage} labelKey={(s) => t(`market.stage${s}`)} />}
      </div>
      {editCost && (
        <Card style={{ marginBottom: 16 }}>
          <div className="grid-12">
            <div className="span-6 stack-3">
              <span className="t-caption">{t('cost.totalMode')}</span>
              <CostEditor itemId={id} initial={v.cost} onDone={() => setEditCost(false)} />
            </div>
            <div className="span-6 stack-3">
              <span className="t-caption">{t('cost.vintedMode')}</span>
              <VintedCostForm itemId={id} onDone={() => setEditCost(false)} />
            </div>
          </div>
        </Card>
      )}
      {error != null && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState error={error} onRetry={runAnalysis} />
        </div>
      )}
      {era.mode === 'real' && (
        <div style={{ marginBottom: 16 }}>
          <RepostPending v={v} />
        </div>
      )}

      <div className="grid-12">
        <div className="span-8 stack-4">
          {intel?.recommendation && <RecommendationCard r={intel.recommendation} onAddCost={() => setEditCost(true)} onAnalyze={runAnalysis} />}

          <Card
            title={t('item.inDistribution')}
            icon="compare"
            tone="cyan"
            hint={analysis ? `${t('market.analyzedAt', { when: i.relative(analysis.at, era.now) })} · ${t(`market.source${analysis.source}`)}` : t('item.inDistributionHint')}
            actions={
              analysis ? (
                <span className="row" style={{ gap: 6 }}>
                  {analysis.via && <Flag kind="UNVERIFIED" title={t('flag.learnedEndpoint')} />}
                  {intel?.analysisStale && <Badge tone="amber">{t('item.stale')}</Badge>}
                  <Badge tone={analysis.quality === 'HIGH' ? 'emerald' : analysis.quality === 'MEDIUM' ? 'cyan' : 'amber'}>
                    {t('market.quality')} · {t(`compQuality.${analysis.quality}`)}
                  </Badge>
                </span>
              ) : null
            }
          >
            {!analysis ? (
              <div className="stack-3">
                <p className="t-muted">{t('reco.w.noAnalysis')}</p>
                {realized && (
                  <DualDistribution
                    title={t('item.inDistribution')}
                    asking={{ points: [] }}
                    realized={{ points: realized.points }}
                    realizedScope={t(`dual.scope.${realized.scope}`)}
                    current={v.askPrice}
                    format={(x) => money(Math.round(x / 100) * 100)}
                  />
                )}
              </div>
            ) : d && analysis.quality !== 'INSUFFICIENT' ? (
              <div className="stack-4">
                <DualDistribution
                  title={t('item.inDistribution')}
                  asking={{ points: analysis.comparables.filter((c) => c.kept).map((c) => ({ v: c.candidate.priceCents, w: c.similarity, label: c.candidate.title })), q: { p25: d.p25, p50: d.p50, p75: d.p75 } }}
                  realized={{ points: realized?.points ?? [] }}
                  realizedScope={realized ? t(`dual.scope.${realized.scope}`) : null}
                  current={v.askPrice}
                  format={(x) => money(Math.round(x / 100) * 100)}
                />
                {analysis.position && (
                  <p className="t-small">
                    {t('item.positionLine', { pct: Math.round(analysis.position.percentile * 100), n: analysis.keptCount })}
                  </p>
                )}
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

          <Card title={t('precision.itemTitle')} hint={t('precision.itemHint')} icon="target" tone="violet">
            {preds.length === 0 ? (
              <p className="t-muted">{t('precision.itemEmpty')}</p>
            ) : (
              <div className="stack">
                {preds.slice(0, 5).map((p) => (
                  <PredictionRow key={p.id} row={p} />
                ))}
              </div>
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
                    <Badge tone={l.status === 'ACTIVE' ? 'emerald' : l.status === 'SOLD' ? 'violet' : l.status === 'RESERVED' ? 'amber' : 'neutral'}>
                      {t(`item.${{ ACTIVE: 'active', SOLD: 'sold', RESERVED: 'reserved', HIDDEN: 'hidden', REMOVED: 'removed' }[l.status]}`)}
                    </Badge>
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
                {intel?.lastRepost && v.firstListedAt !== null && (
                  // Reposted: same article, one memory. Its age for capital and selling speed counts from the first listing.
                  <p className="t-small t-muted" data-testid="repost-memory">
                    {t('item.repostMemory', { n: intel.lastRepost.count, days: Math.max(0, Math.floor((Date.now() - v.firstListedAt) / 86_400_000)) })}{' '}
                    {intel.lastRepost.effect === null ? t('item.repostEffectPending') : t('item.repostEffect', { pct: pct(intel.lastRepost.effect, { sign: true }) })}
                  </p>
                )}
              </div>
            </Card>
          )}

          {intel && v.askPrice !== null && v.inStock && (
            <Card title={t('offer.title')} hint={t('offer.hint')} icon="scale" tone="amber">
              <OfferCalculator intel={intel} compact />
            </Card>
          )}

          {intel && v.inStock && (
            <Card title={t('replies.title')} hint={t('replies.hint')} icon="book" tone="cyan">
              <Replies intel={intel} />
            </Card>
          )}

          <Card title={t('cost.title')} hint={t('cost.hint')} icon="capital" tone="amber">
            <CostBreakdown item={item} onEdit={() => setEditCost(true)} />
          </Card>

          {v.inStock && v.current && (
            <Card
              title={t('vintedPrice.sectionTitle')}
              icon="flask"
              tone="pink"
              actions={<Flag kind="EXPERIMENTAL" />}
              className="card--quiet"
            >
              <p className="t-small t-muted">{t('vintedPrice.sectionHint')}</p>
              <PriceOnVintedButton v={v} suggested={v.askPrice} variant="ghost" size="sm" />
            </Card>
          )}

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
      <SaleModal
        open={saleOpen}
        onClose={() => setSaleOpen(false)}
        itemId={id}
        suggested={v.sale?.salePriceCents ?? v.askPrice ?? v.listings[v.listings.length - 1]?.priceCents ?? null}
        date={v.sale?.soldAt ?? v.listings[v.listings.length - 1]?.soldAt ?? null}
      />
    </>
  );
}
