import { useMemo } from 'react';
import { useI18n } from '@/i18n';
import { NEGOTIATION_DEFAULT, portfolioFigures } from '@/intelligence/pro-figures';
import { Card, Metric } from '@/ui/components/primitives';
import { useEra } from '../state';
import { FillCostsLink, UnknownCost } from './missing-costs';

/**
 * The stock as a portfolio: this month's realised profit (known costs), the capital asleep in the stock, what the stock
 * could bring after the usual negotiation (an assumption, said), the time to sell — and the brands that pay best.
 */
export function PortfolioStrip() {
  const i = useI18n();
  const { t, money, pct } = i;
  const era = useEra();
  const f = useMemo(
    () =>
      portfolioFigures(
        era.views.map((v) => ({
          inStock: v.inStock,
          cost: v.cost,
          askPrice: v.askPrice,
          brand: v.item.brand,
          firstListedAt: v.firstListedAt,
          firstListedKnown: v.firstListedKnown,
          sale: v.sale ? { soldAt: v.sale.soldAt, salePriceCents: v.sale.salePriceCents, status: v.sale.status } : null,
        })),
        era.now,
      ),
    [era.views, era.now],
  );
  const monthName = new Date(era.now).toLocaleDateString('fr-FR', { month: 'long' });
  return (
    <div className="stack-4" data-testid="portfolio">
      <section className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} aria-label={t('portfolio.title')}>
        <div className="kpi">
          <Metric
            small
            label={t('portfolio.month', { month: monthName })}
            value={f.month.profitCents === null ? f.month.sales ? <UnknownCost n={f.month.missing} /> : <span className="num">—</span> : <span className="num">{money(f.month.profitCents, { sign: true })}</span>}
            foot={
              f.month.deltaPct !== null ? (
                <span className={`num ${f.month.deltaPct >= 0 ? 't-pos' : 't-neg'}`}>{t('portfolio.vsPrev', { pct: pct(f.month.deltaPct, { sign: true }) })}</span>
              ) : f.month.missing > 0 && f.month.profitCents !== null ? (
                <span>
                  {t('portfolio.atLeast')} <FillCostsLink n={f.month.missing} />
                </span>
              ) : (
                t('portfolio.salesN', { n: f.month.sales })
              )
            }
          />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('portfolio.immobilized')}
            value={f.immobilized.n > 0 && f.immobilized.missing === f.immobilized.n ? <UnknownCost n={f.immobilized.missing} /> : <span className="num">{money(f.immobilized.cents)}</span>}
            foot={
              f.immobilized.missing > 0 && f.immobilized.missing < f.immobilized.n ? (
                <span>
                  {t('portfolio.atLeast')} <FillCostsLink n={f.immobilized.missing} />
                </span>
              ) : (
                t('portfolio.itemsN', { n: f.immobilized.n })
              )
            }
          />
        </div>
        <div className="kpi">
          <Metric small label={t('portfolio.potential')} help={t('portfolio.potentialHint', { pct: Math.round(NEGOTIATION_DEFAULT * 100) })} value={<span className="num">{money(f.potential.cents)}</span>} foot={t('portfolio.potentialFoot', { pct: Math.round(NEGOTIATION_DEFAULT * 100) })} />
        </div>
        <div className="kpi">
          <Metric
            small
            label={t('portfolio.rotation')}
            value={<span className={`num ${f.rotation.days === null ? '' : f.rotation.days < 21 ? 't-pos' : 't-warn'}`}>{f.rotation.days === null ? '—' : t('kpi.days', { n: Math.round(f.rotation.days) })}</span>}
            foot={f.rotation.n ? t('portfolio.rotationFoot', { n: f.rotation.n }) : t('portfolio.rotationNone')}
          />
        </div>
      </section>
      <Card title={t('portfolio.brands')} hint={t('portfolio.brandsHint')} icon="target" tone="emerald">
        {f.brands.length === 0 ? (
          <p className="t-small t-muted" style={{ margin: 0 }}>
            {t('portfolio.brandsNone')}
          </p>
        ) : (
          <table className="dt" data-testid="brands-roi">
            <thead>
              <tr>
                <th>{t('portfolio.col.brand')}</th>
                <th className="num">{t('portfolio.col.roi')}</th>
                <th className="num">{t('portfolio.col.profit')}</th>
                <th className="num">{t('portfolio.col.sales')}</th>
                <th className="num">{t('portfolio.col.days')}</th>
              </tr>
            </thead>
            <tbody>
              {f.brands.map((b) => (
                <tr key={b.brand}>
                  <td>{b.brand}</td>
                  <td className="num">{pct(b.roi)}</td>
                  <td className="num">{money(b.profitCents, { sign: true })}</td>
                  <td className="num">{b.sales}</td>
                  <td className="num">{b.days === null ? '—' : `${i.num(b.days, 0)} j`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
