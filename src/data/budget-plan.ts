/**
 * The session budget (60 calls, never raised) shared between what runs by itself and what the seller clicks. Rule:
 * reduce the plan, never the budget. Scheduled runs stop short of a reserve kept for the seller's own actions (a label,
 * a price, a search), and each schedule says what it costs.
 */

export const SESSION_CALLS = 60;
/** Scheduled runs (refresh, buy alerts, automations) never start below this many calls left. */
export const AUTO_FLOOR = 20;

export const autoAllowed = (remaining: number) => remaining >= AUTO_FLOOR;

/** What a scheduled run costs at the least, when there is nothing to do (reads only). */
export const IDLE_COST = {
  /** users/current + inbox. */
  offers: 2,
  /** favourites notifications. */
  fav: 1,
  /** profile, wardrobe, sales, purchases: typically 4 to 6. */
  refresh: 5,
  /** one search per niche, 3 niches. */
  alerts: 3,
} as const;

export interface SchedulePlan {
  autoEveryMinutes: number | null;
  fav: boolean;
  offers: boolean;
  refreshEveryHours: number | null;
  alerts: boolean;
}

/**
 * Calls per hour the schedules spend at the least, and hours before they alone bring the session down to the reserve.
 * A floor: a pass that sends messages or answers offers costs more.
 */
export function scheduleCost(p: SchedulePlan): { perHour: number; hoursToReserve: number | null } {
  const autoPass = (p.fav ? IDLE_COST.fav : 0) + (p.offers ? IDLE_COST.offers : 0);
  const auto = p.autoEveryMinutes && autoPass > 0 ? (autoPass * 60) / Math.max(15, p.autoEveryMinutes) : 0;
  const refresh = p.refreshEveryHours ? (IDLE_COST.refresh + (p.alerts ? IDLE_COST.alerts : 0)) / Math.max(1, p.refreshEveryHours) : 0;
  const perHour = Math.round((auto + refresh) * 10) / 10;
  return { perHour, hoursToReserve: perHour > 0 ? Math.round(((SESSION_CALLS - AUTO_FLOOR) / perHour) * 10) / 10 : null };
}
