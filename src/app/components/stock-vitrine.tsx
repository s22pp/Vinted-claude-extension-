import { useState } from 'react';
import { useI18n } from '@/i18n';
import { publishedAgo } from '@/intelligence/repost-now';
import { Money } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { StatusBadge } from './domain';
import type { Row } from './stock-table';

/** One look: the photo Vinted shows (as is, never retouched), or the garment's line drawing when there is none. */
function Look({ r }: { r: Row }) {
  const { t } = useI18n();
  const v = r.v;
  const [failed, setFailed] = useState(false);
  const photo = v.item.photoUrl && !v.item.photoUrl.startsWith('demo:') && !failed ? v.item.photoUrl : null;
  const when = v.current && v.current.listedAtKnown !== false ? publishedAgo(v.current.listedAt, Date.now()) : null;
  const favs = v.current?.favorites ?? null;
  const price = v.askPrice ?? v.sale?.salePriceCents ?? null;
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
        </span>
        <span className="look__text">
          <span className="look__title">{v.item.title}</span>
          <span className="look__meta">{[v.item.brand && !/^inconnue$/i.test(v.item.brand) ? v.item.brand : null, v.item.size].filter(Boolean).join(' / ')}</span>
          <span className="look__row">
            <span className="look__price num">
              <Money cents={price} />
            </span>
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
