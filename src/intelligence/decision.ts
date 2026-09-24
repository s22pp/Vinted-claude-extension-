import type { Confidence } from '@/domain/entities';
import { type Cents, type MoneyMetric, roundToEuro } from '@/domain/money';
import { DAY } from '@/domain/time';
import type { CapitalSummary, CapitalTrap } from './capital';
import type { ComparableAnalysis } from './comparables';
import type { LearningSummary } from './learning';
import type { ItemView } from './portfolio';
import { type PricingResult, priceStrategies } from './pricing';
import { type SegmentStats, type SellerModel, personalEvidence, rankNiches, velocityScore } from './seller-model';
import { type StagnationDiagnosis, diagnoseStagnation } from './stagnation';

export type ActionCode =
  | 'SET_PRICE'
  | 'SMALL_DROP'
  | 'RAISE_PRICE'
  | 'FREE_CAPITAL'
  | 'REPOST'
  | 'REVIEW_LISTING'
  | 'HOLD'
  | 'ADD_COST'
  | 'ANALYZE';

export type Params = Record<string, string | number>;
export interface Coded {
  code: string;
  params: Params;
}

/** One recommendation, always: ACTION · WHY · CONFIDENCE · EXPECTED IMPACT · ALTERNATIVE. */
export interface Recommendation {
  key: string;
  itemId: string | null;
  action: ActionCode;
  actionParams: Params;
  why: Coded[];
  confidence: Confidence;
  impact: Coded;
  alternative: Coded | null;
  evidence: 'MARKET' | 'PERSONAL' | 'BOTH' | 'DATA';
  tone: 'risk' | 'warning' | 'info' | 'positive';
  priority: number;
}

export interface ItemIntel {
  view: ItemView;
  analysis: ComparableAnalysis | null;
  analysisStale: boolean;
  pricing: PricingResult | null;
  stagnation: StagnationDiagnosis | null;
  personal: SegmentStats | null;
  trap: CapitalTrap | null;
  recommendation: Recommendation | null;
}

export const ANALYSIS_TTL_DAYS = 14;

export function computeItemIntel(
  view: ItemView,
  analysis: ComparableAnalysis | null,
  model: SellerModel | null,
  learning: LearningSummary | null,
  capital: CapitalSummary | null,
  now: number,
): ItemIntel {
  const personal = model ? personalEvidence(model, view.item) : null;
  const pricing = analysis
    ? priceStrategies(
        // Re-position against the current ask: the price may have changed since the analysis.
        { ...analysis, subject: { ...analysis.subject, priceCents: view.askPrice } },
        {
          priceCents: view.askPrice,
          views: view.current?.views ?? null,
          favorites: view.current?.favorites ?? null,
          daysListed: view.daysListed,
          condition: view.item.condition,
        },
        personal,
        learning?.priceCorrection ?? 1,
      )
    : null;
  const stagnation = diagnoseStagnation(view, analysis, model, now);
  const trap = capital?.traps.find((t) => t.itemId === view.item.id) ?? null;
  const intel: ItemIntel = {
    view,
    analysis,
    analysisStale: analysis ? now - analysis.at > ANALYSIS_TTL_DAYS * DAY : false,
    pricing,
    stagnation,
    personal,
    trap,
    recommendation: null,
  };
  intel.recommendation = recommendFor(intel);
  return intel;
}

const euro = (c: Cents) => roundToEuro(c);

function option(p: PricingResult | null, s: 'FAST' | 'BALANCED' | 'MAX_MARGIN') {
  return p?.status === 'OK' ? (p.options.find((o) => o.strategy === s) ?? null) : null;
}

function evidenceOf(p: PricingResult | null): Recommendation['evidence'] {
  if (!p || p.status !== 'OK') return 'DATA';
  return p.personalSample >= 3 ? 'BOTH' : 'MARKET';
}

