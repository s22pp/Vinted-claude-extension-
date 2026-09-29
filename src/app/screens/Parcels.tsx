import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, lazy, useMemo, useState } from 'react';
import type { EraMessage, LocateResult } from '@/data/adapters/vinted/protocol';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { DEFAULT_HOME, HOME_KEY, PARCEL_INFO_KEY, PARCEL_STEPS, type Parcel, type ParcelInfo, type Place, distanceKm, parcelsInProgress } from '@/intelligence/parcels';
import { useErrorToast, useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, EmptyState, Flag } from '@/ui/components/primitives';
import type { MapPin } from '../components/parcel-map';
import { PageHead } from '../Shell';
import { useEra } from '../state';
import { SalesTabs } from '../components/section-tabs';

// The map library is loaded with the map only, not with every visit of the dashboard.
const ParcelMap = lazy(() => import('../components/parcel-map').then((m) => ({ default: m.ParcelMap })));

/**
 * Colis: the parcels coming to the seller (purchases) and leaving (sales), on a map around home (Roanne by
 * default). Steps read from Vinted's statuses; places only where Vinted gives coordinates ("Localiser").
 */
export function Parcels() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const errorToast = useErrorToast();
  const purchaseRows = useLiveQuery(() => db.purchases.toArray(), []);
  const infoRow = useLiveQuery(() => repo.getSetting<Record<string, ParcelInfo>>(PARCEL_INFO_KEY, {}), []);
  const info = useMemo(() => infoRow ?? {}, [infoRow]);
  const storedHome = useLiveQuery(() => repo.getSetting<Place | null>(HOME_KEY, null), []);
  const home = storedHome ?? DEFAULT_HOME;
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const parcels = useMemo(
    () =>
      parcelsInProgress(
        era.sales.map((s) => ({ ...s.sale, title: s.item.title })),
        purchaseRows ?? [],
        era.now,
      ),
    [era.sales, purchaseRows, era.now],
  );
  const pins: MapPin[] = useMemo(
    () => parcels.flatMap((p) => (p.conversationId && info[p.conversationId] ? info[p.conversationId]!.points.map((pt, i) => ({ ...pt, key: `${p.key}:${i}`, direction: p.direction, title: p.title })) : [])),
    [parcels, info],
  );

  const locate = async (p: Parcel) => {
    if (!p.conversationId) return;
    setBusy(p.key);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:parcel:locate', conversationId: p.conversationId } satisfies EraMessage)) as LocateResult;
      if (!r.ok) return errorToast(r);
      toast(r.info.points.length ? 'success' : 'info', r.info.points.length ? t('parcelmap.found', { n: r.info.points.length }) : t('parcelmap.noPlace'));
    } finally {
      setBusy(null);
    }
  };
  const placeHome = async (at: { lat: number; lng: number }) => {
    await repo.setSetting(HOME_KEY, { ...at, label: t('parcelmap.homePlaced') } satisfies Place);
    setPlacing(false);
  };

  const incoming = parcels.filter((p) => p.direction === 'IN');
  const outgoing = parcels.filter((p) => p.direction === 'OUT');
  const row = (p: Parcel) => {
    const found = p.conversationId ? info[p.conversationId] : undefined;
    const step = PARCEL_STEPS.indexOf(p.stage);
    return (
      <li key={p.key} className="parcel" data-testid="parcel" data-late={p.late || undefined}>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <b className="grow clamp-1">{p.title}</b>
          {p.late && <Badge tone="coral">{t(`parcelmap.late.${p.direction}.${p.stage}`)}</Badge>}
        </div>
        <ol className="parcel__steps" aria-label={t('parcelmap.progress')}>
          {PARCEL_STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
              {t(`parcelmap.step.${s}`)}
            </li>
          ))}
        </ol>
        <div className="t-small t-muted">
          {p.status ?? t(`parcelmap.step.${p.stage}`)}
          {p.days !== null && ` · ${p.sinceStatus ? t('parcelmap.since', { n: p.days }) : t('parcelmap.atLeast', { n: p.days })}`}
        </div>
        {found && (
          <div className="t-small stack" style={{ gap: 2, marginTop: 4 }}>
            {found.points.map((pt) => (
              <span key={`${pt.lat},${pt.lng}`}>
                {t(`parcelmap.kind.${pt.kind}`)} : {pt.label} · <span className="num">{t('parcelmap.km', { km: distanceKm(home, pt).toFixed(1).replace('.', ',') })}</span>
              </span>
            ))}
            {!found.points.length && <span className="t-faint">{t('parcelmap.noPlace')}</span>}
            {(found.tracking.carrier || found.tracking.code) && (
              <span className="t-muted">
                {[found.tracking.carrier, found.tracking.code].filter(Boolean).join(' · ')}
                {found.tracking.url && (
                  <>
                    {' · '}
                    <a href={found.tracking.url} target="_blank" rel="noopener noreferrer">
                      {t('parcelmap.carrier')}
                    </a>
                  </>
                )}
              </span>
            )}
          </div>
        )}
        <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
          {era.mode === 'real' && p.conversationId && (
            <Button size="sm" variant="ghost" icon="target" loading={busy === p.key} disabled={!!busy && busy !== p.key} onClick={() => void locate(p)}>
              {found ? t('parcelmap.relocate') : t('parcelmap.locate')}
            </Button>
          )}
          {p.conversationId && (
            <a className="btn btn--ghost btn--sm" href={`https://www.vinted.fr/inbox/${p.conversationId}`} target="_blank" rel="noopener noreferrer">
              {t('parcelmap.conversation')}
            </a>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHead title={t('parcelmap.title')} sub={t('parcelmap.sub', { in: incoming.length, out: outgoing.length })} tabs={<SalesTabs active="parcels" />} />
      <div className="grid-12">
        <div className="span-7 stack-4">
          <Card
            title={t('parcelmap.mapTitle', { home: home.label })}
            icon="target"
            tone="cyan"
            actions={
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" variant={placing ? 'primary' : 'ghost'} onClick={() => setPlacing(!placing)}>
                  {placing ? t('parcelmap.placing') : t('parcelmap.place')}
                </Button>
                {storedHome && (
                  <Button size="sm" variant="ghost" onClick={() => void repo.setSetting(HOME_KEY, null)}>
                    {t('parcelmap.backToRoanne')}
                  </Button>
                )}
              </div>
            }
          >
            <Suspense fallback={<div className="pmap skeleton" aria-hidden="true" />}>
              <ParcelMap home={home} pins={pins} placing={placing} onPlace={(at) => void placeHome(at)} />
            </Suspense>
            <p className="t-small t-faint" style={{ marginTop: 8 }}>
              {t('parcelmap.honest')}
            </p>
          </Card>
        </div>
        <div className="span-5 stack-4">
          {parcels.length === 0 ? (
            <Card>
              <EmptyState title={t('parcelmap.none')} why={era.mode === 'real' ? t('parcelmap.noneWhy') : t('parcelmap.noneDemo')} />
            </Card>
          ) : (
            <>
              <Card title={t('parcelmap.incoming', { n: incoming.length })} icon="download" tone="emerald" actions={<Flag kind="EXPERIMENTAL" />}>
                {incoming.length ? <ul className="parcels">{incoming.map(row)}</ul> : <p className="t-small t-muted">{t('parcelmap.noIncoming')}</p>}
              </Card>
              <Card title={t('parcelmap.outgoing', { n: outgoing.length })} icon="upload" tone="violet">
                {outgoing.length ? <ul className="parcels">{outgoing.map(row)}</ul> : <p className="t-small t-muted">{t('parcelmap.noOutgoing')}</p>}
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
