import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/data/db';
import { REPLIES_PENDING_KEY } from '@/data/reply-agent';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { PendingReply } from '@/intelligence/buyer-messages';
import { type DayEvent, type DayRound, type EventGroup, dayTimeline, untilText } from '@/intelligence/day-timeline';
import { PILOT_KEY, type PilotConfig, pilotConfig } from '@/intelligence/pilot';
import { Card } from '@/ui/components/primitives';
import { go, useEra } from '../state';

const X0 = 24;
const X1 = 976;
const TRACK = 96;
const px = (x: number) => X0 + x * (X1 - X0);
const GROUP_COLOR: Record<EventGroup, string> = { MESSAGE: 'var(--violet)', OFFER: 'var(--cobalt)', PRICE: 'var(--amber)', LABEL: 'var(--cyan)', PUBLISH: 'var(--emerald)', LISTING: 'var(--text-3)' };

/** Events close in time stack up (a column per ~20 min), never on top of each other. */
function stacked(events: readonly DayEvent[]): (DayEvent & { level: number })[] {
  const cols = new Map<number, number>();
  return events.map((e) => {
    const col = Math.round(e.x * 72);
    const level = cols.get(col) ?? 0;
    cols.set(col, level + 1);
    return { ...e, level };
  });
}

/**
 * « La journée d'ERA » (skill « era-visuel »): the day on one rail — the autopilot's rounds at their hours (done,
 * interrupted, late, next with its countdown), every action ERA took at its time, and now. Below, what is left for the
 * seller: the physical work. From the journal and ERA's data only.
 */
