import { floorFor, withDefaults } from '@/intelligence/automation';
import { DEFAULT_MARKDOWN, MARKDOWN_KEY, type MarkdownStep, markdownPlan, normalizeSteps, startPrices } from '@/intelligence/markdown';
import { buildItemViews } from '@/intelligence/portfolio';
import { db } from './db';
import { repo } from './repo';

export interface DueCut {
  itemId: string;
  platformListingId: string;
  title: string;
  fromCents: number;
  toCents: number;
  /** When the step became due: the oldest first. */
  dueAt: number;
}

/**
 * The price cuts the seller's own plan says are due today, from ERA's data alone (no Vinted call): live listings with a
 * known cost only — the floor (cost + the minimum margin) is never crossed, and a listing whose cost is unknown is never
 * cut by itself. The same reading as Stock → « Baisse à faire ».
 */
export async function duePriceCuts(now = Date.now()): Promise<DueCut[]> {
  const [items, listings, sales, observations, priceEvents, steps, auto] = await Promise.all([
    db.items.filter((i) => !i.isDemo).toArray(),
    db.listings.filter((l) => !l.isDemo).toArray(),
    db.sales.filter((s) => !s.isDemo).toArray(),
    db.observations.toArray(),
    db.events.where('type').equals('PRICE_CHANGED').toArray(),
    repo.getSetting<MarkdownStep[] | null>(MARKDOWN_KEY, null),
    repo.getSetting<Parameters<typeof withDefaults>[0]>('automations', null),
  ]);
  const views = buildItemViews(items, listings, sales, now);
  const starts = startPrices(observations, priceEvents);
  const plan = normalizeSteps(steps ?? DEFAULT_MARKDOWN);
  const margin = { minMarginCents: withDefaults(auto).minMarginCents };
  const out: DueCut[] = [];
  for (const v of views) {
    const l = v.current;
    if (!v.inStock || l?.status !== 'ACTIVE' || !l.platformListingId || v.askPrice === null) continue;
    const p = markdownPlan({ askCents: v.askPrice, startCents: starts.get(l.id) ?? l.priceCents, listedAt: l.listedAt, floorCents: floorFor(v.cost, margin), now }, plan);
    if (p.status !== 'DUE' || p.step.targetCents >= v.askPrice || p.step.targetCents < p.floorCents) continue;
    out.push({ itemId: v.item.id, platformListingId: l.platformListingId, title: l.title, fromCents: v.askPrice, toCents: p.step.targetCents, dueAt: p.step.at });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}