/** Chooses the single most useful action for an item. Pure. */
export function recommendFor(intel: ItemIntel): Recommendation | null {
  const { view, pricing, stagnation: st, trap, analysis } = intel;
  const id = view.item.id;
  const settled = view.item.status === 'RESERVED';
  const price = view.askPrice;
  const kept = analysis?.keptCount ?? 0;
  const capitalWeight = Math.min(15, (view.cost ?? 2000) / 400);
  const base = (r: Omit<Recommendation, 'key' | 'itemId' | 'evidence'> & { evidence?: Recommendation['evidence'] }): Recommendation => ({
    key: `${r.action}:${id}`,
    itemId: id,
    evidence: r.evidence ?? evidenceOf(pricing),
    ...r,
  });
  const conf: Confidence = pricing?.status === 'OK' ? pricing.confidence : 'LOW';
  const d = analysis?.distribution;
  const below = d && price !== null ? analysis!.comparables.filter((c) => c.kept && c.candidate.priceCents < price).length : 0;

  if (!settled && st?.stagnant && price !== null) {
    const over = Math.max(0, st.daysListed - st.thresholdDays);
    const common: Coded[] = [{ code: 'why.stagnant', params: { days: st.daysListed, views: st.views ?? 0, favorites: st.favorites ?? 0 } }];
    switch (st.action) {
      case 'SMALL_DROP': {
        const target = euro(Math.max(price * 0.92, option(pricing, 'FAST')?.range.min ?? 0));
        return base({
          action: 'SMALL_DROP',
          actionParams: { price: target, from: price },
          why: [...common, { code: 'why.favoritesWaiting', params: { favorites: st.favorites ?? 0 } }],
          confidence: 'MEDIUM',
          impact: { code: 'impact.notifyFavorites', params: { favorites: st.favorites ?? 0 } },
          alternative: { code: 'alt.noRepostFavorites', params: {} },
          tone: 'warning',
          priority: 66 + capitalWeight + Math.min(10, over / 3),
          evidence: 'PERSONAL',
        });
      }
      case 'REPRICE': {
        const bal = option(pricing, 'BALANCED');
        if (!bal) return analyzeReco(id, 'why.stagnantNoComps', 60 + capitalWeight, common);
        const target = st.state === 'LOW_DEMAND' ? option(pricing, 'FAST')!.range.max : bal.range.max;
        if (target >= price) break;
        return base({
          action: 'SET_PRICE',
          actionParams: { price: target, from: price },
          why: [
            st.state === 'HIGH_VISIBILITY_LOW_INTEREST'
              ? { code: 'why.highVisLowInterest', params: { views: st.views ?? 0, favorites: st.favorites ?? 0 } }
              : st.state === 'LOW_VISIBILITY'
                ? { code: 'why.lowVisibility', params: { views: st.views ?? 0, days: view.daysListed ?? 0 } }
                : common[0]!,
            { code: 'why.compsBelow', params: { n: below, total: kept, pct: Math.round((st.priceDeltaPct ?? 0) * 100) } },
          ],
          confidence: conf,
          impact: { code: 'impact.fasterLowerMargin', params: { delta: price - target } },
          alternative: { code: 'alt.keepForMargin', params: { price } },
          tone: 'risk',
          priority: 70 + capitalWeight + Math.min(10, over / 3),
        });
      }
      case 'REPOST':
        return base({
          action: 'REPOST',
          actionParams: {},
          why: [
            { code: 'why.lowVisibility', params: { views: st.views ?? 0, days: view.daysListed ?? 0 } },
            { code: 'why.repostSafe', params: {} },
          ],
          confidence: 'LOW',
          impact: { code: 'impact.visibilityReset', params: {} },
          alternative: option(pricing, 'BALANCED')
            ? { code: 'alt.repriceInstead', params: { price: option(pricing, 'BALANCED')!.range.min } }
            : { code: 'alt.wait', params: { days: 7 } },
          tone: 'warning',
          priority: 55 + capitalWeight,
          evidence: 'PERSONAL',
        });
      case 'REVIEW_LISTING':
        return base({
          action: 'REVIEW_LISTING',
          actionParams: {},
          why: [
            { code: 'why.highVisLowInterest', params: { views: st.views ?? 0, favorites: st.favorites ?? 0 } },
            { code: 'why.priceAligned', params: {} },
          ],
          confidence: 'LOW',
          impact: { code: 'impact.conversion', params: {} },
          alternative: { code: 'alt.smallDrop', params: { price: euro(price * 0.92) } },
          tone: 'warning',
          priority: 52 + capitalWeight,
        });
      case 'HOLD':
        return base({
          action: 'HOLD',
          actionParams: {},
          why: [...common, { code: 'why.priceCompetitive', params: {} }],
          confidence: conf,
          impact: { code: 'impact.none', params: {} },
          alternative: option(pricing, 'FAST')
            ? { code: 'alt.fastExit', params: { price: option(pricing, 'FAST')!.range.max } }
            : null,
          tone: 'info',
          priority: 20,
        });
      default:
        break;
    }
  }

  if (!settled && trap && price !== null) {
    const fast = option(pricing, 'FAST');
    if (fast && fast.range.max < price) {
      return base({
        action: 'FREE_CAPITAL',
        actionParams: { price: fast.range.max, from: price },
        why: [{ code: 'why.capitalTrap', params: { cost: trap.costCents, days: trap.daysHeld, profit: trap.potentialProfitCents ?? 0 } }],
        confidence: conf,
        impact: { code: 'impact.unlockCapital', params: { amount: trap.costCents } },
        alternative: { code: 'alt.keepForMargin', params: { price } },
        tone: 'warning',
        priority: 72 + capitalWeight,
      });
    }
  }

  if (!settled && pricing?.status === 'OK' && price !== null && pricing.recommended) {
    const rec = pricing.options.find((o) => o.strategy === pricing.recommended)!;
    if (pricing.currentVsRecommended === 'ABOVE' && price > rec.range.max * 1.1 && analysis!.quality !== 'LOW') {
      return base({
        action: 'SET_PRICE',
        actionParams: { price: rec.range.max, from: price },
        why: [{ code: 'why.compsBelow', params: { n: below, total: kept, pct: Math.round((analysis!.position?.deltaPct ?? 0) * 100) } }],
        confidence: conf,
        impact: { code: 'impact.fasterLowerMargin', params: { delta: price - rec.range.max } },
        alternative: { code: 'alt.keepForMargin', params: { price } },
        tone: 'warning',
        priority: 48 + capitalWeight,
      });
    }
    if (pricing.currentVsRecommended === 'BELOW' && price < rec.range.min * 0.9 && pricing.basis === 'DEMAND_PROVEN') {
      return base({
        action: 'RAISE_PRICE',
        actionParams: { price: rec.range.min, from: price },
        why: [
          { code: 'why.demandProven', params: { views: view.current?.views ?? 0, favorites: view.current?.favorites ?? 0 } },
          { code: 'why.underMarket', params: { pct: Math.round((analysis!.position?.deltaPct ?? 0) * 100) } },
        ],
        confidence: conf,
        impact: { code: 'impact.moreMargin', params: { delta: rec.range.min - price } },
        alternative: { code: 'alt.keepFast', params: { price } },
        tone: 'positive',
        priority: 45,
      });
    }
  }

  if (view.inStock && view.cost === null) {
    return {
      key: `ADD_COST:${id}`,
      itemId: id,
      action: 'ADD_COST',
      actionParams: {},
      why: [{ code: 'why.missingCost', params: {} }],
      confidence: 'HIGH',
      impact: { code: 'impact.trueProfit', params: {} },
      alternative: null,
      evidence: 'DATA',
      tone: 'info',
      priority: 30,
    };
  }

  if (!settled && view.item.status !== 'HIDDEN' && view.inStock && view.current && (!analysis || intel.analysisStale)) {
    return analyzeReco(id, analysis ? 'why.analysisStale' : 'why.noAnalysis', 25, []);
  }
  return null;
}

