import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { type SellerIdentity, db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { skuOf } from '@/intelligence/listing';
import { Button } from '@/ui/components/primitives';
import { go, useEra } from '../state';

/** A printable invoice (browser print → PDF). Built from the seller's own data; nothing leaves the device. */
export function Invoice({ saleId }: { saleId: string }) {
  const { t, money } = useI18n();
  // An invoice date always carries the year.
  const date = (ts: number) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
  const era = useEra();
  const row = useLiveQuery(() => db.invoices.get(saleId), [saleId]);
  const identity = useLiveQuery(() => repo.getSetting<SellerIdentity | null>('sellerIdentity', null), []);
  const sale = era.sales.find((s) => s.sale.id === saleId) ?? null;
  const [buyer, setBuyer] = useState('');
  useEffect(() => setBuyer(row?.buyer ?? ''), [row?.buyer]);

  if (row === undefined || identity === undefined) return null;
  if (!row || !sale) {
    return (
      <div className="invoice-shell">
        <p>{t('invoice.missing')}</p>
        <Button onClick={() => go('accounting')}>{t('accounting.title')}</Button>
      </div>
    );
  }
  const amount = sale.sale.salePriceCents;
  return (
    <div className="invoice-shell">
      <div className="invoice-bar no-print">
        <Button variant="ghost" icon="chevronLeft" onClick={() => go('accounting')}>
          {t('accounting.title')}
        </Button>
        <span className="grow" />
        {!identity?.name && <span className="t-small t-warn">{t('accounting.identityMissing')}</span>}
        <Button variant="primary" icon="upload" onClick={() => window.print()}>
          {t('invoice.print')}
        </Button>
      </div>
      <article className="invoice" aria-label={`${t('invoice.title')} ${row.number}`}>
        <header className="invoice__head">
          <div>
            <div className="invoice__seller">{identity?.name || t('invoice.sellerPlaceholder')}</div>
            {identity?.address && <div className="invoice__pre">{identity.address}</div>}
            {identity?.siret && <div>SIRET : {identity.siret}</div>}
            {identity?.email && <div>{identity.email}</div>}
          </div>
          <div className="invoice__meta">
            <div className="invoice__title">{t('invoice.title')}</div>
            <div>
              {t('invoice.number')} <b>{row.number}</b>
            </div>
            <div>
              {t('invoice.date')} {date(row.issuedAt)}
            </div>
          </div>
        </header>
        <section className="invoice__to">
          <div className="invoice__label">{t('invoice.buyer')}</div>
          <input className="invoice__input no-print-border" value={buyer} placeholder={t('invoice.buyerPh')} onChange={(e) => setBuyer(e.target.value)} onBlur={() => repo.setInvoiceBuyer(saleId, buyer)} aria-label={t('invoice.buyer')} />
        </section>
        <table className="invoice__table">
          <thead>
            <tr>
              <th>{t('invoice.designation')}</th>
              <th>{t('invoice.qty')}</th>
              <th>{t('invoice.unit')}</th>
              <th>{t('invoice.total')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {sale.item.title}
                <div className="invoice__small">
                  {t('invoice.ref')} {skuOf(sale.item.id)} · {t('invoice.soldOn', { d: date(sale.sale.soldAt) })}
                </div>
              </td>
              <td>1</td>
              <td>{money(amount)}</td>
              <td>{money(amount)}</td>
            </tr>
          </tbody>
        </table>
        <div className="invoice__sum">
          <div>
            <span>{t('invoice.totalDue')}</span>
            <b>{money(amount)}</b>
          </div>
          {identity?.vatExempt && <div className="invoice__small">{t('invoice.vatExempt')}</div>}
          <div className="invoice__small">{t('invoice.paid', { d: date(sale.sale.soldAt) })}</div>
        </div>
      </article>
    </div>
  );
}
