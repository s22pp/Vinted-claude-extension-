import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/data/db';
import { pilotMissions } from '@/data/pilot-missions';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { untilText } from '@/intelligence/day-timeline';
import { parcelStage } from '@/intelligence/parcels';
import { PILOT_KEY, type PilotConfig, nextPilotAt, pilotConfig } from '@/intelligence/pilot';
import { IconTile, type IconName, type TileTone } from '@/ui/components/icons';
import { RoundLive } from '../components/round-live';
import { useEra } from '../state';

function openDashboard(hash: string) {
  void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/${hash}` });
}

/**
 * The extension's icon, as a remote control: the Pilote (its next round, or the round going on live) and what is left
 * for the seller — the physical part only (parcels to drop off or collect, articles to photograph) and the messages ERA
 * left for them. Each line opens the screen where it is done. Counted from ERA's data: no Vinted call.
 */
export function Glance() {
  const { t } = useI18n();
  const era = useEra();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const cfg = pilotConfig(useLiveQuery(() => repo.getSetting<Partial<PilotConfig> | null>(PILOT_KEY, null), []));
  const missions = useLiveQuery(() => pilotMissions().catch(() => ({ priceCuts: 0, toList: 0 })), []);
  const toCollect = useLiveQuery(async () => (await db.purchases.toArray()).filter((p) => !p.dismissed && parcelStage(p.status) === 'AT_PICKUP').length, []) ?? 0;
  const waiting = useLiveQuery(async () => ((await repo.getSetting<unknown[]>('autoRepliesPending', [])) ?? []).length, []) ?? 0;
  const toShip = era.sales.filter((s) => s.sale.needsAction && s.sale.status !== 'REFUNDED').length;
  const next = cfg.enabled && cfg.hours.length ? nextPilotAt(now, cfg.hours) : null;

  const tasks: { key: string; n: number; icon: IconName; tone: TileTone; hash: string }[] = [
    { key: 'toShip', n: toShip, icon: 'box', tone: 'coral', hash: 'parcels' },
    { key: 'toCollect', n: toCollect, icon: 'download', tone: 'violet', hash: 'parcels' },
    { key: 'toList', n: missions?.toList ?? 0, icon: 'upload', tone: 'cobalt', hash: 'workshop' },
    { key: 'waiting', n: waiting, icon: 'info', tone: 'amber', hash: 'automations' },
  ];
  const open = tasks.filter((x) => x.n > 0);

  return (
    <>
      <section className="card stack" style={{ padding: 14, gap: 10 }} data-testid="glance-pilot" aria-label={t('glance.pilot')}>
        <button type="button" className="choice" style={{ padding: '8px 10px' }} onClick={() => openDashboard('automations')}>
          <IconTile name="repost" tone={cfg.enabled ? 'emerald' : 'neutral'} size="sm" />
          <span className="grow stack" style={{ gap: 0, textAlign: 'left' }}>
            <span className="t-caption">{t('glance.pilot')}</span>
            <span className="t-small">
              {next ? (
                <>
                  <b>{t('glance.next', { hour: new Date(next).getHours() })}</b> <span className="t-muted">· {untilText(next, now)}</span>
                </>
              ) : (
                <span className="t-muted">{t('glance.off')}</span>
              )}
            </span>
          </span>
          <span className={`t-small ${cfg.enabled ? '' : 't-faint'}`} style={{ color: cfg.enabled ? 'var(--emerald)' : undefined }}>
            {cfg.enabled ? t('glance.on') : t('glance.turnOn')}
          </span>
        </button>
        <RoundLive compact />
      </section>
      <section className="card" style={{ padding: 14 }} data-testid="glance-you" aria-label={t('glance.you')}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="t-caption">{t('glance.you')}</span>
          <span className="t-small t-faint">{open.length ? t('glance.youHint') : ''}</span>
        </div>
        {open.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {open.map((x) => (
              <button key={x.key} type="button" className="choice" style={{ padding: '8px 10px' }} data-task={x.key} onClick={() => openDashboard(x.hash)}>
                <IconTile name={x.icon} tone={x.tone} size="sm" />
                <span className="t-small grow" style={{ textAlign: 'left' }}>
                  {t(`glance.task.${x.key}`, { n: x.n })}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="t-small t-muted" style={{ margin: 0 }}>
            {t('glance.nothing')}
          </p>
        )}
      </section>
    </>
  );
}
