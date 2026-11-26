import { useI18n } from '@/i18n';
import { DAC7, yearOf, yearSummary } from '@/intelligence/accounting';
import { profitWindow, stockVelocity } from '@/intelligence/telemetry';
import { SegmentedBar, Sparkline } from '@/ui/charts/telemetry';
import { Button } from '@/ui/components/primitives';
import { Thumb } from '@/ui/components/Thumb';
import { go, useEra } from '../state';
import { DayTimeline } from './day-timeline';
import { DropOffShortcut, useDropOffRound } from './drop-off';
import { ForYou } from './for-you';
import { FillCostsLink } from './missing-costs';
import { InlineLocation } from './storage-location';

/**
 * Aujourd'hui, v4.0: a 12-column bento readable without scrolling at 1440 × 900. Columns 1–8: what to do (the parcels
 * to ship — the piece, where it is stored, its carrier — then the day's timeline); columns 9–12: the live telemetry
 * (net profit over 30 days, the stock's velocity, the DAC7 thresholds). The rest of the page follows below.
 */
export function TodayBento() {
  const { t, money, num } = useI18n();
  const era = useEra();
  const r = useDropOffRound();
  const carrierOf = new Map(r.round.stops.flatMap((s) => s.parcels.map((p) => [p.saleId, s.carrier] as const)));
  const toShip = era.sales.filter((x) => x.sale.needsAction && x.sale.status !== 'REFUNDED');
  const profit = profitWindow(era.sales.map((s) => ({ soldAt: s.sale.soldAt, status: s.sale.status, profit: s.profit })), era.now);
  const velocity = stockVelocity(era.views.map((v) => ({ inStock: v.inStock, listed: v.item.status === 'LISTED', daysListed: v.daysListed })));
  const listed = velocity.FRESH + velocity.WATCH + velocity.STALE;
  const year = yearOf(era.now);
  const fiscal = yearSummary(era.sales, era.views, year);
  return (
    <section className="bento" aria-label={t('bento.label')} data-testid="today-bento">
      <div className="bento__main">
        <div className="bento__cell bento__ship" data-testid="bento-ship">
          {toShip.length > 0 ? (
            <>
              <p className="bento__head">{t('bento.ship', { n: toShip.length })}</p>
              <ul className="bento__parcels">
                {toShip.slice(0, 3).map((x) => (
                  <li key={x.sale.id} className="bento__parcel">
                    <Thumb photoUrl={x.item.photoUrl} category={x.item.category} alt="" size="md" />
                    <span className="bento__parcel-text">
                      <span className="bento__parcel-title">{x.item.title}</span>
                      <span className="bento__carrier">{carrierOf.get(x.sale.id)?.toUpperCase() ?? t('bento.carrierUnknown')}</span>
                    </span>
                    <InlineLocation itemId={x.item.id} value={x.item.storageLocation} disabled={x.item.isDemo} />
                  </li>
                ))}
              </ul>
              {toShip.length > 3 && <p className="t-small t-muted">{t('bento.more', { n: toShip.length - 3 })}</p>}
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="primary" onClick={() => go('parcels')}>
                  {t('forYou.cta.ship')}
                </Button>
                <DropOffShortcut />
              </div>
            </>
          ) : (
            <ForYou />
          )}
        </div>
        <div className="bento__cell bento__timeline">
          <DayTimeline />
        </div>
      </div>
      <aside className="bento__side" aria-label={t('bento.telemetry')}>
        <div className="bento__cell bento__metric" data-testid="bento-profit">
          <p className="bento__head">{t('bento.profit')}</p>
          <p className={`bento__value num ${profit.knownCents > 0 ? 'is-pos' : profit.knownCents < 0 ? 'is-neg' : ''}`}>{money(profit.knownCents, { sign: true })}</p>
          <Sparkline data={profit.cumulative} color="var(--emerald)" height={28} label={t('bento.profitCurve')} />
          <p className="bento__foot num">{profit.unknown ? t('bento.profitPartial', { n: profit.sales, unknown: profit.unknown }) : t('bento.profitSales', { n: profit.sales })}</p>
          {profit.unknown > 0 && (
            <span>
              <FillCostsLink n={profit.unknown} />
            </span>
          )}
        </div>
        <div className="bento__cell bento__metric" data-testid="bento-velocity">
          <p className="bento__head">{t('bento.velocity')}</p>
          <SegmentedBar
            parts={[
              { n: velocity.FRESH, tone: 'ok' },
              { n: velocity.WATCH, tone: 'warn' },
              { n: velocity.STALE, tone: 'over' },
            ]}
            label={t('bento.velocityAria', { fresh: velocity.FRESH, watch: velocity.WATCH, stale: velocity.STALE })}
          />
          <p className="bento__legend num">
            <span className="bento__key">
              <i className="is-ok" aria-hidden="true" />
              {t('bento.fresh', { n: velocity.FRESH })}
            </span>
            <span className="bento__key">
              <i className="is-warn" aria-hidden="true" />
              {t('bento.watch', { n: velocity.WATCH })}
            </span>
            <span className="bento__key">
              <i className="is-over" aria-hidden="true" />
              {t('bento.stale', { n: velocity.STALE })}
            </span>
          </p>
          <p className="bento__foot num">{t('bento.listed', { n: listed })}</p>
        </div>
        <div className="bento__cell bento__metric" data-testid="bento-dac7">
          <p className="bento__head">{t('bento.dac7', { year: String(year) })}</p>
          <div className="bento__gauge">
            <span className="bento__gauge-label num">{t('bento.dac7Sales', { n: fiscal.sales, lim: DAC7.sales })}</span>
            <SegmentedBar value={fiscal.sales} max={DAC7.sales} label={t('bento.dac7Sales', { n: fiscal.sales, lim: DAC7.sales })} />
          </div>
          <div className="bento__gauge">
            <span className="bento__gauge-label num">{t('bento.dac7Revenue', { n: num(Math.round(fiscal.revenueCents / 100)), lim: num(DAC7.revenueCents / 100) })}</span>
            <SegmentedBar value={fiscal.revenueCents} max={DAC7.revenueCents} label={t('bento.dac7Revenue', { n: num(Math.round(fiscal.revenueCents / 100)), lim: num(DAC7.revenueCents / 100) })} />
          </div>
          <p className="bento__foot">{fiscal.dac7.reportable ? t('bento.dac7Reached') : t('bento.dac7Under')}</p>
        </div>
      </aside>
    </section>
  );
}
