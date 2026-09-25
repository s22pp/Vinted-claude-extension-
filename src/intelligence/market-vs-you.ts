import type { Confidence } from '@/domain/entities';
import type { Cents } from '@/domain/money';
import type { ComparableAnalysis } from './comparables';
import { brandKey } from './normalize';
import { type SegmentStats, type SellerModel, nicheKey, sizeKey } from './seller-model';
import { median } from './stats';

/**
 * MARKET INSIGHT vs YOUR PERFORMANCE — two different truths, never merged:
 * the market side is ASKING prices of comparable listings (what sellers want),
 * your side is REALISED prices (cash you actually received). They are shown side by side;
 * the gap between them is itself the insight.
 */
export type SegmentDim = 'brand' | 'category' | 'niche' | 'size' | 'band';

export interface MarketSide {
  /** Median asking price over unique comparable listings seen in ERA's analyses. */
  askingMedianCents: Cents | null;
  /** Number of unique comparable listings behind the median. */
  listings: number;
  analyses: number;
  latestAt: number | null;
}

export interface MarketVsYouRow {
  dim: SegmentDim;
  key: string;
  label: string;
  market: MarketSide | null;
  you: SegmentStats;
  /** Your realised median vs the market's asking median: −0.12 = you cash 12 % under what the market asks. */
  gapPct: number | null;
  /** Both sides are thin: no strong conclusion. */
  weak: boolean;
  confidence: Confidence;
}

const MIN_MARKET = 8;
const MIN_YOU = 3;

function keyOf(dim: SegmentDim, a: ComparableAnalysis): string | null {
  const s = a.subject;
  switch (dim) {
    case 'brand':
      return brandKey(s.brand);
    case 'category':
      return s.category;
    case 'niche':
      return nicheKey(s.brand, s.model, s.category);
    case 'size':
      return s.size ? sizeKey(s.size) : null;
    case 'band':
      // A price band is defined by YOUR sale price: the market side does not apply.
      return null;
  }
}

function marketSides(dim: SegmentDim, analyses: readonly ComparableAnalysis[]): Map<string, MarketSide> {
  const acc = new Map<string, { prices: Map<string, number>; n: number; latest: number }>();
  for (const a of analyses) {
    if (a.quality === 'INSUFFICIENT') continue;
    const k = keyOf(dim, a);
    if (!k) continue;
    const e = acc.get(k) ?? { prices: new Map<string, number>(), n: 0, latest: 0 };
    e.n++;
    e.latest = Math.max(e.latest, a.at);
    // Unique listings: the same comparable seen by two analyses counts once.
    for (const c of a.comparables) if (c.kept) e.prices.set(c.candidate.id, c.candidate.priceCents);
    acc.set(k, e);
  }
  const out = new Map<string, MarketSide>();
  for (const [k, e] of acc) {
    const ps = [...e.prices.values()];
    out.set(k, { askingMedianCents: ps.length ? Math.round(median(ps) / 100) * 100 : null, listings: ps.length, analyses: e.n, latestAt: e.latest || null });
  }
  return out;
}

export function marketVsYou(dim: SegmentDim, model: SellerModel, analyses: readonly ComparableAnalysis[]): MarketVsYouRow[] {
  const segs = { brand: model.byBrand, category: model.byCategory, niche: model.byNiche, size: model.bySize, band: model.byPriceBand }[dim];
  const markets = marketSides(dim, analyses);
  return segs
    .filter((s) => s.sold > 0 || markets.has(s.key))
    .map((you) => {
      const m = markets.get(you.key) ?? null;
      const comparable = m?.askingMedianCents != null && m.listings >= MIN_MARKET && you.medianSaleCents !== null && you.sold >= MIN_YOU;
      const weak = you.sold < MIN_YOU && (m?.listings ?? 0) < MIN_MARKET;
      return {
        dim,
        key: you.key,
        label: you.label,
        market: m,
        you,
        gapPct: comparable ? (you.medianSaleCents! - m!.askingMedianCents!) / m!.askingMedianCents! : null,
        weak,
        confidence: you.confidence,
      };
    })
    .sort((a, b) => b.you.sold - a.you.sold || (b.market?.listings ?? 0) - (a.market?.listings ?? 0));
}

/** Latest analysis per subject (brand|model|category|size): re-analysing never double-counts. */
export function latestAnalyses(all: readonly { at: number; analysis: ComparableAnalysis }[]): ComparableAnalysis[] {
  const m = new Map<string, ComparableAnalysis>();
  for (const r of [...all].sort((a, b) => a.at - b.at)) {
    const s = r.analysis.subject;
    m.set(`${brandKey(s.brand)}|${s.model ?? ''}|${s.category}|${s.size ?? ''}`, r.analysis);
  }
  return [...m.values()];
}
