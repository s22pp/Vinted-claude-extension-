import { suggestMatches } from '@/intelligence/purchase-match';
import { db } from './db';
import { repo } from './repo';

/**
 * Purchases whose stock item ERA is sure of (it clearly beats every other candidate) are attached at once — the item
 * gets its real cost — with no click. Unsure ones wait in « Achats à rattacher ». Each item takes one purchase at most.
 * Returns how many were attached.
 */
export async function autoLinkSurePurchases(now = Date.now()): Promise<number> {
  const pending = await db.purchases.filter((p) => !p.linkedItemId && !p.dismissed).toArray();
  if (!pending.length) return 0;
  const items = await db.items.filter((i) => !i.isDemo).toArray();
  const taken = new Set((await db.purchases.filter((p) => !!p.linkedItemId).toArray()).map((p) => p.linkedItemId));
  let linked = 0;
  for (const p of pending) {
    // Articles still without a cost first, as in the drawer: a purchase most likely belongs to one of them.
    const free = items.filter((i) => !taken.has(i.id));
    const unpriced = free.filter((i) => i.purchasePriceCents === null);
    const s = suggestMatches(p, unpriced.length ? unpriced : free);
    if (!s.sure || !s.best) continue;
    await repo.linkPurchase(p.id, s.best.itemId, now);
    taken.add(s.best.itemId);
    linked++;
  }
  return linked;
}
