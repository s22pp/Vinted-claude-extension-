import { useState } from 'react';
import { REFUND_REASONS, type RefundReason } from '@/domain/entities';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { SaleView } from '@/intelligence/portfolio';
import { BarChart } from '@/ui/charts/charts';
import { useToast } from '@/ui/components/overlays';
import { Badge, Card, Metric, Money } from '@/ui/components/primitives';
import { ItemCell } from './domain';
import { useEra } from '../state';

/** One click per refund: the reason becomes a rule in the listing workshop once it repeats. */
export function ReasonChips({ saleId, current, onDone }: { saleId: string; current: RefundReason | null | undefined; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <div className="reason-chips" role="group" aria-label={t('refunds.reason')}>
      {REFUND_REASONS.map((r) => (
        <button
          key={r}
          type="button"
          className="chip"
          aria-pressed={current === r}
          onClick={async () => {
            await repo.setRefundReason(saleId, r);
            toast('success', t('refunds.saved'), t(`refunds.r.${r}`));
            onDone?.();
          }}
        >
          {t(`refunds.r.${r}`)}
        </button>
      ))}
    </div>
  );
}

export function RefundsCard({ highlight }: { highlight?: boolean }) {
  const { t, pct } = useI18n();
  const era = useEra();
  const s = era.refunds;
  const [showAll, setShowAll] = useState(false);
  if (s.refunded === 0) return null;
  const refunded = era.sales.filter((x) => x.sale.status === 'REFUNDED').sort((a, b) => b.sale.soldAt - a.sale.soldAt);
  const missing = refunded.filter((x) => !x.sale.refundReason);
  const qualified = refunded.filter((x) => x.sale.refundReason);
  return (
    <Card id="refunds" className={highlight ? 'card--highlight' : undefined} title={t('refunds.title')} hint={t('refunds.hint')} icon="alert" tone="coral">
      <div className="stack-4">
        <div className="row wrap" style={{ gap: 32 }}>
          <Metric small label={t('refunds.rate')} value={<span className="num">{s.rate === null ? '—' : pct(s.rate, { digits: 1 })}</span>} foot={t('refunds.rateFoot', { r: s.refunded, n: s.sales })} />
          <Metric small label={t('refunds.amount')} value={<Money cents={s.refundedCents} />} foot={t('refunds.amountFoot')} />
          <Metric small label={t('refunds.qualified')} value={<span className="num">{s.withReason}/{s.refunded}</span>} foot={missing.length ? t('refunds.toQualify', { n: missing.length }) : t('refunds.allQualified')} />
        </div>

        {missing.length > 0 && (
          <section>
            <div className="t-caption" style={{ marginBottom: 8 }}>
              {t('refunds.toQualifyTitle')}
            </div>
            <div className="list">
              {missing.slice(0, 8).map((x) => (
                <RefundRow key={x.sale.id} x={x} />
              ))}
            </div>
          </section>
        )}

        <div className="grid-12">
          <div className="span-6">
            <div className="t-caption" style={{ marginBottom: 8 }}>
              {t('refunds.byReason')}
            </div>
            {s.byReason.length ? (
              <BarChart title={t('refunds.byReason')} data={s.byReason.map((r) => ({ label: t(`refunds.r.${r.reason}`), value: r.n, color: 'var(--coral)' }))} format={(v) => String(Math.round(v))} />
            ) : (
              <p className="t-small t-muted">{t('refunds.noReasonsYet')}</p>
            )}
          </div>
          <div className="span-6 stack-3">
            <div className="t-caption">{t('refunds.rules')}</div>
            {s.guards.length ? (
              s.guards.map((g) => (
                <div key={g.guard} className="rule-row">
                  <Badge tone="coral">{t(`refunds.r.${g.reason}`)} ×{g.n}</Badge>
                  <span className="t-small">→ {t(`workshop.guard.${g.guard}`, { n: g.n })}</span>
                </div>
              ))
            ) : (
              <p className="t-small t-muted">{t('refunds.rulesNone')}</p>
            )}
            {s.segments.length > 0 && (
              <>
                <div className="t-caption" style={{ marginTop: 8 }}>
                  {t('refunds.segments')}
                </div>
                {s.segments.map((g) => (
                  <div key={`${g.dim}:${g.key}`} className="rule-row">
                    <span className="t-small" style={{ fontWeight: 600 }}>
                      {g.label}
                    </span>
                    <span className="t-small t-muted num">{t('refunds.segmentLine', { r: g.refunded, n: g.sales, pct: pct(g.rate) })}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {qualified.length > 0 && (
          <details open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
            <summary className="t-small t-muted" style={{ cursor: 'pointer' }}>
              {t('refunds.qualifiedList', { n: qualified.length })}
            </summary>
            <div className="list" style={{ marginTop: 8 }}>
              {qualified.slice(0, 30).map((x) => (
                <RefundRow key={x.sale.id} x={x} />
              ))}
            </div>
          </details>
        )}
        <p className="t-small t-faint">{t('refunds.note')}</p>
      </div>
    </Card>
  );
}

function RefundRow({ x }: { x: SaleView }) {
  const { date } = useI18n();
  return (
    <div className="list__row refund-row" style={{ cursor: 'default' }}>
      <ItemCell item={x.item} sub={`${date(x.sale.soldAt)} · ${x.item.brand}`} />
      <Money cents={x.sale.salePriceCents} />
      <ReasonChips saleId={x.sale.id} current={x.sale.refundReason} />
    </div>
  );
}
