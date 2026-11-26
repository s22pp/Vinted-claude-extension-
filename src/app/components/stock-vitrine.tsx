import { useState } from 'react';
import { useI18n } from '@/i18n';
import { publishedAgo } from '@/intelligence/repost-now';
import { rotation } from '@/intelligence/pro-figures';
import { cutFivePct } from '@/intelligence/telemetry';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Thumb } from '@/ui/components/Thumb';
import { analyzeItem } from '../market-run';
import { useEra } from '../state';
import { StatusBadge } from './domain';
import type { Row } from './stock-table';
import { ApplyPriceModal, vintedIdOf } from './vinted-price';

/**
 * One gallery card (v4.0): the 3:4 photo Vinted shows (as is, never retouched) with its HUD — the archive index top left,
 * the state top right, a 2 px bar of its age online at the bottom — then name, maker, price · margin. On hover (or
 * keyboard focus) an action bar slides up over the photo: analyse the market, a 5 % cut through the price dialog, the
 * listing on Vinted.
 */
function Look({ r, index }: { r: Row; index: number }) {
  const { t, money } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const v = r.v;
  const [failed, setFailed] = useState(false);
  const [cut, setCut] = useState(false);
  const [busy, setBusy] = useState(false);
  const photo = v.item.photoUrl && !v.item.photoUrl.startsWith('demo:') && !failed ? v.item.photoUrl : null;
  const when = v.current && v.current.listedAtKnown !== false ? publishedAgo(v.current.listedAt, Date.now()) : null;
  const favs = v.current?.favorites ?? null;
  const price = v.askPrice ?? v.sale?.salePriceCents ?? null;
  // The margin: what is left over the purchase cost — unknown while the cost is (never shown as zero).
  const margin = v.sale ? (v.cost === null ? null : v.sale.salePriceCents - v.cost) : v.inStock ? v.potentialProfit : null;
  const rot = v.item.status === 'LISTED' ? rotation(v.daysListed, favs, null).state : null;
  const state = v.item.status === 'SOLD' ? 'sold' : rot === 'STALE' ? 'stale' : v.item.status === 'LISTED' ? 'live' : 'other';
  const id = vintedIdOf(v);
  const cutCents = v.item.status === 'LISTED' ? cutFivePct(v.askPrice) : null;
  const age = rot && v.daysListed !== null ? Math.min(1, Math.max(0.04, v.daysListed / 30)) : null;
  const ref = `#${String(index + 1).padStart(3, '0')}`;
  const analyze = async () => {
    setBusy(true);
    try {
      await analyzeItem(v, era.mode, era.model, era.learning, undefined, true);
      toast('success', t('vitrine.analyzed', { title: v.item.title }));
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="look" data-state={state}>
      <a href={`#/item/${v.item.id}`} className="look__link">
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
          <span className="look__hud look__hud--ref num">{ref}</span>
          <span className="look__hud look__hud--state">
            {state === 'other' ? (
              <StatusBadge status={v.item.status} />
            ) : (
              <span className="look__status">
                <i aria-hidden="true" />
                {t(`vitrine.state.${state}`)}
              </span>
            )}
          </span>
          {age !== null && (
            <span className="look__age" data-rot={rot} title={t('vitrine.age', { n: v.daysListed ?? 0 })}>
              <i style={{ width: `${Math.round(age * 100)}%` }} />
            </span>
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
      <div className="look__over">
        <div className="look__actions" role="group" aria-label={t('vitrine.actions', { ref })}>
          <button type="button" className="look__act" onClick={() => void analyze()} disabled={!v.inStock || busy} aria-busy={busy || undefined}>
            {t('vitrine.act.analyze')}
          </button>
          <button type="button" className="look__act" onClick={() => setCut(true)} disabled={!id || cutCents === null} title={id ? undefined : t('vintedPrice.onlyVinted')}>
            {t('vitrine.act.cut')}
          </button>
          <button type="button" className="look__act" onClick={() => id && window.open(`https://www.vinted.fr/items/${id}`, '_blank', 'noopener')} disabled={!id} title={id ? undefined : t('vintedPrice.onlyVinted')}>
            {t('vitrine.act.vinted')}
          </button>
        </div>
      </div>
      {id && cut && <ApplyPriceModal v={v} cents={cutCents} open={cut} onClose={() => setCut(false)} />}
    </li>
  );
}

/**
 * « Vitrine »: the stock as a gallery — four columns of photos with their HUD, then the piece's name, its maker and
 * size, its price and how it is doing. The same rows, filters and order as the list; a click opens the article.
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
