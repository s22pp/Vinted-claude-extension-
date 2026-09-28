import { generateDemoDataset, generateDemoMarket } from '@/data/fixtures/demo';
import type { StoredAnalysis } from '@/data/db';
import type { ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { analyzeComparables, buildQueries } from '@/intelligence/comparables';
import type { EraInputs } from '@/app/era-data';

/**
 * A seller a year into ERA: 300 articles in stock, 400 sold, two imports a day for 60 days on each live listing
 * (≈ 36 000 observations), a market analysis on 3 listings out of 4. Test data only — for timing the engines.
 */
export function bigInputs(now = Date.UTC(2026, 8, 28, 12)): EraInputs {
  const ds = generateDemoDataset(now, { soldCount: 400, stockCount: 300, seed: 7 });
  const observations: ListingObservation[] = [...ds.observations];
  const live = ds.listings.filter((l) => l.status === 'ACTIVE' || l.status === 'RESERVED');
  for (const l of live) {
    for (let k = 0; k < 120; k++) {
      const at = now - (120 - k) * (DAY / 2);
      if (at < l.listedAt) continue;
      observations.push({ id: `b_${l.id}_${k}`, listingId: l.id, inventoryItemId: l.inventoryItemId, at, priceCents: l.priceCents, views: k * 2, favorites: Math.floor(k / 20), provenance: 'OBSERVED' });
    }
  }
  const byItem = new Map(ds.items.map((i) => [i.id, i]));
  const analyses: StoredAnalysis[] = [];
  for (const [k, l] of live.entries()) {
    if (k % 4 === 3) continue;
    const it = byItem.get(l.inventoryItemId)!;
    const subject = { title: it.title, brand: it.brand, model: it.model, category: it.category, gender: it.gender, size: it.size, condition: it.condition, material: it.material, era: it.era, priceCents: l.priceCents };
    const queries = buildQueries(subject);
    const results = queries.map((q, j) => ({ ...generateDemoMarket(q, k * 31 + j), fetchedAt: now }));
    analyses.push({ id: `a_${it.id}`, inventoryItemId: it.id, at: now - (k % 20) * DAY, analysis: analyzeComparables(subject, results, { queries: queries.map((q) => q.text), source: 'DEMO', now }), isDemo: true });
  }
  return {
    items: ds.items,
    listings: ds.listings,
    sales: ds.sales,
    analyses,
    predictions: ds.predictions,
    activation: [],
    decisions: [],
    observations,
    priceEvents: ds.events.filter((e) => e.type === 'PRICE_CHANGED'),
    repostEvents: ds.events.filter((e) => e.type === 'LISTING_REPUBLISHED'),
    mode: 'demo',
    prepRows: [],
    mdSteps: null,
    autoCfg: null,
    now,
    categoryLabel: (c) => c,
  };
}
