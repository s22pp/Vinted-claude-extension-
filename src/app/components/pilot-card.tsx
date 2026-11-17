import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { AUTO_BACKUP_KEY } from '@/data/auto-backup';
import { BUY_ALERTS_KEY } from '@/data/buy-alerts';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { AutoConfig } from '@/intelligence/automation';
import { PILOT_KEY, type PilotConfig, type PilotRound, addPilotHour, nextPilotAt, pilotConfig, pilotNotice } from '@/intelligence/pilot';
import { WEEK_DAYS } from '@/intelligence/weekly';
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
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  // Shown at once on a click; saved, then the schedule follows.
  const [local, setLocal] = useState<PilotConfig | null>(null);
  if (stored === undefined || !others) return null;
  const cfg = local ?? pilotConfig(stored);
  const save = async (next: PilotConfig) => {
    setLocal(next);
    await repo.setSetting(PILOT_KEY, next);
    await browser.runtime.sendMessage({ type: 'era:pilot:schedule' } satisfies EraMessage).catch(() => undefined);
  };
  // Two rounds never at the same hour: picking one already set leaves the hours as they were.
  const setHour = (i: number, h: number) => {
    if (cfg.hours.some((x, j) => j !== i && x === h)) return;
    void save({ ...cfg, hours: cfg.hours.map((x, j) => (j === i ? h : x)).sort((a, b) => a - b) });
  };
  const added = addPilotHour(cfg.hours);
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
  const weeklyNow = async () => {
    setWeeklyBusy(true);
    try {
      const n = (await browser.runtime.sendMessage({ type: 'era:weekly:run' } satisfies EraMessage)) as { title?: string; lines?: string[]; ok?: false; detail?: string };
      if (n.title) toast('success', n.title, (n.lines ?? []).join(' · '));
      else toast('error', t('pilot.failed'), n.detail ?? '');
    } catch (e) {
      toast('error', t('pilot.failed'), e instanceof Error ? e.message : String(e));
    } finally {
      setWeeklyBusy(false);
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
    ['weekly', cfg.weekly],
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
            <div key={`${i}-${h}`} className="row" style={{ gap: 4, alignItems: 'flex-end' }}>
              <Field label={t('pilot.hour', { n: i + 1 })} htmlFor={`pilot-h${i}`}>
                <Select id={`pilot-h${i}`} value={String(h)} onChange={(e) => setHour(i, Number(e.target.value))} options={hours.map((o) => ({ ...o, disabled: cfg.hours.some((x, j) => j !== i && String(x) === o.value) }))} />
              </Field>
              {cfg.hours.length > 1 && (
                <Button size="sm" variant="ghost" icon="x" aria-label={t('pilot.removeHour', { n: i + 1 })} title={t('pilot.removeHour', { n: i + 1 })} onClick={() => void save({ ...cfg, hours: cfg.hours.filter((_, j) => j !== i) })} />
              )}
            </div>
          ))}
          {added && (
            <div style={{ alignSelf: 'flex-end' }}>
              <Button size="sm" variant="ghost" icon="plus" onClick={() => void save({ ...cfg, hours: added })}>
                {t('pilot.addHour')}
              </Button>
            </div>
          )}
        </div>
        <label htmlFor="pilot-labels" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input id="pilot-labels" type="checkbox" className="checkbox" checked={cfg.labels} disabled={!others.real} onChange={(e) => void save({ ...cfg, labels: e.target.checked })} style={{ marginTop: 2 }} />
          <span>
            {t('pilot.labels')} <span className="t-small t-faint">{t('pilot.labelsHint')}</span>
          </span>
        </label>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label htmlFor="pilot-weekly" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input id="pilot-weekly" type="checkbox" className="checkbox" checked={cfg.weekly} disabled={!others.real} onChange={(e) => void save({ ...cfg, weekly: e.target.checked })} style={{ marginTop: 2 }} />
            <span>
              {t('pilot.weekly')} <span className="t-small t-faint">{t('pilot.weeklyHint')}</span>
            </span>
          </label>
          <Field label={t('pilot.weekDay')} htmlFor="pilot-day">
            <Select id="pilot-day" value={String(cfg.weekDay)} disabled={!cfg.weekly} onChange={(e) => void save({ ...cfg, weekDay: Number(e.target.value) })} options={WEEK_DAYS.map((d, i) => ({ value: String(i), label: d[0]!.toUpperCase() + d.slice(1) })).slice(1).concat({ value: '0', label: WEEK_DAYS[0] })} />
          </Field>
        </div>
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
          <li>{t('pilot.sessions')}</li>
          <li>{t('pilot.you')}</li>
        </ul>
        {!others.real && <p className="t-small t-warn">{t('pilot.notReal')}</p>}
        <div>
          <Button size="sm" variant="primary" icon="check" loading={busy} disabled={busy || !others.real} onClick={() => void runNow()}>
            {t('pilot.runNow')}
          </Button>{' '}
          <Button size="sm" variant="ghost" icon="calendar" loading={weeklyBusy} disabled={weeklyBusy || !others.real} onClick={() => void weeklyNow()}>
            {t('pilot.weeklyNow')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
