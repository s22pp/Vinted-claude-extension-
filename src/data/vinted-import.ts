import type { InventoryItem, Listing, Sale } from '@/domain/entities';
import { brandDisplay, brandInTitle, categoriesInTitle, isUnknownBrand, normalizeText } from '@/intelligence/normalize';
import { skuOf, skusInText } from '@/intelligence/listing';
import { REPOST_WINDOW_DAYS, type RepostCandidate, type RepostMatch, matchRepost } from '@/intelligence/repost';
import { DAY } from '@/domain/time';
import { MarketplaceError } from './adapters/marketplace';
import type { ImportStage } from './adapters/vinted/protocol';
import { VintedTabAdapter, ensureVintedTab } from './adapters/vinted/vinted-adapter';
import { isInStock, isLiveListing, listingStatusOf, resolveImportedStatus } from '@/domain/status';
import { fetchPurchases } from './adapters/vinted/orders';
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
): Promise<{ items: number; updated: number; sales: number; linked: number; reposts: number; removed: number }> {
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
  let linked = 0;
  let salesCount = 0;
  // Items prepared in ERA and published by hand carry their reference (E1C4G) in the title:
  // the new Vinted listing is attached to that item instead of creating a duplicate.
  const onVinted = new Set(existing.filter((l) => l.platformListingId).map((l) => l.inventoryItemId));
  const bySku = new Map((await db.items.filter((i) => !i.isDemo && !onVinted.has(i.id)).toArray()).map((i) => [skuOf(i.id), i]));

  // Reposts: a listing gone from the COMPLETE wardrobe may come back under a new id (deleted then published
  // again, by hand or by any tool). The new announcement joins the same article: cost, purchase date, first
  // listing date and history carry over. A listing that vanished while an order names it was sold instead.
  const snapIds = new Set(snapshot.map((s) => s.platformListingId));
  const existingSales = await db.sales.toArray();
  const itemsById = new Map((await db.items.filter((i) => !i.isDemo).toArray()).map((i) => [i.id, i]));
  const soldIds = new Set(orders.map((o) => o.itemId).filter((x): x is string => !!x));
  const knownOrders = new Set(existingSales.map((x) => x.orderKey).filter((k): k is string => !!k));
  const newTitleOrders = orders.filter((o) => !o.itemId && !knownOrders.has(`k:${orderKey(o.title, o.date, o.priceCents)}`));
  const soldNow = (l: Listing) =>
    (l.platformListingId !== null && soldIds.has(l.platformListingId)) ||
    newTitleOrders.some((o) => normalizeText(o.title) === normalizeText(l.title) && (o.date === null || o.date >= (l.lastObservedAt ?? 0) - DAY));
  const vanished = adapter.inventoryComplete ? existing.filter((l) => l.platformListingId !== null && !snapIds.has(l.platformListingId) && isLiveListing(l.status)) : [];
  const stillLive = new Set(existing.filter((l) => isLiveListing(l.status) && l.platformListingId !== null && snapIds.has(l.platformListingId)).map((l) => l.inventoryItemId));
  const repostPool: RepostCandidate[] = [];
  for (const l of vanished) {
    const item = itemsById.get(l.inventoryItemId);
    if (item && !soldNow(l) && !stillLive.has(item.id)) repostPool.push({ listing: l, item });
  }
  // Seen gone at an earlier import (article archived by that inference, not back since): may still return.
  for (const l of [...existing].sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0))) {
    const item = itemsById.get(l.inventoryItemId);
    if (!item || l.status !== 'REMOVED' || l.removedAt === null || now - l.removedAt > REPOST_WINDOW_DAYS * DAY) continue;
    if (item.status !== 'ARCHIVED' || item.meta.status?.p !== 'INFERRED' || stillLive.has(item.id) || repostPool.some((c) => c.item.id === item.id)) continue;
    repostPool.push({ listing: l, item });
  }
  const repostedFrom = new Set<string>();
  let reposts = 0;
  let removed = 0;

  await db.transaction('rw', [db.items, db.listings, db.observations, db.events, db.sales, db.settings], async () => {
    for (const s of snapshot) {
      const prev = byPlatformId.get(s.platformListingId);
      const brandGuess = s.brand ?? inferBrand(s.title);
      let itemId = prev?.inventoryItemId;
      let prevItem = itemId ? await db.items.get(itemId) : undefined;
      if (!prev) {
        const match = skusInText(s.title).map((k) => bySku.get(k)).find(Boolean);
        if (match) {
          itemId = match.id;
          prevItem = match;
          bySku.delete(skuOf(match.id));
          linked++;
        }
      }
      let repost: RepostMatch | null = null;
      if (!prev && !itemId) {
        repost = matchRepost({ title: s.title, brand: s.brand, size: s.size, priceCents: s.priceCents }, repostPool);
        if (repost) {
          itemId = repost.candidate.item.id;
          prevItem = (await db.items.get(itemId)) ?? repost.candidate.item;
          repostPool.splice(repostPool.indexOf(repost.candidate), 1);
          repostedFrom.add(repost.candidate.listing.id);
          reposts++;
        }
      }
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
          costDetail: null,
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
        // A brand still unknown is filled as soon as Vinted or the title gives one (never overwritten otherwise).
        const brandFix = isUnknownBrand(prevItem.brand) && brandGuess ? { brand: brandGuess, meta: { ...prevItem.meta, brand: { p: s.brand ? 'OBSERVED' : 'INFERRED', at: now } } } : null;
        if (brandFix) prevItem = { ...prevItem, ...brandFix } as typeof prevItem;
        // A repost carries new photo URLs (the old announcement's may be gone): prefer them.
        await db.items.put({ ...prevItem, status: resolved.status, photoUrl: repost ? (s.photoUrl ?? prevItem.photoUrl) : (prevItem.photoUrl ?? s.photoUrl), updatedAt: now, meta: { ...prevItem.meta, status: { p: resolved.p, at: now } } });
        if (prevItem.status !== resolved.status)
          await db.events.put({ id: uid('ev'), type: 'STATUS_CHANGED', at: now, inventoryItemId: itemId, listingId: prev?.id ?? null, data: { from: prevItem.status, to: resolved.status }, provenance: resolved.p, isDemo: false });
      }
      const listingId = prev?.id ?? uid('listing');
      // No photo timestamp: ERA only knows when it first saw the listing. Kept as a bound, flagged unknown.
      const listedAt = s.listedAt ?? prev?.listedAt ?? now;
      const listedAtKnown = s.listedAt !== null;
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
        listedAtKnown,
        removedAt: resolved.status === 'ARCHIVED' || resolved.status === 'DRAFT' ? (prev?.removedAt ?? now) : null,
        soldAt: resolved.status === 'SOLD' ? (prev?.soldAt ?? now) : null,
        status: listingStatusOf(resolved.status),
        lastObservedAt: now,
        isDemo: false,
      };
      await db.listings.put(listing);
      // A closed announcement no longer moves: once it stops changing, no new observation per import.
      const moved = !prev || prev.priceCents !== s.priceCents || prev.views !== s.views || prev.favorites !== s.favorites;
      if (moved || isLiveListing(listing.status))
        await db.observations.put({ id: uid('obs'), listingId, inventoryItemId: itemId, at: now, priceCents: s.priceCents, views: s.views, favorites: s.favorites, provenance: 'OBSERVED' });
      if (!prev && repost) {
        // The same article, published again: the old announcement is closed, what Vinted reset is kept.
        const old = repost.candidate.listing;
        if (old.removedAt === null) {
          const goneAt = Math.max(old.listedAt, Math.min(now, listedAt));
          await db.listings.put({ ...old, status: 'REMOVED', removedAt: goneAt });
          await db.events.put({ id: uid('ev'), type: 'LISTING_REMOVED', at: goneAt, inventoryItemId: itemId, listingId: old.id, data: { views: old.views, favorites: old.favorites, price: old.priceCents }, provenance: 'INFERRED', isDemo: false });
        }
        await db.events.put({
          id: uid('ev'),
          type: 'LISTING_REPUBLISHED',
          at: listedAt,
          inventoryItemId: itemId,
          listingId,
          data: { price: s.priceCents, from: old.id, basis: repost.basis, priceFrom: old.priceCents, priceTo: s.priceCents, viewsLost: old.views, favoritesLost: old.favorites },
          provenance: 'INFERRED',
          isDemo: false,
        });
        if (s.priceCents < old.priceCents)
          await db.events.put({ id: uid('ev'), type: 'PRICE_CHANGED', at: listedAt, inventoryItemId: itemId, listingId, data: { from: old.priceCents, to: s.priceCents }, provenance: 'OBSERVED', isDemo: false });
      } else if (!prev) {
        // First seen already sold, with no publication date: no invented "published today" entry.
        if (listedAtKnown || s.status !== 'SOLD')
          await db.events.put({ id: uid('ev'), type: 'LISTING_PUBLISHED', at: listedAt, inventoryItemId: itemId, listingId, data: { price: s.priceCents }, provenance: s.listedAt ? 'INFERRED' : 'OBSERVED', isDemo: false });
      } else if (prev.priceCents !== s.priceCents) {
        await db.events.put({ id: uid('ev'), type: 'PRICE_CHANGED', at: now, inventoryItemId: itemId, listingId, data: { from: prev.priceCents, to: s.priceCents }, provenance: 'OBSERVED', isDemo: false });
      }
      // Timeline: engagement when favourites move (views stay in the observation history, charted on the item).
      if (s.views !== null && (!prev || prev.favorites !== s.favorites)) {
        await db.events.put({ id: uid('ev'), type: 'ENGAGEMENT_OBSERVED', at: now, inventoryItemId: itemId, listingId, data: { views: s.views, favorites: s.favorites }, provenance: 'OBSERVED', isDemo: false });
      }
    }

    // Sold orders → real sale prices, matched by normalized title on closed listings.
    const closed = await db.listings.filter((l) => l.status === 'SOLD' && !l.isDemo).toArray();
    // Gone from the wardrobe and not published again: sold (if an order names it) or deleted.
    const goneLeft = vanished.filter((l) => !repostedFrom.has(l.id));
    const sold = new Set(existingSales.map((x) => x.inventoryItemId));
    const seenSales = new Set<string>();
    for (const o of orders) {
      // Orders carry a calendar date: compare as UTC dates, never as instants.
      const soldAt = o.date ?? now;
      // A cancelled order never became a sale (the item goes back on sale): not a refund, skipped.
      if (o.status && /annul|cancel/i.test(o.status) && !/rembours|refund/i.test(o.status)) continue;
      const refunded = !!o.status && /rembours|refund/i.test(o.status);
      // The same order seen again: refresh its Vinted status (a refund, an action awaited) and never
      // record a second sale. Each sale keeps the key of its order (the listing id when the order carries
      // one, else title|date|price), so two identical titles sold twice stay two sales.
      const okey = o.itemId ? `id:${o.itemId}` : `k:${orderKey(o.title, o.date, o.priceCents)}`;
      const byId = o.itemId ? closed.filter((l) => l.platformListingId === o.itemId) : [];
      const pool = byId.length ? byId : closed.filter((l) => normalizeText(l.title) === normalizeText(o.title));
      const free = (x: Sale) => !seenSales.has(x.id);
      const prevSale =
        existingSales.find((x) => free(x) && x.orderKey === okey) ??
        // Sales recorded before order keys existed: same listing, or same title at the same price — once each.
        existingSales.find((x) => free(x) && !x.orderKey && pool.some((l) => l.inventoryItemId === x.inventoryItemId) && (byId.length > 0 || x.salePriceCents === o.priceCents));
      if (prevSale) {
        seenSales.add(prevSale.id);
        // Older imports could date a sale at the import day: the order's own date wins.
        const fixedAt = o.date !== null && o.date !== prevSale.soldAt ? o.date : null;
        await db.sales.put({ ...prevSale, orderKey: okey, soldAt: fixedAt ?? prevSale.soldAt, dateKnown: o.date !== null || prevSale.dateKnown === true, status: refunded ? 'REFUNDED' : prevSale.status, vintedStatus: o.status, needsAction: o.needsAction, vintedConversationId: o.conversationId ?? prevSale.vintedConversationId ?? null });
        if (fixedAt !== null) {
          await db.events.where('inventoryItemId').equals(prevSale.inventoryItemId).filter((e) => e.type === 'ITEM_SOLD' && e.listingId === prevSale.listingId).modify({ at: fixedAt });
          if (prevSale.listingId) await db.listings.update(prevSale.listingId, { soldAt: fixedAt });
        }
        continue;
      }
      const soldPool = [...closed, ...goneLeft];
      const match =
        (o.itemId ? soldPool.find((l) => l.platformListingId === o.itemId && !sold.has(l.inventoryItemId)) : undefined) ??
        soldPool.find(
          (l) =>
            normalizeText(l.title) === normalizeText(o.title) &&
            !sold.has(l.inventoryItemId) &&
            (l.status === 'SOLD' || o.date === null || o.date >= (l.lastObservedAt ?? 0) - DAY),
        );
      if (match && match.status !== 'SOLD') {
        // It left the wardrobe because it sold: the order says so, it was not deleted.
        await db.listings.put({ ...match, status: 'SOLD', soldAt, removedAt: null });
        const it = await db.items.get(match.inventoryItemId);
        if (it && it.status !== 'SOLD') {
          await db.items.put({ ...it, status: 'SOLD', updatedAt: now, meta: { ...it.meta, status: { p: 'OBSERVED', at: now } } });
          await db.events.put({ id: uid('ev'), type: 'STATUS_CHANGED', at: now, inventoryItemId: it.id, listingId: match.id, data: { from: it.status, to: 'SOLD' }, provenance: 'OBSERVED', isDemo: false });
        }
        goneLeft.splice(goneLeft.indexOf(match), 1);
      }
      if (match) {
        const sale: Sale = {
          id: uid('sale'),
          inventoryItemId: match.inventoryItemId,
          listingId: match.id,
          // The order's date, never moved to fit a listing date ERA may only have guessed.
          soldAt,
          dateKnown: o.date !== null,
          salePriceCents: o.priceCents,
          // Private sellers pay no commission on Vinted: extra costs are known to be zero.
          extraCostsCents: 0,
          status: refunded ? 'REFUNDED' : 'COMPLETED',
          vintedStatus: o.status,
          needsAction: o.needsAction,
          vintedConversationId: o.conversationId,
          orderKey: okey,
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
      const prevVo = await db.sales.get(saleId);
      if (prevVo) {
        await db.sales.put({ ...prevVo, orderKey: okey, dateKnown: o.date !== null, status: refunded ? 'REFUNDED' : prevVo.status, vintedStatus: o.status, needsAction: o.needsAction, vintedConversationId: o.conversationId ?? prevVo.vintedConversationId ?? null });
        continue;
      }
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
        costDetail: null,
        purchaseDate: null,
        purchaseSource: null,
        status: 'SOLD',
        createdAt: now,
        updatedAt: now,
        meta: { status: { p: 'OBSERVED', at: now }, brand: { p: brandGuess ? 'INFERRED' : 'UNKNOWN', at: now } },
        isDemo: false,
      });
      await db.sales.put({ id: saleId, inventoryItemId: itemId, listingId: null, soldAt, salePriceCents: o.priceCents, extraCostsCents: 0, status: refunded ? 'REFUNDED' : 'COMPLETED', vintedStatus: o.status, needsAction: o.needsAction, orderKey: okey, dateKnown: o.date !== null, vintedConversationId: o.conversationId, isDemo: false });
      await db.events.put({ id: uid('ev'), type: 'ITEM_SOLD', at: soldAt, inventoryItemId: itemId, listingId: null, data: { price: o.priceCents }, provenance: 'OBSERVED', isDemo: false });
      salesCount++;
    }
    // Gone from the whole wardrobe, not sold, not published again: deleted on Vinted. The article leaves the
    // stock by inference only (INFERRED): published again within 30 days, it is recognised and comes back.
    for (const l of goneLeft) {
      await db.listings.put({ ...l, status: 'REMOVED', removedAt: now });
      await db.events.put({ id: uid('ev'), type: 'LISTING_REMOVED', at: now, inventoryItemId: l.inventoryItemId, listingId: l.id, data: { views: l.views, favorites: l.favorites, price: l.priceCents }, provenance: 'INFERRED', isDemo: false });
      const it = await db.items.get(l.inventoryItemId);
      if (it && isInStock(it.status) && !stillLive.has(it.id)) {
        await db.items.put({ ...it, status: 'ARCHIVED', updatedAt: now, meta: { ...it.meta, status: { p: 'INFERRED', at: now } } });
        await db.events.put({ id: uid('ev'), type: 'STATUS_CHANGED', at: now, inventoryItemId: it.id, listingId: l.id, data: { from: it.status, to: 'ARCHIVED' }, provenance: 'INFERRED', isDemo: false });
      }
      removed++;
    }
    await repo.setSetting('dataMode', 'real');
    await repo.setSetting('lastVintedImport', now);
    // Diagnostic: which fields Vinted actually returned (e.g. whether a reservation flag exists).
    await repo.setSetting('vintedWardrobeKeys', [...adapter.wardrobeKeys].sort());
  });
  await repo.track('inventory_imported');
  if (salesCount > 0) await repo.track('first_sale_tracked');
  onStage('COMPLETE');
  return { items: created, updated, sales: salesCount, linked, reposts, removed };
}

