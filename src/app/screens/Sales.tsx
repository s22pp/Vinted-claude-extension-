import { useState } from 'react';
import { DAY } from '@/domain/time';
import { useI18n } from '@/i18n';
import { monthlySeries, salesSummary } from '@/intelligence/portfolio';
import { Legend, LineChart, ScatterChart } from '@/ui/charts/charts';
import { IllustrationNoSales } from '@/ui/components/illustrations';
import { Badge, Button, Card, EmptyState, Metric, MetricFootPartial, MetricValue, Money, QualityTag, Segmented } from '@/ui/components/primitives';
import { ItemCell } from '../components/domain';
import { useMoneyField } from '../components/forms';
import { repo } from '@/data/repo';
import { useToast } from '@/ui/components/overlays';
import { Input } from '@/ui/components/primitives';
import type { ItemView } from '@/intelligence/portfolio';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';
import { RefundsCard } from '../components/refunds';
import { ToShipCard } from '../components/to-ship';
import { SalesTabs } from './Accounting';
import { useEffect } from 'react';

type Period = '30' | '90' | '365' | 'all';

export function Sales({ route }: { route?: Route }) {
  const i = useI18n();
  const { t, money, pct, month, date } = i;
  const era = useEra();
  const [period, setPeriod] = useState<Period>('90');
  const from = period === 'all' ? 0 : era.now - Number(period) * DAY;
  const s = salesSummary(era.views, era.sales, from, era.now + 1);
  const series = monthlySeries(era.sales, era.now, 12);
  const inPeriod = era.sales.filter((x) => x.sale.soldAt >= from);
  const done = inPeriod.filter((x) => x.sale.status !== 'REFUNDED');
  const points = done
    .filter((x) => x.profit !== null && x.daysToSale !== null)
    .map((x) => ({ x: x.daysToSale!, y: x.profit!, label: x.item.title, color: x.profit! >= 0 ? 'var(--chart-1)' : 'var(--coral)' }));
  const unknownProfit = done.filter((x) => x.profit === null).length;

  const toComplete = era.views.filter((v) => v.item.status === 'SOLD' && !v.sale);
  const focusRefunds = route?.query.get('refunds') === '1';
  const focusShip = route?.query.get('ship') === '1';
  useEffect(() => {
    if (focusShip) setTimeout(() => document.getElementById('to-ship')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [focusShip]);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  useEffect(() => {
    if (focusRefunds) setTimeout(() => document.getElementById('refunds')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [focusRefunds]);

  if (era.ready && era.sales.length === 0 && toComplete.length === 0) {
    return (
      <>
        <PageHead title={t('sales.title')} sub={t('sales.subtitle')} />
        <Card>
          <EmptyState art={<IllustrationNoSales />} title={t('sales.empty')} why={t('sales.emptyWhy')} action={<Button variant="primary" onClick={() => go('stock')}>{t('sales.emptyCta')}</Button>} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={t('sales.title')}
        sub={t('sales.subtitle')}
        tabs={<SalesTabs active="sales" />}
        actions={
          <Segmented
            label="Période"
            value={period}
            onChange={setPeriod}
            options={(['30', '90', '365', 'all'] as Period[]).map((p) => ({ value: p, label: t(`sales.period.${p}`) }))}
          />
        }
      />
      <div className="stack-4">
        <ToShipCard highlight={focusShip} />
        {toComplete.length > 0 && <ToComplete views={toComplete} />}
        <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }} aria-label={t('sales.title')}>
          <div className="kpi">
            <Metric small label={t('kpi.revenue')} icon="sales" tone="emerald" value={<span className="num">{money(s.period.revenue)}</span>} foot={`${s.period.count} ventes`} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.knownProfit')} icon="price" tone="violet" value={<MetricValue metric={s.period.profit} sign />} foot={<MetricFootPartial metric={s.period.profit} />} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.avgMargin')} value={<span className="num">{pct(s.averageMargin)}</span>} foot={unknownProfit ? <QualityTag quality="PARTIAL" /> : null} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.roi')} value={<span className="num">{pct(s.roi)}</span>} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.sellThrough')} value={<span className="num">{pct(s.sellThrough)}</span>} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.medianDays')} icon="clock" tone="cyan" value={<span className="num">{s.medianDaysToSale === null ? '—' : t('kpi.days', { n: Math.round(s.medianDaysToSale) })}</span>} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.avgSale')} value={<Money cents={s.averageSalePrice} />} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.capitalReturned')} icon="capital" tone="amber" value={<MetricValue metric={s.capitalReturned} />} foot={<MetricFootPartial metric={s.capitalReturned} />} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.refundRate')} value={<span className={`num ${s.refundRate && s.refundRate > 0.1 ? 't-neg' : ''}`}>{pct(s.refundRate, { digits: 1 })}</span>} foot={s.period.refunded ? `${s.period.refunded}` : null} />
          </div>
          <div className="kpi">
            <Metric small label={t('kpi.efficiency')} help={t('kpi.efficiencyHint')} value={<span className="num">{era.capital.efficiency30 === null ? '—' : `×${i.num(era.capital.efficiency30, 1)}`}</span>} />
          </div>
        </section>

        <div className="grid-12">
          <Card className="span-7" title={t('sales.monthly')} hint={t('sales.monthlyHint')} icon="sales" tone="emerald" actions={<Legend items={[{ label: t('charts.revenue'), color: 'var(--chart-1)' }, { label: t('charts.profit'), color: 'var(--chart-2)' }]} />}>
            <LineChart
              title={t('sales.monthly')}
              labels={series.map((m) => month(m.start))}
              series={[
                { key: 'r', label: t('charts.revenue'), color: 'var(--chart-1)', values: series.map((m) => m.revenue), area: true },
                { key: 'p', label: t('charts.profit'), color: 'var(--chart-2)', values: series.map((m) => m.profit) },
              ]}
              format={(v) => money(Math.round(v / 100) * 100)}
              height={250}
            />
          </Card>
          <Card className="span-5" title={t('sales.scatter')} hint={t('sales.scatterHint')} icon="target" tone="violet">
            <ScatterChart
              title={t('sales.scatter')}
              points={points}
              xFormat={(v) => `${Math.round(v)} j`}
              yFormat={(v) => money(Math.round(v / 100) * 100)}
              xLabel={t('sales.col.days')}
              yLabel={t('sales.col.profit')}
              height={250}
            />
          </Card>
        </div>

        <RefundsCard highlight={focusRefunds} />

        <Card title={t('sales.recent')} icon="calendar" tone="neutral" hint={unknownProfit ? t('sales.unknownProfit', { n: unknownProfit }) : undefined} flush>
          <div className="table-wrap" style={{ border: 0, boxShadow: 'none', borderRadius: 0, maxHeight: 480 }}>
            <table className="dt dt--compact">
              <thead>
                <tr>
                  <th scope="col">{t('sales.col.date')}</th>
                  <th scope="col">{t('sales.col.item')}</th>
                  <th scope="col" className="is-num">
                    {t('sales.col.price')}
                  </th>
                  <th scope="col" className="is-num">
                    {t('sales.col.cost')}
                  </th>
                  <th scope="col" className="is-num">
                    {t('sales.col.profit')}
                  </th>
                  <th scope="col" className="is-num">
                    {t('sales.col.days')}
                  </th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {inPeriod.slice(0, 200).map((x) => (
                  <tr key={x.sale.id} onClick={() => go(`item/${x.item.id}`)}>
                    <td className="num t-muted">{date(x.sale.soldAt)}</td>
                    <td>
                      <span className="row">
                        <ItemCell item={x.item} />
                        {x.sale.status === 'REFUNDED' && <Badge tone="coral">{t('sales.refunded')}</Badge>}
                      </span>
                    </td>
                    <td className="is-num">
                      <Money cents={x.sale.salePriceCents} />
                    </td>
                    <td className="is-num">
                      <Money cents={x.cost} unknownLabel={t('data.notProvided')} />
                    </td>
                    <td className="is-num">{x.sale.status === 'REFUNDED' ? <span className="t-faint">—</span> : <Money cents={x.profit} sign />}</td>
                    <td className="is-num num">{x.daysToSale === null ? '—' : t('kpi.days', { n: x.daysToSale })}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {x.sale.status !== 'REFUNDED' &&
                        (refundFor === x.sale.id ? (
                          <span className="row" style={{ gap: 6 }}>
                            <RefundNow saleId={x.sale.id} onDone={() => setRefundFor(null)} />
                          </span>
                        ) : (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRefundFor(x.sale.id)}>
                            {t('refunds.mark')}
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/** Sold on Vinted without a known price: fill each one inline, Enter to save. */
function ToComplete({ views }: { views: ItemView[] }) {
  const { t } = useI18n();
  return (
    <Card title={t('sales.toComplete')} hint={t('sales.toCompleteHint', { n: views.length })} icon="sales" tone="amber">
      <div className="list">
        {views.slice(0, 50).map((v) => (
          <ToCompleteRow key={v.item.id} v={v} />
        ))}
      </div>
    </Card>
  );
}

function ToCompleteRow({ v }: { v: ItemView }) {
  const { t } = useI18n();
  const toast = useToast();
  const last = v.listings[v.listings.length - 1] ?? null;
  const price = useMoneyField(last?.priceCents ?? null);
  const [date, setDate] = useState(() => new Date(last?.soldAt ?? v.item.updatedAt).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (price.cents === null || price.invalid) return;
    setBusy(true);
    await repo.recordSale(v.item.id, price.cents, new Date(date).getTime() + 12 * 3600_000);
    toast('success', t('sales.saleSaved'), v.item.title);
  };
  return (
    <form className="list__row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto auto', cursor: 'default' }} onSubmit={save}>
      <ItemCell item={v.item} sub={last ? t('sales.lastAsk', { price: last.priceCents }) : v.item.brand} />
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('sales.col.date')} style={{ width: 150 }} />
      <Input money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} aria-label={`${t('sales.received')} — ${v.item.title}`} placeholder={t('sales.received')} style={{ width: 110 }} aria-invalid={price.invalid} />
      <Button type="submit" size="sm" variant="primary" icon="check" loading={busy} disabled={price.cents === null || price.invalid}>
        {t('sales.saveSale')}
      </Button>
    </form>
  );
}

/** A sale that came back: pick the reason, the sale leaves revenue and profit. */
function RefundNow({ saleId, onDone }: { saleId: string; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <span className="reason-chips">
      {(['SIZE', 'DEFECT', 'CONDITION', 'DESCRIPTION', 'OTHER'] as const).map((r) => (
        <button
          key={r}
          type="button"
          className="chip"
          onClick={async () => {
            await repo.markRefunded(saleId, r);
            toast('success', t('refunds.marked'), t(`refunds.r.${r}`));
            onDone();
          }}
        >
          {t(`refunds.r.${r}`)}
        </button>
      ))}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>
        {t('common.cancel')}
      </button>
    </span>
  );
}
