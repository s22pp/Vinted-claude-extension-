import type { Condition, Confidence } from '@/domain/entities';
import type { Cents } from '@/domain/money';
import { brandKey } from './normalize';
import type { ItemView, SaleView } from './portfolio';
import { priceBandOf } from './seller-model';
import { mean, median } from './stats';

/**
 * Sales pattern mining on the seller's OWN history.
 * For each dimension (brand, category, niche, price band, condition, size, source, listing weekday…)
 * every segment is compared with the rest of the sales. Small segments are shrunk toward the overall
 * value, so a lucky sale or two never becomes a "pattern". Correlation, not causation: the UI says so.
 */

export type PatternKind = 'SPEED' | 'PROFIT' | 'DISCOUNT' | 'REFUND' | 'STOCK_GAP' | 'SWEET_SPOT' | 'CONDITION' | 'TIMING';

export interface Pattern {
  id: string;
  kind: PatternKind;
  tone: 'positive' | 'warning' | 'info';
  /** i18n key under `patterns.p.*` and its params. */
  code: string;
  params: Record<string, string | number>;
  /** Segment vs baseline, for the comparison bar. */
  value: number;
  baseline: number;
  unit: 'days' | 'eur' | 'pct';
  sample: number;
  baselineSample: number;
  confidence: Confidence;
  /** i18n key under `patterns.a.*` — what to do about it. */
  action: string | null;
  score: number;
  /** Which sales make up the segment: two dimensions describing the same sales are one finding. */
  sig?: string;
}

interface Row {
  sale: SaleView;
  days: number | null;
  profit: Cents | null;
  roi: number | null;
  profitPerDay: number | null;
  discount: number | null;
  refunded: boolean;
}

type Dim = { key: string; label: (r: Row) => string | null; name: string };

const K = 5; // shrinkage strength: a segment of n sales counts as n real + K baseline observations

function conf(n: number): Confidence {
  return n >= 15 ? 'HIGH' : n >= 8 ? 'MEDIUM' : 'LOW';
}

function shrink(seg: number, n: number, base: number): number {
  return (seg * n + base * K) / (n + K);
}

const CONDITION_LABEL: Record<Condition, string> = {
  NEW_WITH_TAGS: 'neuf avec étiquette',
  NEW_WITHOUT_TAGS: 'neuf sans étiquette',
  VERY_GOOD: 'très bon état',
  GOOD: 'bon état',
  SATISFACTORY: 'état satisfaisant',
};

