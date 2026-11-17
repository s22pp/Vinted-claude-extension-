import { eurText } from '@/domain/money';

/**
 * The autopilot: rounds at the seller's chosen hours (9 h, 13 h and 21 h by default), run by ERA in the seller's own
 * Chrome — refresh, offers, favourites, delivered parcels, labels, buy alerts, backup — then one notification: what was
 * done, and what is left that only the seller can do (parcels to drop off, parcels to collect). Pure: the clock and the
 * notice.
 */

export const PILOT_KEY = 'pilot';
/** One round at the least, four at the most. */
export const PILOT_MAX_ROUNDS = 4;
export interface PilotConfig {
  enabled: boolean;
  /** Local hours of the rounds, 0–23, sorted, no two the same. */
  hours: number[];
  /** Labels of the orders to ship fetched (or ordered, like Vinted's button) and saved as PDF. Off by default. */
  labels: boolean;
  /** The week's task (review, what worked, the week's to-do, data saved as CSV) in the first round of `weekDay`. */
  weekly: boolean;
  /** The price cuts the seller's plan says are due: one per round, known cost only, never under the floor. Off by default. */
  priceCuts: boolean;
  /** Reposts of the listings that stall (30 days, no favourite): one per round, each step verified on Vinted. Off by default. */
  reposts: boolean;
  /** 0 = Sunday … 6 = Saturday; Monday by default. */
  weekDay: number;
  /** 2: hours set since three rounds became the default (an older 12 h + 21 h is the former default, not a choice). */
  v?: number;
}
export const PILOT_DEFAULTS: PilotConfig = { enabled: false, hours: [9, 13, 21], labels: false, weekly: true, weekDay: 1, priceCuts: false, reposts: false, v: 2 };
const FORMER_DEFAULT = [12, 21];

