import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { DomainEvent } from '@/domain/entities';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { skuOf } from '@/intelligence/listing';
import { shippingChecklist } from '@/intelligence/shipping';
import { draftDescription, measureFields } from '@/intelligence/workshop';
import { Button } from '@/ui/components/primitives';
import { go, useEra } from '../state';

/**
 * "Dossier d'envoi": everything ERA recorded about one sale, on one printable page, for a dispute — the article
 * as described, the checks ticked before closing the parcel (with their time), the dates, the conversation.
 * Only what was recorded: an unticked check says so; photos stay on Vinted and on the seller's phone.
 */
export function Dossier({ saleId }: { saleId: string }) {
  const { t, money } = useI18n();
  const dt = (ts: number) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts);
  const day = (ts: number) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
  const era = useEra();
  const sv = era.sales.find((s) => s.sale.id === saleId) ?? null;
  const checks = useLiveQuery(() => repo.getSetting<Record<string, string[]>>('shipChecks', {}), []);
  const checksAt = useLiveQuery(() => repo.getSetting<Record<string, Record<string, number>>>('shipChecksAt', {}), []);
  const events = useLiveQuery(async (): Promise<DomainEvent[]> => (sv ? db.events.where('inventoryItemId').equals(sv.item.id).sortBy('at') : []), [sv?.item.id]);
  if (checks === undefined || checksAt === undefined || events === undefined) return null;
  if (!sv) {
    return (
      <div className="invoice-shell">
        <p>{t('dossier.missing')}</p>
        <Button onClick={() => go('sales')}>{t('nav.sales')}</Button>
      </div>
    );
  }
  const { sale, item } = sv;
  const v = era.viewById.get(item.id);
  const listing = v?.listings.find((l) => l.id === sale.listingId) ?? v?.listings[v.listings.length - 1] ?? null;
  const prep = era.preps.get(item.id) ?? null;
  const guards = era.refunds.guards.map((g) => g.guard);
  const { checks: keys } = shippingChecklist(guards);
  const ticked = new Set(checks[sale.id] ?? []);
  const at = checksAt[sale.id] ?? {};
  const measures = measureFields(item.category)
    .map((k) => ({ k, v: prep?.measures[k]?.trim() ?? '' }))
    .filter((m) => m.v);
  const description = prep ? draftDescription(item, prep, guards, (k) => t(`workshop.m.${k}`)) : null;

  // What a dispute is about: the listing's life and the sale — not ERA's own predictions or analyses.
  const facts = events.filter((e) => ['LISTING_PUBLISHED', 'PRICE_CHANGED', 'LISTING_REMOVED', 'LISTING_REPUBLISHED', 'ITEM_SOLD', 'SALE_REFUNDED', 'STATUS_CHANGED'].includes(e.type));

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="dossier__row">
      <span className="invoice__label">{label}</span>
      <span>{children}</span>
    </div>
  );

  return (
    <div className="invoice-shell">
      <div className="invoice-bar no-print">
        <Button variant="ghost" icon="chevronLeft" onClick={() => history.back()}>
          {t('dossier.back')}
        </Button>
        <span className="grow" />
        <Button variant="primary" icon="download" onClick={() => window.print()}>
          {t('dossier.print')}
        </Button>
      </div>
      <article className="invoice" data-testid="dossier" aria-label={t('dossier.title')}>
        <header className="invoice__head">
          <div>
            <div className="invoice__title">{t('dossier.title')}</div>
            <div className="invoice__small">{t('dossier.sub')}</div>
            {sale.isDemo && <div className="invoice__small" style={{ color: '#b91c1c', fontWeight: 700 }}>{t('dossier.demo')}</div>}
          </div>
          <div className="invoice__meta">
            <div>
              {t('dossier.ref')} <b>{skuOf(item.id)}</b>
            </div>
            <div className="invoice__small">{t('dossier.made', { d: dt(Date.now()) })}</div>
          </div>
        </header>

        <section className="dossier__section">
          <h2 className="dossier__h">{t('dossier.article')}</h2>
          <Row label={t('dossier.titleL')}>{item.title}</Row>
          <Row label={t('dossier.brand')}>{item.brand}</Row>
          <Row label={t('dossier.size')}>{item.size ?? t('dossier.notRecorded')}</Row>
          <Row label={t('dossier.condition')}>{item.condition ? t(`condition.${item.condition}`) : t('dossier.notRecorded')}</Row>
          <Row label={t('dossier.defects')}>{prep?.defects.trim() || (prep?.checks.includes('photoDefects') ? t('dossier.noDefect') : t('dossier.notRecorded'))}</Row>
          <Row label={t('dossier.measures')}>{measures.length ? measures.map((m) => `${t(`workshop.m.${m.k}`)} ${m.v} cm`).join(' · ') : t('dossier.notRecorded')}</Row>
          {prep?.material.trim() && <Row label={t('dossier.material')}>{prep.material}</Row>}
        </section>

        <section className="dossier__section">
          <h2 className="dossier__h">{t('dossier.listing')}</h2>
          {listing ? (
            <>
              <Row label={t('dossier.listedAt')}>
                {day(listing.listedAt)}
                {listing.listedAtKnown === false ? ` (${t('dossier.approx')})` : ''}
              </Row>
              <Row label={t('dossier.lastPrice')}>{money(listing.priceCents)}</Row>
              {listing.url && <Row label={t('dossier.link')}>{listing.url}</Row>}
            </>
          ) : (
            <p className="invoice__small">{t('dossier.noListing')}</p>
          )}
          {description && (
            <>
              <div className="invoice__label" style={{ marginTop: 8 }}>
                {t('dossier.description')}
              </div>
              <pre className="dossier__pre">{description}</pre>
            </>
          )}
        </section>

        <section className="dossier__section">
          <h2 className="dossier__h">{t('dossier.sale')}</h2>
          <Row label={t('dossier.soldAt')}>{sale.dateKnown === false ? t('dossier.notRecorded') : day(sale.soldAt)}</Row>
          <Row label={t('dossier.price')}>{money(sale.salePriceCents)}</Row>
          {sale.vintedStatus && <Row label={t('dossier.status')}>{sale.vintedStatus}</Row>}
          {sale.vintedConversationId && <Row label={t('dossier.conversation')}>{`https://www.vinted.fr/inbox/${sale.vintedConversationId}`}</Row>}
          {sale.status === 'REFUNDED' && <Row label={t('dossier.refund')}>{sale.refundReason ? t(`refunds.r.${sale.refundReason}`) : t('dossier.refunded')}</Row>}
        </section>

        <section className="dossier__section">
          <h2 className="dossier__h">{t('dossier.checks')}</h2>
          <ul className="dossier__checks">
            {keys.map((k) => (
              <li key={k} className={ticked.has(k) ? 'is-done' : ''}>
                <span aria-hidden="true">{ticked.has(k) ? '☑' : '☐'}</span> {t(`ship.c.${k}`)}
                <span className="invoice__small"> — {ticked.has(k) ? (at[k] ? t('dossier.tickedAt', { d: dt(at[k]!) }) : t('dossier.ticked')) : t('dossier.notTicked')}</span>
              </li>
            ))}
          </ul>
        </section>

        {facts.length > 0 && (
          <section className="dossier__section">
            <h2 className="dossier__h">{t('dossier.history')}</h2>
            <ul className="dossier__events">
              {facts.map((e) => (
                <li key={e.id}>
                  <span className="num">{day(e.at)}</span> {t(`timeline.${e.type}`)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="invoice__small" style={{ marginTop: 24 }}>
          {t('dossier.honest')}
        </p>
      </article>
    </div>
  );
}
