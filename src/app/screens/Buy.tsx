import { useState } from 'react';
import type { Category, Condition } from '@/domain/entities';
import { errorCode } from '@/data/adapters/marketplace';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type BuyAnalysis, analyzeBuy, buySubject } from '@/intelligence/buy';
import { personalEvidence, realizedFor } from '@/intelligence/seller-model';
import { Ring } from '@/ui/charts/charts';
import { IllustrationBuy } from '@/ui/components/illustrations';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorState, Field, Flag, Input, Stages } from '@/ui/components/primitives';
import { IconTile } from '@/ui/components/icons';
import { DualDistribution } from '@/ui/charts/dual';
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

const RISK_TONE = { HIGH: 'coral', MEDIUM: 'amber', LOW: 'emerald' } as const;

function BuyResult({ r, onAdd, saved }: { r: BuyAnalysis; onAdd: () => void; saved: boolean }) {
  const { t, money, pct, num } = useI18n();
  const era = useEra();
  const tone = VERDICT_TONE[r.verdict];
  const d = r.analysis.distribution;
  const realized = realizedFor(era.sales, { brand: r.input.brand, model: r.input.model, category: r.input.category });
  const expectedRoi = r.expectedProfitCents !== null && r.input.purchasePriceCents > 0 ? r.expectedProfitCents / r.input.purchasePriceCents : null;
  return (
    <>
      <section className={`verdict verdict--${tone}`} aria-live="polite">
        {r.dealScore ? (
          <Ring value={r.dealScore.total} max={100} size={120} stroke={10}>
            <span style={{ textAlign: 'center', lineHeight: 1 }}>
              <span className="num" style={{ fontSize: 36, fontWeight: 650, letterSpacing: '-0.03em', display: 'block' }}>
                {r.dealScore.total}
              </span>
              <span className="t-faint t-small">/ 100</span>
            </span>
          </Ring>
        ) : (
          <IconTile name="alert" tone="neutral" size="lg" />
        )}
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="t-caption">{t('buy.dealScore')}</span>
            {r.analysis.source === 'DEMO' && <DemoBadge />}
            {r.analysis.via && <Flag kind="UNVERIFIED" title={t('flag.learnedEndpoint')} />}
          </div>
          <div className="verdict__title">{t(`buy.verdict.${r.verdict}`)}</div>
          <p className="t-muted" style={{ marginTop: 4 }}>
            {t(`buy.verdictHint.${r.verdict}`, { price: r.maxBuyCents })}
          </p>
        </div>
        {r.maxBuyCents !== null && (
          <div className="verdict__max">
            <span className="t-caption">{t('buy.maxBuy')}</span>
            <span className="num verdict__maxv">{money(r.maxBuyCents)}</span>
            <span className="t-small t-faint">{t('buy.maxBuyHint')}</span>
          </div>
        )}
      </section>

      <section className="decision-grid" aria-label={t('buy.decision')}>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="trendUp" tone="emerald" size="sm" /> {t('buy.expectedProfit')}
          </span>
          <span className={`dtile__v num ${r.expectedProfitCents !== null && r.expectedProfitCents < 0 ? 't-neg' : 't-pos'}`}>{r.expectedProfitCents === null ? '—' : money(r.expectedProfitCents, { sign: true })}</span>
          <span className="dtile__f">{r.profit ? t('buy.profitRange', { min: r.profit.min, max: r.profit.max }) : t('buy.noMarket')}</span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="price" tone="violet" size="sm" /> {t('buy.roi')}
          </span>
          <span className="dtile__v num">{expectedRoi === null ? '—' : pct(expectedRoi)}</span>
          <span className="dtile__f">{r.roi ? `${pct(r.roi.min)} – ${pct(r.roi.max)}` : '—'}</span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="clock" tone="cobalt" size="sm" /> {t('buy.speed')}
          </span>
          <span className="dtile__v num">{r.speed ? t('buy.daysRange', { lo: r.speed.min, hi: r.speed.max }) : '—'}</span>
          <span className="dtile__f">{r.speed ? (r.speed.basis === 'PERSONAL' ? t('buy.speedPersonal', { n: r.speed.n }) : t('buy.speedDefault')) : '—'}</span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="capital" tone="amber" size="sm" /> {t('buy.yield30')}
          </span>
          <span className="dtile__v num">{r.yield30 === null ? '—' : pct(r.yield30)}</span>
          <span className="dtile__f">{t('buy.yield30Hint')}</span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="heart" tone="pink" size="sm" /> {t('buy.demand')}
          </span>
          <span className="dtile__v">{t(`buy.level.${r.demand}`)}</span>
          <span className="dtile__f">
            {r.demandDetail.avgFavorites === null ? t('buy.demandNoFav') : t('buy.demandFav', { fav: num(r.demandDetail.avgFavorites, 1), n: r.demandDetail.favoritesSample })}
            {' · '}
            {r.demandDetail.supplyCapped ? t('buy.supplyCapped') : r.demandDetail.supply !== null ? t('buy.supply', { n: r.demandDetail.supply }) : t('buy.supplyUnknown')}
            {r.demandDetail.sellThrough !== null ? ` · ${t('buy.sellThrough', { pct: Math.round(r.demandDetail.sellThrough * 100), n: r.demandDetail.personalSold })}` : ''}
          </span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="trap" tone={RISK_TONE[r.capitalRisk]} size="sm" /> {t('buy.capitalRisk')}
          </span>
          <span className={`dtile__v ${r.capitalRisk === 'HIGH' ? 't-neg' : r.capitalRisk === 'LOW' ? 't-pos' : 't-warn'}`}>{t(`buy.risk.${r.capitalRisk}`)}</span>
          <span className="dtile__f row wrap" style={{ gap: 4 }}>
            {r.capitalRiskReasons.length === 0 ? t('buy.riskNone') : r.capitalRiskReasons.map((x) => <Badge key={x} tone={x === 'HIGH_COST' ? 'violet' : 'amber'}>{t(`buy.riskReason.${x}`)}</Badge>)}
          </span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="market" tone="cyan" size="sm" /> {t('market.quality')}
          </span>
          <span className="dtile__v">
            <Badge tone={r.analysis.quality === 'HIGH' ? 'emerald' : r.analysis.quality === 'MEDIUM' ? 'cyan' : r.analysis.quality === 'LOW' ? 'amber' : 'coral'}>{t(`compQuality.${r.analysis.quality}`)}</Badge>
          </span>
          <span className="dtile__f">{t('buy.compLine', { n: r.analysis.keptCount, eff: r.analysis.effectiveSample, collected: r.analysis.collected })}</span>
        </div>
        <div className="dtile">
          <span className="dtile__k">
            <IconTile name="buy" tone="neutral" size="sm" /> {t('buy.purchase')}
          </span>
          <span className="dtile__v num">{money(r.input.purchasePriceCents)}</span>
          <span className="dtile__f">{d ? t('buy.vsMedian', { pct: Math.round((r.input.purchasePriceCents / d.p50) * 100) }) : '—'}</span>
        </div>
      </section>

      {d && r.analysis.quality !== 'INSUFFICIENT' && (
        <Card title={t('buy.distribution')} hint={t('buy.distributionHint')} icon="compare" tone="cyan">
          <DualDistribution
            title={t('buy.distribution')}
            asking={{ points: r.analysis.comparables.filter((c) => c.kept).map((c) => ({ v: c.candidate.priceCents, w: c.similarity, label: c.candidate.title })), q: { p25: d.p25, p50: d.p50, p75: d.p75 } }}
            realized={{ points: realized?.points ?? [] }}
            realizedScope={realized ? t(`dual.scope.${realized.scope}`) : null}
            current={r.input.purchasePriceCents}
            currentLabel={t('buy.purchase')}
            format={(x) => money(Math.round(x / 100) * 100)}
          />
        </Card>
      )}

      {r.strategies.length > 0 && (
        <Card
          title={t('buy.strategies')}
          hint={t('buy.strategiesHint')}
          icon="price"
          tone="violet"
          actions={
            <Button size="sm" variant="primary" icon={saved ? 'check' : 'plus'} disabled={saved} onClick={onAdd}>
              {saved ? t('buy.saved') : t('buy.save')}
            </Button>
          }
        >
          <div className="strat-table" role="table">
            <div className="strat-table__head" role="row">
              <span role="columnheader">{t('buy.strategy')}</span>
              <span role="columnheader">{t('buy.askRange')}</span>
              <span role="columnheader">{t('buy.delay')}</span>
              <span role="columnheader">{t('buy.profit')}</span>
              <span role="columnheader">{t('buy.roi')}</span>
            </div>
            {r.strategies.map((s) => (
              <div key={s.strategy} role="row" className={`strat-table__row ${r.pricing.recommended === s.strategy ? 'is-rec' : ''}`}>
                <span role="cell" className="strat-table__name">
                  {t(`strategy.${s.strategy}`)}
                  {r.pricing.recommended === s.strategy && <Badge tone="violet">{t('buy.recommended')}</Badge>}
                </span>
                <span role="cell" className="num">
                  {money(s.range.min)} – {money(s.range.max)}
                </span>
                <span role="cell" className="num">
                  {t('buy.daysRange', { lo: s.days.min, hi: s.days.max })}
                </span>
                <span role="cell" className={`num ${s.profit.min < 0 ? 't-neg' : 't-pos'}`}>
                  {money(s.profit.min, { sign: true })} – {money(s.profit.max, { sign: true })}
                </span>
                <span role="cell" className="num">
                  {s.roi ? `${pct(s.roi.min)} – ${pct(s.roi.max)}` : '—'}
                </span>
              </div>
            ))}
          </div>
          <p className="t-small t-faint" style={{ marginTop: 10 }}>
            {t('buy.strategiesNote')}
          </p>
        </Card>
      )}

      {r.dealScore && (
        <Card title={t('buy.scoreHow')} hint={t('buy.scoreHowHint', { total: r.dealScore.total })} icon="scale" tone="violet">
          <div className="score-bars" role="list">
            {r.dealScore.dimensions.map((dm, k) => (
              <div key={dm.key} role="listitem" style={{ display: 'contents' }}>
                <span className="t-small" style={{ fontWeight: 600 }}>
                  <span>{t(`buy.dim.${dm.key}`)}</span>
                  <span className="t-faint" style={{ display: 'block', fontWeight: 400, fontSize: 11.5 }}>
                    {t(`buy.evidence.${dm.evidence}`)}
                  </span>
                </span>
                <span>
                  <span className="score-bars__track" style={{ display: 'block' }} aria-hidden="true">
                    <span
                      className="score-bars__fill"
                      style={{
                        display: 'block',
                        width: `${(dm.score / dm.max) * 100}%`,
                        animationDelay: `${k * 60}ms`,
                        background: dm.score / dm.max >= 0.66 ? 'var(--emerald)' : dm.score / dm.max >= 0.4 ? 'var(--violet)' : 'var(--amber)',
                      }}
                    />
                  </span>
                  <span className="t-small t-muted" style={{ display: 'block', marginTop: 4 }}>
                    {t(dm.reason, { ...dm.params, quality: dm.params.quality ? t(`compQuality.${dm.params.quality}`).toLowerCase() : undefined })}
                  </span>
                  <span className="t-small t-faint" style={{ display: 'block', marginTop: 2 }}>
                    {t(`buy.rule.${dm.key}`)}
                  </span>
                </span>
                <span className="num" style={{ textAlign: 'right', fontWeight: 650 }}>
                  {dm.score}
                  <span className="t-faint">/{dm.max}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="score-sum">
            <span>{t('buy.scoreSum')}</span>
            <span className="num">
              {r.dealScore.dimensions.map((x) => x.score).join(' + ')} = <b>{r.dealScore.total}</b>
            </span>
          </div>
          <p className="t-small t-faint" style={{ marginTop: 8 }}>
            {t('buy.verdictRule')}
          </p>
        </Card>
      )}

      <Card title={t('buy.marketVsYou')} hint={t('buy.marketVsYouHint')} icon="compare" tone="cyan">
        <div className="mvy">
          <div className="mvy__side mvy__side--market">
            <span className="mvy__tag">{t('mvy.market')}</span>
            <span className="mvy__v num">{d ? money(d.p50) : '—'}</span>
            <span className="t-small t-muted">{t('mvy.askingMedian', { n: r.analysis.keptCount })}</span>
          </div>
          <div className="mvy__side mvy__side--you">
            <span className="mvy__tag">{t('mvy.you')}</span>
            <span className="mvy__v num">{r.personal?.medianSaleCents != null ? money(r.personal.medianSaleCents) : '—'}</span>
            <span className="t-small t-muted">
              {r.personal
                ? `${t('mvy.realizedMedian', { n: r.personal.sold, scope: r.personal.label })}${r.personal.medianDays != null ? ` · ${t('mvy.soldIn', { n: Math.round(r.personal.medianDays) })}` : ''}${r.personal.roi != null ? ` · ROI ${pct(r.personal.roi)}` : ''}`
                : t('buy.noPersonal')}
            </span>
          </div>
        </div>
      </Card>

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
