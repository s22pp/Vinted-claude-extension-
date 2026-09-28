import { describe, expect, it } from 'vitest';
import { computeCore, computeDerived, computeEraData, computeIntel } from '@/app/era-data';
import { generateDemoDataset } from '@/data/fixtures/demo';
import type { Decision } from '@/domain/entities';
import type { EraInputs } from '@/app/era-data';

const NOW = Date.UTC(2026, 8, 28, 12);
const inputs = (): EraInputs => {
  const ds = generateDemoDataset(NOW, { seed: 3 });
  return {
    items: ds.items,
    listings: ds.listings,
    sales: ds.sales,
    analyses: [],
    predictions: ds.predictions,
    activation: [],
    decisions: [],
    observations: ds.observations,
    priceEvents: ds.events.filter((e) => e.type === 'PRICE_CHANGED'),
    repostEvents: ds.events.filter((e) => e.type === 'LISTING_REPUBLISHED'),
    mode: 'demo',
    prepRows: [],
    mdSteps: null,
    autoCfg: null,
    now: NOW,
    categoryLabel: String,
  };
};

describe('dashboard state in layers', () => {
  it('a dismissed advice is hidden on a copy: the shared layer keeps it, so taking the decision back restores it', () => {
    const x = inputs();
    const core = computeCore(x);
    const layer = computeIntel(core, x);
    const target = layer.intel.find((i) => i.recommendation)!;
    const key = target.recommendation!.key;
    const dismissed: Decision = { id: 'd', recommendationKey: key, inventoryItemId: target.view.item.id, action: target.recommendation!.action, outcome: 'DISMISSED', at: NOW, until: null };
    const hidden = computeDerived(core, layer, { ...x, decisions: [dismissed], ready: true });
    expect(hidden.intelById.get(target.view.item.id)!.recommendation).toBeNull();
    expect(target.recommendation?.key).toBe(key);
    const back = computeDerived(core, layer, { ...x, decisions: [], ready: true });
    expect(back.intelById.get(target.view.item.id)!.recommendation?.key).toBe(key);
  });

  it('the layers compose to the same state as one pass', () => {
    const x = inputs();
    const a = computeEraData(x);
    const core = computeCore(x);
    const b = computeDerived(core, computeIntel(core, x), { ...x, ready: true });
    expect(b.priorities).toEqual(a.priorities);
    expect([...b.markdown.keys()]).toEqual([...a.markdown.keys()]);
    expect(b.intel.map((i) => i.recommendation?.key ?? null)).toEqual(a.intel.map((i) => i.recommendation?.key ?? null));
    expect(a.ready).toBe(true);
  });
});
