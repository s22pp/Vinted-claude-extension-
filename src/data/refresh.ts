import { db } from './db';
import { repo } from './repo';

/**
 * Keeping ERA up to date without a click: a read-only import every few hours, only while a vinted.fr tab is
 * already open (ERA never opens Vinted by itself for this), never while Vinted blocks. After every import, the
 * toolbar icon shows the orders waiting to be shipped, and — if the seller switched it on — a notification says
 * what is new (an order to ship, a sale).
 */

export const REFRESH_KEY = 'autoRefresh';
export interface RefreshConfig {
  enabled: boolean;
  everyHours: number;
  notify: boolean;
}
export const REFRESH_DEFAULTS: RefreshConfig = { enabled: false, everyHours: 6, notify: true };

export async function loadRefreshConfig(): Promise<RefreshConfig> {
  return { ...REFRESH_DEFAULTS, ...(await repo.getSetting<Partial<RefreshConfig> | null>(REFRESH_KEY, null)) };
}

/** What matters before and after an import, to say what is new. */
export interface SalesSnapshot {
  toShip: Map<string, string>;
  sales: Set<string>;
}

export async function salesSnapshot(): Promise<SalesSnapshot> {
  const sales = await db.sales.filter((s) => !s.isDemo).toArray();
  const titles = new Map((await db.items.bulkGet(sales.map((s) => s.inventoryItemId))).filter((i) => !!i).map((i) => [i!.id, i!.title]));
  return {
    toShip: new Map(sales.filter((s) => s.needsAction && s.status !== 'REFUNDED').map((s) => [s.id, titles.get(s.inventoryItemId) ?? 'commande'])),
    sales: new Set(sales.map((s) => s.id)),
  };
}

/** New orders to ship and new sales between two snapshots (pure). */
export function whatIsNew(before: SalesSnapshot, after: SalesSnapshot): { toShip: string[]; sold: number } {
  const toShip = [...after.toShip].filter(([id]) => !before.toShip.has(id)).map(([, title]) => title);
  const sold = [...after.sales].filter((id) => !before.sales.has(id)).length;
  return { toShip, sold };
}
