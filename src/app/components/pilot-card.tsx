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
import { IconTile, type IconName, type TileTone } from '@/ui/components/icons';
import { Badge, Button, Card, Field, Select } from '@/ui/components/primitives';
import { untilText } from '@/intelligence/day-timeline';

/**
 * The autopilot's settings: on/off and the two hours. The round runs what is switched on below (offers, favourites,
 * delivered parcels) and elsewhere (buy alerts, backup); each round ends with a notification of what is left.
 */
export type AgentKey = 'offers' | 'fav' | 'delivered' | 'replies';

export function PilotCard({ auto, onAll, onAgent }: { auto: AutoConfig; onAll: () => Promise<void>; onAgent: (k: AgentKey, on: boolean) => Promise<void> }) {
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
  const [details, setDetails] = useState<string | null>(null);
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
  const runNow = async (dryRun = false) => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:pilot:run', dryRun } satisfies EraMessage)) as PilotRound;
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
  /** Everything ERA can do, switched on in one click: the automations, the rounds, the labels, the week's task. */
  const giveAll = async () => {
    await onAll();
    await save({ ...cfg, enabled: true, labels: true, weekly: true, priceCuts: true, reposts: true });
    toast('success', t('pilot.allDone'), t('pilot.allDoneHint'));
  };
  // Every agent ERA runs in a round: its switch, its icon, one line of what it does; its details on demand.
  const agents: { key: string; on: boolean; icon: IconName; tone: TileTone; label: string; toggle: (v: boolean) => void; more: string; card?: string }[] = [
    { key: 'offers', on: auto.offers.enabled, icon: 'capital', tone: 'amber', label: t('pilot.agentSwitch', { name: t('pilot.task.offers') }), toggle: (v) => void onAgent('offers', v), more: t('pilot.more.offers'), card: 'auto-offers' },
    { key: 'fav', on: auto.fav.enabled, icon: 'heart', tone: 'pink', label: t('pilot.agentSwitch', { name: t('pilot.task.fav') }), toggle: (v) => void onAgent('fav', v), more: t('pilot.more.fav'), card: 'auto-fav' },
    { key: 'delivered', on: auto.delivered.enabled, icon: 'check', tone: 'emerald', label: t('pilot.agentSwitch', { name: t('pilot.task.delivered') }), toggle: (v) => void onAgent('delivered', v), more: t('pilot.more.delivered'), card: 'auto-delivered' },
    { key: 'replies', on: auto.replies.enabled, icon: 'info', tone: 'violet', label: t('pilot.agentSwitch', { name: t('pilot.task.replies') }), toggle: (v) => void onAgent('replies', v), more: t('auto.replies.never'), card: 'auto-replies' },
    { key: 'priceCuts', on: cfg.priceCuts, icon: 'trendUp', tone: 'cobalt', label: t('pilot.priceCuts'), toggle: (v) => void save({ ...cfg, priceCuts: v }), more: t('pilot.priceCutsHint') },
    { key: 'reposts', on: cfg.reposts, icon: 'repost', tone: 'cyan', label: t('pilot.reposts'), toggle: (v) => void save({ ...cfg, reposts: v }), more: t('pilot.repostsHint') },
    { key: 'labels', on: cfg.labels, icon: 'download', tone: 'violet', label: t('pilot.labels'), toggle: (v) => void save({ ...cfg, labels: v }), more: t('pilot.labelsHint') },
    { key: 'weekly', on: cfg.weekly, icon: 'calendar', tone: 'emerald', label: t('pilot.weekly'), toggle: (v) => void save({ ...cfg, weekly: v }), more: t('pilot.weeklyHint') },
  ];
  const allOn = cfg.enabled && agents.every((a) => a.on);
  const next = cfg.enabled ? nextPilotAt(Date.now(), cfg.hours) : null;
  const hours = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h} h` }));
  return (
    <Card className="span-12" title={t('pilot.title')} hint={t('pilot.hint')} icon="repost" tone="violet">
      <div className="stack-4" data-testid="pilot">
        {/* The master switch, the next round, and « everything to ERA ». */}
        <div className="row wrap" style={{ gap: 16, alignItems: 'center', padding: 14, borderRadius: 14, background: cfg.enabled ? 'var(--emerald-soft)' : 'var(--surface-sunken)', border: `1px solid ${cfg.enabled ? 'var(--emerald)' : 'var(--border)'}` }}>
          <label htmlFor="pilot-on" className="row" style={{ gap: 12, alignItems: 'center', cursor: 'pointer' }}>
            <input id="pilot-on" type="checkbox" role="switch" className="checkbox" checked={cfg.enabled} disabled={!others.real} onChange={(e) => void save({ ...cfg, enabled: e.target.checked })} style={{ width: 22, height: 22 }} />
            <span className="stack" style={{ gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{t('pilot.enable')}</span>
              {next !== null ? (
                <span className="t-small" data-testid="pilot-next">
                  {t('pilot.next', { when: dateLong(next), hour: new Date(next).getHours() })} <span className="t-muted">({untilText(next, Date.now())})</span>
                </span>
              ) : (
                <span className="t-small t-muted">{t('pilot.offState')}</span>
              )}
            </span>
          </label>
          <span className="grow" />
          {!allOn && (
            <Button variant="primary" icon="check" disabled={!others.real} onClick={() => void giveAll()} title={t('pilot.allHint')}>
              {t('pilot.all')}
            </Button>
          )}
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
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
            <Button size="sm" variant="ghost" icon="plus" onClick={() => void save({ ...cfg, hours: added })}>
              {t('pilot.addHour')}
            </Button>
          )}
          <Field label={t('pilot.weekDay')} htmlFor="pilot-day">
            <Select id="pilot-day" value={String(cfg.weekDay)} disabled={!cfg.weekly} onChange={(e) => void save({ ...cfg, weekDay: Number(e.target.value) })} options={WEEK_DAYS.map((d, i) => ({ value: String(i), label: d[0]!.toUpperCase() + d.slice(1) })).slice(1).concat({ value: '0', label: WEEK_DAYS[0] })} />
          </Field>
        </div>
        {/* One tile per agent: on/off at a glance, its own switch, its details on demand. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }} aria-label={t('pilot.tasks')}>
          {agents.map((a) => (
            <div key={a.key} data-agent={a.key} className="stack" style={{ gap: 8, padding: 12, borderRadius: 12, border: `1px solid ${a.on ? 'var(--emerald)' : 'var(--border)'}`, background: a.on ? 'var(--surface)' : 'var(--surface-sunken)', transition: 'border-color var(--t-normal) var(--ease), background var(--t-normal) var(--ease)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <IconTile name={a.icon} tone={a.tone} size="sm" />
                <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="t-small">
                    {t(`pilot.task.${a.key}`)} {a.on ? '✓' : t('pilot.off')}
                  </strong>
                  <span className="t-small t-muted">{t(`pilot.short.${a.key}`)}</span>
                </span>
                <input type="checkbox" role="switch" className="checkbox" aria-label={a.label} checked={a.on} disabled={!others.real} onChange={(e) => a.toggle(e.target.checked)} style={{ marginTop: 2 }} />
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="t-small t-faint" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }} aria-expanded={details === a.key} onClick={() => setDetails(details === a.key ? null : a.key)}>
                  {t('pilot.details')}
                </button>
                {a.card && (
                  <button type="button" className="t-small t-faint" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => document.querySelector(`[data-testid="${a.card}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {t('pilot.tune')}
                  </button>
                )}
              </div>
              {details === a.key && <p className="t-small t-faint" style={{ margin: 0 }}>{a.more}</p>}
            </div>
          ))}
        </div>
        <div className="row wrap t-small t-faint" style={{ gap: 6 }}>
          <span>{t('pilot.also')}</span>
          {(
            [
              ['refresh', true],
              ['alerts', others.alerts],
              ['backup', others.backup],
            ] as [string, boolean][]
          ).map(([k, on]) => (
            <Badge key={k} tone={on ? 'emerald' : 'neutral'}>
              {t(`pilot.task.${k}`)} {on ? '✓' : t('pilot.off')}
            </Badge>
          ))}
        </div>
        {!others.real && <p className="t-small t-warn">{t('pilot.notReal')}</p>}
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="primary" icon="check" loading={busy} disabled={busy || !others.real} onClick={() => void runNow()}>
            {t('pilot.runNow')}
          </Button>
          <Button variant="ghost" icon="eye" loading={busy} disabled={busy || !others.real} onClick={() => void runNow(true)}>
            {t('pilot.simulate')}
          </Button>
          <Button variant="ghost" icon="calendar" loading={weeklyBusy} disabled={weeklyBusy || !others.real} onClick={() => void weeklyNow()}>
            {t('pilot.weeklyNow')}
          </Button>
        </div>
        <details className="t-small t-faint">
          <summary style={{ cursor: 'pointer' }}>{t('pilot.howTitle')}</summary>
          <ul className="stack" style={{ margin: '8px 0 0', paddingLeft: 18, gap: 4 }}>
            <li>{t('pilot.how')}</li>
            <li>{t('pilot.tab')}</li>
            <li>{t('pilot.sessions')}</li>
            <li>{t('pilot.you')}</li>
          </ul>
        </details>
      </div>
    </Card>
  );
}
