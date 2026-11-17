/**
 * « La journée d'ERA » (skill « era-visuel »): the seller's day on one line — the autopilot's rounds at their hours, and
 * every action ERA took, at its time, from the journal. Pure: what goes where on the day, nothing invented (a round not
 * in the journal is « à venir » or « manquée », never « faite »).
 */

export type EventGroup = 'MESSAGE' | 'OFFER' | 'PRICE' | 'LABEL' | 'PUBLISH' | 'LISTING';

export interface JournalLike {
  at: number;
  kind: string;
  ok: boolean;
  dryRun: boolean;
  target: string;
  detail: string;
}

export interface DayEvent {
  at: number;
  /** Position on the day, 0 (midnight) to 1. */
  x: number;
  group: EventGroup;
  ok: boolean;
  target: string;
}

/** LATE: its hour passed without it (Chrome closed?) — it can still run within the grace; MISSED: too late now. */
export type RoundStatus = 'DONE' | 'STOPPED' | 'LATE' | 'NEXT' | 'LATER' | 'MISSED';

export interface DayRound {
  hour: number;
  x: number;
  status: RoundStatus;
  /** When it ran (the journal's line), and what it said. */
  at: number | null;
  lines: string[];
}

const GROUP: Record<string, EventGroup> = {
  FAV_MESSAGE: 'MESSAGE',
  FAV_BUNDLE: 'MESSAGE',
  DELIVERED_MESSAGE: 'MESSAGE',
  REPLY: 'MESSAGE',
  FAV_OFFER: 'OFFER',
  OFFER_ACCEPT: 'OFFER',
  OFFER_COUNTER: 'OFFER',
  OFFER_REJECT: 'OFFER',
  PRICE: 'PRICE',
  LABEL: 'LABEL',
  PUBLISH: 'PUBLISH',
  DRAFT: 'LISTING',
  REPOST: 'LISTING',
  DESCRIPTION: 'LISTING',
  TITLE: 'LISTING',
  HIDE: 'LISTING',
  UNHIDE: 'LISTING',
  DELETE: 'LISTING',
};

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const xOf = (t: number, day0: number) => Math.min(1, Math.max(0, (t - day0) / 86_400_000));

/** The notice's lines start so; a piece that does not belongs to the line before (the journal joins both with « · »). */
const LINE_START = /^(Stock à jour|Fait pour vous|Pour vous|Suite de vos messages|À venir|Vinted :|ERA ferait|Vinted a demandé|Vinted vous a|Le budget|vinted\.fr|Importez|Les requêtes|Tournée interrompue)/;
export function noticeLines(detail: string): string[] {
  const out: string[] = [];
  for (const piece of detail.split(' · ').slice(1)) {
    if (!out.length || LINE_START.test(piece)) out.push(piece);
    else out[out.length - 1] += ` · ${piece}`;
  }
  return out;
}

/** A round's line in the journal: « Tournée de 13 h faite · … » / « … interrompue · … » (never a simulation). */
const ROUND = /^Tournée de (\d{1,2}) h (faite|interrompue)/;

/** Today's actions (real ones only: a simulation sent nothing) and today's rounds, from the journal and the pilot's hours. */
export function dayTimeline(rows: readonly JournalLike[], hours: readonly number[], now: number, graceMs = 3 * 3_600_000): { events: DayEvent[]; rounds: DayRound[]; nowX: number } {
  const day0 = startOfDay(now);
  const today = rows.filter((r) => r.at >= day0 && r.at < day0 + 86_400_000 && !r.dryRun);
  const events: DayEvent[] = today
    .filter((r) => GROUP[r.kind])
    .map((r) => ({ at: r.at, x: xOf(r.at, day0), group: GROUP[r.kind]!, ok: r.ok, target: r.target }))
    .sort((a, b) => a.at - b.at);
  const ran = today.filter((r) => r.target === 'Pilote automatique' && ROUND.test(r.detail));
  const nextHour = [...hours].sort((a, b) => a - b).find((h) => day0 + h * 3_600_000 > now);
  const rounds: DayRound[] = [...hours]
    .sort((a, b) => a - b)
    .map((hour) => {
      const due = day0 + hour * 3_600_000;
      const line = ran.filter((r) => Number(ROUND.exec(r.detail)![1]) === hour).sort((a, b) => b.at - a.at)[0];
      if (line) return { hour, x: xOf(due, day0), status: ROUND.exec(line.detail)![2] === 'faite' ? 'DONE' : 'STOPPED', at: line.at, lines: noticeLines(line.detail) };
      const status: RoundStatus = due > now ? (hour === nextHour ? 'NEXT' : 'LATER') : now - due < graceMs ? 'LATE' : 'MISSED';
      return { hour, x: xOf(due, day0), status, at: null, lines: [] };
    });
  // A round run by hand (« Lancer une tournée maintenant ») outside the hours: shown when it ran.
  const extra: DayRound[] = ran
    .filter((r) => !hours.includes(Number(ROUND.exec(r.detail)![1])))
    .map((r) => ({ hour: Number(ROUND.exec(r.detail)![1]), x: xOf(r.at, day0), status: (ROUND.exec(r.detail)![2] === 'faite' ? 'DONE' : 'STOPPED') as RoundStatus, at: r.at, lines: noticeLines(r.detail) }));
  const byHour = new Map<number, DayRound>();
  for (const r of extra.sort((a, b) => a.at! - b.at!)) byHour.set(r.hour, r);
  return { events, rounds: [...rounds, ...byHour.values()].sort((a, b) => a.x - b.x), nowX: xOf(now, day0) };
}

/** « dans 2 h 15 » / « dans 12 min » until a time, for the next round. */
export function untilText(at: number, now: number): string {
  const min = Math.max(0, Math.round((at - now) / 60_000));
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `dans ${h} h ${String(m).padStart(2, '0')}` : `dans ${h} h`;
}