/** Per-day money as a ready string (cents → "5,33 €"), so it can never be misread as cents or days. */
const eurDay = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const eur = (cents: number) => `${Math.round(cents / 100)} €`;

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export function minePatterns(sales: readonly SaleView[], views: readonly ItemView[], labels: { category: (c: string) => string }): Pattern[] {
  const byItem = new Map(views.map((v) => [v.item.id, v]));
  const rows: Row[] = sales.map((s) => {
    const done = s.sale.status !== 'REFUNDED';
    const days = s.daysToSale;
    return {
      sale: s,
      days: done ? days : null,
      profit: done ? s.profit : null,
      roi: done && s.profit !== null && s.cost ? s.profit / s.cost : null,
      profitPerDay: done && s.profit !== null && days !== null ? s.profit / Math.max(1, days) : null,
      discount: done && s.lastAskCents ? (s.sale.salePriceCents - s.lastAskCents) / s.lastAskCents : null,
      refunded: !done,
    };
  });
  const completed = rows.filter((r) => !r.refunded);
  if (completed.length < 8) return [];

  const dims: Dim[] = [
    { key: 'brand', name: 'marque', label: (r) => r.sale.item.brand },
    { key: 'category', name: 'catégorie', label: (r) => labels.category(r.sale.item.category) },
    { key: 'niche', name: 'niche', label: (r) => `${r.sale.item.brand} ${r.sale.item.model ?? labels.category(r.sale.item.category).toLowerCase()}` },
    { key: 'band', name: 'tranche de prix', label: (r) => priceBandOf(r.sale.sale.salePriceCents) },
    { key: 'size', name: 'taille', label: (r) => r.sale.item.size },
    { key: 'source', name: 'source d’achat', label: (r) => r.sale.item.purchaseSource },
    {
      key: 'weekday',
      name: 'jour de publication',
      label: (r) => {
        const first = byItem.get(r.sale.item.id)?.firstListedAt;
        return first ? WEEKDAYS[(new Date(first).getDay() + 6) % 7]! : null;
      },
    },
  ];

  const out: Pattern[] = [];
  const med = (xs: (number | null)[]) => {
    const k = xs.filter((x): x is number => x !== null);
    return k.length ? median(k) : null;
  };
  const avg = (xs: (number | null)[]) => {
    const k = xs.filter((x): x is number => x !== null);
    return k.length ? mean(k) : null;
  };

  for (const d of dims) {
    const groups = new Map<string, Row[]>();
    for (const r of completed) {
      const l = d.label(r);
      if (!l) continue;
      const arr = groups.get(l) ?? [];
      arr.push(r);
      groups.set(l, arr);
    }
    for (const [label, seg] of groups) {
      const rest = completed.filter((r) => !seg.includes(r));
      if (seg.length < 4 || rest.length < 4) continue;
      const sig = seg.map((r) => r.sale.sale.id).sort().join(',');

      // Speed: median days to sale.
      const sd = med(seg.map((r) => r.days));
      const bd = med(rest.map((r) => r.days));
      if (sd !== null && bd !== null && bd > 0) {
        const adj = shrink(sd, seg.length, bd);
        const ratio = adj / bd;
        if (ratio <= 0.67 || ratio >= 1.5) {
          const fast = ratio < 1;
          out.push({
            id: `speed:${d.key}:${label}`,
            sig,
            kind: 'SPEED',
            tone: fast ? 'positive' : 'warning',
            code: fast ? 'speedFast' : 'speedSlow',
            params: { label, dim: d.name, days: Math.round(sd), base: Math.round(bd), x: Math.round((fast ? bd / Math.max(1, sd) : sd / Math.max(1, bd)) * 10) / 10 },
            value: sd,
            baseline: bd,
            unit: 'days',
            sample: seg.length,
            baselineSample: rest.length,
            confidence: conf(seg.length),
            action: fast ? 'buyMore' : 'priceLower',
            score: Math.abs(Math.log(ratio)) * Math.sqrt(seg.length),
          });
        }
      }

      // Profit velocity: profit per day on the shelf.
      const sp = avg(seg.map((r) => r.profitPerDay));
      const bp = avg(rest.map((r) => r.profitPerDay));
      const nP = seg.filter((r) => r.profitPerDay !== null).length;
      if (sp !== null && bp !== null && bp > 0 && nP >= 4) {
        const ratio = shrink(sp, nP, bp) / bp;
        if (ratio >= 1.6 || ratio <= 0.55) {
          const good = ratio > 1;
          const sProfit = avg(seg.map((r) => r.profit));
          out.push({
            id: `profit:${d.key}:${label}`,
            sig,
            kind: 'PROFIT',
            tone: good ? 'positive' : 'warning',
            code: good ? 'profitHigh' : 'profitLow',
            params: { label, dim: d.name, perDay: eurDay(sp), base: eurDay(bp), profit: sProfit === null ? '—' : eur(sProfit), x: Math.round((good ? sp / bp : bp / Math.max(1, sp)) * 10) / 10 },
            value: sp,
            baseline: bp,
            unit: 'eur',
            sample: nP,
            baselineSample: rest.length,
            confidence: conf(nP),
            action: good ? 'buyMore' : 'stopBuying',
            score: Math.abs(Math.log(ratio)) * Math.sqrt(nP) * 1.2,
          });
        }
      }

      // Negotiation: how far below the ask this segment actually sells.
      const sdis = avg(seg.map((r) => r.discount));
      const bdis = avg(rest.map((r) => r.discount));
      const nD = seg.filter((r) => r.discount !== null).length;
      if (sdis !== null && bdis !== null && nD >= 5 && d.key !== 'weekday') {
        const adj = shrink(sdis, nD, bdis);
        if (adj - bdis <= -0.06) {
          out.push({
            id: `discount:${d.key}:${label}`,
            sig,
            kind: 'DISCOUNT',
            tone: 'info',
            code: 'discountDeep',
            params: { label, dim: d.name, pct: Math.round(-sdis * 100), base: Math.round(-bdis * 100) },
            value: -sdis * 100,
            baseline: -bdis * 100,
            unit: 'pct',
            sample: nD,
            baselineSample: rest.length,
            confidence: conf(nD),
            action: 'askHigher',
            score: Math.abs(adj - bdis) * 10 * Math.sqrt(nD),
          });
        }
      }
    }
  }

  // Refunds by brand / category (transactions that fail).
  const allRefundRate = rows.filter((r) => r.refunded).length / rows.length;
  for (const key of ['brand', 'category'] as const) {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const l = key === 'brand' ? r.sale.item.brand : labels.category(r.sale.item.category);
      groups.set(l, [...(groups.get(l) ?? []), r]);
    }
    for (const [label, seg] of groups) {
      // One refund is an incident, not a pattern: ≥ 8 sales and ≥ 2 refunds.
      const refunds = seg.filter((r) => r.refunded).length;
      if (seg.length < 8 || refunds < 2) continue;
      const rate = refunds / seg.length;
      const adj = (rate * seg.length + allRefundRate * K) / (seg.length + K);
      if (adj >= allRefundRate * 1.6 && rate >= 0.15) {
        out.push({
          id: `refund:${key}:${label}`,
          kind: 'REFUND',
          tone: 'warning',
          code: 'refundHigh',
          params: { label, pct: Math.round(rate * 100), base: Math.round(allRefundRate * 100), n: seg.filter((r) => r.refunded).length },
          value: rate * 100,
          baseline: allRefundRate * 100,
          unit: 'pct',
          sample: seg.length,
          baselineSample: rows.length,
          confidence: conf(seg.length),
          action: 'describeBetter',
          score: (rate - allRefundRate) * 10 * Math.sqrt(seg.length),
        });
      }
    }
  }

  // Condition: price premium of very good vs good condition within the same brands.
  const vg = completed.filter((r) => r.sale.item.condition === 'VERY_GOOD' || r.sale.item.condition === 'NEW_WITHOUT_TAGS' || r.sale.item.condition === 'NEW_WITH_TAGS');
  const gd = completed.filter((r) => r.sale.item.condition === 'GOOD' || r.sale.item.condition === 'SATISFACTORY');
  if (vg.length >= 5 && gd.length >= 5) {
    const a = median(vg.map((r) => r.sale.sale.salePriceCents));
    const b = median(gd.map((r) => r.sale.sale.salePriceCents));
    if (a > b * 1.15) {
      out.push({
        id: 'condition:premium',
        kind: 'CONDITION',
        tone: 'info',
        code: 'conditionPremium',
        params: { a: CONDITION_LABEL.VERY_GOOD, b: CONDITION_LABEL.GOOD, pct: Math.round((a / b - 1) * 100), price: eur(a), base: eur(b) },
        value: a / 100,
        baseline: b / 100,
        unit: 'eur',
        sample: vg.length,
        baselineSample: gd.length,
        confidence: conf(Math.min(vg.length, gd.length)),
        action: 'sourceCondition',
        score: (a / b - 1) * Math.sqrt(Math.min(vg.length, gd.length)),
      });
    }
  }

  // Stock gap: what earns the most vs what the current stock is made of (the volume lever).
  const stock = views.filter((v) => v.inStock);
  if (stock.length >= 5) {
    const profitBy = new Map<string, number>();
    let totalProfit = 0;
    for (const r of completed) {
      if (r.profit === null || r.profit <= 0) continue;
      const k = brandKey(r.sale.item.brand);
      profitBy.set(k, (profitBy.get(k) ?? 0) + r.profit);
      totalProfit += r.profit;
    }
    const display = new Map(completed.map((r) => [brandKey(r.sale.item.brand), r.sale.item.brand]));
    for (const [k, p] of profitBy) {
      const share = p / totalProfit;
      const stockShare = stock.filter((v) => brandKey(v.item.brand) === k).length / stock.length;
      const n = completed.filter((r) => brandKey(r.sale.item.brand) === k).length;
      if (n >= 4 && share >= 0.15 && stockShare < share * 0.5) {
        out.push({
          id: `gap:${k}`,
          kind: 'STOCK_GAP',
          tone: 'positive',
          code: 'stockGap',
          params: { label: display.get(k) ?? k, share: Math.round(share * 100), stock: Math.round(stockShare * 100) },
          value: share * 100,
          baseline: stockShare * 100,
          unit: 'pct',
          sample: n,
          baselineSample: stock.length,
          confidence: conf(n),
          action: 'restock',
          score: (share - stockShare) * 10 * Math.sqrt(n),
        });
      }
    }
  }

  // Sweet spot: the price band with the best profit per day.
  const bands = new Map<string, Row[]>();
  for (const r of completed) bands.set(priceBandOf(r.sale.sale.salePriceCents), [...(bands.get(priceBandOf(r.sale.sale.salePriceCents)) ?? []), r]);
  const ranked = [...bands.entries()]
    .map(([band, seg]) => ({ band, n: seg.filter((r) => r.profitPerDay !== null).length, v: avg(seg.map((r) => r.profitPerDay)), days: med(seg.map((r) => r.days)) }))
    .filter((b) => b.n >= 5 && b.v !== null)
    .sort((a, b) => b.v! - a.v!);
  if (ranked.length >= 2) {
    const [best, second] = ranked;
    if (best!.v! > second!.v! * 1.25) {
      out.push({
        id: `sweet:${best!.band}`,
        kind: 'SWEET_SPOT',
        tone: 'positive',
        code: 'sweetSpot',
        params: { band: best!.band, perDay: eurDay(best!.v!), days: Math.round(best!.days ?? 0), second: second!.band },
        value: best!.v!,
        baseline: second!.v!,
        unit: 'eur',
        sample: best!.n,
        baselineSample: second!.n,
        confidence: conf(best!.n),
        action: 'targetBand',
        score: Math.log(best!.v! / second!.v!) * Math.sqrt(best!.n) * 1.1,
      });
    }
  }

  // One finding per (kind, same set of sales): brand, niche and category often describe the same sales.
  // Dimensions are tried in order brand → category → niche → band…, so the most readable label wins ties.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((p) => {
      const k = `${p.kind}:${p.sig ?? p.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 12);
}
