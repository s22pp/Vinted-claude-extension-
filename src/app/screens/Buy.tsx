import { useState } from 'react';
import type { Category, Condition } from '@/domain/entities';
import { errorCode } from '@/data/adapters/marketplace';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type BuyAnalysis, analyzeBuy, buySubject } from '@/intelligence/buy';
import { personalEvidence } from '@/intelligence/seller-model';
import { Ring } from '@/ui/charts/charts';
import { IllustrationBuy } from '@/ui/components/illustrations';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorState, Field, Input, Metric, Sample, Stages } from '@/ui/components/primitives';
import { StrategyCards } from '../components/domain';
import { CategorySelect, ConditionSelect, useMoneyField } from '../components/forms';
import { marketAdapter } from '../market-run';
import { AnalysisView } from './Market';
import { PageHead } from '../Shell';
import { go, type Route, useEra } from '../state';

type Stage = 'COLLECTING' | 'COMPARING' | 'READY';
const VERDICT_TONE = { BUY: 'emerald', NEGOTIATE: 'amber', AVOID: 'coral', INSUFFICIENT_DATA: 'neutral' } as const;

/** Buyer-side Vinted fees (verified): 0,70 € + 5 % buyer protection, shipping on top. */
export function vintedLandedCost(listed: number, shipping: number | null): number {
  return listed + 70 + Math.round(listed * 0.05) + (shipping ?? 0);
}

