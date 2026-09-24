import { db } from '../../db';
import { reserve } from './budget-store';
import { type SoldOrder, firstArray, parseOrder } from './parse';
import type { EraMessage } from './protocol';
import { VintedTabAdapter, ping, waitForLoad } from './vinted-adapter';

export const PURCHASES_TEMPLATE_KEY = 'vintedPurchasesTemplate';

/** Observed orders URL → template: same path/params, `{page}` for paging. */
export function ordersTemplateFromObserved(urls: string[]): string | null {
  const orderCalls = urls.filter((u) => u.startsWith('/api/') && /order/i.test(u.split('?')[0]!));
  // Prefer the call that mentions purchases; never the "sold" list.
  const pick = orderCalls.find((u) => /purchas/i.test(u)) ?? orderCalls.find((u) => !/sold/i.test(u)) ?? null;
  if (!pick) return null;
  const [path, qs = ''] = pick.split('?');
  const params = new URLSearchParams(qs);
  params.set('page', '__P__');
  return `${path}?${params.toString().replace('__P__', '{page}')}`;
}

/**
 * The purchases list endpoint is not in the verified API map: learn it from Vinted's own
 * "Mes commandes → Achats" page (background tab, Resource Timing, read-only), never by guessing.
 */
export async function discoverPurchasesTemplate(): Promise<{ template: string | null; observed: string[] }> {
  const r = await reserve();
  if (!r.ok) return { template: null, observed: [] };
  const url = 'https://www.vinted.fr/my_orders?order_type=purchased';
  const tab = await browser.tabs.create({ url, active: false });
  const tabId = tab.id!;
  try {
    await waitForLoad(tabId, 15_000);
    if (!(await ping(tabId))) {
      await browser.tabs.update(tabId, { url });
      await waitForLoad(tabId, 15_000);
    }
    let observed: string[] = [];
    for (let i = 0; i < 24; i++) {
      await new Promise((res) => setTimeout(res, 500));
      try {
        observed = ((await browser.tabs.sendMessage(tabId, { type: 'era:observe' } satisfies EraMessage)) as { urls: string[] }).urls;
        const t = ordersTemplateFromObserved(observed);
        if (t) return { template: t, observed };
      } catch {
        /* not ready */
      }
    }
    return { template: null, observed };
  } finally {
    await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

/** Up to 2 pages of purchases (budget rule). */
export async function fetchPurchases(adapter: VintedTabAdapter): Promise<SoldOrder[]> {
  let template = (await db.settings.get(PURCHASES_TEMPLATE_KEY))?.value as string | undefined;
  if (!template) {
    const found = await discoverPurchasesTemplate();
    if (!found.template) throw new Error(`liste d’achats non trouvée sur Vinted · appels observés : ${found.observed.map((u) => u.split('?')[0]).join(' | ') || 'aucun'}`);
    template = found.template;
    await db.settings.put({ key: PURCHASES_TEMPLATE_KEY, value: template });
  }
  const out: SoldOrder[] = [];
  for (let page = 1; page <= 2; page++) {
    const raw = firstArray(await adapter.rawGet(template.replace('{page}', String(page))), ['my_orders', 'orders', 'items']);
    out.push(...raw.map(parseOrder).filter((o): o is SoldOrder => o !== null));
    if (raw.length < 20) break;
  }
  return out;
}