/**
 * Purchases (real buying prices), run AFTER the stock import so it never slows it down or makes it fail.
 * The first run learns the purchases endpoint from Vinted's own page; later runs reuse it.
 */
export async function importPurchasesFromVinted(now = Date.now()): Promise<number> {
  try {
    await ensureVintedTab();
    const purchases = await fetchPurchases(new VintedTabAdapter());
    for (const p of purchases) {
      const id = `pur_${orderKey(p.title, p.date, p.priceCents)}`;
      const prev = await db.purchases.get(id);
      await db.purchases.put({ id, title: p.title, priceCents: p.priceCents, date: p.date, status: p.status, linkedItemId: prev?.linkedItemId ?? null, dismissed: prev?.dismissed ?? false, importedAt: now });
    }
    await repo.setSetting('purchasesError', null);
    return purchases.length;
  } catch (e) {
    await repo.setSetting('purchasesError', e instanceof Error ? e.message : String(e));
    return 0;
  }
}

function orderKey(title: string, date: number | null, price: number): string {
  const raw = `${normalizeText(title)}|${date ?? ''}|${price}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** A brand written in the title, from ERA's dictionary; displayed the way people write it. */
function inferBrand(title: string): string | null {
  const k = brandInTitle(title);
  return k ? brandDisplay(k) : null;
}
