import { useState } from 'react';
import { useI18n } from '@/i18n';
import { type Deal, type ShoppingLine, findDeals, shoppingList } from '@/intelligence/shopping';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorState, Money, Sample } from '@/ui/components/primitives';
import { marketAdapter } from '../market-run';
import { go, useEra } from '../state';

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

const SCAN_NICHES = 5;

/**
 * One click: the best niches of the shopping list searched on Vinted (read-only, one search each, newest first),
 * and only the listings whose all-in cost stays under the niche's maximum.
 */
export function DealScanner() {
  const { t } = useI18n();
  const era = useEra();
  const top = shoppingList(era.model).buy.slice(0, SCAN_NICHES);
  const [busy, setBusy] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [demo, setDemo] = useState(false);

  const scan = async () => {
    setError(null);
    setDeals(null);
    const adapter = marketAdapter(era.mode, false);
    setDemo(adapter.isDemo);
    const own = new Set(era.views.flatMap((v) => v.listings.map((l) => l.platformListingId).filter((x): x is string => !!x)));
    const found: Deal[] = [];
    try {
      for (const l of top) {
        setBusy(l.label);
        const r = await adapter.searchComparables({ text: l.label, brand: l.brand ?? '', category: l.category, gender: null, size: null, condition: null });
        found.push(...findDeals(l, r, own));
      }
      setDeals(found.sort((a, b) => b.marginCents - a.marginCents));
    } catch (e) {
      setError(e);
      if (found.length) setDeals(found);
    } finally {
      setBusy(null);
    }
  };

  if (!top.length)
    return (
      <Card>
        <EmptyState title={t('scanner.emptyTitle')} why={t('scanner.emptyWhy')} action={<Button variant="ghost" onClick={() => go('buy?tab=list')}>{t('shopping.tabList')}</Button>} />
      </Card>
    );

  return (
    <div className="stack-4">
      <Card title={t('scanner.title')} hint={t('scanner.hint', { n: top.length })} icon="target" tone="cyan">
        <div className="stack">
          <p className="t-small t-muted">{top.map((l) => `${l.label} ≤ ${(l.maxVintedPriceCents / 100).toFixed(0)} €`).join(' · ')}</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Button variant="primary" icon="target" loading={busy !== null} onClick={scan}>
              {busy ? t('scanner.scanning', { niche: busy }) : t('scanner.run', { n: top.length })}
            </Button>
            {demo && <DemoBadge />}
          </div>
          {error != null && <ErrorState error={error} />}
        </div>
      </Card>
      {deals && (
        <Card title={t('scanner.results', { n: deals.length })} hint={t('scanner.resultsHint')} icon="buy" tone="emerald" flush>
          {deals.length === 0 ? (
            <p className="t-small t-muted" style={{ padding: 16 }}>
              {t('scanner.none')}
            </p>
          ) : (
            <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="dt dt--compact" data-testid="deals">
                <thead>
                  <tr>
                    <th>{t('scanner.col.listing')}</th>
                    <th>{t('scanner.col.price')}</th>
                    <th>{t('scanner.col.landed')}</th>
                    <th>{t('scanner.col.max')}</th>
                    <th>{t('scanner.col.margin')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => (
                    <tr key={`${d.niche}:${d.candidate.id}`}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{d.candidate.title}</span>
                        <div className="t-small t-faint">
                          {d.niche}
                          {d.candidate.size ? ` · ${d.candidate.size}` : ''}
                        </div>
                      </td>
                      <td className="num">
                        <Money cents={d.candidate.priceCents} />
                      </td>
                      <td className="num">
                        <Money cents={d.landedCents} />
                      </td>
                      <td className="num t-muted">
                        <Money cents={d.maxLandedCents} />
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        <Money cents={d.marginCents} sign />
                      </td>
                      <td>
                        {!demo && (
                          <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(d.candidate.url ?? `https://www.vinted.fr/items/${d.candidate.id}`, '_blank', 'noopener')}>
                            {t('scanner.open')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <p className="t-small t-faint">{t('scanner.rule')}</p>
    </div>
  );
}
