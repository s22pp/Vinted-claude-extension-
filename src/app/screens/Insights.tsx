import { useI18n } from '@/i18n';
import { rankNiches, velocityScore } from '@/intelligence/seller-model';
import { BarChart, LineChart, ScatterChart } from '@/ui/charts/charts';
import { IconTile } from '@/ui/components/icons';
import { Badge, Card, EmptyState, Metric, Money, Sample } from '@/ui/components/primitives';
import { IllustrationDone } from '@/ui/components/illustrations';
import { ItemCell } from '../components/domain';
import { PatternsCard } from '../components/patterns';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';
import { MarketVsYou, YouHighlights } from '../components/market-vs-you';
import { PrecisionView } from '../components/precision';
import { Icon } from '@/ui/components/icons';

const CONF_TONE = { HIGH: 'emerald', MEDIUM: 'cyan', LOW: 'amber' } as const;

type Tab = 'patterns' | 'you' | 'precision' | 'niches';

export function Insights({ route }: { route: Route }) {
  const i = useI18n();
  const tab = (['patterns', 'you', 'precision', 'niches'].includes(route.query.get('tab') ?? '') ? route.query.get('tab') : 'patterns') as Tab;
  const { t, money, pct, date } = i;
  const era = useEra();
  const L = era.learning;
  const niches = rankNiches(era.model, 3).slice(0, 8);
  const brands = era.model.byBrand
    .filter((b) => b.sold >= 2 && b.avgProfitCents !== null)
    .map((b) => ({ label: b.label, value: (b.avgProfitCents ?? 0) * b.profitSample, n: b.sold }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const buyRoi = era.sales
    .filter((s) => s.sale.status !== 'REFUNDED' && s.cost && s.cost > 0 && s.profit !== null)
    .map((s) => ({ x: s.cost!, y: s.profit! / s.cost!, label: s.item.title, color: s.profit! / s.cost! >= 1 ? 'var(--emerald)' : s.profit! >= 0 ? 'var(--chart-1)' : 'var(--coral)' }));
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  if (era.ready && era.model.totalSold === 0) {
    return (
      <>
        <PageHead title={t('insights.title')} sub={t('insights.subtitle')} />
        <Card>
          <EmptyState art={<IllustrationDone />} title={t('insights.empty')} why={t('insights.emptyWhy')} />
        </Card>
      </>
    );
  }

  const tabs: { value: Tab; icon: 'insights' | 'compare' | 'target' | 'layers'; label: string }[] = [
    { value: 'patterns', icon: 'insights', label: t('insights.tabPatterns') },
    { value: 'you', icon: 'compare', label: t('insights.tabYou') },
    { value: 'precision', icon: 'target', label: t('insights.tabPrecision') },
    { value: 'niches', icon: 'layers', label: t('insights.tabNiches') },
  ];
  const nicheBars = rankNiches(era.model, 3).slice(0, 10);

  return (
    <>
      <PageHead
        title={t('insights.title')}
        sub={t('insights.marketVsPersonal')}
        tabs={
          <nav className="subtabs" role="tablist" aria-label={t('insights.title')}>
            {tabs.map((x) => (
              <button key={x.value} type="button" role="tab" aria-selected={tab === x.value} onClick={() => go(`insights?tab=${x.value}`)}>
                <Icon name={x.icon} size={14} /> {x.label}
              </button>
            ))}
          </nav>
        }
      />
      <div className="stack-4">
        {tab === 'patterns' && <PatternsCard />}
        {tab === 'you' && (
          <>
            <YouHighlights />
            <MarketVsYou />
          </>
        )}
        {tab === 'precision' && <PrecisionView />}
        {tab === 'niches' && (
          <>
        <Card title={t('insights.nichePerf')} hint={t('insights.nichePerfHint')} icon="trendUp" tone="emerald">
          <BarChart
            title={t('insights.nichePerf')}
            data={nicheBars.map((n) => ({
              label: `${n.label} · n=${n.sold}`,
              value: Math.round(velocityScore(n)),
              color: n.confidence === 'HIGH' ? 'var(--emerald)' : n.confidence === 'MEDIUM' ? 'var(--chart-1)' : 'var(--border-strong)',
              note: `${t('insights.niche.roi')} ${pct(n.roi)} · ${n.medianDays === null ? '—' : t('kpi.days', { n: Math.round(n.medianDays) })}`,
            }))}
            format={(v) => `${money(Math.round(v))}/j`}
          />
          <p className="t-small t-faint" style={{ marginTop: 8 }}>
            {t('insights.nichePerfRead')}
          </p>
        </Card>
        <Card title={t('insights.niches')} hint={t('insights.nichesHint')} icon="insights" tone="cyan">
          {niches.length === 0 ? (
            <p className="t-muted">{t('insights.emptyWhy')}</p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {niches.map((n, k) => (
                <article key={n.key} className="strategy" style={{ animationDelay: `${k * 50}ms` }}>
                  <div className="row-between">
                    <span className="t-h3 clamp-1">{n.label}</span>
                    {k === 0 && <Badge tone="emerald">#1</Badge>}
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 }}>
                    <Metric small label={t('insights.niche.avgBuy')} value={<span className="num" style={{ fontSize: 16 }}>{money(n.avgBuyCents)}</span>} />
                    <Metric small label={t('insights.niche.avgSale')} value={<span className="num" style={{ fontSize: 16 }}>{money(n.avgSaleCents)}</span>} />
                    <Metric small label={t('insights.niche.profit')} value={<span className="num t-pos" style={{ fontSize: 16 }}>{money(n.avgProfitCents)}</span>} />
                    <Metric small label={t('insights.niche.medianDays')} value={<span className="num" style={{ fontSize: 16 }}>{n.medianDays === null ? '—' : t('kpi.days', { n: Math.round(n.medianDays) })}</span>} />
                    <Metric small label={t('insights.niche.roi')} value={<span className="num" style={{ fontSize: 16 }}>{pct(n.roi)}</span>} />
                    <Metric small label={t('insights.niche.sample')} value={<span className="num" style={{ fontSize: 16 }}>{n.sold}</span>} foot={<Badge tone={CONF_TONE[n.confidence]}>{t(`confidence.${n.confidence}`)}</Badge>} />
                  </div>
                  <div className="t-small t-faint" style={{ marginTop: 8 }}>
                    {money(Math.round(velocityScore(n)))} {t('insights.perDay')}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>

        <div className="grid-12" id="capital">
          <Card className="span-6" title={t('insights.capitalTraps')} hint={t('insights.capitalTrapsHint')} icon="trap" tone="amber">
            <p className="t-muted">{t('insights.trapsMoved', { n: era.capital.traps.length })}</p>
            <button type="button" className="btn btn--sm" style={{ marginTop: 10 }} onClick={() => go('capital')}>
              {t('capital.title')} →
            </button>
          </Card>
          <Card className="span-6" title={t('insights.capitalStars')} hint={t('insights.capitalStarsHint')} icon="trendUp" tone="emerald">
            <div className="list">
              {era.capital.stars.map((s) => {
                const v = era.viewById.get(s.itemId)!;
                return (
                  <a key={s.itemId} className="list__row" href={`#/item/${s.itemId}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto', color: 'inherit' }}>
                    <ItemCell item={v.item} sub={t('insights.held', { n: s.days })} />
                    <span style={{ textAlign: 'right' }}>
                      <span className="num" style={{ display: 'block', fontWeight: 600 }}>
                        {money(s.costCents)} <span className="t-faint" style={{ fontWeight: 400 }}>{t('insights.invested')}</span>
                      </span>
                      <span className="t-small">
                        <Money cents={s.profitCents} sign /> · <span className="num">×{s.yield30.toFixed(1)}</span>
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid-12">
          <Card className="span-6" title={t('insights.brands')} hint={t('insights.brandsHint')} icon="stock" tone="cobalt">
            <BarChart title={t('insights.brands')} data={brands.map((b) => ({ label: `${b.label} · ${b.n}`, value: b.value }))} format={(v) => money(Math.round(v / 100) * 100)} />
          </Card>
          <Card className="span-6" title={t('insights.buyVsRoi')} hint={t('insights.buyVsRoiHint')} icon="target" tone="violet">
            <ScatterChart title={t('insights.buyVsRoi')} points={buyRoi} xFormat={(v) => money(Math.round(v / 100) * 100)} yFormat={(v) => pct(v)} xLabel={t('insights.niche.avgBuy')} yLabel={t('kpi.roi')} guides={{ y: 1 }} height={230} />
          </Card>
        </div>

        <div className="grid-12">
          <Card className="span-6" title={t('insights.priceBands')} hint={t('insights.priceBandsHint')} icon="clock" tone="cyan">
            <BarChart
              title={t('insights.priceBands')}
              data={era.model.byPriceBand.map((b) => ({ label: `${b.label} · n=${b.sold}`, value: b.sold >= 2 ? b.medianDays : null }))}
              format={(v) => `${Math.round(v)} j`}
              color="var(--chart-2)"
            />
          </Card>
          <Card className="span-6" title={t('insights.seasonality')} hint={t('insights.seasonalityHint')} icon="calendar" tone="neutral">
            <BarChart title={t('insights.seasonality')} orientation="vertical" height={190} data={era.model.seasonality.map((n, k) => ({ label: months[k]!, value: n }))} format={(v) => i.num(v)} />
          </Card>
          <Card className="span-12" title={t('insights.weekdays')} hint={`${t('insights.weekdaysHint')} · n = ${era.model.totalSold}`} icon="clock" tone="cyan">
            <BarChart
              title={t('insights.weekdays')}
              orientation="vertical"
              height={170}
              data={era.model.weekdays.map((n, k) => {
                const max = Math.max(...era.model.weekdays);
                return { label: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][k]!, value: n, color: n === max && n > 0 ? 'var(--emerald)' : 'var(--chart-1)' };
              })}
              format={(v) => i.num(v)}
            />
          </Card>
        </div>
          </>
        )}
        <p className="t-small t-faint row" style={{ gap: 8 }}>
          <IconTile name="info" tone="neutral" size="sm" />
          {t('kpi.refundRate')} : {pct(era.model.refundRate, { digits: 1 })} · <Sample n={era.sales.length} />
        </p>
      </div>
    </>
  );
}
