import { addMonths, startOfMonth } from '@/domain/time';
import { useI18n } from '@/i18n';
import { AGE_BUCKETS } from '@/intelligence/capital';
import { monthlySeries, periodSales } from '@/intelligence/portfolio';
import { BarChart, Legend, LineChart, Sparkline } from '@/ui/charts/charts';
import { IconTile } from '@/ui/components/icons';
import { IllustrationStock } from '@/ui/components/illustrations';
import { Button, Card, Delta, EmptyState, MetricFootPartial, MetricValue, Money, QualityTag } from '@/ui/components/primitives';
import { ActivationProgress, ACTIVATION_STEPS, ItemCell, RecoChip, RecommendationCard } from '../components/domain';
import { PriorityList } from '../components/priorities';
import { useBulkAnalyze } from '../components/tools';
import { VintedImportButton } from '../components/vinted-import';
import { PageHead } from '../Shell';
import { go, useEra } from '../state';

const AGE_COLOR: Record<string, string> = { '0-30': 'var(--chart-1)', '30-60': 'var(--cobalt)', '60-90': 'var(--amber)', '90+': 'var(--coral)' };
const AGE_FOCUS: Record<string, string> = { '0-30': 'stock?sort=age', '30-60': 'stock?focus=AGE30', '60-90': 'stock?focus=AGE60', '90+': 'stock?focus=AGE90' };

