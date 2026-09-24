import type { Category, Confidence } from '@/domain/entities';
import type { Cents } from '@/domain/money';
import type { ItemView, SaleView } from './portfolio';
import { brandKey } from './normalize';
import { mean, median, quantile } from './stats';

/** Personal evidence for one segment (brand, category, niche or price band). Always carries its sample size. */
export interface SegmentStats {
  key: string;
  label: string;
  brand: string | null;
  category: Category | null;
  sold: number;
  refunded: number;
  inStock: number;
  avgBuyCents: Cents | null;
  avgSaleCents: Cents | null;
  avgProfitCents: Cents | null;
  /** How many of the sold items had a known profit. */
  profitSample: number;
  medianDays: number | null;
  roi: number | null;
  sellThrough: number | null;
  /** Average (sale − last ask) / last ask. Negative = accepted discounts. */
  avgDiscount: number | null;
  confidence: Confidence;
}

export interface SellerModel {
  totalSold: number;
  medianDays: number | null;
  p90Days: number | null;
  refundRate: number | null;
  byBrand: SegmentStats[];
  byCategory: SegmentStats[];
  byNiche: SegmentStats[];
  byPriceBand: SegmentStats[];
  /** Sales count per calendar month (0 = January), for seasonality. */
  seasonality: number[];
}

export function sampleConfidence(n: number): Confidence {
  if (n >= 10) return 'HIGH';
  if (n >= 4) return 'MEDIUM';
  return 'LOW';
}

export function nicheKey(brand: string, model: string | null, category: Category): string {
  return `${brandKey(brand)}|${model ? model.toLowerCase() : category}`;
}

const PRICE_BANDS: [number, number, string][] = [
  [0, 2000, '< 20 €'],
  [2000, 4000, '20–40 €'],
  [4000, 7000, '40–70 €'],
  [7000, 12000, '70–120 €'],
  [12000, Infinity, '> 120 €'],
];

export function priceBandOf(cents: Cents): string {
  return PRICE_BANDS.find(([lo, hi]) => cents >= lo && cents < hi)?.[2] ?? '?';
}

function segment(
  key: string,
  label: string,
  brand: string | null,
  category: Category | null,
  sales: SaleView[],
  stock: ItemView[],
): SegmentStats {
  const done = sales.filter((s) => s.sale.status !== 'REFUNDED');
  const withProfit = done.filter((s) => s.profit !== null && s.cost !== null);
  const costs = done.map((s) => s.cost).filter((c): c is number => c !== null);
  const days = done.map((s) => s.daysToSale).filter((d): d is number => d !== null);
  const discounts = done
    .filter((s) => s.lastAskCents !== null && s.lastAskCents > 0)
    .map((s) => (s.sale.salePriceCents - s.lastAskCents!) / s.lastAskCents!);
  const profitSum = withProfit.reduce((a, s) => a + s.profit!, 0);
  const costSum = withProfit.reduce((a, s) => a + s.cost!, 0);
  return {
    key,
    label,
    brand,
    category,
    sold: done.length,
    refunded: sales.length - done.length,
    inStock: stock.length,
    avgBuyCents: costs.length ? Math.round(mean(costs)) : null,
    avgSaleCents: done.length ? Math.round(mean(done.map((s) => s.sale.salePriceCents))) : null,
    avgProfitCents: withProfit.length ? Math.round(profitSum / withProfit.length) : null,
    profitSample: withProfit.length,
    medianDays: days.length ? median(days) : null,
    roi: costSum > 0 ? profitSum / costSum : null,
    sellThrough: done.length + stock.length > 0 ? done.length / (done.length + stock.length) : null,
    avgDiscount: discounts.length ? mean(discounts) : null,
    confidence: sampleConfidence(done.length),
  };
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k) ?? [];
    arr.push(x);
    m.set(k, arr);
  }
  return m;
}

