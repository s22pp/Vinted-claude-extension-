import { useMemo } from 'react';
import type { Prep } from '@/domain/entities';
import { sumMetric } from '@/domain/money';
import { useI18n } from '@/i18n';
import { skuOf } from '@/intelligence/listing';
import type { ItemView } from '@/intelligence/portfolio';
import type { RefundGuard } from '@/intelligence/refunds';
import { draftTitle, prepStats, readiness, suggestPrice } from '@/intelligence/workshop';
import { IconTile } from '@/ui/components/icons';
import { IllustrationDone } from '@/ui/components/illustrations';
import { Button, Card, EmptyState, Metric, MetricValue, Money } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { StockTabs } from '../components/section-tabs';
import { VintedImportButton } from '../components/vinted-import';
import { WorkshopSheet } from '../components/workshop-sheet';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';

export function Workshop({ route }: { route: Route }) {
  const { t } = useI18n();
  const era = useEra();
  const { toList, awaitingImport } = era.workshop;
  const selectedId = route.id && era.viewById.get(route.id) ? route.id : (toList[0]?.item.id ?? null);
  const v = selectedId ? era.viewById.get(selectedId)! : null;
  const stats = useMemo(() => prepStats([...era.preps.values()], era.now), [era.preps, era.now]);
  const idle = sumMetric(toList.map((x) => x.cost));
  const guards = era.refunds.guards.map((g) => g.guard);

  return (
    <>
      <PageHead
        title={t('workshop.title')}
        sub={t('workshop.subtitle')}
        tabs={<StockTabs active="workshop" />}
        actions={
          <>
            <Button icon="layers" onClick={() => go('stock?lot=1')}>
              {t('lot.button')}
            </Button>
            <VintedImportButton />
          </>
        }
      />
      <div className="stack-4">
        <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }} aria-label={t('workshop.title')}>
          <div className="kpi">
            <Metric small label={t('workshop.kToList')} icon="upload" tone="violet" value={<span className="num">{toList.length}</span>} foot={awaitingImport.length ? t('workshop.awaitingN', { n: awaitingImport.length }) : null} />
          </div>
          <div className="kpi">
            <Metric small label={t('workshop.kIdle')} icon="capital" tone="amber" value={<MetricValue metric={idle} />} foot={t('workshop.kIdleHint')} />
          </div>
          <div className="kpi">
            <Metric
              small
              label={t('workshop.kTime')}
              icon="clock"
              tone="cyan"
              value={<span className="num">{stats.medianMinutes === null ? '—' : t('workshop.minutes', { n: Math.max(1, Math.round(stats.medianMinutes)) })}</span>}
              foot={stats.timed ? t('workshop.kTimeHint', { n: stats.timed }) : t('workshop.kTimeNone')}
            />
          </div>
          <div className="kpi">
            <Metric small label={t('workshop.kPublished')} icon="check" tone="emerald" value={<span className="num">{stats.published7}</span>} foot={t('workshop.kPublished30', { n: stats.published30 })} />
          </div>
        </section>

        {era.refunds.guards.length > 0 && (
          <div className="guard-banner">
            <IconTile name="alert" tone="coral" size="sm" />
            <span>
              <b>{t('workshop.guardsTitle')}</b>{' '}
              {era.refunds.guards.map((g) => t(`workshop.guard.${g.guard}`, { n: g.n })).join(' · ')}
            </span>
          </div>
        )}

        {toList.length === 0 && awaitingImport.length === 0 ? (
          <Card>
            <EmptyState art={<IllustrationDone />} title={t('workshop.empty')} why={t('workshop.emptyWhy')} action={<Button icon="plus" onClick={() => go('stock?add=1')}>{t('stock.add')}</Button>} />
          </Card>
        ) : (
          <div className="grid-12 workshop">
            <div className="span-4 stack-3">
              <Card title={t('workshop.queue')} hint={t('workshop.queueHint')} icon="rows" tone="violet" flush>
                <div className="wq">
                  {toList.map((x) => (
                    <QueueRow key={x.item.id} v={x} active={x.item.id === selectedId} prep={era.preps.get(x.item.id) ?? null} guards={guards} />
                  ))}
                  {toList.length === 0 && <p className="t-muted" style={{ padding: 16 }}>{t('workshop.queueEmpty')}</p>}
                </div>
              </Card>
              {awaitingImport.length > 0 && (
                <Card title={t('workshop.awaiting')} hint={t('workshop.awaitingHint')} icon="clock" tone="cyan" flush>
                  <div className="wq">
                    {awaitingImport.map((x) => (
                      <a key={x.item.id} className="wq__row" href={`#/item/${x.item.id}`}>
                        <Thumb photoUrl={x.item.photoUrl} category={x.item.category} alt="" size="sm" />
                        <span className="wq__main">
                          <span className="clamp-1 wq__title">{x.item.title}</span>
                          <span className="t-small t-faint">
                            {t('workshop.ref')} <code>{skuOf(x.item.id)}</code>
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                </Card>
              )}
            </div>
            <div className="span-8">{v && toList.some((x) => x.item.id === v.item.id) ? <WorkshopSheet key={v.item.id} v={v} guards={guards} /> : v ? <Card><p className="t-muted">{t('workshop.pickOne')}</p></Card> : null}</div>
          </div>
        )}
        <p className="t-small t-faint">{t('workshop.footnote')}</p>
      </div>
    </>
  );
}

function QueueRow({ v, active, prep, guards }: { v: ItemView; active: boolean; prep: Prep | null; guards: readonly RefundGuard[] }) {
  const { t } = useI18n();
  const era = useEra();
  const title = draftTitle(v.item, prep);
  const intel = era.intelById.get(v.item.id);
  const price = prep?.priceCents ?? suggestPrice(intel?.analysis ?? null, intel?.pricing ?? null, intel?.personal ?? null)?.cents ?? prep?.template?.soldCents ?? null;
  const r = readiness(v.item, prep, title, price, guards);
  const days = v.item.purchaseDate ? Math.floor((era.now - v.item.purchaseDate) / 86_400_000) : null;
  return (
    <a className="wq__row" href={`#/workshop/${v.item.id}`} aria-current={active ? 'true' : undefined}>
      <Thumb photoUrl={v.item.photoUrl} category={v.item.category} alt="" size="sm" />
      <span className="wq__main">
        <span className="clamp-1 wq__title">{v.item.title}</span>
        <span className="t-small t-faint">
          {v.item.brand}
          {v.item.size ? ` · ${v.item.size}` : ''}
          {days !== null ? ` · ${t('workshop.bought', { n: days })}` : ''}
          {v.item.status === 'DRAFT' && v.current ? ` · ${t('workshop.vintedDraft')}` : ''}
        </span>
        <span className="wq__bar" aria-label={t('workshop.readiness', { done: r.done, total: r.total })}>
          <span style={{ width: `${(r.done / r.total) * 100}%` }} className={r.ready ? 'is-ready' : ''} />
        </span>
      </span>
      <span className="wq__side">
        <Money cents={v.cost} compact />
        <span className="t-small t-faint num">
          {r.done}/{r.total}
        </span>
      </span>
    </a>
  );
}
