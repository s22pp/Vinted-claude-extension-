import type { DomainEvent, ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { nicheKey } from './seller-model';
import type { ItemView } from './portfolio';
import { median } from './stats';

/**
 * Does price actually move views for this kind of article — for THIS seller?
 * Two measured sources, never an assumption:
 *  1. DROPS  — the seller's own past price drops: views per day in the week before vs the week after.
 *  2. CROSS  — among live listings of the same niche: do cheaper ones get more views per day? (rank correlation)
 * Niche articles often don't react to price: then ERA must not recommend lowering it.
 */
export type SensitivityStatus = 'SENSITIVE' | 'INSENSITIVE' | 'UNKNOWN';

export interface Sensitivity {
  status: SensitivityStatus;
  basis: 'DROPS' | 'CROSS' | 'NONE';
  n: number;
  /** DROPS: median relative change in views/day after a drop. CROSS: Spearman rho(price, views/day). */
  effect: number | null;
  scope: string | null;
}

const UNKNOWN: Sensitivity = { status: 'UNKNOWN', basis: 'NONE', n: 0, effect: null, scope: null };

function viewsAt(obs: ListingObservation[], t: number): number | null {
  // nearest observation within 3 days
  let best: ListingObservation | null = null;
  for (const o of obs) if (o.views !== null && Math.abs(o.at - t) <= 3 * DAY && (!best || Math.abs(o.at - t) < Math.abs(best.at - t))) best = o;
  return best?.views ?? null;
}

/** Relative change in views/day around one price drop, or null when the observations don't cover it. */
export function dropEffect(obs: ListingObservation[], at: number, window = 7 * DAY): number | null {
  const v0 = viewsAt(obs, at - window);
  const v1 = viewsAt(obs, at);
  const v2 = viewsAt(obs, at + window);
  if (v0 === null || v1 === null || v2 === null) return null;
  const before = (v1 - v0) / 7;
  const after = (v2 - v1) / 7;
  if (before <= 0) return after > 0 ? 1 : null;
  return after / before - 1;
}

function rank(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  idx.forEach(([, i], k) => (r[i] = k));
  return r;
}

export function spearman(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const ra = rank(a);
  const rb = rank(b);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i]! - rb[i]!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export function buildSensitivityIndex(
  views: readonly ItemView[],
  observations: readonly ListingObservation[],
  priceEvents: readonly DomainEvent[],
): Map<string, Sensitivity> {
  const obsByListing = new Map<string, ListingObservation[]>();
  for (const o of observations) obsByListing.set(o.listingId, [...(obsByListing.get(o.listingId) ?? []), o]);
  const niche = new Map(views.map((v) => [v.item.id, nicheKey(v.item.brand, v.item.model, v.item.category)]));

  // 1. Past drops, grouped by niche.
  const drops = new Map<string, number[]>();
  for (const e of priceEvents) {
    if (e.type !== 'PRICE_CHANGED' || !e.listingId || !e.inventoryItemId) continue;
    const from = e.data.from;
    const to = e.data.to;
    if (typeof from !== 'number' || typeof to !== 'number' || to >= from) continue;
    const eff = dropEffect(obsByListing.get(e.listingId) ?? [], e.at);
    if (eff === null) continue;
    const k = niche.get(e.inventoryItemId);
    if (k) drops.set(k, [...(drops.get(k) ?? []), eff]);
  }

  // 2. Cross-section of live listings per niche.
  const live = new Map<string, { price: number; vpd: number }[]>();
  for (const v of views) {
    const l = v.current;
    if (!v.inStock || !l || l.views === null || v.askPrice === null) continue;
    const days = Math.max(1, v.daysListed ?? 1);
    const k = niche.get(v.item.id)!;
    live.set(k, [...(live.get(k) ?? []), { price: v.askPrice, vpd: l.views / days }]);
  }

  const byNiche = new Map<string, Sensitivity>();
  for (const k of new Set([...drops.keys(), ...live.keys()])) {
    const d = drops.get(k) ?? [];
    if (d.length >= 3) {
      const eff = median(d);
      byNiche.set(k, { status: eff >= 0.25 ? 'SENSITIVE' : eff <= 0.1 ? 'INSENSITIVE' : 'UNKNOWN', basis: 'DROPS', n: d.length, effect: eff, scope: k });
      continue;
    }
    const c = live.get(k) ?? [];
    if (c.length >= 6) {
      const rho = spearman(
        c.map((x) => x.price),
        c.map((x) => x.vpd),
      );
      if (rho !== null)
        byNiche.set(k, { status: rho <= -0.35 ? 'SENSITIVE' : Math.abs(rho) < 0.15 ? 'INSENSITIVE' : 'UNKNOWN', basis: 'CROSS', n: c.length, effect: rho, scope: k });
    }
  }

  const out = new Map<string, Sensitivity>();
  for (const v of views) out.set(v.item.id, byNiche.get(niche.get(v.item.id)!) ?? UNKNOWN);
  return out;
}
