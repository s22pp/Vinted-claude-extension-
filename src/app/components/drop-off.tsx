import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage, LabelResult } from '@/data/adapters/vinted/protocol';
import { db, uid } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { HOME_KEY, PARCEL_INFO_KEY, type ParcelInfo, type Place } from '@/intelligence/parcels';
import type { SaleView } from '@/intelligence/portfolio';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Button, Field, Input, Segmented, Select } from '@/ui/components/primitives';
import { CARRIERS, type Carrier, type DropOffPoint, type Round, type TravelMode, carrierOf, groupByStop, mapsDirectionsUrl, mapsSearchUrl, orderStops, parseLatLng, placeParam } from '@/utils/routeOptimizer';
import { useEra } from '../state';
import { LocationBadge } from './storage-location';

const CARRIER_KEY = 'parcelCarrier';
const CHOSEN_KEY = 'dropOffChosen';
const MODE_KEY = 'dropOffMode';

/**
 * The drop-off round of the parcels « À envoyer »: each parcel's carrier (the seller's choice, else what Vinted's order
 * data or status says), the seller's favourite point for it, the stops by nearest neighbour from home, the Google
 * Maps Directions URL. Shared by Colis (the panel) and Aujourd'hui (the shortcut).
 */
export function useDropOffRound() {
  const era = useEra();
  const points = useLiveQuery(() => db.dropOffPoints.toArray(), []) ?? [];
  const home = useLiveQuery(() => repo.getSetting<Place | null>(HOME_KEY, null), []) ?? null;
  const info = useLiveQuery(() => repo.getSetting<Record<string, ParcelInfo>>(PARCEL_INFO_KEY, {}), []) ?? {};
  const assigned = useLiveQuery(() => repo.getSetting<Record<string, Carrier>>(CARRIER_KEY, {}), []) ?? {};
  const chosen = useLiveQuery(() => repo.getSetting<Partial<Record<Carrier, string>>>(CHOSEN_KEY, {}), []) ?? {};
  const mode = useLiveQuery(() => repo.getSetting<TravelMode>(MODE_KEY, 'driving'), []) ?? 'driving';
  const toShip = era.sales.filter((x) => x.sale.needsAction && x.sale.status !== 'REFUNDED');
  const sales = new Map(toShip.map((x) => [x.sale.id, x]));
  const carrierFor = (x: SaleView): Carrier | null =>
    assigned[x.sale.id] ?? carrierOf(x.sale.vintedConversationId ? info[x.sale.vintedConversationId]?.tracking.carrier : null) ?? carrierOf(x.sale.vintedStatus);
  const parcels = toShip.map((x) => ({ saleId: x.sale.id, title: x.item.title, carrier: carrierFor(x), storageLocation: x.item.storageLocation ?? null }));
  const round: Round = orderStops(home, groupByStop(parcels, points, chosen));
  const waypoints = round.stops.filter((s) => s.point).map((s) => placeParam(s.point!));
  const url = home && waypoints.length ? mapsDirectionsUrl(placeParam(home), waypoints, mode) : null;
  return {
    toShip: toShip.length,
    sales,
    points,
    home,
    round,
    mode,
    url,
    setMode: (m: TravelMode) => repo.setSetting(MODE_KEY, m),
    assign: (saleId: string, c: Carrier) => repo.setSetting(CARRIER_KEY, { ...assigned, [saleId]: c }),
    choose: (c: Carrier, pointId: string) => repo.setSetting(CHOSEN_KEY, { ...chosen, [c]: pointId }),
  };
}