export function DayTimeline() {
  const { t } = useI18n();
  const era = useEra();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const day0 = new Date(now).setHours(0, 0, 0, 0);
  const rows = useLiveQuery(() => db.autoLog.where('at').aboveOrEqual(day0).toArray(), [day0]);
  const pilot = useLiveQuery(async () => pilotConfig(await repo.getSetting<Partial<PilotConfig> | null>(PILOT_KEY, null)), []);
  const pending = useLiveQuery(() => repo.getSetting<PendingReply[]>(REPLIES_PENDING_KEY, []), []);
  const [open, setOpen] = useState<number | null>(null);
  if (!rows || !pilot) return null;
  const { events, rounds, nowX } = dayTimeline(rows, pilot.enabled ? pilot.hours : [], now);
  const next = rounds.find((r) => r.status === 'NEXT');
  const toShip = era.sales.filter((s) => s.sale.needsAction && s.sale.status !== 'REFUNDED').length;
  const toList = era.workshop.toList.length;
  const tasks: { key: string; n: number; route: string }[] = [
    { key: 'ship', n: toShip, route: 'sales' },
    { key: 'photos', n: toList, route: 'workshop' },
    { key: 'messages', n: pending?.length ?? 0, route: 'automations' },
  ];
  const roundFill = (r: DayRound) =>
    r.status === 'DONE' ? 'var(--emerald)' : r.status === 'STOPPED' ? 'var(--amber)' : r.status === 'MISSED' ? 'var(--surface-sunken)' : 'var(--surface)';
  const roundStroke = (r: DayRound) => (r.status === 'NEXT' ? 'var(--cobalt)' : r.status === 'LATE' ? 'var(--amber)' : r.status === 'LATER' ? 'var(--border-strong)' : 'transparent');
  const shown = stacked(events);
  return (
    <Card className="span-12" title={t('day.title')} hint={pilot.enabled ? (next ? t('day.next', { hour: next.hour, when: untilText(day0 + next.hour * 3_600_000, now) }) : t('day.noMore')) : t('day.off')} icon="clock" tone="cobalt">
      <div className="stack-3" data-testid="day-timeline">
        <svg viewBox="0 0 1000 150" width="100%" role="img" aria-label={t('day.aria', { rounds: rounds.length, done: rounds.filter((r) => r.status === 'DONE').length, actions: events.length })} style={{ display: 'block', overflow: 'visible' }}>
          {/* Night and day: the hours ERA works in are the light ones. */}
          <rect x={px(0)} y={TRACK - 34} width={px(7 / 24) - px(0)} height={48} rx={8} fill="var(--surface-sunken)" opacity={0.6} />
          <rect x={px(22 / 24)} y={TRACK - 34} width={px(1) - px(22 / 24)} height={48} rx={8} fill="var(--surface-sunken)" opacity={0.6} />
          <line x1={px(0)} x2={px(1)} y1={TRACK} y2={TRACK} stroke="var(--border-strong)" strokeWidth={2} strokeLinecap="round" />
          <line x1={px(0)} x2={px(nowX)} y1={TRACK} y2={TRACK} stroke="var(--cobalt)" strokeWidth={3} strokeLinecap="round" />
          {Array.from({ length: 9 }, (_, i) => i * 3).map((h) => (
            <g key={h}>
              <line x1={px(h / 24)} x2={px(h / 24)} y1={TRACK + 6} y2={TRACK + 11} stroke="var(--text-3)" />
              <text x={px(h / 24)} y={TRACK + 27} textAnchor="middle" fontSize={13} fill="var(--text-3)">
                {h} h
              </text>
            </g>
          ))}
          {shown.map((e, i) => (
            <circle key={i} cx={px(e.x)} cy={TRACK - 22 - e.level * 11} r={4.5} fill={e.ok ? GROUP_COLOR[e.group] : 'none'} stroke={e.ok ? 'none' : 'var(--coral)'} strokeWidth={2}>
              <title>{`${new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${t(`day.g.${e.group}`)}${e.ok ? '' : ` (${t('day.failed')})`} · ${e.target}`}</title>
            </circle>
          ))}
          {/* The rounds already run drawn last: on top of a scheduled one at nearly the same time. */}
          {[...rounds].sort((a, b) => Number(a.status === 'DONE' || a.status === 'STOPPED') - Number(b.status === 'DONE' || b.status === 'STOPPED')).map((r) => (
            <g key={r.hour} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.hour ? null : r.hour)}>
              <circle cx={px(r.x)} cy={TRACK} r={13} fill={roundFill(r)} stroke={roundStroke(r)} strokeWidth={2.5} strokeDasharray={r.status === 'LATE' ? '4 3' : undefined} />
              <text x={px(r.x)} y={TRACK + 4.5} textAnchor="middle" fontSize={12} fontWeight={700} fill={r.status === 'DONE' || r.status === 'STOPPED' ? 'var(--text-inverse)' : 'var(--text-2)'}>
                {r.status === 'DONE' ? '✓' : r.status === 'STOPPED' ? '!' : r.hour}
              </text>
              <title>{`${r.hour} h · ${t(`day.r.${r.status}`)}`}</title>
            </g>
          ))}
          <g className="day-now">
            <line x1={px(nowX)} x2={px(nowX)} y1={TRACK - 40} y2={TRACK + 12} stroke="var(--cobalt)" strokeWidth={1.5} strokeDasharray="3 3" />
            <circle cx={px(nowX)} cy={TRACK} r={5} fill="var(--cobalt)" />
          </g>
        </svg>
        <div className="row wrap" style={{ gap: 8 }}>
          {rounds.map((r) => (
            <button key={r.hour} type="button" className="seg__btn" aria-expanded={open === r.hour} onClick={() => setOpen(open === r.hour ? null : r.hour)}>
              {r.hour} h · {t(`day.r.${r.status}`)}
              {r.status === 'NEXT' ? ` (${untilText(day0 + r.hour * 3_600_000, now)})` : ''}
            </button>
          ))}
        </div>
        <div className="row wrap t-small t-faint" style={{ gap: 14 }} aria-label={t('day.legend')}>
          {(['MESSAGE', 'OFFER', 'PRICE', 'LABEL', 'PUBLISH'] as EventGroup[]).map((g) => (
              <span key={g} style={{ whiteSpace: 'nowrap' }}>
                <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: GROUP_COLOR[g], marginRight: 4 }} />
                {t(`day.g.${g}`)} · {events.filter((e) => e.group === g).length}
              </span>
            ))}
        </div>
        {open !== null && (
          <ul className="t-small stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }} data-testid="day-round-detail">
            {(rounds.find((r) => r.hour === open)?.lines.length ? rounds.find((r) => r.hour === open)!.lines : [t('day.nothingYet')]).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }} data-testid="day-physical">
          {tasks.map((k) => (
            <button key={k.key} type="button" className="card" onClick={() => go(k.route)} style={{ textAlign: 'left', padding: 14, cursor: 'pointer', border: k.n ? '1px solid var(--amber)' : undefined }}>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{k.n}</div>
              <div className="t-small" style={{ marginTop: 6 }}>
                {t(`day.task.${k.key}`, { n: k.n })}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
