import type { Category, Condition, Gender } from '@/domain/entities';
import type { Cents, MoneyRange } from '@/domain/money';
import { roundToEuro } from '@/domain/money';
import type { ComparableAnalysis, ComparableSubject } from './comparables';
import { type PricingResult, priceStrategies } from './pricing';
import type { SegmentStats, SellerModel } from './seller-model';
import { clamp, mean } from './stats';

export interface BuyInput {
  title: string;
  brand: string;
  model: string | null;
  category: Category;
  gender: Gender | null;
  size: string | null;
  condition: Condition | null;
  purchasePriceCents: Cents;
  url: string | null;
}

export function buySubject(input: BuyInput): ComparableSubject {
  return {
    title: input.title || `${input.brand} ${input.model ?? ''}`.trim(),
    brand: input.brand,
    model: input.model,
    category: input.category,
    gender: input.gender,
    size: input.size,
    condition: input.condition,
    material: null,
    era: null,
    priceCents: null,
  };
}

export type DealDimensionKey = 'margin' | 'demand' | 'velocity' | 'risk' | 'rarity' | 'resale' | 'capital';
export type Evidence = 'MARKET' | 'PERSONAL' | 'INFERRED';

export interface DealDimension {
  key: DealDimensionKey;
  score: number;
  max: number;
  evidence: Evidence;
  reason: string;
  params: Record<string, string | number>;
}

export interface DealScore {
  total: number;
  dimensions: DealDimension[];
}

export type Level = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type Verdict = 'BUY' | 'NEGOTIATE' | 'AVOID' | 'INSUFFICIENT_DATA';

export interface BuyAnalysis {
  input: BuyInput;
  analysis: ComparableAnalysis;
  pricing: PricingResult;
  profit: MoneyRange | null;
  roi: { min: number; max: number } | null;
  demand: Level;
  capitalRisk: Exclude<Level, 'UNKNOWN'>;
  dealScore: DealScore | null;
  /** Highest purchase price that still leaves ≥ 100 % ROI and ≥ 12 € at the balanced low end. */
  maxBuyCents: Cents | null;
  verdict: Verdict;
  personal: SegmentStats | null;
}

const MAX: Record<DealDimensionKey, number> = { margin: 25, demand: 20, velocity: 15, risk: 15, rarity: 10, resale: 10, capital: 5 };

