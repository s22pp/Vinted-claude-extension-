import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { brandKey, categoriesInTitle, normalizeText } from '@/intelligence/normalize';
import { MarketplaceError } from './adapters/marketplace';
import type { ImportStage } from './adapters/vinted/protocol';
import { VintedTabAdapter, ensureVintedTab } from './adapters/vinted/vinted-adapter';
import { listingStatusOf, resolveImportedStatus } from '@/domain/status';
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
      const prevItem = itemId ? await db.items.get(itemId) : undefined;
      const resolved = resolveImportedStatus(prevItem ?? null, s.status, s.reservedKnown);
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
          status: resolved.status,
          createdAt: now,
          updatedAt: now,
          meta: {
            status: { p: resolved.p, at: now },
            brand: { p: s.brand ? 'OBSERVED' : brandGuess ? 'INFERRED' : 'UNKNOWN', at: now },
            category: { p: 'INFERRED', at: now },
          },
          isDemo: false,
        };
        await db.items.put(item);
        created++;
      } else if (prevItem) {
        updated++;
        await db.items.put({ ...prevItem, status: resolved.status, updatedAt: now, meta: { ...prevItem.meta, status: { p: resolved.p, at: now } } });
        if (prevItem.status !== resolved.status)
          await db.events.put({ id: uid('ev'), type: 'STATUS_CHANGED', at: now, inventoryItemId: itemId, listingId: prev?.id ?? null, data: { from: prevItem.status, to: resolved.status }, provenance: resolved.p, isDemo: false });
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
        removedAt: resolved.status === 'ARCHIVED' || resolved.status === 'DRAFT' ? (prev?.removedAt ?? now) : null,
        soldAt: resolved.status === 'SOLD' ? (prev?.soldAt ?? now) : null,
        status: listingStatusOf(resolved.status),
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
      // Orders carry a calendar date: compare as UTC dates, never as instants.
      const soldAt = o.date ?? now;
      const refunded = !!o.status && /rembours|refund|annul|cancel/i.test(o.status);
      const match = closed.find((l) => normalizeText(l.title) === normalizeText(o.title) && !sold.has(l.inventoryItemId));
      if (match) {
        const sale: Sale = {
          id: uid('sale'),
          inventoryItemId: match.inventoryItemId,
          listingId: match.id,
          soldAt: Math.max(soldAt, match.listedAt),
          salePriceCents: o.priceCents,
          // Private sellers pay no commission on Vinted: extra costs are known to be zero.
          extraCostsCents: 0,
          status: refunded ? 'REFUNDED' : 'COMPLETED',
          isDemo: false,
        };
        await db.sales.put(sale);
        await db.events.put({ id: uid('ev'), type: 'ITEM_SOLD', at: sale.soldAt, inventoryItemId: match.inventoryItemId, listingId: match.id, data: { price: o.priceCents }, provenance: 'OBSERVED', isDemo: false });
        sold.add(match.inventoryItemId);
        salesCount++;
        continue;
      }
      // No listing left in the wardrobe for this order (older sales drop out of it): keep the sale anyway,
      // as a sold item built from the order. Deterministic id → re-importing never duplicates it.
      const saleId = `sale_vo_${orderKey(o.title, o.date, o.priceCents)}`;
      if (await db.sales.get(saleId)) continue;
      const itemId = `item_vo_${orderKey(o.title, o.date, o.priceCents)}`;
      const brandGuess = inferBrand(o.title);
      await db.items.put({
        id: itemId,
        title: o.title,
        brand: brandGuess ?? 'Inconnue',
        model: null,
        category: categoriesInTitle(normalizeText(o.title))[0] ?? 'OTHER',
        gender: null,
        size: null,
        condition: null,
        material: null,
        era: null,
        photoUrl: null,
        purchasePriceCents: null,
        purchaseDate: null,
        purchaseSource: null,
        status: 'SOLD',
        createdAt: now,
        updatedAt: now,
        meta: { status: { p: 'OBSERVED', at: now }, brand: { p: brandGuess ? 'INFERRED' : 'UNKNOWN', at: now } },
        isDemo: false,
      });
      await db.sales.put({ id: saleId, inventoryItemId: itemId, listingId: null, soldAt, salePriceCents: o.priceCents, extraCostsCents: 0, status: refunded ? 'REFUNDED' : 'COMPLETED', isDemo: false });
      await db.events.put({ id: uid('ev'), type: 'ITEM_SOLD', at: soldAt, inventoryItemId: itemId, listingId: null, data: { price: o.priceCents }, provenance: 'OBSERVED', isDemo: false });
      salesCount++;
    }
    await repo.setSetting('dataMode', 'real');
    await repo.setSetting('lastVintedImport', now);
    // Diagnostic: which fields Vinted actually returned (e.g. whether a reservation flag exists).
    await repo.setSetting('vintedWardrobeKeys', [...adapter.wardrobeKeys].sort());
  });
  await repo.track('inventory_imported');
  if (salesCount > 0) await repo.track('first_sale_tracked');
  onStage('COMPLETE');
  return { items: created, updated, sales: salesCount };
}

function orderKey(title: string, date: number | null, price: number): string {
  const raw = `${normalizeText(title)}|${date ?? ''}|${price}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function inferBrand(title: string): string | null {
  const k = brandKey(title);
  return k !== normalizeText(title) ? k.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
