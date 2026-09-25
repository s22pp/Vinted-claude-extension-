import { DemoMarketplaceAdapter } from '@/data/adapters/demo-adapter';
import type { MarketplaceAdapter } from '@/data/adapters/marketplace';
import { VintedTabAdapter } from '@/data/adapters/vinted/vinted-adapter';
import type { DataMode } from '@/data/repo';
import { repo } from '@/data/repo';
import type { ComparableAnalysis, ComparableSubject } from '@/intelligence/comparables';
import { isUnknownBrand } from '@/intelligence/normalize';
import type { LearningSummary } from '@/intelligence/learning';
import type { ItemView } from '@/intelligence/portfolio';
import { priceStrategies } from '@/intelligence/pricing';
import { buildPrediction } from '@/intelligence/precision';
import { type SellerModel, personalEvidence } from '@/intelligence/seller-model';

export function itemSubject(v: ItemView): ComparableSubject {
  return {
    title: v.item.title,
    brand: v.item.brand,
    model: v.item.model,
    category: v.item.category,
    gender: v.item.gender,
    size: v.item.size,
    condition: v.item.condition,
    material: v.item.material,
    era: v.item.era,
    priceCents: v.askPrice,
  };
}

/**
 * Demo data is analysed against the demo market; real data only ever against the real marketplace.
 * A real item is never priced with fixtures.
 */
export function marketAdapter(mode: DataMode, isDemoItem: boolean, quick = false): MarketplaceAdapter {
  if (mode === 'demo' || isDemoItem) return new DemoMarketplaceAdapter(quick ? 0 : 380);
  return new VintedTabAdapter();
}

export async function analyzeItem(
  v: ItemView,
  mode: DataMode,
  model: SellerModel | null,
  learning: LearningSummary | null,
  onStage?: (s: 'COLLECTING' | 'COMPARING' | 'READY') => void,
  quick = false,
): Promise<ComparableAnalysis> {
  const adapter = marketAdapter(mode, v.item.isDemo, quick);
  const subject = itemSubject(v);
  // Brand unknown on a real listing: read the listing itself on Vinted (one verified GET) before searching.
  const vintedId = v.current?.platformListingId;
  if (isUnknownBrand(subject.brand) && adapter instanceof VintedTabAdapter && vintedId && /^\d+$/.test(vintedId)) {
    const brand = await adapter.listingBrand(vintedId).catch(() => null);
    if (brand) {
      subject.brand = brand;
      await repo.setBrand(v.item.id, brand, 'OBSERVED');
    }
  }
  const analysis = await repo.analyzeMarket(adapter, subject, v.item.id, onStage);
  // Store what ERA predicted now, so it can be confronted with the real sale later.
  const personal = model ? personalEvidence(model, v.item) : null;
  const pricing = priceStrategies(
    analysis,
    { priceCents: v.askPrice, views: v.current?.views ?? null, favorites: v.current?.favorites ?? null, daysListed: v.daysListed, condition: v.item.condition },
    personal,
    learning?.priceCorrection ?? 1,
  );
  const pred = buildPrediction({
    itemId: v.item.id,
    at: Date.now(),
    analysis,
    pricing,
    personal,
    askCents: v.askPrice,
    correction: learning?.priceCorrection ?? 1,
    kind: 'ANALYSIS',
    isDemo: v.item.isDemo,
  });
  if (pred) await repo.storePrediction(pred);
  return analysis;
}
