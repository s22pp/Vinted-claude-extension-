import { REFUND_REASONS, type RefundReason } from '@/domain/entities';
import type { Cents } from '@/domain/money';
import type { SaleView } from './portfolio';
import { brandKey } from './normalize';
import { pushTo } from './stats';

/** What a refund reason changes upstream, in the listing sheet. */
export type RefundGuard = 'MEASURES_REQUIRED' | 'DEFECT_PHOTOS' | 'CONDITION_DETAIL' | 'DESCRIPTION_CHECK' | 'AUTH_PHOTOS' | 'PACKAGING';

const GUARD_OF: Partial<Record<RefundReason, RefundGuard>> = {
  SIZE: 'MEASURES_REQUIRED',
  DEFECT: 'DEFECT_PHOTOS',
  CONDITION: 'CONDITION_DETAIL',
  DESCRIPTION: 'DESCRIPTION_CHECK',
  AUTHENTICITY: 'AUTH_PHOTOS',
  SHIPPING: 'PACKAGING',
};

export interface RefundSegment {
  dim: 'brand' | 'category';
  key: string;
  label: string;
  sales: number;
  refunded: number;
  rate: number;
  /** Shrunk toward the overall rate: 5 sales with 2 refunds is not "40 %". */
  shrunkRate: number;
}

export interface RefundSummary {
  sales: number;
  refunded: number;
  rate: number | null;
  /** Sale price given back to buyers (the item usually comes back; shipping and time do not). */
  refundedCents: Cents;
  withReason: number;
  missingReason: string[];
  byReason: { reason: RefundReason; n: number }[];
  segments: RefundSegment[];
  guards: { guard: RefundGuard; reason: RefundReason; n: number }[];
}

const K = 5;
const MIN_SEGMENT = 5;

export function refundSummary(sales: readonly SaleView[], labels: { category: (c: string) => string }): RefundSummary {
  const refunded = sales.filter((s) => s.sale.status === 'REFUNDED');
  const rate = sales.length ? refunded.length / sales.length : null;
  const counts = new Map<RefundReason, number>();
  for (const s of refunded) if (s.sale.refundReason) counts.set(s.sale.refundReason, (counts.get(s.sale.refundReason) ?? 0) + 1);
  const byReason = REFUND_REASONS.map((reason) => ({ reason, n: counts.get(reason) ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const withReason = byReason.reduce((a, r) => a + r.n, 0);

  const segments: RefundSegment[] = [];
  const base = rate ?? 0;
  const seen = new Set<string>();
  for (const dim of ['brand', 'category'] as const) {
    const groups = new Map<string, SaleView[]>();
    for (const s of sales) {
      const k = dim === 'brand' ? brandKey(s.item.brand) : s.item.category;
      pushTo(groups, k, s);
    }
    for (const [key, xs] of groups) {
      if (xs.length < MIN_SEGMENT) continue;
      const back = xs.filter((s) => s.sale.status === 'REFUNDED');
      const r = back.length;
      // One refund is an anecdote, not a pattern.
      if (r < 2) continue;
      // Brand and category describing the same refunds are one finding.
      const sig = back.map((s) => s.sale.id).sort().join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const shrunk = (r + K * base) / (xs.length + K);
      segments.push({ dim, key, label: dim === 'brand' ? xs[0]!.item.brand : labels.category(key), sales: xs.length, refunded: r, rate: r / xs.length, shrunkRate: shrunk });
    }
  }
  segments.sort((a, b) => b.shrunkRate - a.shrunkRate);

  // A reason becomes a rule in the listing sheet once it has happened twice.
  const guards = byReason
    .filter((r) => r.n >= 2 && GUARD_OF[r.reason])
    .map((r) => ({ guard: GUARD_OF[r.reason]!, reason: r.reason, n: r.n }));

  return {
    sales: sales.length,
    refunded: refunded.length,
    rate,
    refundedCents: refunded.reduce((a, s) => a + s.sale.salePriceCents, 0),
    withReason,
    missingReason: refunded.filter((s) => !s.sale.refundReason).map((s) => s.sale.id),
    byReason,
    segments: segments.filter((s) => s.shrunkRate > base * 1.2).slice(0, 6),
    guards,
  };
}
