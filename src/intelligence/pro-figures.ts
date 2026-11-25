/**
 * A professional seller's figures (pure), in cents:
 *  - the projected net: the asking price less the usual negotiation (an assumption, 10 % unless the seller changes it —
 *    said as such, never mixed with realised profit), less the full cost (purchase + extras);
 *  - three offer tiers: the floor (30 % return on the cost, rounded up to the euro), the target (−10 %), the firm price;
 *  - the rotation of a listing by days online: fresh, to watch, stalling.
 * An unknown cost gives no profit, no ROI and no floor: never zero.
 */

export const NEGOTIATION_DEFAULT = 0.1;
export const FLOOR_ROI = 0.3;

const euroUp = (cents: number) => Math.ceil(cents / 100) * 100;
const euroRound = (cents: number) => Math.round(cents / 100) * 100;

export interface Projection {
  /** Asking price after the assumed negotiation. */
  netSaleCents: number;
  profitCents: number | null;
  /** Profit over total cost, as a fraction (0.42 = 42 %); null without a cost. */
  roi: number | null;
}

export function projectNet(askCents: number, costCents: number | null, extraCents = 0, negotiation = NEGOTIATION_DEFAULT): Projection {
  const n = Math.min(Math.max(negotiation, 0), 0.9);
  const netSaleCents = Math.round(askCents * (1 - n));
  if (costCents === null) return { netSaleCents, profitCents: null, roi: null };
  const total = costCents + Math.max(0, extraCents);
  const profitCents = netSaleCents - total;
  return { netSaleCents, profitCents, roi: total > 0 ? profitCents / total : null };
}

export interface OfferTiers {
  /** 30 % return on the full cost, rounded up to the euro; null without a cost. */
  floor: number | null;
  /** −10 %, to the nearest euro. */
  target: number;
  firm: number;
}

export function offerTiers(askCents: number, costCents: number | null, extraCents = 0): OfferTiers {
  return {
    floor: costCents === null ? null : euroUp((costCents + Math.max(0, extraCents)) * (1 + FLOOR_ROI)),
    target: euroRound(askCents * 0.9),
    firm: askCents,
  };
}

export type Rotation = 'FRESH' | 'WATCH' | 'STALE';
export type RotationAdvice = null | 'GROUP_OFFER' | 'REPOST_CUT';

/** 0–14 days: fresh. 15–29: to watch (5 favourites or more and no offer: a group offer). 30 or more: stalling. */
export function rotation(daysOnline: number | null, favourites: number | null, offers: number | null): { state: Rotation | null; advice: RotationAdvice } {
  if (daysOnline === null || !Number.isFinite(daysOnline) || daysOnline < 0) return { state: null, advice: null };
  if (daysOnline < 15) return { state: 'FRESH', advice: null };
  if (daysOnline < 30) return { state: 'WATCH', advice: (favourites ?? 0) >= 5 && (offers ?? 0) === 0 ? 'GROUP_OFFER' : null };
  return { state: 'STALE', advice: 'REPOST_CUT' };
}

const DAY = 86_400_000;

/** What the portfolio figures need of an article (a subset of ItemView). */
export interface PortfolioView {
  inStock: boolean;
  cost: number | null;
  askPrice: number | null;
  brand: string | null;
  firstListedAt: number | null;
  firstListedKnown: boolean;
  sale: { soldAt: number; salePriceCents: number; status: string } | null;
}

export interface PortfolioFigures {
  /** Profit of this calendar month's sales whose cost is known; partial when some lack a cost; null when none has. */
  month: { profitCents: number | null; sales: number; missing: number; prevProfitCents: number | null; deltaPct: number | null };
  /** What the stock cost (known costs only), and how many articles lack one. */
  immobilized: { cents: number; missing: number; n: number };
  /** The stock's asking prices after the assumed negotiation. */
  potential: { cents: number; n: number };
  /** Days from first listing to sale, on sales with a real listing date. */
  rotation: { days: number | null; n: number };
  /** Brands by return on cost (sales with a known cost), best first. */
  brands: { brand: string; roi: number; profitCents: number; costCents: number; sales: number; days: number | null }[];
}

const monthStart = (t: number, back = 0) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() - back, 1).getTime();
};

export function portfolioFigures(views: readonly PortfolioView[], now: number, negotiation = NEGOTIATION_DEFAULT): PortfolioFigures {
  const sold = views.filter((v) => v.sale && v.sale.status !== 'REFUNDED');
  const inMonth = (from: number, to: number) => sold.filter((v) => v.sale!.soldAt >= from && v.sale!.soldAt < to);
  const profitOf = (list: PortfolioView[]) => {
    const known = list.filter((v) => v.cost !== null);
    return { cents: known.length ? known.reduce((s, v) => s + v.sale!.salePriceCents - v.cost!, 0) : null, missing: list.length - known.length };
  };
  const cur = inMonth(monthStart(now), monthStart(now, -1));
  const prev = inMonth(monthStart(now, 1), monthStart(now));
  const c = profitOf(cur);
  const p = profitOf(prev);
  const deltaPct = c.cents !== null && p.cents !== null && p.cents !== 0 && p.missing === 0 && c.missing === 0 ? (c.cents - p.cents) / Math.abs(p.cents) : null;

  const stock = views.filter((v) => v.inStock);
  const withCost = stock.filter((v) => v.cost !== null);
  const asked = stock.filter((v) => v.askPrice !== null);

  const daysOf = (v: PortfolioView) => (v.firstListedKnown && v.firstListedAt !== null && v.sale!.soldAt >= v.firstListedAt ? (v.sale!.soldAt - v.firstListedAt) / DAY : null);
  const dayList = sold.map(daysOf).filter((d): d is number => d !== null);

  const byBrand = new Map<string, PortfolioView[]>();
  for (const v of sold) {
    const b = (v.brand ?? '').trim();
    if (!b || /^inconnue?$/i.test(b) || v.cost === null || v.cost <= 0) continue;
    byBrand.set(b, [...(byBrand.get(b) ?? []), v]);
  }
  const brands = [...byBrand.entries()]
    .map(([brand, list]) => {
      const costCents = list.reduce((s, v) => s + v.cost!, 0);
      const profitCents = list.reduce((s, v) => s + v.sale!.salePriceCents - v.cost!, 0);
      const ds = list.map(daysOf).filter((d): d is number => d !== null);
      return { brand, roi: profitCents / costCents, profitCents, costCents, sales: list.length, days: ds.length ? ds.reduce((s, d) => s + d, 0) / ds.length : null };
    })
    .sort((a, b) => b.roi - a.roi || b.sales - a.sales)
    .slice(0, 5);

  return {
    month: { profitCents: c.cents, sales: cur.length, missing: c.missing, prevProfitCents: p.cents, deltaPct },
    immobilized: { cents: withCost.reduce((s, v) => s + v.cost!, 0), missing: stock.length - withCost.length, n: stock.length },
    potential: { cents: asked.reduce((s, v) => s + projectNet(v.askPrice!, null, 0, negotiation).netSaleCents, 0), n: asked.length },
    rotation: { days: dayList.length ? dayList.reduce((s, d) => s + d, 0) / dayList.length : null, n: dayList.length },
    brands,
  };
}
