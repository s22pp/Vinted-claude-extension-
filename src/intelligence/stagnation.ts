import { daysBetween } from '@/domain/time';
import type { ComparableAnalysis } from './comparables';
import type { ItemView } from './portfolio';
import type { SellerModel } from './seller-model';
import { clamp } from './stats';

export type StagnationState =
  | 'HEALTHY'
  | 'TOO_EARLY'
  | 'LOW_VISIBILITY'
  | 'HIGH_VISIBILITY_LOW_INTEREST'
  | 'FAVORITES_NO_CONVERSION'
  | 'PRICE_MISALIGNED'
  | 'LOW_DEMAND'
  | 'INSUFFICIENT_DATA';

export type StagnationAction = 'WAIT' | 'REPRICE' | 'SMALL_DROP' | 'REPOST' | 'REVIEW_LISTING' | 'HOLD';

export interface StagnationDiagnosis {
  state: StagnationState;
  stagnant: boolean;
  action: StagnationAction;
  daysListed: number;
  thresholdDays: number;
  views: number | null;
  favorites: number | null;
  viewsPerDay: number | null;
  favoriteRate: number | null;
  priceDeltaPct: number | null;
  /** Reposting destroys views and favourites: never suggested when favourites exist. */
  repostSafe: boolean;
}

/** Stagnation threshold adapts to the seller's own rhythm (p90 days-to-sale × 1.5, clamped 10–45 d). */
export function stagnationThreshold(model: SellerModel | null): number {
  if (!model?.p90Days) return 21;
  return Math.round(clamp(model.p90Days * 1.5, 10, 45));
}

export function diagnoseStagnation(
  view: ItemView,
  analysis: ComparableAnalysis | null,
  model: SellerModel | null,
  now: number,
): StagnationDiagnosis | null {
  const l = view.current;
  if (!l || !view.inStock) return null;
  // Age counts from the first listing: a republish does not reset how long capital has been waiting.
  const age = view.firstListedAt === null ? 0 : daysBetween(view.firstListedAt, now);
  const currentAge = Math.max(1, view.daysListed ?? 1);
  const threshold = stagnationThreshold(model);
  const views = l.views;
  const favorites = l.favorites;
  const vpd = views === null ? null : views / currentAge;
  const favRate = views && favorites !== null ? favorites / views : null;
  const usable = analysis && analysis.quality !== 'INSUFFICIENT' && analysis.distribution;
  const priceDeltaPct = usable ? (l.priceCents - analysis.distribution!.p50) / analysis.distribution!.p50 : null;
  const repostSafe = (favorites ?? 0) === 0;

  const out = (state: StagnationState, action: StagnationAction, stagnant = true): StagnationDiagnosis => ({
    state,
    stagnant,
    action,
    daysListed: age,
    thresholdDays: threshold,
    views,
    favorites,
    viewsPerDay: vpd,
    favoriteRate: favRate,
    priceDeltaPct,
    repostSafe,
  });

  if (views === null) return out('INSUFFICIENT_DATA', 'WAIT', false);
  if (age < threshold) {
    if (currentAge >= 5 && views === 0) return out('LOW_VISIBILITY', 'REPRICE');
    return out('TOO_EARLY', 'WAIT', false);
  }
  // Favourites only signal "waiting for a drop" when they are dense (≥ 3 and ≥ 4 % of views), not 3 over months.
  if ((favorites ?? 0) >= 3 && (favRate ?? 0) >= 0.04) return out('FAVORITES_NO_CONVERSION', 'SMALL_DROP');
  if (views >= 80 && (favRate ?? 0) < 0.02) {
    return out('HIGH_VISIBILITY_LOW_INTEREST', priceDeltaPct !== null && priceDeltaPct <= 0.05 ? 'REVIEW_LISTING' : 'REPRICE');
  }
  if (priceDeltaPct !== null && priceDeltaPct > 0.2 && analysis!.quality !== 'LOW') return out('PRICE_MISALIGNED', 'REPRICE');
  if ((vpd ?? 0) < 1.5 && views < 40) return out('LOW_VISIBILITY', repostSafe ? 'REPOST' : 'SMALL_DROP');
  return out('LOW_DEMAND', priceDeltaPct !== null && priceDeltaPct > 0 ? 'REPRICE' : 'HOLD');
}