export function Today() {
  const i = useI18n();
  const { t, money, month } = i;
  const era = useEra();
  const bulk = useBulkAnalyze();

  if (era.ready && era.mode === 'empty') {
    return (
      <Card>
        <EmptyState art={<IllustrationStock />} title={t('stock.empty')} why={t('stock.emptyWhy')} action={<VintedImportButton variant="primary" size="lg" />} />
      </Card>
    );
  }

  const cap = era.capital;
  const monthStart = startOfMonth(era.now);
  const prevStart = addMonths(monthStart, -1);
  const cur = periodSales(era.sales, monthStart, era.now + 1);
  // Compare against the same number of days last month, not the full month.
  const prev = periodSales(era.sales, prevStart, prevStart + (era.now - monthStart));
  const inStock = era.views.filter((v) => v.inStock);
  const listed = inStock.filter((v) => v.item.status === 'LISTED').length;
  const reserved = inStock.filter((v) => v.item.status === 'RESERVED').length;
  const series = monthlySeries(era.sales, era.now, 12);
  const recos = era.intel
    .filter((x) => x.recommendation && x.recommendation.action !== 'ADD_COST' && x.recommendation.action !== 'HOLD' && (x.recommendation.action !== 'ANALYZE' || x.recommendation.priority >= 50))
    .sort((a, b) => b.recommendation!.priority - a.recommendation!.priority);
  const top = recos[0];
  const activationDone = ACTIVATION_STEPS.every((s) => era.activation.has(s.name));
  const revDelta = prev.revenue > 0 ? (cur.revenue - prev.revenue) / prev.revenue : null;
  const investedV = cap.invested.status === 'unknown' ? 0 : cap.invested.value;
  const ageTotal = cap.aging.reduce((a, b) => a + (b.invested.status === 'unknown' ? 0 : b.invested.value), 0);
  const over = [
    { d: 30, m: cap.over30, focus: 'AGE30' },
    { d: 60, m: cap.over60, focus: 'AGE60' },
    { d: 90, m: cap.over90, focus: 'AGE90' },
  ];
  const agedCount = (d: number) => inStock.filter((v) => (v.daysHeld ?? 0) >= d).length;

  return (
    <>
      <PageHead
        eyebrow={<span className="hero-date">{i.dateLong(era.now)}</span>}
        title={
          <>
            {t('today.greetingA')} <span className="t-accent">{t('today.greetingB')}</span>
          </>
        }
        actions={
          <>
            {bulk.pending > 0 && (
              <Button variant="primary" icon="market" loading={!!bulk.busy} onClick={() => bulk.run()}>
                {bulk.busy ? `${bulk.busy.done}/${bulk.busy.total}` : t('today.analyzeStock', { n: bulk.pending })}
              </Button>
            )}
            <Button icon="capital" onClick={() => go('capital')}>
              {t('capital.title')}
            </Button>
          </>
        }
      />

      <div className="stack-4">
        {!activationDone && <ActivationProgress done={era.activation} />}

        <section className="cockpit" aria-label={t('today.overview')}>
          <div className="cockpit__capital">
            <div className="cockpit__label">
              <IconTile name="capital" tone="violet" size="sm" /> {t('kpi.invested')}
            </div>
            <div className="cockpit__hero num">
              <MetricValue metric={cap.invested} />
            </div>
            <div className="row wrap" style={{ gap: 8, minHeight: 22 }}>
              <MetricFootPartial metric={cap.invested} />
              {cap.costsExcludingShipping > 0 && <QualityTag quality="PARTIAL" text={t('capital.excludingShipping', { n: cap.costsExcludingShipping })} />}
            </div>
            <div className="cockpit__trio">
              <button type="button" className="cockpit__cell" onClick={() => go('stock?filter=listed')}>
                <span className="cockpit__k">{t('kpi.stockValue')}</span>
                <span className="cockpit__v num">
                  <MetricValue metric={cap.stockValue} />
                </span>
                <MetricFootPartial metric={cap.stockValue} />
              </button>
              <button type="button" className="cockpit__cell" onClick={() => go('capital')}>
                <span className="cockpit__k">{t('kpi.potentialProfitKnown')}</span>
                <span className="cockpit__v num t-pos">
                  <MetricValue metric={cap.potentialProfit} sign />
                </span>
                <MetricFootPartial metric={cap.potentialProfit} />
              </button>
              <button type="button" className="cockpit__cell" onClick={() => go('stock')}>
                <span className="cockpit__k">{t('kpi.stockTotal')}</span>
                <span className="cockpit__v num">{inStock.length}</span>
                <span className="t-small t-faint">{t('kpi.listedReserved', { n: listed, r: reserved })}</span>
              </button>
            </div>
            <div className="agebar" role="img" aria-label={t('today.capitalAge')}>
              {cap.aging.map((b) => {
                const v = b.invested.status === 'unknown' ? 0 : b.invested.value;
                return v > 0 ? <span key={b.bucket} style={{ flexGrow: v, background: AGE_COLOR[b.bucket] }} title={`${b.bucket} j · ${money(v)}`} /> : null;
              })}
            </div>
            <div className="cockpit__aged">
              {over.map((o) => (
                <button key={o.d} type="button" className={`aged aged--${o.d}`} onClick={() => go(`stock?focus=${o.focus}`)} disabled={agedCount(o.d) === 0}>
                  <span className="aged__k">{t('capital.over', { n: o.d })}</span>
                  <span className="aged__v num">
                    <MetricValue metric={o.m} />
                  </span>
                  <span className="aged__n">
                    {t('capital.items', { n: agedCount(o.d) })}
                    {investedV > 0 && o.m.status !== 'unknown' ? ` · ${i.pct(o.m.value / investedV)}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="cockpit__month">
            <div className="cockpit__label">
              <IconTile name="sales" tone="emerald" size="sm" /> {t('today.thisMonth')}
            </div>
            <button type="button" className="cockpit__cell cockpit__cell--wide" onClick={() => go('sales')}>
              <span className="cockpit__k">{t('kpi.monthSales')}</span>
              <span className="cockpit__v num">{cur.count}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="num t-small">{money(cur.revenue)}</span>
                <Delta value={revDelta} />
              </span>
            </button>
            <button type="button" className="cockpit__cell cockpit__cell--wide" onClick={() => go('sales')}>
              <span className="cockpit__k">{t('kpi.monthProfit')}</span>
              <span className="cockpit__v num">
                <MetricValue metric={cur.profit} sign />
              </span>
              <MetricFootPartial metric={cur.profit} />
            </button>
            <button type="button" className="cockpit__cell cockpit__cell--wide" onClick={() => go('capital')}>
              <span className="cockpit__k">{t('today.returned90')}</span>
              <span className="cockpit__v num">
                <MetricValue metric={cap.returned90} />
              </span>
              <span className="t-small t-faint">{cap.turnover !== null ? t('capital.turnoverLine', { x: cap.turnover.toFixed(1) }) : t('today.returned90Hint')}</span>
            </button>
            <button type="button" className="cockpit__cell cockpit__cell--wide" onClick={() => go('insights?tab=you')}>
              <span className="cockpit__k">{t('kpi.medianDays')}</span>
              <span className="cockpit__v num">{era.model.medianDays === null ? '—' : t('kpi.days', { n: Math.round(era.model.medianDays) })}</span>
              <span className="t-small t-faint">{t('today.medianDaysHint', { n: era.model.totalSold })}</span>
            </button>
            <div className="cockpit__spark">
              <span className="t-caption">{t('today.profit12')}</span>
              <Sparkline values={series.map((m) => m.profit ?? 0)} color="var(--emerald)" width={320} height={44} />
            </div>
            {cap.efficiency30 !== null && (
              <div className="t-small t-muted">
                {t('capital.efficiencyLine', { pct: Math.round(cap.efficiency30 * 100) })}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="prio-h">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 className="t-caption" id="prio-h">
              {t('today.priorities')}
            </h2>
            <span className="t-small t-faint">{t('today.prioritiesHint')}</span>
          </div>
          {era.priorities.length === 0 ? (
            <Card>
              <p className="t-muted">{t('today.noPriorities')}</p>
            </Card>
          ) : (
            <PriorityList priorities={era.priorities} />
          )}
        </section>

        <div className="grid-12">
          <Card
            className="span-8"
            title={t('today.performance')}
            hint={t('today.performanceHint')}
            icon="sales"
            tone="emerald"
            actions={<Legend items={[{ label: t('charts.revenue'), color: 'var(--chart-1)' }, { label: t('charts.profit'), color: 'var(--emerald)' }]} />}
          >
            <LineChart
              title={t('today.performance')}
              labels={series.map((m) => month(m.start))}
              series={[
                { key: 'rev', label: t('charts.revenue'), color: 'var(--chart-1)', values: series.map((m) => m.revenue), area: true },
                { key: 'profit', label: t('charts.profit'), color: 'var(--emerald)', values: series.map((m) => m.profit) },
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
              onSelect={(idx) => go(AGE_FOCUS[AGE_BUCKETS[idx]!]!)}
              data={cap.aging.map((b) => ({
                label: `${b.bucket} j`,
                value: b.invested.status === 'unknown' ? null : b.invested.value,
                color: AGE_COLOR[b.bucket],
                sub: (
                  <>
                    <div className="chart__tooltip-row">
                      {t('capital.items', { n: b.count })} <b className="num">{b.invested.status === 'unknown' ? '—' : money(b.invested.value)}</b>
                    </div>
                    <div className="chart__tooltip-row">{ageTotal > 0 && b.invested.status !== 'unknown' ? i.pct(b.invested.value / ageTotal) : ''}</div>
                  </>
                ),
              }))}
              format={(v) => money(Math.round(v / 100) * 100)}
            />
            <p className="t-small t-faint" style={{ marginTop: 6 }}>
              {t('today.capitalAgeClick')}
            </p>
          </Card>
        </div>

        <div className="grid-12">
          <Card
            className="span-7"
            title={t('today.attention')}
            hint={t('today.attentionHint')}
            icon="alert"
            tone="coral"
            actions={
              <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => go('stock?filter=attention')}>
                {t('today.seeAll')}
              </Button>
            }
          >
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
                          {x.view.item.brand} · <Money cents={x.view.askPrice} /> · {x.view.daysHeld !== null ? t('kpi.days', { n: x.view.daysHeld }) : null}
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
                  <span className="t-caption clamp-1">#1 · {top.view.item.title}</span>
                  <a className="t-small t-muted" href={`#/item/${top.view.item.id}`}>
                    {t('today.openItem')} →
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