/** Colis → « Tournée de dépôt »: the stops in order, the parcels to drop at each with their storage place and label. */
export function DropOffRoute() {
  const { t, num } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const r = useDropOffRound();
  const [busy, setBusy] = useState<string | null>(null);
  if (r.toShip === 0) return null;
  const stops = r.round.stops;
  const label = async (x: SaleView) => {
    setBusy(x.sale.id);
    try {
      const res = (await browser.runtime.sendMessage({ type: 'era:label:get', conversationId: x.sale.vintedConversationId!, title: x.item.title, soldAt: x.sale.soldAt } satisfies EraMessage)) as LabelResult;
      if (!res.ok) return errorToast(res);
      toast('success', t('ship.labelDone'), res.file ? t('ship.saved', { file: res.file }) : t('ship.notSaved', { detail: res.saveError ?? '' }));
      window.open(res.url, '_blank', 'noopener');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="drop" aria-labelledby="drop-h" data-testid="drop-off" id="tournee">
      <header className="drop__head">
        <h2 className="drop__title" id="drop-h">
          {t('drop.head', { parcels: r.toShip, stops: stops.length })}
          {r.round.km !== null && <span className="drop__km"> · ≈ {num(r.round.km, 1)} KM</span>}
        </h2>
        <Segmented label={t('drop.mode')} value={r.mode} onChange={(m) => void r.setMode(m)} options={[{ value: 'driving', label: t('drop.driving') }, { value: 'walking', label: t('drop.walking') }]} />
        {r.url ? (
          <a className="btn btn--primary" href={r.url} target="_blank" rel="noopener noreferrer" data-testid="drop-maps">
            {t('drop.open')} ↗
          </a>
        ) : (
          <Button variant="primary" disabled>
            {t('drop.open')} ↗
          </Button>
        )}
      </header>
      {!r.url && <p className="drop__why t-small t-warn">{!r.home ? t('drop.noHome') : t('drop.noPoint')}</p>}
      <ol className="drop__stops">
        {stops.map((s, i) => (
          <li key={s.key} className="drop__stop" data-testid="drop-stop">
            <div className="drop__stop-head">
              <span className="drop__n num">{String(i + 1).padStart(2, '0')}</span>
              <span className="drop__carrier">{s.carrier ? s.carrier.toUpperCase() : t('drop.unknownCarrier')}</span>
              {s.point && <span className="drop__point">— {s.point.name}</span>}
              <span className="drop__count">{t('drop.count', { n: s.parcels.length })}</span>
            </div>
            {s.point?.hours && <p className="t-small t-muted drop__meta">{s.point.hours} · {s.point.address}</p>}
            {s.carrier && !s.point && (
              <p className="t-small drop__meta">
                {t('drop.noPointFor', { carrier: s.carrier })}{' '}
                <a href={mapsSearchUrl(s.carrier, r.home)} target="_blank" rel="noopener noreferrer" data-testid="drop-find">
                  {t('drop.find')} ↗
                </a>
              </p>
            )}
            {s.carrier && r.points.filter((p) => p.carrier === s.carrier).length > 1 && (
              <Select
                aria-label={t('drop.choosePoint', { carrier: s.carrier })}
                value={s.point?.id ?? ''}
                onChange={(e) => void r.choose(s.carrier!, e.target.value)}
                options={r.points.filter((p) => p.carrier === s.carrier).map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            <ul className="drop__parcels">
              {s.parcels.map((p) => {
                const x = r.sales.get(p.saleId)!;
                return (
                  <li key={p.saleId} className="drop__parcel">
                    <span className="drop__parcel-title">{p.title}</span>
                    <LocationBadge value={p.storageLocation} />
                    {!s.carrier && (
                      <Select aria-label={t('drop.assign', { title: p.title })} value="" onChange={(e) => void r.assign(p.saleId, e.target.value as Carrier)} options={[{ value: '', label: t('drop.assignPh') }, ...CARRIERS.map((c) => ({ value: c, label: c }))]} />
                    )}
                    {era.mode === 'real' && x.sale.vintedConversationId && (
                      <Button size="sm" variant="ghost" icon="download" loading={busy === p.saleId} onClick={() => void label(x)}>
                        {t('drop.label')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <DropOffPoints points={r.points} />
    </section>
  );
}

/** « Mes points de dépôt »: the seller's usual relay points and lockers, one per line; coordinates pasted from Google Maps. */
function DropOffPoints({ points }: { points: readonly DropOffPoint[] }) {
  const { t } = useI18n();
  const [carrier, setCarrier] = useState<Carrier>('Mondial Relay');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState('');
  const [hours, setHours] = useState('');
  // Open when no point is saved yet; then as the seller leaves it (never closed under their hands by a save).
  const [open, setOpen] = useState(points.length === 0);
  const ll = coords.trim() ? parseLatLng(coords) : null;
  const bad = coords.trim() !== '' && ll === null;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim() || bad) return;
    // The point as typed, then the form emptied at once: what the seller types next is never wiped by this save.
    const point: DropOffPoint = { id: uid('dp'), carrier, name: name.trim(), address: address.trim(), ...(ll ?? {}), ...(hours.trim() ? { hours: hours.trim() } : {}) };
    setName('');
    setAddress('');
    setCoords('');
    setHours('');
    await db.dropOffPoints.put(point);
  };
  return (
    <details className="drop__book" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="drop__book-head">{t('drop.book', { n: points.length })}</summary>
      {points.length > 0 && (
        <ul className="drop__book-list">
          {points.map((p) => (
            <li key={p.id}>
              <span className="drop__carrier">{p.carrier.toUpperCase()}</span> {p.name} <span className="t-muted">· {p.address}</span>
              {p.lat !== undefined && <span className="num t-faint"> · {p.lat}, {p.lng}</span>}
              <button type="button" className="studio__remove" aria-label={t('drop.remove', { name: p.name })} onClick={() => void db.dropOffPoints.delete(p.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="drop__form" onSubmit={add}>
        <Field label={t('drop.carrier')} htmlFor="dp-carrier">
          <Select id="dp-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as Carrier)} options={CARRIERS.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label={t('drop.name')} htmlFor="dp-name">
          <Input id="dp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('drop.namePh')} />
        </Field>
        <Field label={t('drop.address')} htmlFor="dp-address">
          <Input id="dp-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('drop.addressPh')} />
        </Field>
        <Field label={t('drop.coords')} htmlFor="dp-coords" optional error={bad ? t('drop.coordsBad') : null}>
          <Input id="dp-coords" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="45.7578, 4.8320" />
        </Field>
        <Field label={t('drop.hours')} htmlFor="dp-hours" optional>
          <Input id="dp-hours" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={t('drop.hoursPh')} />
        </Field>
        <Button type="submit" icon="plus" disabled={!name.trim() || !address.trim() || bad}>
          {t('drop.add')}
        </Button>
      </form>
      <p className="t-small t-faint">{t('drop.coordsHow')}</p>
    </details>
  );
}

/** Aujourd'hui → « Itinéraire dépôt ↗ »: Google Maps at once when the round can be drawn, else the Colis panel. */
export function DropOffShortcut() {
  const { t } = useI18n();
  const r = useDropOffRound();
  if (r.toShip === 0) return null;
  return r.url ? (
    <a className="btn" href={r.url} target="_blank" rel="noopener noreferrer" data-testid="today-route">
      {t('drop.shortcut')} ↗
    </a>
  ) : (
    <a className="btn" href="#/parcels" data-testid="today-route">
      {t('drop.shortcut')} ↗
    </a>
  );
}
