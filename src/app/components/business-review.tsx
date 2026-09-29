import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type MonthlyGoal, buyingPlan, goalPlan, goalProgress } from '@/intelligence/goal';
import { type PeriodStats, businessReview, reviewCsv } from '@/intelligence/review';
import { shoppingList } from '@/intelligence/shopping';
import { downloadText } from '@/lib/download';
import { BarChart } from '@/ui/charts/charts';
import { Icon } from '@/ui/components/icons';
import { Button, Card, Metric, QualityTag } from '@/ui/components/primitives';
import { go, useEra } from '../state';
import { GoalCard } from './goal';

/**
 * Pilotage: the last 30 days against the 30 before, then the business month by month over a year — sales, revenue,
 * known profit, refunds, listings put online, purchases, selling speed — and where the stock stands today.
 */
export function BusinessReview() {
  const { t, money, pct } = useI18n();
  const era = useEra();
  const r = useMemo(() => businessReview(era.sales, era.views, era.now), [era.sales, era.views, era.now]);
  const monthLabel = (from: number) => {
    const d = new Date(from);
    return `${t(`accounting.m${d.getMonth()}`)} ${String(d.getFullYear()).slice(2)}`;
  };
  const { last30: a, prev30: b } = r;
  const days = (n: number | null) => (n === null ? '—' : t('kpi.days', { n }));
  const rate = (p: PeriodStats) => (p.refundRate === null ? '' : ` · ${pct(p.refundRate)}`);

  const rows: { key: string; label: string; cell: (m: PeriodStats) => React.ReactNode }[] = [
    { key: 'sales', label: t('review.row.sales'), cell: (m) => m.sales },
    { key: 'revenue', label: t('review.row.revenue'), cell: (m) => money(m.revenueCents) },
    {
      key: 'profit',
      label: t('review.row.profit'),
      cell: (m) => (
        <>
          {money(m.profitCents)}
          {m.profitPartial && <sup title={t('review.partial')} aria-label={t('review.partial')}> ◐</sup>}
        </>
      ),
    },
    { key: 'basket', label: t('review.row.basket'), cell: (m) => (m.basketCents === null ? '—' : money(m.basketCents)) },
    { key: 'refunds', label: t('review.row.refunds'), cell: (m) => (m.refunds ? `${m.refunds}${rate(m)}` : '0') },
    { key: 'listed', label: t('review.row.listed'), cell: (m) => m.listed },
    { key: 'bought', label: t('review.row.bought'), cell: (m) => (m.bought ? `${m.bought} · ${money(m.spentCents)}${m.spentPartial ? ' ◐' : ''}` : '0') },
    { key: 'speed', label: t('review.row.speed'), cell: (m) => (m.daysToSell === null ? '—' : `${days(m.daysToSell)} (n=${m.daysToSellN})`) },
  ];

  return (
    <div className="stack-4" data-testid="business-review">
      <section className="kpi-strip" aria-label={t('review.last30')}>
        <div className="kpi">
          <Metric small label={t('review.k.revenue')} icon="capital" tone="emerald" value={<span className="num">{money(a.revenueCents)}</span>} foot={<Versus now={a.revenueCents} before={b.revenueCents} text={t('review.vs', { v: money(b.revenueCents) })} />} />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('review.k.profit')}
            icon="trendUp"
            tone="violet"
            value={<span className="num">{money(a.profitCents)}</span>}
            foot={a.profitPartial ? <QualityTag quality="PARTIAL" text={t('review.partialShort')} /> : <Versus now={a.profitCents} before={b.profitCents} text={t('review.vs', { v: money(b.profitCents) })} />}
          />
        </div>
        <div className="kpi">
          <Metric small label={t('review.k.sales')} icon="check" tone="cyan" value={<span className="num">{a.sales}</span>} foot={<Versus now={a.sales} before={b.sales} text={t('review.vs', { v: b.sales })} />} />
        </div>
        <div className="kpi">
          <Metric small label={t('review.k.listed')} icon="upload" tone="cobalt" value={<span className="num">{a.listed}</span>} foot={<Versus now={a.listed} before={b.listed} text={t('review.vs', { v: b.listed })} />} />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('review.k.refunds')}
            icon="alert"
            tone="coral"
            value={<span className="num">{a.refunds}{a.refundRate !== null && a.refunds > 0 ? ` · ${pct(a.refundRate)}` : ''}</span>}
            foot={<Versus now={a.refunds} before={b.refunds} invert text={t('review.vs', { v: b.refunds })} />}
          />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('review.k.speed')}
            icon="clock"
            tone="amber"
            value={<span className="num">{days(a.daysToSell)}</span>}
            foot={a.daysToSellN ? t('review.speedN', { n: a.daysToSellN }) : t('review.speedNone')}
          />
        </div>
      </section>
      <p className="t-small t-muted">
        {r.lowData ? t('review.lowData') : t('review.read')}
        {r.undated > 0 && ` ${t('review.undated', { n: r.undated })}`}
      </p>

      <GoalCard />
      <BuyingPlanCard capitalNowCents={r.today.capitalCents} />

      <div className="grid-12">
        <Card className="span-8" title={t('review.chart')} hint={t('review.chartHint')} icon="calendar" tone="emerald">
          <BarChart
            title={t('review.chart')}
            orientation="vertical"
            height={210}
            data={r.months.map((m, i) => ({
              label: monthLabel(m.from),
              value: m.revenueCents,
              color: i === r.months.length - 1 ? 'var(--chart-1)' : 'var(--emerald)',
              sub: (
                <div className="chart__tooltip-row">
                  {t('accounting.salesN', { n: m.sales })} <b className="num">{money(m.revenueCents)}</b>
                </div>
              ),
            }))}
            format={(v) => money(Math.round(v / 100) * 100)}
          />
        </Card>
        <Card className="span-4" title={t('review.today')} icon="stock" tone="cobalt">
          <dl className="reco__grid" style={{ margin: 0, gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <dt className="reco__k">{t('review.inStock')}</dt>
            <dd className="num" style={{ margin: 0 }}>{r.today.inStock}</dd>
            <dt className="reco__k">{t('review.online')}</dt>
            <dd className="num" style={{ margin: 0 }}>{r.today.online}</dd>
            <dt className="reco__k">{t('review.capital')}</dt>
            <dd className="num" style={{ margin: 0 }}>
              {money(r.today.capitalCents)}
              {r.today.capitalUnknown > 0 && <span className="t-small t-faint"> {t('review.capitalUnknown', { n: r.today.capitalUnknown })}</span>}
            </dd>
          </dl>
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <Button size="sm" variant="ghost" icon="capital" onClick={() => go('capital')}>
              {t('review.toCapital')}
            </Button>
            <Button size="sm" variant="ghost" icon="upload" onClick={() => go('workshop')}>
              {t('review.toWorkshop')}
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title={t('review.table')}
        hint={t('review.tableHint')}
        icon="rows"
        tone="violet"
        actions={
          <Button size="sm" variant="ghost" icon="download" onClick={() => downloadText(`era-pilotage-${new Date(era.now).toISOString().slice(0, 10)}.csv`, reviewCsv(r, monthLabel))}>
            {t('review.csv')}
          </Button>
        }
        flush
      >
        <div className="table-wrap" tabIndex={0} style={{ boxShadow: 'none', border: 0 }}>
          <table className="dt dt--compact review-table">
            <thead>
              <tr>
                <th scope="col">{t('review.metric')}</th>
                {r.months.map((m, i) => (
                  <th key={m.from} scope="col" className="is-num">
                    {monthLabel(m.from)}
                    {i === r.months.length - 1 && <span className="t-faint"> {t('review.running')}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {r.months.map((m) => (
                    <td key={m.from} className="is-num num">
                      {row.cell(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/**
 * The monthly goal turned into buying: articles a week, the weekly budget, the capital in stock it ties up, and the
 * niches to buy first with the most to pay — all from the seller's own sales.
 */
function BuyingPlanCard({ capitalNowCents }: { capitalNowCents: number }) {
  const { t, money } = useI18n();
  const era = useEra();
  const goal = useLiveQuery(() => repo.getSetting<MonthlyGoal | null>('monthlyGoal', null), []);
  const plan = useMemo(() => (goal ? goalPlan(goalProgress(goal, era.sales, era.views, era.now), era.views, era.now) : null), [goal, era.sales, era.views, era.now]);
  const first = useMemo(() => shoppingList(era.model).buy.slice(0, 3), [era.model]);
  if (!goal || !plan) return null;
  const b = buyingPlan(plan, era.sales, era.now);
  return (
    <Card title={t('growth.title', { amount: goal.cents })} hint={t('growth.hint')} icon="target" tone="emerald" data-testid="buying-plan">
      <div className="grid-12" style={{ gap: 16 }}>
        <dl className="span-6 reco__grid" style={{ margin: 0, gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
          <dt className="reco__k" />
          <dd className="t-caption" style={{ margin: 0, textAlign: 'right' }}>{t('goal.planNeed')}</dd>
          <dd className="t-caption" style={{ margin: 0, textAlign: 'right' }}>{t('goal.planNow')}</dd>
          <dt className="reco__k">{t('growth.perWeek')}</dt>
          <dd className="num" style={{ margin: 0, textAlign: 'right' }}>{b.perWeek}</dd>
          <dd className="num t-muted" style={{ margin: 0, textAlign: 'right' }}>{plan.current.perWeek}</dd>
          <dt className="reco__k">{t('growth.budget')}</dt>
          <dd className="num" style={{ margin: 0, textAlign: 'right' }}>{b.budgetPerWeekCents === null ? '—' : money(b.budgetPerWeekCents)}</dd>
          <dd style={{ margin: 0 }} />
          <dt className="reco__k">{t('growth.capital')}</dt>
          <dd className="num" style={{ margin: 0, textAlign: 'right' }}>{b.capitalNeededCents === null ? '—' : money(b.capitalNeededCents)}</dd>
          <dd className="num t-muted" style={{ margin: 0, textAlign: 'right' }}>{money(capitalNowCents)}</dd>
        </dl>
        <div className="span-6 stack-3">
          <div className="t-caption">{t('growth.first')}</div>
          {first.length ? (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
              {first.map((l) => (
                <li key={l.key} className="row-between t-small" style={{ gap: 8 }}>
                  <span className="clamp-1">
                    <b>{l.label}</b> <span className="t-faint">· {t('growth.sold', { n: l.sold })}</span>
                  </span>
                  <span className="num" style={{ whiteSpace: 'nowrap' }}>{t('growth.max', { price: money(l.maxVintedPriceCents) })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-small t-muted">{t('growth.noNiche')}</p>
          )}
          <div>
            <Button size="sm" variant="ghost" icon="stock" onClick={() => go('buy?tab=list')}>
              {t('growth.toList')}
            </Button>
          </div>
        </div>
      </div>
      <p className="t-small t-faint" style={{ marginTop: 12 }}>
        {b.medianCost ? t('growth.basis', { cost: money(b.medianCost.cents), n: b.medianCost.n }) : t('growth.noCost')} {t('growth.caveat')}
      </p>
    </Card>
  );
}

/** Now against before, as an arrow and a word, never colour alone. Fewer is better when `invert`. */
function Versus({ now, before, text, invert }: { now: number; before: number; text: string; invert?: boolean }) {
  const { t } = useI18n();
  if (now === before) return <span className="t-faint">{t('review.same')}</span>;
  const up = now > before;
  const good = invert ? !up : up;
  return (
    <span className={`delta ${good ? 'delta--up' : 'delta--down'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.2} />
      <span style={{ fontWeight: 400 }}>{text}</span>
    </span>
  );
}
