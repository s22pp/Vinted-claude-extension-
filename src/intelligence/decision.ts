import type { Confidence } from '@/domain/entities';
import { type Cents, type MoneyMetric, roundToEuro } from '@/domain/money';
import { DAY } from '@/domain/time';
import type { CapitalSummary, CapitalTrap } from './capital';
import type { ComparableAnalysis } from './comparables';
import type { LearningSummary } from './learning';
import type { ItemView } from './portfolio';
import { type PricingResult, priceStrategies } from './pricing';
import { type SegmentStats, type SellerModel, nicheKey, personalEvidence, rankNiches, velocityScore } from './seller-model';
import type { Sensitivity } from './sensitivity';
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
  /** Measured effect of price on views for this niche (never assumed). */
  sensitivity: Sensitivity;
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
  sensitivity: Sensitivity = { status: 'UNKNOWN', basis: 'NONE', n: 0, effect: null, scope: null },
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
    sensitivity,
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

/**
 * Chooses the single most useful action for an item. Pure.
 * Rule: NO price decrease without solid evidence — a fresh market analysis (≥ 8 reliable comparables),
 * a price actually above the market (> P75), and no measurement showing that price does not move views
 * for this niche. Otherwise ERA says "analyse first" or "keep", with the numbers that justify it.
 */
