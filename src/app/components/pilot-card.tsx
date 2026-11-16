import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { AUTO_BACKUP_KEY } from '@/data/auto-backup';
import { BUY_ALERTS_KEY } from '@/data/buy-alerts';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { AutoConfig } from '@/intelligence/automation';
import { PILOT_KEY, type PilotConfig, type PilotRound, nextPilotAt, pilotConfig, pilotNotice } from '@/intelligence/pilot';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card, Field, Select } from '@/ui/components/primitives';

/**
 * The autopilot's settings: on/off and the two hours. The round runs what is switched on below (offers, favourites,
 * delivered parcels) and elsewhere (buy alerts, backup); each round ends with a notification of what is left.
 */
export function PilotCard({ auto }: { auto: AutoConfig }) {
  const { t, dateLong } = useI18n();
  const toast = useToast();
  const stored = useLiveQuery(() => repo.getSetting<Partial<PilotConfig> | null>(PILOT_KEY, null), []);
  const others = useLiveQuery(async () => ({
    alerts: !!(await repo.getSetting<{ enabled?: boolean } | null>(BUY_ALERTS_KEY, null))?.enabled,
    backup: !!(await repo.getSetting<{ enabled?: boolean } | null>(AUTO_BACKUP_KEY, null))?.enabled,
    real: (await repo.getSetting('dataMode', 'empty')) === 'real',
  }));
  const [busy, setBusy] = useState(false);
  // Shown at once on a click; saved, then the schedule follows.
  const [local, setLocal] = useState<PilotConfig | null>(null);
  if (stored === undefined || !others) return null;
  const cfg = local ?? pilotConfig(stored);
  const save = async (next: PilotConfig) => {
    setLocal(next);
    await repo.setSetting(PILOT_KEY, next);
    await browser.runtime.sendMessage({ type: 'era:pilot:schedule' } satisfies EraMessage).catch(() => undefined);
  };
  const setHour = (i: number, h: number) => void save({ ...cfg, hours: cfg.hours.map((x, j) => (j === i ? h : x)) });
  const runNow = async () => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:pilot:run' } satisfies EraMessage)) as PilotRound;
      const n = pilotNotice(r);
      toast(r.stopped ? 'error' : 'success', n.title, n.lines.join(' · '));
    } catch (e) {
      toast('error', t('pilot.failed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const tasks: [string, boolean][] = [
    ['refresh', true],
    ['offers', auto.offers.enabled],
    ['fav', auto.fav.enabled],
    ['delivered', auto.delivered.enabled],
    ['labels', cfg.labels],
    ['alerts', others.alerts],
    ['backup', others.backup],
  ];
  const hours = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h} h` }));
  return (
    <Card className="span-12" title={t('pilot.title')} hint={t('pilot.hint')} icon="repost" tone="violet">
      <div className="stack-3" data-testid="pilot">
        <label htmlFor="pilot-on" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input id="pilot-on" type="checkbox" className="checkbox" checked={cfg.enabled} disabled={!others.real} onChange={(e) => void save({ ...cfg, enabled: e.target.checked })} style={{ marginTop: 2 }} />
          <span style={{ fontWeight: 600 }}>{t('pilot.enable')}</span>
        </label>
        <div className="row wrap" style={{ gap: 10 }}>
          {cfg.hours.map((h, i) => (
            <Field key={i} label={t('pilot.hour', { n: i + 1 })} htmlFor={`pilot-h${i}`}>
              <Select id={`pilot-h${i}`} value={String(h)} onChange={(e) => setHour(i, Number(e.target.value))} options={hours} />
            </Field>
          ))}
        </div>
        <label htmlFor="pilot-labels" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input id="pilot-labels" type="checkbox" className="checkbox" checked={cfg.labels} disabled={!others.real} onChange={(e) => void save({ ...cfg, labels: e.target.checked })} style={{ marginTop: 2 }} />
          <span>
            {t('pilot.labels')} <span className="t-small t-faint">{t('pilot.labelsHint')}</span>
          </span>
        </label>
        {cfg.enabled && <p className="t-small t-muted" data-testid="pilot-next">{t('pilot.next', { when: dateLong(nextPilotAt(Date.now(), cfg.hours)), hour: new Date(nextPilotAt(Date.now(), cfg.hours)).getHours() })}</p>}
        <div className="row wrap" style={{ gap: 6 }} aria-label={t('pilot.tasks')}>
          {tasks.map(([k, on]) => (
            <Badge key={k} tone={on ? 'emerald' : 'neutral'}>
              {t(`pilot.task.${k}`)} {on ? '✓' : t('pilot.off')}
            </Badge>
          ))}
        </div>
        <ul className="t-small t-faint stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
          <li>{t('pilot.how')}</li>
          <li>{t('pilot.tab')}</li>
          <li>{t('pilot.you')}</li>
        </ul>
        {!others.real && <p className="t-small t-warn">{t('pilot.notReal')}</p>}
        <div>
          <Button size="sm" variant="primary" icon="check" loading={busy} disabled={busy || !others.real} onClick={() => void runNow()}>
            {t('pilot.runNow')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