export function pilotConfig(c: Partial<PilotConfig> | null | undefined): PilotConfig {
  let raw = c?.hours ?? PILOT_DEFAULTS.hours;
  if (c?.v !== 2 && raw.length === FORMER_DEFAULT.length && raw.every((h, i) => h === FORMER_DEFAULT[i])) raw = PILOT_DEFAULTS.hours;
  const hours = [...new Set(raw.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b).slice(0, PILOT_MAX_ROUNDS);
  const weekDay = Number.isInteger(c?.weekDay) && c!.weekDay! >= 0 && c!.weekDay! <= 6 ? c!.weekDay! : PILOT_DEFAULTS.weekDay;
  return { enabled: c?.enabled === true, hours: hours.length ? hours : PILOT_DEFAULTS.hours, labels: c?.labels === true, weekly: c?.weekly !== false, weekDay, priceCuts: c?.priceCuts === true, reposts: c?.reposts === true, v: 2 };
}

/**
 * A round added (four at the most): the daytime hour (8 h–22 h) farthest from the rounds already set, the earliest on a
 * tie — 9 h, 13 h, 21 h gives 17 h. Null when no round can be added.
 */
export function addPilotHour(hours: readonly number[]): number[] | null {
  if (hours.length >= PILOT_MAX_ROUNDS) return null;
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
  let best: number | null = null;
  let score = -1;
  for (let h = 8; h <= 22; h++) {
    if (hours.includes(h)) continue;
    const d = hours.length ? Math.min(...hours.map((x) => gap(x, h))) : 24;
    if (d > score) [best, score] = [h, d];
  }
  return best === null ? null : [...hours, best].sort((a, b) => a - b);
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
/** Nor is a late round run when the next one is this close: one round, not two in a row. */
export const PILOT_NEXT_GAP_MS = 3_600_000;

/** A round due at `due`, seen at `now`: run it, unless it is too late or the next round (at `next`) is about to come. */
export const runLateRound = (due: number, now: number, next: number): boolean => now - due <= PILOT_LATE_MS && (now - due < 60_000 || next - now >= PILOT_NEXT_GAP_MS);

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
  /** Labels saved as PDF, and labels Vinted gave that the browser could not save. */
  labels: number;
  labelsNotSaved: number;
  backup: boolean;
  /** Left for the seller, read after the round. */
  toShip: number;
  late: number;
  toCollect: number;
  /** Price cuts due by the seller's plan (one click each), articles waiting in the workshop. */
  priceCuts?: number;
  toList?: number;
  /** Buyer messages answered by ERA, and those left to the seller (a question ERA cannot answer for sure). */
  replies?: number;
  toAnswer?: number;
  /** What followed earlier contacts, settled this round: answers, sales. */
  outcomes?: { replied: number; sold: number };
  /** Requests sent to Vinted by the round, all agents together. */
  calls?: number;
  /** The price cut made this round (the plan's, one per round), or why the one due was not made. */
  priceCut?: { title: string; from: number; to: number; unconfirmed: boolean };
  priceCutFailed?: string;
  /** Price cuts are ERA's (the seller ticked them): the ones left are said as coming, not as the seller's. */
  priceCutsAuto?: boolean;
  /** « Simuler une tournée »: everything read, nothing sent — the counts are what ERA would do. */
  simulated?: boolean;
  /** The repost of the round (one at most): done, the one a simulation would make, or why it stopped half-way. */
  repost?: { title: string; to: number | null; deleted: boolean } | null;
  repostFailed?: string;
  /** The article whose price the round cut (never reposted in the same round). */
  priceCutItemId?: string;
  /** Stopped for the session's budget: when it is full again (3 h without a call). */
  budgetResetAt?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const hhmm = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Why a round stopped, said calmly: what happened, that nothing is lost, and what comes next. */
const CALM_STOP: [RegExp, string][] = [
  [/^(NETWORK_403|RATE_LIMITED)/, 'Vinted a demandé une pause : ERA ne lui envoie plus rien pendant 6 h, puis attend que vous redémarriez Chrome. Vos données sont intactes.'],
  [/^NOT_LOGGED_IN/, 'Vinted vous a déconnecté : reconnectez-vous sur vinted.fr, la tournée suivante reprendra normalement.'],
  [/^BUDGET_EXHAUSTED/, 'Le budget de requêtes de la session est atteint : la tournée suivante reprendra là où celle-ci s’est arrêtée.'],
  [/^NO_VINTED_TAB/, 'vinted.fr n’a pas répondu (connexion internet ?) : la tournée suivante réessaiera.'],
  [/^pas de données Vinted/, 'Importez d’abord vos données Vinted : les tournées commenceront ensuite.'],
  [/^budget de la session gardé/, 'Les requêtes restantes sont gardées pour vos propres clics : la tournée suivante reprendra.'],
];
export const calmStop = (reason: string) => CALM_STOP.find(([re]) => re.test(reason))?.[1] ?? `Tournée interrompue (${reason}) : rien n’est perdu, la suivante réessaiera.`;

/** The notification, calm and short: what ERA did, what followed, then what is left for the seller — urgent first. */
export function pilotNotice(r: PilotRound): { title: string; lines: string[] } {
  const done = [
    r.offers && plural(r.offers, 'offre traitée', 'offres traitées'),
    r.favourites && plural(r.favourites, 'message aux favoris', 'messages aux favoris'),
    r.replies && plural(r.replies, 'réponse à un acheteur', 'réponses aux acheteurs'),
    r.delivered && plural(r.delivered, 'remerciement (colis livré)', 'remerciements (colis livrés)'),
    r.priceCut && `${r.simulated ? 'baisserait le prix' : 'prix baissé'} : ${r.priceCut.title} ${eurText(r.priceCut.from, 2)} → ${eurText(r.priceCut.to, 2)}${r.priceCut.unconfirmed ? ' (non confirmé : à vérifier)' : ''}`,
    r.repost && `${r.simulated ? 'republierait' : 'republié'} : ${r.repost.title}${r.repost.to !== null ? ` à ${eurText(r.repost.to, 2)}` : ''}${!r.simulated && !r.repost.deleted ? ' (ancienne annonce : suppression envoyée, non confirmée)' : ''}`,
    r.deals && plural(r.deals, 'affaire repérée', 'affaires repérées'),
    r.labels && `${plural(r.labels, 'bordereau prêt', 'bordereaux prêts')} (Téléchargements/ERA-bordereaux)`,
    r.backup && 'sauvegarde faite',
  ].filter((x): x is string => !!x);
  const followed = r.outcomes && (r.outcomes.replied || r.outcomes.sold) ? [r.outcomes.replied && plural(r.outcomes.replied, 'réponse reçue', 'réponses reçues'), r.outcomes.sold && plural(r.outcomes.sold, 'vente', 'ventes')].filter((x): x is string => !!x) : [];
  const todo = [
    r.toShip && `${plural(r.toShip, 'colis', 'colis')} à déposer${r.labels ? '' : ' (bordereaux dans Ventes)'}`,
    r.labelsNotSaved && `${plural(r.labelsNotSaved, 'bordereau', 'bordereaux')} à télécharger depuis Ventes`,
    r.toAnswer && `${plural(r.toAnswer, 'message', 'messages')} à voir dans ERA (Automatisations → Messages à voir)`,
    r.late && `${plural(r.late, 'colis', 'colis')} à surveiller`,
    r.toCollect && `${plural(r.toCollect, 'colis', 'colis')} à retirer`,
    r.priceCutFailed && `baisse de prix non faite (${r.priceCutFailed}) : réessayée à la tournée suivante`,
    r.repostFailed && `republication non finie (${r.repostFailed}) : reprise à la tournée suivante`,
    !r.priceCutsAuto && r.priceCuts && `${plural(r.priceCuts, 'baisse de prix prévue', 'baisses de prix prévues')} (Stock → « Baisse à faire », un clic chacune)`,
    r.toList && `${plural(r.toList, 'article', 'articles')} à mettre en ligne (Atelier)`,
  ].filter((x): x is string => !!x);
  const title = r.simulated ? `Simulation de tournée${r.stopped ? ' interrompue' : ''} : rien n’a été envoyé` : r.stopped ? `Tournée de ${r.hour} h interrompue` : `Tournée de ${r.hour} h faite`;
  return {
    title,
    lines: [
      ...(r.stopped ? [calmStop(r.stopped)] : []),
      ...(r.budgetResetAt ? [`Budget de nouveau plein vers ${hhmm(r.budgetResetAt)} (3 h sans requête à Vinted), ou dès que Chrome redémarre.`] : []),
      ...(r.imported ? [`Stock à jour : ${plural(r.imported.listings, 'annonce', 'annonces')}, ${plural(r.imported.sold, 'vente', 'ventes')}`] : []),
      // Stopped before doing anything: no « rien de nouveau » line (nothing was looked at).
      ...(r.stopped && !done.length ? [] : [r.simulated
        ? done.length
          ? `ERA ferait : ${done.join(' · ')}`
          : 'ERA ferait : rien, rien de nouveau à traiter'
        : done.length
          ? `Fait pour vous : ${done.join(' · ')}`
          : 'Fait pour vous : rien de nouveau à traiter']),
      ...(followed.length ? [`Suite de vos messages : ${followed.join(' · ')}`] : []),
      ...(r.priceCutsAuto && r.priceCuts ? [`À venir : ${plural(r.priceCuts, 'baisse de prix prévue', 'baisses de prix prévues')}, une par tournée`] : []),
      todo.length ? `Pour vous : ${todo.join(' · ')}` : 'Pour vous : rien à faire, tout est à jour',
      ...(typeof r.calls === 'number' ? [`Vinted : ${plural(r.calls, 'requête', 'requêtes')} pour toute la tournée`] : []),
    ],
  };
}