export function recommendFor(intel: ItemIntel): Recommendation | null {
  const { view, pricing, stagnation: st, trap, analysis, personal } = intel;
  const sens = intel.sensitivity;
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
  const d = analysis?.distribution ?? null;
  const marketSolid =
    !!analysis && !!d && !intel.analysisStale && (analysis.quality === 'HIGH' || analysis.quality === 'MEDIUM') && (analysis.source === 'VINTED' || view.item.isDemo);
  const insensitive = sens.status === 'INSENSITIVE';
  // Price-lowering confidence is capped while the price effect is unmeasured for this niche.
  const baseConf: Confidence = pricing?.status === 'OK' ? pricing.confidence : 'LOW';
  const conf: Confidence = sens.status === 'SENSITIVE' ? baseConf : baseConf === 'HIGH' ? 'MEDIUM' : baseConf;
  const floor = view.cost ?? 0; // never propose selling below what was paid

  const evidence: Coded[] = [];
  if (marketSolid) evidence.push({ code: 'why.marketEvidence', params: { n: kept, p25: d!.p25, p50: d!.p50, p75: d!.p75 } });
  if (personal && personal.sold >= 3 && personal.medianSaleCents !== null)
    evidence.push({ code: 'why.personalRealized', params: { n: personal.sold, realized: personal.medianSaleCents } });
  const sensLine: Coded =
    sens.basis === 'DROPS'
      ? { code: 'why.sensDrops', params: { n: sens.n, pct: `${(sens.effect ?? 0) >= 0 ? '+' : '−'}${Math.abs(Math.round((sens.effect ?? 0) * 100))} %` } }
      : sens.basis === 'CROSS'
        ? { code: sens.status === 'SENSITIVE' ? 'why.sensCrossYes' : sens.status === 'INSENSITIVE' ? 'why.sensCrossNo' : 'why.sensCrossUnclear', params: { n: sens.n } }
        : { code: 'why.sensUnknown', params: {} };

  const hold = (why: Coded[], alt: Coded | null, priority = 38): Recommendation =>
    base({ action: 'HOLD', actionParams: {}, why, confidence: marketSolid ? baseConf : 'LOW', impact: { code: 'impact.keepMargin', params: {} }, alternative: alt, tone: 'info', priority });

  if (!settled && st?.stagnant && price !== null) {
    const over = Math.max(0, st.daysListed - st.thresholdDays);
    const common: Coded = { code: 'why.stagnant', params: { days: st.daysListed, views: st.views ?? 0, favorites: st.favorites ?? 0 } };
    const wantsLower = st.action === 'SMALL_DROP' || st.action === 'REPRICE';
    if (wantsLower && !marketSolid) return analyzeReco(id, 'why.stagnantNeedsData', 60 + capitalWeight, [common]);
    if (wantsLower && insensitive) return hold([common, sensLine, { code: 'why.priceNotLever', params: {} }, ...evidence], { code: 'alt.titleReference', params: {} }, 45);

    switch (st.action) {
      case 'SMALL_DROP': {
        if (price < d!.p50) return hold([common, { code: 'why.priceAlreadyMarket', params: { pct: Math.round(((price - d!.p50) / d!.p50) * 100) } }, ...evidence], null);
        const target = euro(Math.max(price * 0.92, d!.p50, floor));
        if (target >= price) break;
        return base({
          action: 'SMALL_DROP',
          actionParams: { price: target, from: price },
          why: [common, { code: 'why.favoritesWaiting', params: { favorites: st.favorites ?? 0 } }, ...evidence, sensLine],
          confidence: conf,
          impact: { code: 'impact.notifyFavorites', params: { favorites: st.favorites ?? 0 } },
          alternative: { code: 'alt.noRepostFavorites', params: {} },
          tone: 'warning',
          priority: 66 + capitalWeight + Math.min(10, over / 3),
          evidence: 'BOTH',
        });
      }
      case 'REPRICE': {
        const bal = option(pricing, 'BALANCED');
        if (!bal) return analyzeReco(id, 'why.stagnantNeedsData', 60 + capitalWeight, [common]);
        if (price <= d!.p75)
          return hold([common, { code: 'why.priceAlreadyMarket', params: { pct: Math.round(((price - d!.p50) / d!.p50) * 100) } }, ...evidence, sensLine], { code: 'alt.titleReference', params: {} });
        const target = euro(Math.max(st.state === 'LOW_DEMAND' ? option(pricing, 'FAST')!.range.max : bal.range.max, floor));
        if (target >= price) break;
        const below = analysis!.comparables.filter((c) => c.kept && c.candidate.priceCents < price).length;
        return base({
          action: 'SET_PRICE',
          actionParams: { price: target, from: price },
          why: [
            st.state === 'HIGH_VISIBILITY_LOW_INTEREST'
              ? { code: 'why.highVisLowInterest', params: { views: st.views ?? 0, favorites: st.favorites ?? 0 } }
              : st.state === 'LOW_VISIBILITY'
                ? { code: 'why.lowVisibility', params: { views: st.views ?? 0, days: view.daysListed ?? 0 } }
                : common,
            { code: 'why.compsBelow', params: { n: below, total: kept, pct: Math.round((st.priceDeltaPct ?? 0) * 100) } },
            ...evidence,
            sensLine,
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
          alternative: { code: 'alt.titleReference', params: {} },
          tone: 'warning',
          priority: 55 + capitalWeight,
          evidence: 'PERSONAL',
        });
      case 'REVIEW_LISTING':
        return base({
          action: 'REVIEW_LISTING',
          actionParams: {},
          why: [{ code: 'why.highVisLowInterest', params: { views: st.views ?? 0, favorites: st.favorites ?? 0 } }, { code: 'why.priceAligned', params: {} }, ...evidence],
          confidence: 'LOW',
          impact: { code: 'impact.conversion', params: {} },
          alternative: { code: 'alt.titleReference', params: {} },
          tone: 'warning',
          priority: 52 + capitalWeight,
        });
      case 'HOLD':
        return hold([common, { code: 'why.priceCompetitive', params: {} }, ...evidence], null, 20);
      default:
        break;
    }
  }

  if (!settled && trap && price !== null && marketSolid && !insensitive) {
    const fast = option(pricing, 'FAST');
    const target = fast ? euro(Math.max(fast.range.max, floor)) : null;
    if (target !== null && target < price) {
      return base({
        action: 'FREE_CAPITAL',
        actionParams: { price: target, from: price },
        why: [{ code: 'why.capitalTrap', params: { cost: trap.costCents, days: trap.daysHeld, profit: trap.potentialProfitCents ?? 0 } }, ...evidence, sensLine],
        confidence: conf,
        impact: { code: 'impact.unlockCapital', params: { amount: trap.costCents } },
        alternative: { code: 'alt.keepForMargin', params: { price } },
        tone: 'warning',
        priority: 72 + capitalWeight,
      });
    }
  }

  if (!settled && marketSolid && pricing?.status === 'OK' && price !== null && pricing.recommended) {
    const rec = pricing.options.find((o) => o.strategy === pricing.recommended)!;
    if (!insensitive && pricing.currentVsRecommended === 'ABOVE' && price > d!.p75 * 1.05 && price > rec.range.max * 1.1) {
      const target = euro(Math.max(rec.range.max, floor));
      const below = analysis!.comparables.filter((c) => c.kept && c.candidate.priceCents < price).length;
      if (target < price)
        return base({
          action: 'SET_PRICE',
          actionParams: { price: target, from: price },
          why: [{ code: 'why.compsBelow', params: { n: below, total: kept, pct: Math.round((analysis!.position?.deltaPct ?? 0) * 100) } }, ...evidence, sensLine],
          confidence: conf,
          impact: { code: 'impact.fasterLowerMargin', params: { delta: price - target } },
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
          ...evidence,
        ],
        confidence: baseConf,
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
  code:
    | 'MISSING_SALE'
    | 'RESERVED'
    | 'STAGNANT'
    | 'OVERPRICED'
    | 'MISSING_COST'
    | 'MISSING_SHIPPING'
    | 'CAPITAL_AGED'
    | 'TRAPS'
    | 'NICHE'
    | 'NO_ANALYSIS'
    | 'TO_LIST'
    | 'REFUND_REASON';
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
  // A fact, not an opinion: fresh, reliable comparables and an ask above their P75.
  const over = ids(
    (i) =>
      !!i.analysis &&
      !i.analysisStale &&
      (i.analysis.quality === 'HIGH' || i.analysis.quality === 'MEDIUM') &&
      !!i.analysis.distribution &&
      i.view.askPrice !== null &&
      i.view.askPrice > i.analysis.distribution.p75,
  );
  if (over.length) out.push({ code: 'OVERPRICED', tone: 'warning', count: over.length, amount: null, label: null, itemIds: over });
  if (capital.traps.length)
    out.push({ code: 'TRAPS', tone: 'warning', count: capital.traps.length, amount: null, label: null, itemIds: capital.traps.map((t) => t.itemId) });
  if (capital.over60.status !== 'unknown' && capital.over60.value > 0) {
    const aged = ids((i) => i.view.inStock && (i.view.daysHeld ?? 0) >= 60);
    out.push({ code: 'CAPITAL_AGED', tone: 'warning', count: aged.length, amount: capital.over60, label: null, itemIds: aged });
  }
  const missing = ids((i) => i.view.inStock && i.view.cost === null);
  if (missing.length) out.push({ code: 'MISSING_COST', tone: 'info', count: missing.length, amount: null, label: null, itemIds: missing });
  // Known item price + buyer protection, but shipping unknown: the cost is a lower bound, never "complete".
  const noShip = ids((i) => i.view.inStock && i.view.cost !== null && !i.view.costComplete);
  if (noShip.length) out.push({ code: 'MISSING_SHIPPING', tone: 'info', count: noShip.length, amount: null, label: null, itemIds: noShip });
  const reserved = ids((i) => i.view.item.status === 'RESERVED');
  if (reserved.length) out.push({ code: 'RESERVED', tone: 'positive', count: reserved.length, amount: null, label: null, itemIds: reserved });
  const noAnalysis = ids((i) => i.view.inStock && !!i.view.current && (!i.analysis || i.analysisStale));
  if (noAnalysis.length) out.push({ code: 'NO_ANALYSIS', tone: 'info', count: noAnalysis.length, amount: null, label: null, itemIds: noAnalysis });
  const niches = rankNiches(model);
  const top = niches[0];
  if (top && niches.length >= 3) {
    const avg = niches.reduce((a, n) => a + velocityScore(n), 0) / niches.length;
    if (velocityScore(top) > avg * 1.4) {
      // Opens what you hold in that niche, else what you sold in it.
      const inNiche = views.filter((v) => nicheKey(v.item.brand, v.item.model, v.item.category) === top.key);
      const held = inNiche.filter((v) => v.inStock).map((v) => v.item.id);
      out.push({ code: 'NICHE', tone: 'positive', count: top.sold, amount: null, label: top.label, itemIds: held.length ? held : inNiche.map((v) => v.item.id) });
    }
  }
  return out;
}
