import type { FavQueued } from './automation';
import type { FollowUp } from './follow-up';
import type { RepostNow } from './repost-now';

/**
 * The Pilote's live queue (pure): what ERA will do next and when — favourites waiting for their delay, follow-ups,
 * reposts under way, the next round — the soonest first, each with its own way to cancel when there is one.
 */
export type Cancel = { type: 'fav'; key: string } | { type: 'followup'; conversationId: string } | { type: 'repost'; itemId: string } | null;

export interface QueueEntry {
  id: string;
  kind: 'FAV' | 'FOLLOWUP' | 'REPOST' | 'ROUND';
  /** What will be done: « Offre −10 % », « Message », « Relance », « Remise en ligne », « Tournée du Pilote ». */
  action: string;
  /** On what / whom. */
  target: string;
  /** When (ms), null when it simply waits its turn. */
  at: number | null;
  /** Under way right now. */
  running: boolean;
  cancel: Cancel;
}

export function controlQueue(x: { fav: readonly FavQueued[]; followUps: readonly FollowUp[]; reposts: readonly RepostNow[]; nextRound: number | null; now: number }): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const f of x.fav) out.push({ id: `fav:${f.key}`, kind: 'FAV', action: f.offerPct !== null ? `Offre −${f.offerPct} %` : 'Message', target: `membre ${f.userId} · ${f.title}`, at: f.dueAt, running: false, cancel: { type: 'fav', key: f.key } });
  for (const f of x.followUps) out.push({ id: `fu:${f.conversationId}`, kind: 'FOLLOWUP', action: 'Relance', target: `« ${f.title} »`, at: f.dueAt, running: false, cancel: { type: 'followup', conversationId: f.conversationId } });
  for (const r of x.reposts) {
    if (r.outcome === 'WAITING') out.push({ id: `rp:${r.itemId}`, kind: 'REPOST', action: 'Remise en ligne', target: r.title, at: r.waitUntil, running: false, cancel: null });
    else if (r.outcome === 'RUNNING') out.push({ id: `rp:${r.itemId}`, kind: 'REPOST', action: 'Republication', target: r.title, at: null, running: true, cancel: null });
    else if (r.outcome === 'QUEUED') out.push({ id: `rp:${r.itemId}`, kind: 'REPOST', action: 'Republication', target: r.title, at: null, running: false, cancel: { type: 'repost', itemId: r.itemId } });
  }
  if (x.nextRound !== null) out.push({ id: 'round', kind: 'ROUND', action: 'Tournée du Pilote', target: `${new Date(x.nextRound).getHours()} h`, at: x.nextRound, running: false, cancel: null });
  // Under way first, then by time (what waits its turn goes after what is dated).
  return out.sort((a, b) => Number(b.running) - Number(a.running) || (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** « dans 03m 42s », « dans 2 h 58 », « au prochain passage » (due already), « en file » (no time). */
export function dueText(at: number | null, now: number, running = false): string {
  if (running) return 'en cours';
  if (at === null) return 'en file';
  const s = Math.ceil((at - now) / 1000);
  if (s <= 0) return 'au prochain passage';
  if (s < 3600) return `dans ${pad(Math.floor(s / 60))}m ${pad(s % 60)}s`;
  const m = Math.floor(s / 60);
  return `dans ${Math.floor(m / 60)} h ${pad(m % 60)}`;
}
