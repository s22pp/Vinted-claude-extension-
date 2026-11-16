/**
 * The autopilot: rounds at the seller's chosen hours (12 h and 21 h by default), run by ERA in the seller's own Chrome —
 * refresh, offers, favourites, delivered parcels, buy alerts, backup — then one notification: what was done, and what
 * is left that only the seller can do (parcels to drop off, parcels to collect). Pure: the clock and the notice.
 */

export const PILOT_KEY = 'pilot';
export interface PilotConfig {
  enabled: boolean;
  /** Local hours of the rounds, 0–23. */
  hours: number[];
}
export const PILOT_DEFAULTS: PilotConfig = { enabled: false, hours: [12, 21] };

export function pilotConfig(c: Partial<PilotConfig> | null | undefined): PilotConfig {
  const hours = [...new Set((c?.hours ?? PILOT_DEFAULTS.hours).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
  return { enabled: c?.enabled === true, hours: hours.length ? hours : PILOT_DEFAULTS.hours };
}

/** The next round strictly after `now`, at one of the hours (local time), minute 0. */
export function nextPilotAt(now: number, hours: readonly number[]): number {
  const d = new Date(now);
  for (let day = 0; day < 2; day++) {
    for (const h of [...hours].sort((a, b) => a - b)) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, h, 0, 0, 0).getTime();
      if (t > now) return t;
    }
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hours[0] ?? 12, 0, 0, 0).getTime();
}

/** A round missed by more than this (Chrome closed at its hour) is not run late: the next one comes. */
export const PILOT_LATE_MS = 3 * 3_600_000;

export interface PilotRound {
  /** The round's hour, as the seller set it. */
  hour: number;
  /** Why the round stopped before its end (a block, a logout, no Vinted tab…), null when it went through. */
  stopped: string | null;
  imported: { listings: number; sold: number } | null;
  offers: number;
  favourites: number;
  delivered: number;
  deals: number;
  backup: boolean;
  /** Left for the seller, read after the round. */
  toShip: number;
  late: number;
  toCollect: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The notification: what ERA did, then what only the seller can do. */
export function pilotNotice(r: PilotRound): { title: string; lines: string[] } {
  const done = [
    r.offers && plural(r.offers, 'offre traitée', 'offres traitées'),
    r.favourites && plural(r.favourites, 'message favori', 'messages favoris'),
    r.delivered && plural(r.delivered, 'message colis livré', 'messages colis livré'),
    r.deals && plural(r.deals, 'affaire repérée', 'affaires repérées'),
    r.backup && 'sauvegarde faite',
  ].filter((x): x is string => !!x);
  const todo = [
    r.toShip && `${plural(r.toShip, 'colis', 'colis')} à envoyer (bordereaux dans Ventes)`,
    r.late && `${plural(r.late, 'colis', 'colis')} à surveiller`,
    r.toCollect && `${plural(r.toCollect, 'colis', 'colis')} à retirer`,
  ].filter((x): x is string => !!x);
  const title = r.stopped ? `Tournée de ${r.hour} h arrêtée` : `Tournée de ${r.hour} h faite`;
  return {
    title,
    lines: [
      ...(r.stopped ? [`Arrêt : ${r.stopped}`] : []),
      ...(r.imported ? [`Stock lu : ${plural(r.imported.listings, 'annonce', 'annonces')}, ${plural(r.imported.sold, 'vente', 'ventes')}`] : []),
      done.length ? `Fait : ${done.join(' · ')}` : 'Fait : rien à traiter',
      todo.length ? `Pour vous : ${todo.join(' · ')}` : 'Pour vous : rien d’urgent',
    ],
  };
}