export function buildSellerModel(
  views: readonly ItemView[],
  sv: readonly SaleView[],
  labels: { category: (c: Category) => string },
): SellerModel {
  const stock = views.filter((v) => v.inStock);
  const done = sv.filter((s) => s.sale.status !== 'REFUNDED');
  const days = done.map((s) => s.daysToSale).filter((d): d is number => d !== null);
  const display = new Map<string, string>();
  for (const v of views) display.set(brandKey(v.item.brand), v.item.brand);

  const build = (
    keyOfItem: (i: ItemView['item']) => string,
    labelOf: (k: string, sample: ItemView['item']) => string,
    dims: (sample: ItemView['item']) => { brand: string | null; category: Category | null },
  ): SegmentStats[] => {
    const sGroups = groupBy(sv, (s) => keyOfItem(s.item));
    const stGroups = groupBy(stock, (v) => keyOfItem(v.item));
    const keys = new Set([...sGroups.keys(), ...stGroups.keys()]);
    const out: SegmentStats[] = [];
    for (const k of keys) {
      const sample = sGroups.get(k)?.[0]?.item ?? stGroups.get(k)![0]!.item;
      const d = dims(sample);
      out.push(segment(k, labelOf(k, sample), d.brand, d.category, sGroups.get(k) ?? [], stGroups.get(k) ?? []));
    }
    return out.sort((a, b) => b.sold - a.sold || b.inStock - a.inStock);
  };

  const seasonality = Array.from({ length: 12 }, () => 0);
  for (const s of done) seasonality[new Date(s.sale.soldAt).getMonth()]!++;

  const bandSales = groupBy(done, (s) => priceBandOf(s.sale.salePriceCents));
  const bandStock = groupBy(
    stock.filter((v) => v.askPrice !== null),
    (v) => priceBandOf(v.askPrice!),
  );

  return {
    totalSold: done.length,
    medianDays: days.length ? median(days) : null,
    p90Days: days.length >= 5 ? quantile(days, 0.9) : null,
    refundRate: sv.length ? (sv.length - done.length) / sv.length : null,
    byBrand: build(
      (i) => brandKey(i.brand),
      (k) => display.get(k) ?? k,
      (i) => ({ brand: brandKey(i.brand), category: null }),
    ),
    byCategory: build(
      (i) => i.category,
      (_k, i) => labels.category(i.category),
      (i) => ({ brand: null, category: i.category }),
    ),
    byNiche: build(
      (i) => nicheKey(i.brand, i.model, i.category),
      (_k, i) => `${i.brand} ${i.model ?? labels.category(i.category)}`,
      (i) => ({ brand: brandKey(i.brand), category: i.category }),
    ),
    byPriceBand: PRICE_BANDS.map(([, , label]) =>
      segment(label, label, null, null, bandSales.get(label) ?? [], bandStock.get(label) ?? []),
    ),
    seasonality,
  };
}

/** Best personal evidence for a subject: niche first, then brand, then category. */
export function personalEvidence(
  model: SellerModel,
  subject: { brand: string; model: string | null; category: Category },
): SegmentStats | null {
  const niche = model.byNiche.find((s) => s.key === nicheKey(subject.brand, subject.model, subject.category));
  if (niche && niche.sold >= 3) return niche;
  const brand = model.byBrand.find((s) => s.key === brandKey(subject.brand));
  if (brand && brand.sold >= 3) return brand;
  const cat = model.byCategory.find((s) => s.key === subject.category);
  if (cat && cat.sold >= 3) return cat;
  return null;
}

/** Niches worth a look: enough sample, ranked by profit velocity (profit per day to sell). */
export function rankNiches(model: SellerModel, minSample = 3): SegmentStats[] {
  return model.byNiche
    .filter((s) => s.sold >= minSample && s.avgProfitCents !== null)
    .sort((a, b) => velocityScore(b) - velocityScore(a));
}

export function velocityScore(s: SegmentStats): number {
  const days = Math.max(1, s.medianDays ?? 30);
  return (s.avgProfitCents ?? 0) / days;
}