export function Buy({ route }: { route: Route }) {
  const { t, money } = useI18n();
  const era = useEra();
  const toast = useToast();
  const [title, setTitle] = useState(route.query.get('title') ?? '');
  const [brand, setBrand] = useState(route.query.get('brand') ?? '');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState<Category>((route.query.get('category') as Category) ?? 'JACKET');
  const [size, setSize] = useState('');
  const [condition, setCondition] = useState<Condition | ''>('VERY_GOOD');
  const price = useMoneyField(route.query.get('price') ? Number(route.query.get('price')) : null);
  const shipping = useMoneyField(null);
  const [onVinted, setOnVinted] = useState(route.query.get('vinted') === '1');
  const [stage, setStage] = useState<Stage | null>(null);
  const [result, setResult] = useState<BuyAnalysis | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(false);

  const cost = price.cents === null ? null : onVinted ? vintedLandedCost(price.cents, shipping.cents) : price.cents + (shipping.cents ?? 0);
  const valid = brand.trim() !== '' && cost !== null && !price.invalid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setError(null);
    setResult(null);
    setSaved(false);
    try {
      const input = { title: title.trim(), brand: brand.trim(), model: model.trim() || null, category, gender: null, size: size.trim() || null, condition: condition || null, purchasePriceCents: cost!, url: null };
      const adapter = marketAdapter(era.mode, false);
      const analysis = await repo.analyzeMarket(adapter, buySubject(input), null, setStage);
      const personal = personalEvidence(era.model, { brand: input.brand, model: input.model, category });
      setResult(analyzeBuy(input, analysis, era.model, personal, era.learning.priceCorrection));
      await repo.track('first_buy_analysis');
    } catch (err) {
      setStage(null);
      const code = errorCode(err);
      setError(err);
    }
  };

  const addToStock = async () => {
    if (!result) return;
    const r = result.input;
    await repo.addItem({ ...r, title: r.title || `${r.brand} ${r.model ?? t(`category.${r.category}`)}`, purchaseDate: Date.now(), purchaseSource: onVinted ? 'Vinted' : null, priceCents: null, listedAt: null, views: null, favorites: null });
    setSaved(true);
    toast('success', t('buy.saved'));
  };

  return (
    <>
      <PageHead title={t('buy.title')} sub={t('buy.subtitle')} />
      <div className="grid-12">
        <Card className="span-4" title={t('buy.form')} icon="buy" tone="violet" style={{ alignSelf: 'start' }}>
          <form className="stack-3" onSubmit={submit} noValidate>
            <Field label={t('buy.fTitle')} htmlFor="b-title" optional>
              <Input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Veste Harrington vintage" />
            </Field>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label={t('buy.fBrand')} htmlFor="b-brand" error={touched && !brand.trim() ? t('add.required') : null}>
                <Input id="b-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ralph Lauren" aria-invalid={touched && !brand.trim()} />
              </Field>
              <Field label={t('buy.fModel')} htmlFor="b-model" optional>
                <Input id="b-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Harrington" />
              </Field>
              <Field label={t('buy.fCategory')} htmlFor="b-cat">
                <CategorySelect id="b-cat" value={category} onChange={setCategory} />
              </Field>
              <Field label={t('buy.fSize')} htmlFor="b-size" optional>
                <Input id="b-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M" />
              </Field>
              <Field label={t('buy.fCondition')} htmlFor="b-cond">
                <ConditionSelect id="b-cond" value={condition} onChange={setCondition} />
              </Field>
              <Field label={t('buy.fPrice')} htmlFor="b-price" error={price.invalid ? t('add.invalidAmount') : touched && price.cents === null ? t('add.required') : null}>
                <Input id="b-price" money value={price.raw} onChange={(e) => price.setRaw(e.target.value)} placeholder="22" aria-invalid={price.invalid || (touched && price.cents === null)} />
              </Field>
            </div>
            <label className="row t-small" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
              <input type="checkbox" className="checkbox" checked={onVinted} onChange={(e) => setOnVinted(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                {t('buy.onVinted')}
                <span className="t-faint" style={{ display: 'block' }}>
                  {t('buy.onVintedHint')}
                </span>
              </span>
            </label>
            {onVinted && (
              <Field label={t('buy.shipping')} htmlFor="b-ship" optional>
                <Input id="b-ship" money value={shipping.raw} onChange={(e) => shipping.setRaw(e.target.value)} placeholder="—" />
              </Field>
            )}
            {cost !== null && (onVinted || shipping.cents) ? (
              <p className="t-small t-muted">
                {t('buy.landedCost')} <b className="num" style={{ color: 'var(--text)' }}>{money(cost)}</b>
              </p>
            ) : null}
            <Button type="submit" variant="primary" size="lg" block icon="target" loading={stage !== null && stage !== 'READY' && !result}>
              {t('buy.analyze')}
            </Button>
            {stage && <Stages stages={['COLLECTING', 'COMPARING', 'READY'] as Stage[]} current={result ? 'READY' : stage} labelKey={(s) => t(`buy.stage${s}`)} />}
          </form>
        </Card>

        <div className="span-8 stack-4">
          {error != null && <ErrorState error={error} />}
          {!result ? (
            <Card>
              <EmptyState art={<IllustrationBuy />} title={t('buy.empty')} why={t('buy.emptyWhy')} />
            </Card>
          ) : (
            <BuyResult r={result} onAdd={addToStock} saved={saved} />
          )}
        </div>
      </div>
    </>
  );
}

function BuyResult({ r, onAdd, saved }: { r: BuyAnalysis; onAdd: () => void; saved: boolean }) {
  const { t, money, pct } = useI18n();
  const fast = r.pricing.options.find((o) => o.strategy === 'FAST');
  const bal = r.pricing.options.find((o) => o.strategy === 'BALANCED');
  const tone = VERDICT_TONE[r.verdict];
  return (
    <>
      <section className={`reco reco--${tone === 'emerald' ? 'positive' : tone === 'amber' ? 'warning' : tone === 'coral' ? 'risk' : 'info'}`} aria-live="polite">
        <div className="row wrap" style={{ gap: 24, alignItems: 'center' }}>
          {r.dealScore ? (
            <Ring value={r.dealScore.total} max={100} size={112} stroke={9}>
              <span style={{ textAlign: 'center', lineHeight: 1 }}>
                <span className="num" style={{ fontSize: 34, fontWeight: 650, letterSpacing: '-0.03em', display: 'block' }}>
                  {r.dealScore.total}
                </span>
                <span className="t-faint t-small">/ 100</span>
              </span>
            </Ring>
          ) : null}
          <div className="grow" style={{ minWidth: 220 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="t-caption">{t('buy.dealScore')}</span>
              {r.analysis.source === 'DEMO' && <DemoBadge />}
            </div>
            <div className="t-h1" style={{ marginTop: 4 }}>
              {t(`buy.verdict.${r.verdict}`)}
            </div>
            <p className="t-muted" style={{ marginTop: 4 }}>
              {t(`buy.verdictHint.${r.verdict}`, { price: r.maxBuyCents })}
            </p>
          </div>
          {r.maxBuyCents !== null && (
            <Metric small label={t('buy.maxBuy')} help={t('buy.maxBuyHint')} value={<span className="num">{money(r.maxBuyCents)}</span>} />
          )}
        </div>
      </section>

      {r.dealScore && (
        <Card title={t('buy.dealScore')} icon="scale" tone="violet" hint={`${r.dealScore.total} / 100`}>
          <div className="score-bars" role="list">
            {r.dealScore.dimensions.map((d, k) => (
              <div key={d.key} role="listitem" style={{ display: 'contents' }}>
                <span className="t-small" style={{ fontWeight: 550 }}>
                  {t(`buy.dim.${d.key}`)}
                </span>
                <span>
                  <span className="score-bars__track" style={{ display: 'block' }} aria-hidden="true">
                    <span
                      className="score-bars__fill"
                      style={{
                        display: 'block',
                        width: `${(d.score / d.max) * 100}%`,
                        animationDelay: `${k * 60}ms`,
                        background: d.score / d.max >= 0.66 ? 'var(--emerald)' : d.score / d.max >= 0.4 ? 'var(--violet)' : 'var(--amber)',
                      }}
                    />
                  </span>
                  <span className="t-small t-faint" style={{ display: 'block', marginTop: 4 }}>
                    {t(d.reason, { ...d.params, quality: d.params.quality ? t(`compQuality.${d.params.quality}`).toLowerCase() : undefined })} · {t(`buy.evidence.${d.evidence}`)}
                  </span>
                </span>
                <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                  {d.score}/{d.max}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="kpi">
          <Metric small label={t('buy.purchase')} value={<span className="num">{money(r.input.purchasePriceCents)}</span>} />
        </div>
        <div className="kpi">
          <Metric small label={t('buy.positioning')} value={<span className="num">{bal ? money(bal.range.max) : '—'}</span>} foot={t('strategy.BALANCED')} />
        </div>
        <div className="kpi">
          <Metric small label={t('buy.fast')} value={<span className="num">{fast ? money(fast.range.min) : '—'}</span>} />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('buy.profit')}
            value={<span className={`num ${r.profit && r.profit.min < 0 ? 't-neg' : 't-pos'}`}>{r.profit ? `${money(r.profit.min)} – ${money(r.profit.max)}` : '—'}</span>}
            foot={r.roi ? `${t('buy.roi')} ${pct(r.roi.min)} – ${pct(r.roi.max)}` : null}
          />
        </div>
        <div className="kpi">
          <Metric small label={t('market.quality')} value={<Badge tone={r.analysis.quality === 'HIGH' ? 'emerald' : r.analysis.quality === 'MEDIUM' ? 'cyan' : r.analysis.quality === 'LOW' ? 'amber' : 'coral'}>{t(`compQuality.${r.analysis.quality}`)}</Badge>} foot={<Sample n={r.analysis.keptCount} />} />
        </div>
        <div className="kpi">
          <Metric small label={t('buy.demand')} value={t(`buy.level.${r.demand}`)} />
        </div>
        <div className="kpi">
          <Metric small label={t('buy.capitalRisk')} value={<span className={r.capitalRisk === 'HIGH' ? 't-neg' : r.capitalRisk === 'LOW' ? 't-pos' : 't-warn'}>{t(`buy.risk.${r.capitalRisk}`)}</span>} />
        </div>
        <div className="kpi">
          <Metric small label={t('market.supply')} value={<span className="num">{r.analysis.totalEntries === null ? '—' : r.analysis.totalCapped ? '≥ 960' : r.analysis.totalEntries}</span>} />
        </div>
      </div>

      <Card title={t('buy.personal')} icon="insights" tone="cyan">
        {r.personal ? (
          <div className="row wrap" style={{ gap: 28 }}>
            <Metric small label={t('insights.niche.avgBuy')} value={<span className="num">{money(r.personal.avgBuyCents)}</span>} />
            <Metric small label={t('insights.niche.avgSale')} value={<span className="num">{money(r.personal.avgSaleCents)}</span>} />
            <Metric small label={t('insights.niche.medianDays')} value={<span className="num">{r.personal.medianDays === null ? '—' : t('kpi.days', { n: Math.round(r.personal.medianDays) })}</span>} />
            <Metric small label={t('insights.niche.roi')} value={<span className="num">{pct(r.personal.roi)}</span>} />
            <Metric small label={t('insights.niche.sample')} value={<span className="num">{r.personal.sold}</span>} foot={r.personal.label} />
          </div>
        ) : (
          <p className="t-muted">{t('buy.noPersonal')}</p>
        )}
      </Card>

      {r.pricing.status === 'OK' && (
        <Card title={t('market.strategies')} icon="price" tone="violet" actions={<Button size="sm" variant="primary" icon={saved ? 'check' : 'plus'} disabled={saved} onClick={onAdd}>{saved ? t('buy.saved') : t('buy.save')}</Button>}>
          <StrategyCards pricing={r.pricing} />
        </Card>
      )}
      <details>
        <summary className="t-small t-muted" style={{ cursor: 'pointer' }}>
          {t('market.comparables')} ({r.analysis.keptCount})
        </summary>
        <div style={{ marginTop: 12 }}>
          <AnalysisView analysis={r.analysis} pricing={r.pricing} current={null} />
        </div>
      </details>
      {saved && (
        <Button variant="ghost" iconRight="chevronRight" onClick={() => go('stock')}>
          {t('nav.stock')}
        </Button>
      )}
    </>
  );
}
