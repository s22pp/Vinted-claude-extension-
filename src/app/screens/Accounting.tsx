import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { DAC7, ledgerYears, purchasesCsv, purchasesRegister, salesCsv, salesLedger, yearSummary } from '@/intelligence/accounting';
import { downloadText } from '@/lib/download';
import { BarChart } from '@/ui/charts/charts';
import { Badge, Button, Card, Metric, MetricFootPartial, MetricValue, Money, QualityTag, Segmented } from '@/ui/components/primitives';
import { PageHead } from '../Shell';
import { go, useEra } from '../state';

export function SalesTabs({ active }: { active: 'sales' | 'accounting' }) {
  const { t } = useI18n();
  return (
    <nav className="subtabs" aria-label={t('sales.title')}>
      <a href="#/sales" aria-current={active === 'sales' ? 'page' : undefined}>
        {t('sales.title')}
      </a>
      <a href="#/accounting" aria-current={active === 'accounting' ? 'page' : undefined}>
        {t('accounting.title')}
      </a>
    </nav>
  );
}

export function Accounting() {
  const { t, money, date } = useI18n();
  const era = useEra();
  const years = useMemo(() => ledgerYears(era.sales, era.views, era.now), [era.sales, era.views, era.now]);
  const [year, setYear] = useState<number>(years[0]!);
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) ?? [];
  const invoiceBySale = useMemo(() => new Map(invoices.map((r) => [r.saleId, r.number])), [invoices]);
  const sum = useMemo(() => yearSummary(era.sales, era.views, year), [era.sales, era.views, year]);
  const ledger = useMemo(() => salesLedger(era.sales, year, invoiceBySale), [era.sales, year, invoiceBySale]);
  const register = useMemo(() => purchasesRegister(era.views, year), [era.views, year]);
  const identity = useLiveQuery(() => repo.getSetting<{ name: string } | null>('sellerIdentity', null), []);
  const [showAll, setShowAll] = useState(false);

  return (
    <>
      <PageHead
        title={t('accounting.title')}
        sub={t('accounting.subtitle')}
        tabs={<SalesTabs active="accounting" />}
        actions={
          <Segmented label={t('accounting.year')} value={String(year)} onChange={(y) => setYear(Number(y))} options={years.slice(0, 5).map((y) => ({ value: String(y), label: String(y) }))} />
        }
      />
      <div className="stack-4">
        <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }} aria-label={t('accounting.title')}>
          <div className="kpi">
            <Metric small label={t('accounting.revenue')} icon="sales" tone="emerald" value={<span className="num">{money(sum.revenueCents)}</span>} foot={t('accounting.salesN', { n: sum.sales })} />
          </div>
          <div className="kpi">
            <Metric small label={t('accounting.cogs')} icon="capital" tone="amber" value={<MetricValue metric={sum.cogs} />} foot={<MetricFootPartial metric={sum.cogs} />} />
          </div>
          <div className="kpi">
            <Metric small label={t('accounting.margin')} icon="trendUp" tone="violet" value={<MetricValue metric={sum.grossMargin} sign />} foot={<MetricFootPartial metric={sum.grossMargin} />} />
          </div>
          <div className="kpi">
            <Metric small label={t('accounting.purchases')} icon="buy" tone="cobalt" value={<MetricValue metric={sum.purchases} />} foot={t('accounting.purchasesN', { n: register.rows.length })} />
          </div>
          <div className="kpi">
            <Metric small label={t('accounting.refunds')} icon="alert" tone="coral" value={<span className="num">{sum.refunds}</span>} foot={sum.refunds ? money(sum.refundedCents) : null} />
          </div>
        </section>

        <div className="grid-12">
          <Card className="span-5" title={t('accounting.dac7')} hint={t('accounting.dac7Hint')} icon="scale" tone={sum.dac7.reportable ? 'amber' : 'emerald'}>
            <div className="stack-3">
              <Gauge label={t('accounting.dac7Sales', { n: sum.sales, lim: DAC7.sales })} ratio={sum.dac7.salesRatio} />
              <Gauge label={t('accounting.dac7Revenue', { n: money(sum.revenueCents), lim: money(DAC7.revenueCents) })} ratio={sum.dac7.revenueRatio} />
              <p className={`t-small ${sum.dac7.reportable ? 't-warn' : 't-muted'}`}>{sum.dac7.reportable ? t('accounting.dac7Reached', { year }) : t('accounting.dac7Below', { year })}</p>
              <p className="t-small t-faint">{t('accounting.dac7Note')}</p>
            </div>
          </Card>
          <Card className="span-7" title={t('accounting.monthly')} hint={t('accounting.monthlyHint')} icon="calendar" tone="emerald">
            <BarChart
              title={t('accounting.monthly')}
              orientation="vertical"
              height={210}
              data={sum.byMonth.map((m) => ({
                label: t(`accounting.m${m.month}`),
                value: m.revenueCents,
                color: 'var(--emerald)',
                sub: (
                  <>
                    <div className="chart__tooltip-row">
                      {t('accounting.salesN', { n: m.sales })} <b className="num">{money(m.revenueCents)}</b>
                    </div>
                    <div className="chart__tooltip-row">
                      {t('accounting.margin')} <b className="num">{m.profit.status === 'unknown' ? '—' : money(m.profit.value, { sign: true })}</b>
                    </div>
                  </>
                ),
              }))}
              format={(v) => money(Math.round(v / 100) * 100)}
            />
          </Card>
        </div>

        <Card
          title={t('accounting.ledger')}
          hint={t('accounting.ledgerHint', { n: ledger.length })}
          icon="book"
          tone="emerald"
          flush
          actions={
            <Button size="sm" icon="upload" disabled={!ledger.length} onClick={() => downloadText(`era-livre-des-recettes-${year}.csv`, salesCsv(ledger))}>
              {t('accounting.exportCsv')}
            </Button>
          }
        >
          {!identity && (
            <p className="t-small t-warn" style={{ padding: '0 20px' }}>
              {t('accounting.identityMissing')} <a href="#/settings">{t('nav.settings')} →</a>
            </p>
          )}
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 460 }}>
            <table className="dt dt--compact">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.col.date')}</th>
                  <th scope="col">{t('accounting.col.invoice')}</th>
                  <th scope="col">{t('accounting.col.item')}</th>
                  <th scope="col" className="is-num">{t('accounting.col.amount')}</th>
                  <th scope="col" className="is-num">{t('accounting.col.cost')}</th>
                  <th scope="col" className="is-num">{t('accounting.col.margin')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {(showAll ? ledger : ledger.slice(-40)).map((r) => (
                  <tr key={r.saleId}>
                    <td className="num t-muted">{date(r.date)}</td>
                    <td className="num">{r.invoice ?? <span className="t-faint">—</span>}</td>
                    <td style={{ maxWidth: 320 }}>
                      <a className="clamp-1" href={`#/item/${r.itemId}`} style={{ color: 'inherit', fontWeight: 550, textDecoration: 'none' }}>
                        {r.title}
                      </a>
                    </td>
                    <td className="is-num">
                      <Money cents={r.amountCents} />
                    </td>
                    <td className="is-num">
                      <Money cents={r.costCents} compact />
                    </td>
                    <td className="is-num">
                      <Money cents={r.profitCents} sign compact />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={async () => {
                          await repo.issueInvoice(r.saleId);
                          go(`invoice/${r.saleId}`);
                        }}
                      >
                        {r.invoice ? t('accounting.openInvoice') : t('accounting.makeInvoice')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ledger.length > 40 && (
            <div style={{ padding: '10px 20px' }}>
              <Button size="sm" variant="ghost" onClick={() => setShowAll((x) => !x)}>
                {showAll ? t('precision.showLess') : t('accounting.showAll', { n: ledger.length })}
              </Button>
            </div>
          )}
        </Card>

        <Card
          title={t('accounting.register')}
          hint={t('accounting.registerHint', { n: register.rows.length })}
          icon="buy"
          tone="cobalt"
          flush
          actions={
            <Button size="sm" icon="upload" disabled={!register.rows.length} onClick={() => downloadText(`era-registre-des-achats-${year}.csv`, purchasesCsv(register.rows))}>
              {t('accounting.exportCsv')}
            </Button>
          }
        >
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 420 }}>
            <table className="dt dt--compact">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.col.date')}</th>
                  <th scope="col">{t('accounting.col.item')}</th>
                  <th scope="col">{t('accounting.col.source')}</th>
                  <th scope="col" className="is-num">{t('cost.item')}</th>
                  <th scope="col" className="is-num">{t('cost.protection')}</th>
                  <th scope="col" className="is-num">{t('cost.shipping')}</th>
                  <th scope="col" className="is-num">{t('cost.total')}</th>
                </tr>
              </thead>
              <tbody>
                {register.rows.slice(-60).map((r) => (
                  <tr key={r.itemId} onClick={() => go(`item/${r.itemId}`)}>
                    <td className="num t-muted">{r.date ? date(r.date) : '—'}</td>
                    <td style={{ maxWidth: 300 }}>
                      <span className="clamp-1" style={{ fontWeight: 550 }}>
                        {r.title}
                      </span>
                    </td>
                    <td className="t-muted">{r.source ?? '—'}</td>
                    <td className="is-num">
                      <Money cents={r.itemCents} compact />
                    </td>
                    <td className="is-num">
                      <Money cents={r.protectionCents} compact />
                    </td>
                    <td className="is-num">{r.shippingCents === null && r.protectionCents !== null ? <span className="t-warn t-small">{t('cost.shippingUnknown')}</span> : <Money cents={r.shippingCents} compact />}</td>
                    <td className="is-num">
                      <Money cents={r.totalCents} compact />
                      {!r.complete && <sup className="t-warn">+</sup>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {register.undated > 0 && (
            <p className="t-small t-faint" style={{ padding: '10px 20px' }}>
              <QualityTag quality="PARTIAL" text={t('accounting.undated', { n: register.undated })} />
            </p>
          )}
        </Card>

        <p className="t-small t-faint">
          <Badge tone="neutral">{t('accounting.notAdvice')}</Badge> {t('accounting.disclaimer')}
        </p>
      </div>
    </>
  );
}

function Gauge({ label, ratio }: { label: string; ratio: number }) {
  const w = Math.min(1, ratio);
  return (
    <div className="gauge">
      <div className="row-between t-small">
        <span>{label}</span>
        <span className="num t-muted">{Math.round(ratio * 100)} %</span>
      </div>
      <span className="gauge__track">
        <span className={`gauge__fill ${ratio >= 1 ? 'is-over' : ratio >= 0.8 ? 'is-near' : ''}`} style={{ width: `${w * 100}%` }} />
      </span>
    </div>
  );
}
