import { writeFileSync } from 'node:fs';
import { BACKUP_FORMAT, BACKUP_VERSION } from '@/data/backup';
import { generateDemoDataset, generateDemoMarket } from '@/data/fixtures/demo';
import type { StoredAnalysis } from '@/data/db';
import type { ListingObservation } from '@/domain/entities';
import { DAY } from '@/domain/time';
import { analyzeComparables, buildQueries } from '@/intelligence/comparables';

/**
 * A backup file of a very large synthetic account (test data only, flagged demo): 1 500 articles in stock, 600 sold,
 * observations twice a day for 20 days on each live listing, a market analysis on one listing out of two. Restored
 * through Réglages → Sauvegarde by tests/visual/big-stock.spec.ts to time the Stock table in the built extension.
 * Usage: BIG_BACKUP=.output/big-backup.json npm run perf -- big-backup
 */
test('writes the big backup', () => {
  const now = Date.now();
  const ds = generateDemoDataset(now, { soldCount: 600, stockCount: 1500, seed: 11 });
  const observations: ListingObservation[] = [...ds.observations];
  const live = ds.listings.filter((l) => l.status === 'ACTIVE' || l.status === 'RESERVED');
  for (const l of live) {
    for (let k = 0; k < 40; k++) {
      const at = now - (40 - k) * (DAY / 2);
      if (at < l.listedAt) continue;
      observations.push({ id: `big_${l.id}_${k}`, listingId: l.id, inventoryItemId: l.inventoryItemId, at, priceCents: l.priceCents, views: k * 2, favorites: Math.floor(k / 12), provenance: 'OBSERVED' });
    }
  }
  const byItem = new Map(ds.items.map((i) => [i.id, i]));
  const analyses: StoredAnalysis[] = [];
  for (const [k, l] of live.entries()) {
    if (k % 2 === 1) continue;
    const it = byItem.get(l.inventoryItemId)!;
    const subject = { title: it.title, brand: it.brand, model: it.model, category: it.category, gender: it.gender, size: it.size, condition: it.condition, material: it.material, era: it.era, priceCents: l.priceCents };
    const queries = buildQueries(subject);
    const results = queries.map((q, j) => ({ ...generateDemoMarket(q, k * 31 + j), fetchedAt: now }));
    const at = now - (k % 20) * DAY;
    analyses.push({ id: `analysis_${it.id}`, inventoryItemId: it.id, at, analysis: analyzeComparables(subject, results, { queries: queries.map((q) => q.text), source: 'DEMO', now: at }), isDemo: true });
  }
  const tables = {
    items: ds.items,
    listings: ds.listings,
    observations,
    sales: ds.sales,
    events: ds.events,
    analyses,
    predictions: ds.predictions,
    settings: [
      { key: 'onboardingDone', value: true },
      { key: 'dataMode', value: 'demo' },
    ],
  };
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  const out = process.env.BIG_BACKUP ?? '.output/big-backup.json';
  writeFileSync(out, JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, at: now, app: 'bench', counts, tables }));
  console.log(out, JSON.stringify(counts));
  expect(ds.items.length).toBeGreaterThan(2000);
});