function analyzeReco(id: string, code: string, priority: number, extra: Coded[]): Recommendation {
  return {
    key: `ANALYZE:${id}`,
    itemId: id,
    action: 'ANALYZE',
    actionParams: {},
    why: [...extra, { code, params: {} }],
    confidence: 'HIGH',
    impact: { code: 'impact.unlockPricing', params: {} },
    alternative: null,
    evidence: 'DATA',
    tone: 'info',
    priority,
  };
}

export interface TodayPriority {
  code: 'MISSING_SALE' | 'RESERVED' | 'STAGNANT' | 'OVERPRICED' | 'MISSING_COST' | 'CAPITAL_AGED' | 'TRAPS' | 'NICHE' | 'NO_ANALYSIS';
  tone: Recommendation['tone'];
  count: number;
  amount: MoneyMetric | null;
  label: string | null;
  itemIds: string[];
}

export function todayPriorities(intel: readonly ItemIntel[], capital: CapitalSummary, model: SellerModel, views: readonly ItemView[] = []): TodayPriority[] {
  const out: TodayPriority[] = [];
  // Sold on Vinted, but no sale price known: revenue and profit are incomplete until it is entered.
  const missingSale = views.filter((v) => v.item.status === 'SOLD' && !v.sale).map((v) => v.item.id);
  if (missingSale.length) out.push({ code: 'MISSING_SALE', tone: 'warning', count: missingSale.length, amount: null, label: null, itemIds: missingSale });
  const ids = (f: (i: ItemIntel) => boolean) => intel.filter(f).map((i) => i.view.item.id);
  const stagnant = ids((i) => !!i.stagnation?.stagnant && i.recommendation?.action !== 'HOLD');
  if (stagnant.length) out.push({ code: 'STAGNANT', tone: 'risk', count: stagnant.length, amount: null, label: null, itemIds: stagnant });
  // Not double-counted with stagnant items: those are already in the first priority.
  const over = ids((i) => i.recommendation?.action === 'SET_PRICE' && !i.stagnation?.stagnant);
  if (over.length) out.push({ code: 'OVERPRICED', tone: 'warning', count: over.length, amount: null, label: null, itemIds: over });
  if (capital.traps.length)
    out.push({ code: 'TRAPS', tone: 'warning', count: capital.traps.length, amount: null, label: null, itemIds: capital.traps.map((t) => t.itemId) });
  if (capital.over60.status !== 'unknown' && capital.over60.value > 0) {
    const aged = ids((i) => i.view.inStock && (i.view.daysHeld ?? 0) >= 60);
    out.push({ code: 'CAPITAL_AGED', tone: 'warning', count: aged.length, amount: capital.over60, label: null, itemIds: aged });
  }
  const missing = ids((i) => i.view.inStock && i.view.cost === null);
  if (missing.length) out.push({ code: 'MISSING_COST', tone: 'info', count: missing.length, amount: null, label: null, itemIds: missing });
  const reserved = ids((i) => i.view.item.status === 'RESERVED');
  if (reserved.length) out.push({ code: 'RESERVED', tone: 'positive', count: reserved.length, amount: null, label: null, itemIds: reserved });
  const noAnalysis = ids((i) => i.view.inStock && !!i.view.current && (!i.analysis || i.analysisStale));
  if (noAnalysis.length) out.push({ code: 'NO_ANALYSIS', tone: 'info', count: noAnalysis.length, amount: null, label: null, itemIds: noAnalysis });
  const niches = rankNiches(model);
  const top = niches[0];
  if (top && niches.length >= 3) {
    const avg = niches.reduce((a, n) => a + velocityScore(n), 0) / niches.length;
    if (velocityScore(top) > avg * 1.4) out.push({ code: 'NICHE', tone: 'positive', count: top.sold, amount: null, label: top.label, itemIds: [] });
  }
  return out;
}