export function analyzeBuy(
  input: BuyInput,
  analysis: ComparableAnalysis,
  model: SellerModel | null,
  personal: SegmentStats | null,
  priceCorrection = 1,
): BuyAnalysis {
  const pricing = priceStrategies(
    analysis,
    { priceCents: null, views: null, favorites: null, daysListed: null, condition: input.condition },
    personal,
    priceCorrection,
  );
  const cost = input.purchasePriceCents;
  const favs = analysis.comparables.filter((c) => c.kept && c.candidate.favorites !== null).map((c) => c.candidate.favorites!);
  const avgFav = favs.length >= 3 ? mean(favs) : null;
  const demand: Level = avgFav === null ? 'UNKNOWN' : avgFav >= 8 ? 'HIGH' : avgFav >= 3 ? 'MEDIUM' : 'LOW';

  if (pricing.status !== 'OK') {
    return {
      input,
      analysis,
      pricing,
      profit: null,
      roi: null,
      demand,
      capitalRisk: cost >= 5000 ? 'HIGH' : 'MEDIUM',
      dealScore: null,
      maxBuyCents: null,
      verdict: 'INSUFFICIENT_DATA',
      personal,
    };
  }

  const fast = pricing.options.find((o) => o.strategy === 'FAST')!;
  const bal = pricing.options.find((o) => o.strategy === 'BALANCED')!;
  const profit = { min: fast.range.min - cost, max: bal.range.max - cost };
  const roi = cost > 0 ? { min: profit.min / cost, max: profit.max / cost } : null;
  const balMid = (bal.range.min + bal.range.max) / 2;
  const expProfit = balMid * priceCorrection - cost;

  const dims: DealDimension[] = [];
  const push = (key: DealDimensionKey, ratio: number, evidence: Evidence, reason: string, params: Record<string, string | number> = {}) =>
    dims.push({ key, score: Math.round(clamp(ratio) * MAX[key]), max: MAX[key], evidence, reason, params });

  // Margin: blend of ROI (100 %+ is excellent) and absolute euros (30 €+ is excellent).
  const roiMid = cost > 0 ? expProfit / cost : 2;
  push('margin', 0.6 * clamp(roiMid / 1.5) + 0.4 * clamp(expProfit / 3000), 'MARKET', 'deal.margin', {
    profit: Math.round(expProfit),
    roi: Math.round(roiMid * 100),
  });

  // Demand: favourites on comparable listings, blended with personal sell-through when known.
  const favRatio = avgFav === null ? 0.5 : clamp(avgFav / 8);
  if (personal?.sellThrough != null && personal.sold >= 3) {
    push('demand', 0.6 * favRatio + 0.4 * personal.sellThrough, 'PERSONAL', 'deal.demandPersonal', {
      fav: avgFav === null ? '—' : avgFav.toFixed(1),
      st: Math.round(personal.sellThrough * 100),
    });
  } else {
    push('demand', favRatio, avgFav === null ? 'INFERRED' : 'MARKET', avgFav === null ? 'deal.demandUnknown' : 'deal.demand', {
      fav: avgFav === null ? '—' : avgFav.toFixed(1),
    });
  }

  // Velocity: personal median days when we have them; otherwise cheaper items rotate faster (measured).
  if (personal?.medianDays != null && personal.sold >= 3) {
    push('velocity', 1 - clamp((personal.medianDays - 3) / 40), 'PERSONAL', 'deal.velocityPersonal', {
      days: Math.round(personal.medianDays),
      n: personal.sold,
    });
  } else {
    push('velocity', 1 - clamp((balMid - 2000) / 10000) * 0.8, 'INFERRED', 'deal.velocityInferred', {
      price: roundToEuro(balMid),
    });
  }

  // Risk: comparable reliability × condition × refund exposure.
  const q = { HIGH: 1, MEDIUM: 0.72, LOW: 0.45, INSUFFICIENT: 0 }[analysis.quality];
  const cond = input.condition === 'GOOD' ? 0.85 : input.condition === 'SATISFACTORY' ? 0.6 : 1;
  const refund = model?.refundRate ?? 0.1;
  push('risk', q * cond * (1 - refund / 2), 'MARKET', 'deal.risk', {
    quality: analysis.quality,
    refund: Math.round(refund * 100),
  });

  // Rarity: supply size. A capped total ("≥ 960") is a crowded market.
  const supply = analysis.totalEntries;
  const rarity = analysis.totalCapped ? 0.15 : supply === null ? 0.5 : 1 - clamp(Math.log10(Math.max(supply, 10) / 30) / Math.log10(960 / 30));
  push('rarity', rarity, supply === null ? 'INFERRED' : 'MARKET', analysis.totalCapped ? 'deal.rarityCapped' : 'deal.rarity', {
    supply: supply ?? '—',
  });

  // Resale ease: how this brand has actually sold for this seller.
  const brandSeg = personal?.brand ? model?.byBrand.find((b) => b.key === personal.brand) : null;
  if (brandSeg && brandSeg.sold >= 3) {
    const ease = 0.5 * clamp(brandSeg.sold / 15) + 0.5 * (1 - clamp(((brandSeg.medianDays ?? 20) - 2) / 30));
    push('resale', ease, 'PERSONAL', 'deal.resalePersonal', { n: brandSeg.sold, days: Math.round(brandSeg.medianDays ?? 0) });
  } else {
    push('resale', 0.5, 'INFERRED', 'deal.resaleUnknown');
  }

  // Capital: the less cash immobilised, the better.
  push('capital', 1 - clamp((cost - 1000) / 7000) * 0.85, 'MARKET', 'deal.capital', { cost });

  const total = dims.reduce((a, d) => a + d.score, 0);
  const maxBuy = Math.min(bal.range.min / 2, bal.range.min - 1200);
  const maxBuyCents = maxBuy > 0 ? Math.floor(maxBuy / 100) * 100 : 0;
  const capitalRisk: BuyAnalysis['capitalRisk'] =
    cost >= 5000 && (analysis.quality === 'LOW' || (roi?.min ?? 0) < 0.3)
      ? 'HIGH'
      : cost <= 2000 && (roi?.min ?? 0) >= 1
        ? 'LOW'
        : (roi?.min ?? 0) < 0.2
          ? 'HIGH'
          : 'MEDIUM';
  const verdict: Verdict = total >= 72 && profit.min > 0 ? 'BUY' : total >= 55 && profit.max > 0 ? 'NEGOTIATE' : 'AVOID';

  return {
    input,
    analysis,
    pricing,
    profit,
    roi,
    demand,
    capitalRisk,
    dealScore: { total, dimensions: dims },
    maxBuyCents,
    verdict,
    personal,
  };
}
