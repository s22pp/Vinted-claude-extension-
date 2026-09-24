import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { brandKey, categoriesInTitle, normalizeText } from '@/intelligence/normalize';
import { MarketplaceError } from './adapters/marketplace';
import type { ImportStage } from './adapters/vinted/protocol';
import { VintedTabAdapter, ensureVintedTab } from './adapters/vinted/vinted-adapter';
import { db, uid } from './db';
import { repo } from './repo';

/**
 * Import the seller's own wardrobe + sold orders from Vinted (≤ 5 budgeted GET calls).
 * - Items are matched by platform listing id: re-importing updates, never duplicates.
 * - Each import stores an observation (views/favourites), which builds engagement history over time.
 * - Sold orders only carry a title: they are matched by exact normalized title, unmatched ones are skipped.
 * - Purchase cost is never guessed: it stays UNKNOWN until the seller enters it.
 */
export async function importFromVinted(
  onStage: (s: ImportStage) => void = () => undefined,
  now = Date.now(),
): Promise<{ items: number; updated: number; sales: number }> {
  onStage('CONNECTING');
  const { tabId, created: openedTab } = await ensureVintedTab();
  const adapter = new VintedTabAdapter();
  let snapshot;
  let orders;
  try {
    onStage('READING');
    snapshot = await adapter.getInventory();
    orders = await adapter.getSoldOrders().catch(() => []);
  } catch (e) {
    // Not logged in: bring the Vinted tab forward so the seller can log in, then click again.
    if (e instanceof MarketplaceError && e.code === 'NOT_LOGGED_IN') await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
    else if (openedTab) await browser.tabs.remove(tabId).catch(() => undefined);
    throw e;
  }
  if (openedTab) await browser.tabs.remove(tabId).catch(() => undefined);
  onStage('MATCHING');
  // Real data is never silently mixed with demo fixtures.
  if ((await repo.getSetting('dataMode', 'empty')) === 'demo') await repo.clearDemo();
  const existing = await db.listings.filter((l) => l.platform === 'vinted' && !l.isDemo).toArray();
  const byPlatformId = new Map(existing.filter((l) => l.platformListingId).map((l) => [l.platformListingId!, l]));
  let created = 0;
  let updated = 0;
  let salesCount = 0;

  await db.transaction('rw', [db.items, db.listings, db.observations, db.events, db.sales, db.settings], async () => {
    for (const s of snapshot) {
      const prev = byPlatformId.get(s.platformListingId);
      const brandGuess = s.brand ?? inferBrand(s.title);
      let itemId = prev?.inventoryItemId;
      if (!itemId) {
        itemId = uid('item');
        const item: InventoryItem = {
          id: itemId,
          title: s.title,
          brand: brandGuess ?? 'Inconnue',
          model: null,
          category: categoriesInTitle(normalizeText(s.title))[0] ?? 'OTHER',
          gender: null,
          size: s.size,
          condition: s.condition,
          material: null,
          era: /vintage/i.test(s.title) ? 'vintage' : null,
          photoUrl: s.photoUrl,
          purchasePriceCents: null,
          purchaseDate: null,
          purchaseSource: null,
          status: s.status === 'SOLD' ? 'SOLD' : s.status === 'ACTIVE' ? 'LISTED' : 'DRAFT',
          createdAt: now,
          updatedAt: now,
          meta: {
            brand: { p: s.brand ? 'OBSERVED' : brandGuess ? 'INFERRED' : 'UNKNOWN', at: now },
            category: { p: 'INFERRED', at: now },
          },
          isDemo: false,
        };
        await db.items.put(item);
        created++;
      } else {
        updated++;
        const item = await db.items.get(itemId);
        if (item) await db.items.put({ ...item, status: s.status === 'SOLD' ? 'SOLD' : item.status === 'DRAFT' && s.status === 'ACTIVE' ? 'LISTED' : item.status, updatedAt: now });
      }
      const listingId = prev?.id ?? uid('listing');
      const listedAt = s.listedAt ?? prev?.listedAt ?? now;
      const listing: Listing = {
        id: listingId,
        inventoryItemId: itemId,
        platform: 'vinted',
        platformListingId: s.platformListingId,
        url: s.url,
        title: s.title,
        priceCents: s.priceCents,
        views: s.views,
        favorites: s.favorites,
        listedAt,
        removedAt: s.status === 'REMOVED' ? (prev?.removedAt ?? now) : null,
        soldAt: s.status === 'SOLD' ? (prev?.soldAt ?? now) : null,
        status: s.status,
        lastObservedAt: now,
        isDemo: false,
      };
      await db.listings.put(listing);
      await db.observations.put({ id: uid('obs'), listingId, inventoryItemId: itemId, at: now, priceCents: s.priceCents, views: s.views, favorites: s.favorites, provenance: 'OBSERVED' });
      if (!prev) {
        await db.events.put({ id: uid('ev'), type: 'LISTING_PUBLISHED', at: listedAt, inventoryItemId: itemId, listingId, data: { price: s.priceCents }, provenance: s.listedAt ? 'INFERRED' : 'OBSERVED', isDemo: false });
      } else if (prev.priceCents !== s.priceCents) {
        await db.events.put({ id: uid('ev'), type: 'PRICE_CHANGED', at: now, inventoryItemId: itemId, listingId, data: { from: prev.priceCents, to: s.priceCents }, provenance: 'OBSERVED', isDemo: false });
      }
      if (s.views !== null) {
        await db.events.put({ id: uid('ev'), type: 'ENGAGEMENT_OBSERVED', at: now, inventoryItemId: itemId, listingId, data: { views: s.views, favorites: s.favorites }, provenance: 'OBSERVED', isDemo: false });
      }
    }

    // Sold orders → real sale prices, matched by normalized title on closed listings.
    const closed = await db.listings.filter((l) => l.status === 'SOLD' && !l.isDemo).toArray();
    const existingSales = await db.sales.toArray();
    const sold = new Set(existingSales.map((x) => x.inventoryItemId));
    for (const o of orders) {
      const match = closed.find((l) => normalizeText(l.title) === normalizeText(o.title) && !sold.has(l.inventoryItemId));
      if (!match) continue;
      // Orders carry a calendar date: compare as UTC dates, never as instants.
      const soldAt = o.date ?? now;
      const sale: Sale = {
        id: uid('sale'),
        inventoryItemId: match.inventoryItemId,
        listingId: match.id,
        soldAt: Math.max(soldAt, match.listedAt),
        salePriceCents: o.priceCents,
        // Private sellers pay no commission on Vinted: extra costs are known to be zero.
        extraCostsCents: 0,
        status: o.status && /rembours|refund|annul|cancel/i.test(o.status) ? 'REFUNDED' : 'COMPLETED',
        isDemo: false,
      };
      await db.sales.put(sale);
      await db.events.put({ id: uid('ev'), type: 'ITEM_SOLD', at: sale.soldAt, inventoryItemId: match.inventoryItemId, listingId: match.id, data: { price: o.priceCents }, provenance: 'OBSERVED', isDemo: false });
      sold.add(match.inventoryItemId);
      salesCount++;
    }
    await repo.setSetting('dataMode', 'real');
    await repo.setSetting('lastVintedImport', now);
  });
  await repo.track('inventory_imported');
  if (salesCount > 0) await repo.track('first_sale_tracked');
  onStage('COMPLETE');
  return { items: created, updated, sales: salesCount };
}

function inferBrand(title: string): string | null {
  const k = brandKey(title);
  return k !== normalizeText(title) ? k.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
