import { useI18n } from '@/i18n';
import { rankNiches, velocityScore } from '@/intelligence/seller-model';
import { BarChart, LineChart, ScatterChart } from '@/ui/charts/charts';
import { IconTile } from '@/ui/components/icons';
import { Badge, Card, EmptyState, Metric, Money, Sample } from '@/ui/components/primitives';
import { IllustrationDone } from '@/ui/components/illustrations';
import { ItemCell } from '../components/domain';
import { PageHead } from '../Shell';
import { useEra } from '../state';

const CONF_TONE = { HIGH: 'emerald', MEDIUM: 'cyan', LOW: 'amber' } as const;

export function Insights() {
  const i = useI18n();
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

  return (
    <>
      <PageHead title={t('insights.title')} sub={t('insights.subtitle')} />
      <p className="t-small t-muted" style={{ marginTop: -12, marginBottom: 16 }}>
        {t('insights.marketVsPersonal')}
      </p>
      <div className="stack-4">
        <div className="grid-12">
          <Card className="span-7" title={t('insights.predictionReality')} hint={`${t('insights.predictionHint')} · ${t('insights.resolved', { n: L.resolved, open: L.open })}`} icon="scale" tone="pink">
            {L.resolved === 0 ? (
              <p className="t-muted">{t('insights.noCorrection')}</p>
            ) : (
              <div className="stack-4">
                <div className="row wrap" style={{ gap: 32 }}>
                  <Metric small label={t('insights.priceError')} value={<span className="num">{pct(L.priceMape, { digits: 1 })}</span>} foot={<Sample n={L.resolved} />} />
                  <Metric small label={t('insights.hitRate')} value={<span className="num">{pct(L.priceHitRate)}</span>} />
                  <Metric small label={t('insights.timeHit')} value={<span className="num">{pct(L.timeHitRate)}</span>} />
                  <Metric small label={t('insights.bias')} value={<span className={`num ${L.priceBias !== null && L.priceBias < 0 ? 't-warn' : ''}`}>{pct(L.priceBias, { sign: true, digits: 1 })}</span>} />
                </div>
                {L.priceBias !== null && <p className="t-small">{t('insights.biasText', { pct: pct(L.priceBias, { sign: true, digits: 1 }) })}</p>}
                <p className="t-small t-muted">{L.resolved >= 5 ? t('insights.correction', { f: L.priceCorrection.toFixed(3) }) : t('insights.noCorrection')}</p>
                <LineChart
                  title={t('insights.trend')}
                  labels={L.trend.map((p) => date(p.at))}
                  series={[{ key: 'mape', label: t('insights.trend'), color: 'var(--pink)', values: L.trend.map((p) => p.mape), area: true }]}
                  format={(v) => pct(v)}
                  height={160}
                />
                <p className="t-small t-faint">{t('insights.trendHint')}</p>
              </div>
            )}
          </Card>
          <Card className="span-5" title={t('insights.calibration')} hint={t('insights.calibrationHint')} icon="target" tone="pink">
            <div className="stack-3">
              {L.calibration.map((c) => (
                <div key={c.confidence} className="stack" style={{ gap: 6 }}>
                  <div className="row-between t-small">
                    <span className="row" style={{ gap: 8 }}>
                      <Badge tone={CONF_TONE[c.confidence]}>{t(`confidence.${c.confidence}`)}</Badge>
                      <Sample n={c.n} />
                    </span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {pct(c.hitRate)} <span className="t-faint" style={{ fontWeight: 400 }}>· {t('insights.target', { pct: pct(c.target) })}</span>
                    </span>
                  </div>
                  <div className="meter" style={{ position: 'relative', height: 8 }} aria-hidden="true">
                    <span className="meter__fill" style={{ display: 'block', width: `${(c.hitRate ?? 0) * 100}%` }} />
                    <span style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${c.target * 100}%`, background: 'var(--text-2)', borderRadius: 1 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

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
            {era.capital.traps.length === 0 ? (
              <p className="t-muted">{t('today.noPriorities')}</p>
            ) : (
              <div className="list">
                {era.capital.traps.slice(0, 6).map((tr) => {
                  const v = era.viewById.get(tr.itemId)!;
                  return (
                    <a key={tr.itemId} className="list__row" href={`#/item/${tr.itemId}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto', color: 'inherit' }}>
                      <ItemCell item={v.item} sub={t('insights.held', { n: tr.daysHeld })} />
                      <span style={{ textAlign: 'right' }}>
                        <span className="num" style={{ display: 'block', fontWeight: 600 }}>
                          {money(tr.costCents)} <span className="t-faint" style={{ fontWeight: 400 }}>{t('insights.invested')}</span>
                        </span>
                        <span className="t-small">
                          <Money cents={tr.potentialProfitCents} sign /> <span className="t-faint">{t('insights.profitPot')}</span>
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
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
        <p className="t-small t-faint row" style={{ gap: 8 }}>
          <IconTile name="info" tone="neutral" size="sm" />
          {t('kpi.refundRate')} : {pct(era.model.refundRate, { digits: 1 })} · <Sample n={era.sales.length} />
        </p>
      </div>
    </>
  );
}
