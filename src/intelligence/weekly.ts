import { eurNumber } from '@/domain/money';
import { toCsv } from './accounting';
import type { ContactRow } from './outcomes';

/**
 * The week's task, done by the autopilot during the first round of the seller's chosen day (Monday by default): the
 * week's review, what worked (messages, offers, delays, reposts), what the week asks of the seller, and the data
 * gathered — the contacts and what followed them — saved as a CSV in the downloads. Pure: when it is due, the notice,
 * the file.
 */

export const WEEK_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
/** A listing online this long without a favourite: worth reposting (the seller's click; never one with favourites). */
export const REPOST_AFTER_DAYS = 30;

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Due on the chosen day, once (not twice the same day); also on any day once 8 days went by without it (Chrome closed
 * all of that day), never twice in a row.
 */
export function weeklyDue(now: number, day: number, lastDone: number | null): boolean {
  if (lastDone !== null && lastDone >= startOfDay(now)) return false;
  if (new Date(now).getDay() === day) return true;
  return lastDone !== null && now - lastDone >= 8 * 86_400_000;
}

export interface WeeklyInput {
  /** The week's digest (sales, listings put online, workshop). */
  digest: { title: string; lines: string[] };
  /** What worked, as sentences (only conclusions resting on enough contacts). */
  best: string[];
  contactsThisWeek: number;
  priceCuts: number;
  toList: number;
  /** Listings online REPOST_AFTER_DAYS days or more, no favourite. */
  toRepost: number;
  /** Where the week's data was saved, or why it was not. */
  file: { ok: true; file: string } | { ok: false; detail: string } | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The week's notification, calm: the week, what worked, what the week asks, where the data is. */
export function weeklyNotice(w: WeeklyInput): { title: string; lines: string[] } {
  const todo = [
    w.priceCuts && plural(w.priceCuts, 'baisse de prix prévue', 'baisses de prix prévues'),
    w.toRepost && `${plural(w.toRepost, 'annonce', 'annonces')} à republier (en ligne depuis ${REPOST_AFTER_DAYS} jours ou plus, sans favori : Outils → Republier)`,
    w.toList && `${plural(w.toList, 'article', 'articles')} à mettre en ligne (Atelier)`,
  ].filter((x): x is string => !!x);
  return {
    title: `Bilan de la semaine · ${w.digest.title.replace(/^Semaine : /, '')}`,
    lines: [
      ...w.digest.lines,
      w.best.length ? `Ce qui marche : ${w.best.join(' · ')}` : `Ce qui marche : pas encore assez d’envois mesurés pour conclure (${plural(w.contactsThisWeek, 'envoi', 'envois')} cette semaine)`,
      todo.length ? `Cette semaine pour vous : ${todo.join(' · ')}` : 'Cette semaine pour vous : rien en retard',
      w.file === null ? null : w.file.ok ? `Données relevées : ${w.file.file}` : `Données non enregistrées (${w.file.detail}) : Automatisations → Ce qui fait répondre et acheter`,
    ].filter((x): x is string => !!x),
  };
}

const KIND: Record<ContactRow['kind'], string> = {
  FAV_MESSAGE: 'Favori → message',
  FAV_OFFER: 'Favori → offre',
  FAV_BUNDLE: 'Favoris → lot',
  OFFER_ACCEPT: 'Offre acceptée',
  OFFER_COUNTER: 'Contre-offre',
  OFFER_REJECT: 'Offre refusée',
  DELIVERED: 'Colis livré → remerciement',
  REPLY: 'Réponse à un acheteur',
};
const when = (t: number | null) => (t === null ? '' : new Date(t).toISOString().slice(0, 16).replace('T', ' '));
const euros = (c: number | null) => (c === null ? '' : eurNumber(c));

/** Every contact and what followed it, one line each (French Excel: « ; », decimal comma). */
export function contactsCsv(rows: readonly ContactRow[]): string {
  return toCsv(
    ['Date', 'Type', 'Article', 'Message', 'Prix demandé (€)', 'Offre (€)', 'Offre / prix (%)', 'Délai depuis le favori (h)', 'Réponse le', 'Vendu le', 'Prix de vente (€)'],
    [...rows]
      .sort((a, b) => a.at - b.at)
      .map((r) => [
        when(r.at),
        KIND[r.kind],
        r.title,
        r.variant,
        euros(r.askCents),
        euros(r.offerCents),
        r.offerCents && r.askCents ? Math.round((r.offerCents / r.askCents) * 100) : null,
        r.delayMs === null ? null : String(Math.round((r.delayMs / 3_600_000) * 10) / 10).replace('.', ','),
        when(r.repliedAt),
        when(r.soldAt),
        euros(r.soldCents),
      ]),
  );
}

/** The week's file name: ERA-bilans/semaine-2026-11-16.csv (the day the task ran). */
export const weeklyFileName = (now: number) => {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `ERA-bilans/semaine-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
};
