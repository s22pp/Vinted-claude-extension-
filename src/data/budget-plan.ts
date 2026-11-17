/**
 * The session budget (60 calls, never raised) shared between what runs by itself and what the seller clicks. Rule:
 * reduce the plan, never the budget. Scheduled runs stop short of a reserve kept for the seller's own actions (a label,
 * a price, a search), and each schedule says what it costs.
 */

export const SESSION_CALLS = 60;
/** Scheduled runs (refresh, buy alerts, automations) never start below this many calls left. */
export const AUTO_FLOOR = 20;

/** A scheduled run starts only if it can make one call above the reserve (the reserve itself is never touched). */
export const autoAllowed = (remaining: number, floor = AUTO_FLOOR) => remaining > floor;
/** A round the seller starts by hand (« Lancer » or « Simuler ») keeps only this much for an urgent click. */
export const MANUAL_FLOOR = 5;

/**
 * A session ends with the browser, or after this long without a single call to Vinted — like a seller sitting down
 * again hours later: the autopilot's rounds (9 h, 13 h, 21 h) with Chrome left open for days each start a session of
 * 60, instead of all stopping from the second day. Within a session nothing changes (60 calls, 12 per minute, 1.2 s
 * apart), and a session stopped by a block (403/429) never starts again by itself: only a browser restart does.
 */
export const SESSION_GAP_MS = 3 * 3_600_000;

export const sessionOver = (s: { lastAt?: number; halted?: string | null } | undefined, now: number): boolean =>
  !!s && !s.halted && typeof s.lastAt === 'number' && now - s.lastAt >= SESSION_GAP_MS;

/** What a scheduled run costs at the least, when there is nothing to do (reads only). */
export const IDLE_COST = {
  /** users/current + inbox. */
  offers: 2,
  /** favourites notifications. */
  fav: 1,
  /** the latest sales (my_orders, page 1), for parcels delivered. */
  delivered: 1,
  /** the inbox (shared with the offers when they run), then one call per conversation waiting. */
  replies: 1,
  /** profile, wardrobe, sales, purchases: typically 4 to 6. */
  refresh: 5,
  /** one search per niche, 3 niches. */
  alerts: 3,
} as const;

export interface SchedulePlan {
  autoEveryMinutes: number | null;
  fav: boolean;
  offers: boolean;
  /** Parcel delivered → message (absent: off). */
  delivered?: boolean;
  /** Buyers' messages (absent: off). */
  replies?: boolean;
  refreshEveryHours: number | null;
  alerts: boolean;
}

/**
 * Calls per hour the schedules spend at the least, and hours before they alone bring the session down to the reserve.
 * A floor: a pass that sends messages or answers offers costs more.
 */
export function scheduleCost(p: SchedulePlan): { perHour: number; hoursToReserve: number | null } {
  const autoPass = (p.fav ? IDLE_COST.fav : 0) + (p.offers ? IDLE_COST.offers : 0) + (p.delivered ? IDLE_COST.delivered : 0) + (p.replies ? IDLE_COST.replies : 0);
  const auto = p.autoEveryMinutes && autoPass > 0 ? (autoPass * 60) / Math.max(15, p.autoEveryMinutes) : 0;
  const refresh = p.refreshEveryHours ? (IDLE_COST.refresh + (p.alerts ? IDLE_COST.alerts : 0)) / Math.max(1, p.refreshEveryHours) : 0;
  const perHour = Math.round((auto + refresh) * 10) / 10;
  return { perHour, hoursToReserve: perHour > 0 ? Math.round(((SESSION_CALLS - AUTO_FLOOR) / perHour) * 10) / 10 : null };
}
