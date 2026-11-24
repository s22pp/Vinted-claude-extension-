import { useState } from 'react';
import { useI18n } from '@/i18n';
import { publishedAgo } from '@/intelligence/repost-now';
import { Thumb } from '@/ui/components/Thumb';
import { StatusBadge } from './domain';
import type { Row } from './stock-table';

/** One look: the photo Vinted shows (as is, never retouched), or the garment's line drawing when there is none. */
function Look({ r }: { r: Row }) {
  const { t, money } = useI18n();
  const v = r.v;
  const [failed, setFailed] = useState(false);
  const photo = v.item.photoUrl && !v.item.photoUrl.startsWith('demo:') && !failed ? v.item.photoUrl : null;
  const when = v.current && v.current.listedAtKnown !== false ? publishedAgo(v.current.listedAt, Date.now()) : null;
  const favs = v.current?.favorites ?? null;
  const price = v.askPrice ?? v.sale?.salePriceCents ?? null;
  // The margin: what is left over the purchase cost — unknown while the cost is (never shown as zero).
  const margin = v.sale ? (v.cost === null ? null : v.sale.salePriceCents - v.cost) : v.inStock ? v.potentialProfit : null;
  return (
    <li className="look">
      <a href={`#/item/${v.item.id}`} className="look__link">
        <span className="look__frame">
          {photo ? (
            <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
          ) : (
            <span className="look__glyph">
              <Thumb photoUrl={v.item.photoUrl?.startsWith('demo:') ? v.item.photoUrl : null} category={v.item.category} alt="" size="lg" />
            </span>
          )}
          <span className="look__state">
            <StatusBadge status={v.item.status} />
          </span>
          <span className="look__tags">
            <span className="look__tag look__tag--price num">{price !== null ? money(price) : '—'}</span>
            <span className={`look__tag num ${margin === null ? 'is-unknown' : margin > 0 ? 'is-pos' : margin < 0 ? 'is-neg' : ''}`} title={margin === null ? t('vitrine.marginUnknown') : undefined}>
              {margin === null ? t('vitrine.marginNone') : t('vitrine.margin', { amount: money(margin, { sign: true }) })}
            </span>
          </span>
        </span>
        <span className="look__text">
          <span className="look__title">{v.item.title}</span>
          <span className="look__meta">{[v.item.brand && !/^inconnue$/i.test(v.item.brand) ? v.item.brand : null, v.item.size].filter(Boolean).join(' / ')}</span>
          <span className="look__row">
            <span className="look__facts">
              {favs !== null ? t('vitrine.favs', { n: favs }) : null}
              {favs !== null && when ? ' · ' : null}
              {when}
            </span>
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
      {rows.map((r) => (
        <Look key={r.v.item.id} r={r} />
      ))}
    </ul>
  );
}
