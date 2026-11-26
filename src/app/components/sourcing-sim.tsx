import { useState } from 'react';
import { useI18n } from '@/i18n';
import { simulateSourcing } from '@/intelligence/sourcing-sim';
import { Field, Input, Select } from '@/ui/components/primitives';
import { useEra } from '../state';
import { useMoneyField } from './forms';

/**
 * « Est-ce que j'achète ? » — Outils → Calculateur sourcing: three amounts in, the verdict out at once. The resale can be
 * taken from a market analysis ERA already made (its median); nothing is fetched, nothing saved.
 */
export function SourcingSimulator() {
  const { t, money, pct, num } = useI18n();
  const era = useEra();
  const buy = useMoneyField(null);
  const fees = useMoneyField(0);
  const resale = useMoneyField(null);
  const [onVinted, setOnVinted] = useState(false);
  // The market analyses ERA kept: their median asking price, as a resale estimate.
  const analysed = era.intel.filter((i) => i.analysis?.distribution?.p50 != null && (i.analysis?.keptCount ?? 0) > 0);
  const r = buy.cents !== null && resale.cents !== null && !buy.invalid && !resale.invalid && !fees.invalid ? simulateSourcing({ buyCents: buy.cents, feesCents: fees.cents ?? 0, resaleCents: resale.cents, onVinted }) : null;
  const tone = r ? ({ GO: 'is-go', NEGOTIATE: 'is-nego', PASS: 'is-pass' } as const)[r.verdict] : '';
  return (
    <div className="stack-3" data-testid="sourcing-sim">
      <div className="sim__inputs">
        <Field label={t('sim.buy')} htmlFor="sim-buy" error={buy.invalid ? t('add.invalidAmount') : null}>
          <Input id="sim-buy" money value={buy.raw} onChange={(e) => buy.setRaw(e.target.value)} placeholder="12" />
        </Field>
        <Field label={t('sim.fees')} htmlFor="sim-fees" error={fees.invalid ? t('add.invalidAmount') : null}>
          <Input id="sim-fees" money value={fees.raw} onChange={(e) => fees.setRaw(e.target.value)} placeholder="0" />
        </Field>
        <Field label={t('sim.resale')} htmlFor="sim-resale" error={resale.invalid ? t('add.invalidAmount') : null}>
          <Input id="sim-resale" money value={resale.raw} onChange={(e) => resale.setRaw(e.target.value)} placeholder="45" />
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="row t-small" style={{ gap: 8 }}>
          <input type="checkbox" className="checkbox" checked={onVinted} onChange={(e) => setOnVinted(e.target.checked)} />
          {t('sim.onVinted')}
        </label>
        {analysed.length > 0 && (
          <Select
            aria-label={t('sim.fromAnalysis')}
            value=""
            onChange={(e) => {
              const a = analysed.find((i) => i.view.item.id === e.target.value)?.analysis?.distribution?.p50;
              if (a != null) resale.setRaw(num(Math.round(a) / 100, 2));
            }}
            options={[{ value: '', label: t('sim.fromAnalysis') }, ...analysed.map((i) => ({ value: i.view.item.id, label: `${i.view.item.title} · ${money(i.analysis!.distribution!.p50)}` }))]}
          />
        )}
      </div>
      {r ? (
        <div className="sim__out" aria-live="polite">
          <div className="sim__cells">
            <div className="sim__cell">
              <span className="t-caption">{t('sim.profit')}</span>
              <b className="num" data-testid="sim-profit">{money(r.profitCents, { sign: true })}</b>
            </div>
            <div className="sim__cell">
              <span className="t-caption">{t('sim.roi')}</span>
              <b className="num" data-testid="sim-roi">{r.roi === null ? '—' : pct(r.roi)}</b>
            </div>
            <div className="sim__cell">
              <span className="t-caption">{t('sim.multiple')}</span>
              <b className="num" data-testid="sim-multiple">{r.multiple === null ? '—' : `x${num(r.multiple, 1)}`}</b>
            </div>
          </div>
          <p className={`sim__verdict ${tone}`} data-testid="sim-verdict">
            <span aria-hidden="true">●</span> {t(`sim.v.${r.verdict}`)}
          </p>
          <p className="t-small t-muted">
            {r.verdict === 'GO'
              ? t('sim.why.GO')
              : r.maxBuyCents !== null
                ? t('sim.maxBuy', { price: money(r.maxBuyCents) })
                : t('sim.noPrice')}
          </p>
          <p className="t-small t-faint">{t('sim.basis', { resale: money(r.netResaleCents), cost: money(r.costCents) })}</p>
        </div>
      ) : (
        <p className="t-small t-faint">{t('sim.empty')}</p>
      )}
    </div>
  );
}
