import { useState } from 'react';
import { useI18n } from '@/i18n';
import { publishedAgo } from '@/intelligence/repost-now';
import { rotation } from '@/intelligence/pro-figures';
import { Thumb } from '@/ui/components/Thumb';
import { StatusBadge } from './domain';
import type { Row } from './stock-table';

/** One archive card: its index and state, the photo Vinted shows (as is, never retouched), then name, maker, price. */
function Look({ r, index }: { r: Row; index: number }) {
  const { t, money } = useI18n();
  const v = r.v;
  const [failed, setFailed] = useState(false);
  const photo = v.item.photoUrl && !v.item.photoUrl.startsWith('demo:') && !failed ? v.item.photoUrl : null;
  const when = v.current && v.current.listedAtKnown !== false ? publishedAgo(v.current.listedAt, Date.now()) : null;
  const favs = v.current?.favorites ?? null;
  const price = v.askPrice ?? v.sale?.salePriceCents ?? null;
  // The margin: what is left over the purchase cost — unknown while the cost is (never shown as zero).
  const margin = v.sale ? (v.cost === null ? null : v.sale.salePriceCents - v.cost) : v.inStock ? v.potentialProfit : null;
  const rot = v.item.status === 'LISTED' ? rotation(v.daysListed, favs, null).state : null;
  const state = v.item.status === 'SOLD' ? 'sold' : rot === 'STALE' ? 'stale' : v.item.status === 'LISTED' ? 'live' : 'other';
  return (
    <li className="look" data-state={state}>
      <a href={`#/item/${v.item.id}`} className="look__link">
        <span className="look__head">
          <span className="num">#{String(index + 1).padStart(3, '0')}</span>
          {state === 'other' ? (
            <StatusBadge status={v.item.status} />
          ) : (
            <span className="look__status">
              <i aria-hidden="true" />
              {t(`vitrine.state.${state}`)}
            </span>
          )}
        </span>
        <span className="look__frame">
          {photo ? (
            <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
          ) : v.item.photoUrl?.startsWith('demo:') ? (
            <span className="look__glyph">
              <Thumb photoUrl={v.item.photoUrl} category={v.item.category} alt="" size="lg" />
            </span>
          ) : (
            <span className="look__none num">{t('vitrine.noPhoto')}</span>
          )}
        </span>
        <span className="look__text">
          <span className="look__title">{v.item.title}</span>
          <span className="look__row">
            <span className="look__meta">{[v.item.brand && !/^inconnue$/i.test(v.item.brand) ? v.item.brand : null, v.item.size].filter(Boolean).join(' / ') || '—'}</span>
            <span className="look__money num">
              {price !== null ? money(price) : '—'}
              {margin === null ? (
                v.inStock || v.sale ? (
                  <span className="look__cost" title={t('vitrine.marginUnknown')}>
                    {' · '}
                    {t('vitrine.costUnknown')}
                  </span>
                ) : null
              ) : (
                <span className={margin > 0 ? 'is-pos' : margin < 0 ? 'is-neg' : ''}>
                  {' · '}
                  {money(margin, { sign: true })}
                </span>
              )}
            </span>
          </span>
          <span className="look__facts">
            {favs !== null ? t('vitrine.favs', { n: favs }) : null}
            {favs !== null && when ? ' · ' : null}
            {when}
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * « Vitrine »: the stock as a collection page — the photo first, then the piece's name, its maker and size, its price
 * and how it is doing. The same rows, filters and order as the list; a click opens the article.
 */
export function StockVitrine({ rows }: { rows: Row[] }) {
  const { t } = useI18n();
  return (
    <ul className="vitrine" aria-label={t('vitrine.aria', { n: rows.length })} data-testid="stock-vitrine">
      {rows.map((r, i) => (
        <Look key={r.v.item.id} r={r} index={i} />
      ))}
    </ul>
  );
}
