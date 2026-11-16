import { floorFor, withDefaults } from '@/intelligence/automation';
import { DEFAULT_MARKDOWN, MARKDOWN_KEY, type MarkdownStep, markdownPlan, normalizeSteps, startPrices } from '@/intelligence/markdown';
import { buildItemViews } from '@/intelligence/portfolio';
import { workshopQueue } from '@/intelligence/workshop';
import { db } from './db';
import { repo } from './repo';

/**
 * What the seller's own plan asks of them today, from ERA's data alone (no Vinted call), for the autopilot's notice:
 * the price cuts due by the price-cut plan (one click each — never applied by a round), and the articles waiting in the
 * workshop to be listed. The same reading as the Stock and Workshop screens.
 */
export async function pilotMissions(now = Date.now()): Promise<{ priceCuts: number; toList: number }> {
  const [items, listings, sales, preps, observations, priceEvents, steps, auto] = await Promise.all([
    db.items.filter((i) => !i.isDemo).toArray(),
    db.listings.filter((l) => !l.isDemo).toArray(),
    db.sales.filter((s) => !s.isDemo).toArray(),
    db.preps.toArray(),
    db.observations.toArray(),
    db.events.where('type').equals('PRICE_CHANGED').toArray(),
    repo.getSetting<MarkdownStep[] | null>(MARKDOWN_KEY, null),
    repo.getSetting<Parameters<typeof withDefaults>[0]>('automations', null),
  ]);
  const views = buildItemViews(items, listings, sales, now);
  const starts = startPrices(observations, priceEvents);
  const plan = normalizeSteps(steps ?? DEFAULT_MARKDOWN);
  const margin = { minMarginCents: withDefaults(auto).minMarginCents };
  let priceCuts = 0;
  for (const v of views) {
    if (!v.inStock || v.current?.status !== 'ACTIVE') continue;
    const p = markdownPlan({ askCents: v.askPrice, startCents: starts.get(v.current.id) ?? v.current.priceCents, listedAt: v.current.listedAt, floorCents: floorFor(v.cost, margin), now }, plan);
    if (p.status === 'DUE') priceCuts++;
  }
  const toList = workshopQueue(views, new Map(preps.map((p) => [p.itemId, p]))).toList.length;
  return { priceCuts, toList };
}
