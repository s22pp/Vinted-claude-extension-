import { addMonths, startOfMonth } from '@/domain/time';
import { useI18n } from '@/i18n';
import type { TodayPriority } from '@/intelligence/decision';
import { monthlySeries, periodSales } from '@/intelligence/portfolio';
import { BarChart, Legend, LineChart } from '@/ui/charts/charts';
import { type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { IllustrationStock } from '@/ui/components/illustrations';
import { Button, Card, Delta, EmptyState, Metric, MetricFootPartial, MetricValue, Money } from '@/ui/components/primitives';
import { ActivationProgress, ACTIVATION_STEPS, ItemCell, RecoChip, RecommendationCard } from '../components/domain';
import { useBulkAnalyze } from '../components/tools';
import { PageHead } from '../Shell';
import { go, useEra } from '../state';

const PRIO: Record<TodayPriority['code'], { icon: IconName; tone: TileTone; href: string }> = {
  STAGNANT: { icon: 'hourglass', tone: 'coral', href: 'stock?filter=attention' },
  OVERPRICED: { icon: 'price', tone: 'amber', href: 'stock?filter=attention' },
  TRAPS: { icon: 'trap', tone: 'amber', href: 'insights#capital' },
  CAPITAL_AGED: { icon: 'capital', tone: 'amber', href: 'stock?sort=age' },
  MISSING_COST: { icon: 'edit', tone: 'cyan', href: 'stock?filter=nocost' },
  NO_ANALYSIS: { icon: 'market', tone: 'cobalt', href: 'market' },
  NICHE: { icon: 'trendUp', tone: 'emerald', href: 'insights' },
};

export function Today() {
  const i = useI18n();
  const { t, money, month } = i;
  const era = useEra();
  const bulk = useBulkAnalyze();

  if (era.ready && era.mode === 'empty') {
    return (
      <Card>
        <EmptyState art={<IllustrationStock />} title={t('stock.empty')} why={t('stock.emptyWhy')} action={<Button variant="primary" onClick={() => go('onboarding')}>{t('stock.emptyCta')}</Button>} />
      </Card>
    );
  }

  const monthStart = startOfMonth(era.now);
  const prevStart = addMonths(monthStart, -1);
  const cur = periodSales(era.sales, monthStart, era.now + 1);
  // Compare against the same number of days last month, not the full month.
  const prev = periodSales(era.sales, prevStart, prevStart + (era.now - monthStart));
  const inStock = era.views.filter((v) => v.inStock);
  const listed = inStock.filter((v) => v.current).length;
  const series = monthlySeries(era.sales, era.now, 12);
  const recos = era.intel
    .filter((x) => x.recommendation && x.recommendation.action !== 'ADD_COST' && x.recommendation.action !== 'ANALYZE' && x.recommendation.action !== 'HOLD')
    .sort((a, b) => b.recommendation!.priority - a.recommendation!.priority);
  const top = recos[0];
  const activationDone = ACTIVATION_STEPS.every((s) => era.activation.has(s.name));
  const revDelta = prev.revenue > 0 ? (cur.revenue - prev.revenue) / prev.revenue : null;

  return (
    <>
      <PageHead
        eyebrow={<span className="hero-date">{i.dateLong(era.now)}</span>}
        title={<>{t('today.greetingA')} <span className="t-accent">{t('today.greetingB')}</span></>}
        actions={
          <>
            {bulk.pending > 0 && (
              <Button variant="primary" icon="market" loading={!!bulk.busy} onClick={() => bulk.run()}>
                {bulk.busy ? `${bulk.busy.done}/${bulk.busy.total}` : t('today.analyzeStock', { n: bulk.pending })}
              </Button>
            )}
            <Button icon="layers" onClick={() => go('tools')}>
              {t('tools.title')}
            </Button>
          </>
        }
      />

      <div className="stack-4">
        {!activationDone && <ActivationProgress done={era.activation} />}

        <section aria-labelledby="prio-h">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 className="t-caption" id="prio-h">
              {t('today.priorities')}
            </h2>
          </div>
          {era.priorities.length === 0 ? (
            <Card>
              <p className="t-muted">{t('today.noPriorities')}</p>
            </Card>
          ) : (
            <div className="prio">
              {era.priorities.map((p, idx) => {
                const cfg = PRIO[p.code];
                const title =
                  p.code === 'CAPITAL_AGED'
                    ? t('today.P_CAPITAL_AGED', { amount: p.amount && p.amount.status !== 'unknown' ? p.amount.value : null })
                    : p.code === 'NICHE'
                      ? t('today.P_NICHE', { label: p.label ?? '' })
                      : t(`today.P_${p.code}`, { n: p.count });
                return (
                  <button key={p.code} type="button" className="prio__item" style={{ animationDelay: `${idx * 60}ms` }} onClick={() => go(cfg.href)}>
                    <IconTile name={cfg.icon} tone={cfg.tone} />
                    <span>
                      <span className="prio__title" style={{ display: 'block' }}>
                        {title}
                      </span>
                      <span className="prio__hint" style={{ display: 'block' }}>
                        {t(`today.P_${p.code}_hint`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section aria-label={t('today.overview')} className="kpi-strip">
          <div className="kpi">
            <Metric label={t('kpi.invested')} icon="capital" tone="amber" value={<MetricValue metric={era.capital.invested} />} foot={<MetricFootPartial metric={era.capital.invested} />} small />
          </div>
          <div className="kpi">
            <Metric label={t('kpi.stockValue')} icon="stock" tone="cobalt" value={<MetricValue metric={era.capital.stockValue} />} foot={<MetricFootPartial metric={era.capital.stockValue} />} small />
          </div>
          <div className="kpi">
            <Metric
              label={t('kpi.potentialProfit')}
              icon="trendUp"
              tone="emerald"
              value={<MetricValue metric={era.capital.potentialProfit} />}
              foot={<MetricFootPartial metric={era.capital.potentialProfit} />}
              small
            />
          </div>
          <div className="kpi">
            <Metric label={t('kpi.monthSales')} icon="sales" tone="emerald" value={<span className="num">{cur.count}</span>} foot={<><span className="num">{money(cur.revenue)}</span><Delta value={revDelta} /></>} small />
          </div>
          <div className="kpi">
            <Metric label={t('kpi.monthProfit')} icon="price" tone="violet" value={<MetricValue metric={cur.profit} sign />} foot={<MetricFootPartial metric={cur.profit} />} small />
          </div>
          <div className="kpi">
            <Metric label={t('kpi.stockTotal')} icon="layers" tone="cyan" value={<span className="num">{inStock.length}</span>} foot={t('kpi.listed', { n: listed })} small />
          </div>
        </section>

        <div className="grid-12">
          <Card className="span-8" title={t('today.performance')} hint={t('today.performanceHint')} icon="sales" tone="emerald" actions={<Legend items={[{ label: t('charts.revenue'), color: 'var(--chart-1)' }, { label: t('charts.profit'), color: 'var(--chart-2)' }]} />}>
            <LineChart
              title={t('today.performance')}
              labels={series.map((m) => month(m.start))}
              series={[
                { key: 'rev', label: t('charts.revenue'), color: 'var(--chart-1)', values: series.map((m) => m.revenue), area: true },
                { key: 'profit', label: t('charts.profit'), color: 'var(--chart-2)', values: series.map((m) => m.profit) },
              ]}
              format={(v) => money(Math.round(v / 100) * 100)}
              height={230}
            />
          </Card>
          <Card className="span-4" title={t('today.capitalAge')} hint={t('today.capitalAgeHint')} icon="capital" tone="amber">
            <BarChart
              title={t('today.capitalAge')}
              orientation="vertical"
              height={230}
              data={era.capital.aging.map((b) => ({
                label: `${b.bucket} j`,
                value: b.invested.status === 'unknown' ? null : b.invested.value,
                color: b.bucket === '90+' ? 'var(--coral)' : b.bucket === '60-90' ? 'var(--amber)' : 'var(--chart-1)',
                sub: (
                  <div className="chart__tooltip-row">
                    {b.count} · <b className="num">{b.invested.status === 'unknown' ? '—' : money(b.invested.value)}</b>
                  </div>
                ),
              }))}
              format={(v) => money(Math.round(v / 100) * 100)}
            />
          </Card>
        </div>

        <div className="grid-12">
          <Card className="span-7" title={t('today.attention')} hint={t('today.attentionHint')} icon="alert" tone="coral" actions={<Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => go('stock?filter=attention')}>{t('today.seeAll')}</Button>}>
            {recos.length === 0 ? (
              <p className="t-muted">{t('today.noPriorities')}</p>
            ) : (
              <div className="list">
                {recos.slice(0, 7).map((x, idx) => (
                  <a key={x.view.item.id} className="list__row" href={`#/item/${x.view.item.id}`} style={{ animationDelay: `${idx * 40}ms`, gridTemplateColumns: 'minmax(0,1fr) auto', color: 'inherit' }}>
                    <ItemCell
                      item={x.view.item}
                      sub={
                        <>
                          {x.view.item.brand} · <Money cents={x.view.askPrice} /> · {x.stagnation ? t('kpi.days', { n: x.stagnation.daysListed }) : null}
                        </>
                      }
                    />
                    <RecoChip r={x.recommendation} />
                  </a>
                ))}
              </div>
            )}
          </Card>
          <div className="span-5 stack-3">
            {top?.recommendation && (
              <>
                <div className="row-between">
                  <span className="t-caption">#1 · {top.view.item.title}</span>
                  <a className="t-small t-muted" href={`#/item/${top.view.item.id}`}>
                    {t('today.seeAll')} →
                  </a>
                </div>
                <RecommendationCard r={top.recommendation} />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
