import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { AGE_BUCKETS, type CapitalPosition, type TrapReason } from '@/intelligence/capital';
import { BarChart, Legend, ScatterChart } from '@/ui/charts/charts';
import { IllustrationStock } from '@/ui/components/illustrations';
import { Badge, type BadgeTone, Card, EmptyState, Metric, MetricFootPartial, MetricValue, Money, QualityTag, Segmented } from '@/ui/components/primitives';
import { ItemCell } from '../components/domain';
import { PageHead } from '../Shell';
import { go, useEra } from '../state';
import { StockTabs } from './Stock';

const REASON_TONE: Record<TrapReason, BadgeTone> = { HIGH_COST: 'violet', LONG_HELD: 'amber', LOW_DEMAND: 'coral', THIN_MARGIN: 'coral' };
const AGE_FOCUS = ['stock?sort=age', 'stock?focus=AGE30', 'stock?focus=AGE60', 'stock?focus=AGE90'];

type SortKey = 'efficiency' | 'cost' | 'days' | 'profit';

export function Capital() {
  const i = useI18n();
  const { t, money, pct } = i;
  const era = useEra();
  const cap = era.capital;
  const [sort, setSort] = useState<SortKey>('efficiency');
  const byId = era.viewById;

  const positions = useMemo(() => {
    const val = (p: CapitalPosition): number | null =>
      sort === 'efficiency' ? p.efficiency30 : sort === 'cost' ? p.cost : sort === 'days' ? p.daysHeld : p.potentialProfit;
    // Worst capital first: lowest efficiency, highest cost, longest held, lowest profit.
    const dir = sort === 'efficiency' || sort === 'profit' ? 1 : -1;
    return [...cap.positions]
      .filter((p) => p.cost !== null)
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        if (x === null) return 1;
        if (y === null) return -1;
        return (x - y) * dir;
      });
  }, [cap.positions, sort]);

  if (era.views.filter((v) => v.inStock).length === 0) {
    return (
      <>
        <PageHead title={t('capital.title')} tabs={<StockTabs active="capital" />} />
        <Card>
          <EmptyState art={<IllustrationStock />} title={t('stock.empty')} why={t('stock.emptyWhy')} />
        </Card>
      </>
    );
  }

  const trapIds = new Set(cap.traps.map((x) => x.itemId));
  // Chart 4: profit vs days held — stock (potential, at the current ask) and sold (realised).
  const stockPts = cap.positions
    .filter((p) => p.potentialProfit !== null && p.daysHeld !== null)
    .map((p) => ({
      x: p.daysHeld!,
      y: p.potentialProfit!,
      r: 3 + Math.min(7, Math.sqrt((p.cost ?? 0) / 100)),
      label: byId.get(p.itemId)?.item.title ?? '',
      color: trapIds.has(p.itemId) ? 'var(--coral)' : 'var(--chart-1)',
      id: p.itemId,
      detail: (
        <div className="chart__tooltip-row">
          {t('capital.invested')} <b className="num">{money(p.cost ?? 0)}</b>
        </div>
      ),
    }));
  const soldPts = era.sales
    .filter((s) => s.sale.status !== 'REFUNDED' && s.profit !== null && s.daysToSale !== null)
    .slice(-80)
    .map((s) => ({ x: s.daysToSale!, y: s.profit!, r: 3 + Math.min(7, Math.sqrt((s.cost ?? 0) / 100)), label: s.item.title, color: 'var(--emerald)', id: s.item.id, detail: undefined }));
  const pts = [...soldPts, ...stockPts];
  const nicheLabel = new Map(era.model.byNiche.map((n) => [n.key, n.label]));
  const niches = cap.byNiche.slice(0, 10).map((n) => ({ ...n, label: nicheLabel.get(n.key) ?? n.label }));
  const investedV = cap.invested.status === 'unknown' ? 0 : cap.invested.value;

  return (
    <>
      <PageHead title={t('capital.title')} sub={t('capital.subtitle')} tabs={<StockTabs active="capital" />} />
      <div className="stack-4">
        <section className="kpi-strip" aria-label={t('capital.title')}>
          <div className="kpi">
            <Metric
              label={t('kpi.invested')}
              icon="capital"
              tone="violet"
              value={<MetricValue metric={cap.invested} />}
              foot={cap.costsExcludingShipping > 0 ? <QualityTag quality="PARTIAL" text={t('capital.excludingShipping', { n: cap.costsExcludingShipping })} /> : <MetricFootPartial metric={cap.invested} />}
              small
            />
          </div>
          <div className="kpi">
            <Metric label={t('capital.over', { n: 30 })} icon="clock" tone="cobalt" value={<MetricValue metric={cap.over30} />} foot={investedV && cap.over30.status !== 'unknown' ? pct(cap.over30.value / investedV) : null} small />
          </div>
          <div className="kpi">
            <Metric label={t('capital.over', { n: 60 })} icon="hourglass" tone="amber" value={<MetricValue metric={cap.over60} />} foot={investedV && cap.over60.status !== 'unknown' ? pct(cap.over60.value / investedV) : null} small />
          </div>
          <div className="kpi">
            <Metric label={t('capital.over', { n: 90 })} icon="alert" tone="coral" value={<MetricValue metric={cap.over90} />} foot={investedV && cap.over90.status !== 'unknown' ? pct(cap.over90.value / investedV) : null} small />
          </div>
          <div className="kpi">
            <Metric
              label={t('kpi.efficiency')}
              help={t('kpi.efficiencyHint')}
              icon="trendUp"
              tone="emerald"
              value={<span className="num">{cap.efficiency30 === null ? '—' : pct(cap.efficiency30)}</span>}
              foot={t('capital.per30')}
              small
            />
          </div>
          <div className="kpi">
            <Metric
              label={t('capital.medianHeld')}
              icon="calendar"
              tone="cyan"
              value={<span className="num">{cap.medianDaysHeld === null ? '—' : t('kpi.days', { n: cap.medianDaysHeld })}</span>}
              foot={cap.turnover !== null ? t('capital.turnoverLine', { x: cap.turnover.toFixed(1) }) : null}
              small
            />
          </div>
        </section>

        <div className="grid-12">
          <Card className="span-5" title={t('capital.whereTitle')} hint={t('capital.whereHint')} icon="target" tone="violet">
            <BarChart
              title={t('capital.whereTitle')}
              onSelect={(idx) => {
                const n = niches[idx];
                if (n) go(`stock?focus=${encodeURIComponent(`NICHE:${n.key}`)}&label=${encodeURIComponent(n.label)}`);
              }}
              data={niches.map((n) => ({
                label: `${n.label} · ${n.count}`,
                value: n.invested,
                color: n.medianDaysHeld >= 90 ? 'var(--coral)' : n.medianDaysHeld >= 60 ? 'var(--amber)' : n.medianDaysHeld >= 30 ? 'var(--cobalt)' : 'var(--chart-1)',
                note: t('capital.nicheNote', { n: n.count, d: Math.round(n.medianDaysHeld) }),
              }))}
              format={(v) => money(Math.round(v / 100) * 100)}
            />
            <div className="row wrap t-small t-muted" style={{ gap: 12, marginTop: 8 }}>
              <Legend
                items={[
                  { label: '< 30 j', color: 'var(--chart-1)' },
                  { label: '30–60 j', color: 'var(--cobalt)' },
                  { label: '60–90 j', color: 'var(--amber)' },
                  { label: '90 j +', color: 'var(--coral)' },
                ]}
              />
            </div>
          </Card>
          <Card
            className="span-7"
            title={t('capital.profitVsDays')}
            hint={t('capital.profitVsDaysHint')}
            icon="scale"
            tone="cobalt"
            actions={
              <Legend
                items={[
                  { label: t('capital.legendStock'), color: 'var(--chart-1)' },
                  { label: t('capital.legendTrap'), color: 'var(--coral)' },
                  { label: t('capital.legendSold'), color: 'var(--emerald)' },
                ]}
              />
            }
          >
            <ScatterChart
              title={t('capital.profitVsDays')}
              points={pts}
              xLabel={t('capital.daysHeld')}
              yLabel={t('capital.profit')}
              xFormat={(v) => `${Math.round(v)} j`}
              yFormat={(v) => money(Math.round(v / 100) * 100)}
              guides={{ y: 0, x: 60 }}
              height={290}
              onSelect={(idx) => go(`item/${pts[idx]!.id}`)}
            />
          </Card>
        </div>

        <div className="grid-12">
          <Card className="span-4" title={t('today.capitalAge')} hint={t('today.capitalAgeHint')} icon="hourglass" tone="amber">
            <BarChart
              title={t('today.capitalAge')}
              orientation="vertical"
              height={230}
              onSelect={(idx) => go(AGE_FOCUS[idx]!)}
              data={cap.aging.map((b, idx) => ({
                label: `${AGE_BUCKETS[idx]} j`,
                value: b.invested.status === 'unknown' ? null : b.invested.value,
                color: ['var(--chart-1)', 'var(--cobalt)', 'var(--amber)', 'var(--coral)'][idx],
                sub: (
                  <div className="chart__tooltip-row">
                    {t('capital.items', { n: b.count })} <b className="num">{b.invested.status === 'unknown' ? '—' : money(b.invested.value)}</b>
                  </div>
                ),
              }))}
              format={(v) => money(Math.round(v / 100) * 100)}
            />
          </Card>
          <Card className="span-8" title={t('insights.capitalTraps')} hint={t('capital.trapsHint')} icon="trap" tone="coral">
            {cap.traps.length === 0 ? (
              <p className="t-muted">{t('capital.noTraps')}</p>
            ) : (
              <div className="list">
                {cap.traps.slice(0, 8).map((tr, idx) => {
                  const v = byId.get(tr.itemId);
                  if (!v) return null;
                  return (
                    <a key={tr.itemId} className="list__row trap-row" href={`#/item/${tr.itemId}`} style={{ animationDelay: `${idx * 40}ms`, color: 'inherit' }}>
                      <ItemCell item={v.item} sub={<span className="row wrap" style={{ gap: 4 }}>{tr.reasons.map((r) => <Badge key={r} tone={REASON_TONE[r]}>{t(`capital.reason.${r}`)}</Badge>)}</span>} />
                      <span className="trap-row__nums">
                        <span>
                          <span className="t-faint t-small">{t('capital.invested')}</span> <Money cents={tr.costCents} />
                        </span>
                        <span>
                          <span className="t-faint t-small">{t('capital.held')}</span> <span className="num">{t('kpi.days', { n: tr.daysHeld })}</span>
                        </span>
                        <span>
                          <span className="t-faint t-small">{t('capital.profit')}</span> <Money cents={tr.potentialProfitCents} sign compact />
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
            <p className="t-small t-faint" style={{ marginTop: 10 }}>
              {t('capital.trapRule')}
            </p>
          </Card>
        </div>

        <Card
          title={t('capital.positions')}
          hint={t('capital.positionsHint')}
          icon="rows"
          tone="neutral"
          flush
          actions={
            <Segmented
              label={t('capital.sortBy')}
              value={sort}
              onChange={setSort}
              options={[
                { value: 'efficiency', label: t('capital.sortEfficiency') },
                { value: 'cost', label: t('capital.sortCost') },
                { value: 'days', label: t('capital.sortDays') },
                { value: 'profit', label: t('capital.sortProfit') },
              ]}
            />
          }
        >
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 520 }}>
            <table className="dt dt--compact">
              <thead>
                <tr>
                  <th scope="col">{t('stock.col.item')}</th>
                  <th scope="col" className="is-num">{t('capital.invested')}</th>
                  <th scope="col" className="is-num">{t('capital.held')}</th>
                  <th scope="col" className="is-num">{t('capital.potentialProfit')}</th>
                  <th scope="col" className="is-num">{t('capital.potentialRoi')}</th>
                  <th scope="col" className="is-num">{t('capital.efficiencyCol')}</th>
                  <th scope="col">{t('capital.demand')}</th>
                </tr>
              </thead>
              <tbody>
                {positions.slice(0, 120).map((p) => {
                  const v = byId.get(p.itemId);
                  if (!v) return null;
                  return (
                    <tr key={p.itemId} tabIndex={0} onClick={() => go(`item/${p.itemId}`)} onKeyDown={(e) => e.key === 'Enter' && go(`item/${p.itemId}`)} className={p.trap ? 'is-trap' : undefined}>
                      <td style={{ maxWidth: 320 }}>
                        <span className="clamp-1" style={{ fontWeight: 550 }}>
                          {v.item.title}
                        </span>
                      </td>
                      <td className="is-num" title={!p.costComplete ? t('capital.knownExShipping') : undefined}>
                        <Money cents={p.cost} compact />
                        {!p.costComplete && <sup className="t-warn">+</sup>}
                      </td>
                      <td className="is-num num">
                        {p.daysHeld === null ? '—' : t('kpi.days', { n: p.daysHeld })}
                        {p.daysHeldInferred ? '*' : ''}
                      </td>
                      <td className="is-num">
                        <Money cents={p.potentialProfit} sign compact />
                      </td>
                      <td className="is-num num">{p.potentialRoi === null ? '—' : pct(p.potentialRoi)}</td>
                      <td className="is-num num">
                        {p.efficiency30 === null ? (
                          '—'
                        ) : (
                          <span className="effbar">
                            <span className="effbar__track">
                              <span className="effbar__fill" style={{ width: `${Math.max(3, Math.min(100, p.efficiency30 * 50))}%`, background: p.efficiency30 < 0.25 ? 'var(--coral)' : p.efficiency30 >= 1 ? 'var(--emerald)' : 'var(--chart-1)' }} />
                            </span>
                            {pct(p.efficiency30)}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={p.demand === 'LOW' ? 'coral' : p.demand === 'HIGH' ? 'emerald' : p.demand === 'OK' ? 'cobalt' : 'neutral'}>{t(`capital.demandLevel.${p.demand}`)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="t-small t-faint">{t('capital.footnote')}</p>
      </div>
    </>
  );
}
