import { useI18n } from '@/i18n';
import { type ShoppingLine, shoppingList } from '@/intelligence/shopping';
import { Badge, Card, EmptyState, Money, Sample } from '@/ui/components/primitives';
import { useEra } from '../state';

/** What to buy again, from the seller's own sales: niche, what it cashes in, how fast, the most to pay. */
export function ShoppingListView() {
  const { t } = useI18n();
  const era = useEra();
  const list = shoppingList(era.model);

  const row = (l: ShoppingLine, tone: 'buy' | 'avoid') => (
    <tr key={l.key}>
      <td>
        <span style={{ fontWeight: 600 }}>{l.label}</span>
        <div className="t-small t-faint">{t(`shopping.why.${l.why.code}`, l.why.params)}</div>
      </td>
      <td className="num">
        <Money cents={l.medianSaleCents} />
      </td>
      <td className="num">{l.medianDays === null ? '—' : t('kpi.days', { n: Math.round(l.medianDays) })}</td>
      <td className="num">{l.profitPerDayCents === null ? <span className="t-faint">{t('shopping.unknownProfit')}</span> : <Money cents={l.profitPerDayCents} />}</td>
      <td className="num">{l.inStock}</td>
      <td className="num" style={{ fontWeight: tone === 'buy' ? 700 : 400 }}>
        {tone === 'buy' ? (
          <>
            <Money cents={l.maxVintedPriceCents} />
            <div className="t-small t-faint">{t('shopping.landed', { amount: l.maxLandedCents })}</div>
          </>
        ) : (
          '—'
        )}
      </td>
      <td>
        <Sample n={l.sold} />
      </td>
    </tr>
  );

  const table = (rows: ShoppingLine[], tone: 'buy' | 'avoid') => (
    <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
      <table className="dt dt--compact" data-testid={`shopping-${tone}`}>
        <thead>
          <tr>
            <th>{t('shopping.col.niche')}</th>
            <th>{t('shopping.col.sale')}</th>
            <th>{t('shopping.col.days')}</th>
            <th>{t('shopping.col.perDay')}</th>
            <th>{t('shopping.col.stock')}</th>
            <th>{t('shopping.col.max')}</th>
            <th>{t('shopping.col.n')}</th>
          </tr>
        </thead>
        <tbody>{rows.map((l) => row(l, tone))}</tbody>
      </table>
    </div>
  );

  if (!list.buy.length && !list.avoid.length)
    return (
      <Card>
        <EmptyState title={t('shopping.emptyTitle')} why={t('shopping.emptyWhy', { n: list.unsure })} />
      </Card>
    );

  return (
    <div className="stack-4">
      <Card title={t('shopping.buyTitle')} hint={t('shopping.buyHint', { n: list.basis })} icon="buy" tone="emerald" flush>
        {list.buy.length ? table(list.buy, 'buy') : <p className="t-small t-muted" style={{ padding: 16 }}>{t('shopping.noneToBuy')}</p>}
      </Card>
      {list.avoid.length > 0 && (
        <Card title={t('shopping.avoidTitle')} hint={t('shopping.avoidHint')} icon="alert" tone="coral" flush>
          {table(list.avoid, 'avoid')}
        </Card>
      )}
      <p className="t-small t-faint row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="neutral">{t('shopping.rule')}</Badge> {list.unsure > 0 && t('shopping.unsure', { n: list.unsure })}
      </p>
    </div>
  );
}
