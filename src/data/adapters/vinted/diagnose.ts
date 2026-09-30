import { errorInfo } from '../marketplace';
import { db } from '../../db';
import { DEFAULT_SEARCH_TEMPLATE, SEARCH_DOWN_KEY, SEARCH_TEMPLATE_KEY, VintedTabAdapter, ensureVintedTab, findVintedTab } from './vinted-adapter';
import { PURCHASES_TEMPLATE_KEY } from './orders';
import { currentUserId, firstArray } from './parse';
import type { BudgetStatus, EraMessage } from './protocol';

/** The last diagnostic search that gave comparables on the real account: proof the search works here, and how. */
export const SEARCH_PROBE_KEY = 'vintedSearchProbe';
export interface SearchProbe {
  at: number;
  via: 'PAGE' | 'LEARNED' | null;
}

export type DiagKey = 'worker' | 'tab' | 'session' | 'wardrobe' | 'catalog' | 'sold' | 'purchases' | 'notifications' | 'inbox' | 'listing' | 'conversation' | 'address' | 'brands' | 'sizes';
export interface DiagStep {
  key: DiagKey;
  ok: boolean;
  info: string;
}

/**
 * Step-by-step check of the whole chain, stopping at the first failure (no wasted calls).
 * Costs 3 budgeted GET calls as a rule (users/current, wardrobe page 1, one search); up to 6 when the search goes
 * through its fallbacks (plain form, search page visit, learned address).
 */
export async function runVintedDiagnostic(onStep: (s: DiagStep) => void, full = false): Promise<DiagStep[]> {
  const steps: DiagStep[] = [];
  const push = (s: DiagStep) => {
    steps.push(s);
    onStep(s);
    return s.ok;
  };
  const fail = (key: DiagKey, e: unknown) => {
    const { code, detail } = errorInfo(e);
    push({ key, ok: false, info: `${code}${detail ? ` · ${detail}` : ''}` });
    return steps;
  };

  try {
    const b = (await browser.runtime.sendMessage({ type: 'era:budget:status' } satisfies EraMessage)) as BudgetStatus | undefined;
    if (!b) throw new Error('le service worker n’a pas répondu');
    if (!push({ key: 'worker', ok: !b.halted, info: b.halted ? `bloqué (${b.halted}) jusqu’à ${b.haltedUntil ? new Date(b.haltedUntil).toLocaleTimeString() : '?'}` : `${b.remaining} requêtes restantes` }))
      return steps;
  } catch (e) {
    return fail('worker', e);
  }

  try {
    const before = await findVintedTab();
    const { tabId, created } = await ensureVintedTab();
    const tab = await browser.tabs.get(tabId);
    push({ key: 'tab', ok: true, info: `${created ? 'ouvert par ERA' : before !== null ? 'onglet existant' : 'onglet'} · ${tab.url ?? '?'}` });
  } catch (e) {
    return fail('tab', e);
  }

  const adapter = new VintedTabAdapter();
  let uid: string | null = null;
  try {
    const json = await adapter.rawGet('/api/v2/users/current');
    uid = currentUserId(json);
    if (!push({ key: 'session', ok: !!uid, info: uid ? `connecté · id ${uid}` : `réponse sans id · clés : ${Object.keys((json as object) ?? {}).join(', ')}` })) return steps;
  } catch (e) {
    return fail('session', e);
  }

  let firstListing: string | null = null;
  try {
    const json = await adapter.rawGet(`/api/v2/wardrobe/${uid}/items?page=1&per_page=20`);
    const items = firstArray(json, ['items']);
    firstListing = items.map((i) => i.id).find((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)))?.toString() ?? null;
    const keys = [...new Set(items.flatMap((i) => Object.keys(i)))].sort();
    if (!push({ key: 'wardrobe', ok: true, info: `${items.length} articles lus · is_reserved ${keys.includes('is_reserved') ? 'présent' : 'absent'} · champs : ${keys.slice(0, 40).join(', ')}` }))
      return steps;
  } catch (e) {
    return fail('wardrobe', e);
  }

  try {
    // The seller asked for this test: a search paused after failures is tried again now.
    await db.settings.delete(SEARCH_DOWN_KEY);
    const res = await adapter.searchComparables({ text: 'veste ralph lauren', brand: 'Ralph Lauren', category: 'JACKET', gender: null, size: null, condition: null });
    const used = ((await db.settings.get(SEARCH_TEMPLATE_KEY))?.value as string | undefined) ?? DEFAULT_SEARCH_TEMPLATE;
    if (res.candidates.length > 0) await db.settings.put({ key: SEARCH_PROBE_KEY, value: { at: Date.now(), via: res.via ?? null } satisfies SearchProbe });
    push({
      key: 'catalog',
      ok: res.candidates.length > 0,
      info: `${res.candidates.length} comparables · total ${res.totalEntries === null ? '?' : res.totalCapped ? '≥ 960' : res.totalEntries} · via ${res.via === 'PAGE' ? 'la page de recherche Vinted (cartes lues, EXPERIMENTAL)' : used.split('?')[0]}`,
    });
  } catch (e) {
    return fail('catalog', e);
  }
  if (!full) return steps;

  // Full check: every other read ERA relies on, once each. A failure here does not stop the rest — only a block does.
  const probe = async (key: DiagKey, path: string | null, describe: (json: unknown) => { ok: boolean; info: string }, none = 'rien à lire (aucune annonce dans la garde-robe)') => {
    // Nothing to read here is said, and the next reads still go ahead (only a block stops them).
    if (!path) {
      push({ key, ok: false, info: none });
      return true;
    }
    try {
      push({ key, ...describe(await adapter.rawGet(path)) });
      return true;
    } catch (e) {
      const { code, detail } = errorInfo(e);
      push({ key, ok: false, info: `${code}${detail ? ` · ${detail}` : ''}` });
      return !['NETWORK_403', 'RATE_LIMITED', 'NOT_LOGGED_IN', 'BUDGET_EXHAUSTED'].includes(code);
    }
  };
  const count = (json: unknown, keys: string[]) => {
    const list = firstArray(json, keys);
    const fields = [...new Set(list.flatMap((i) => Object.keys(i)))].sort().slice(0, 25).join(', ');
    return { ok: true, info: `${list.length} lignes lues${fields ? ` · champs : ${fields}` : ''}` };
  };
  const purchases = ((await db.settings.get(PURCHASES_TEMPLATE_KEY))?.value as string | undefined)?.replace('{page}', '1') ?? '/api/v2/my_orders?type=purchased&status=all&page=1&per_page=5';
  const steps2: [DiagKey, string | null, (j: unknown) => { ok: boolean; info: string }][] = [
    ['sold', '/api/v2/my_orders?type=sold&status=all&page=1&per_page=5', (j) => count(j, ['my_orders', 'orders'])],
    ['purchases', purchases, (j) => count(j, ['my_orders', 'orders'])],
    ['notifications', '/web/api/notifications/notifications?page=1&per_page=5', (j) => count(j, ['notifications'])],
    ['inbox', '/api/v2/inbox?page=1&per_page=5', (j) => count(j, ['conversations'])],
    [
      'listing',
      firstListing ? `/api/v2/item_upload/items/${firstListing}` : null,
      (j) => {
        const it = (j as { item?: Record<string, unknown> })?.item ?? {};
        const keys = Object.keys(it);
        return { ok: keys.length > 0, info: `annonce ${firstListing} · description ${typeof it.description === 'string' ? 'lue' : 'absente'} · photos ${Array.isArray(it.photos) ? it.photos.length : 'absentes'} · champs : ${keys.sort().slice(0, 25).join(', ')}` };
      },
    ],
  ];
  for (const [key, path, describe] of steps2) if (!(await probe(key, path, describe))) return steps;
  // What the tools that write rely on, read only: an order's conversation and the default address (labels, parcels),
  // brand search and a category's sizes (drafts). Never their content in the report — only whether the fields are there.
  const sale = await db.sales.filter((s) => !s.isDemo && !!s.vintedConversationId).last();
  const keysOf = (o: unknown) => (typeof o === 'object' && o !== null ? Object.keys(o).sort() : []);
  const steps3: [DiagKey, string | null, (j: unknown) => { ok: boolean; info: string }, string?][] = [
    [
      'conversation',
      sale ? `/api/v2/conversations/${sale.vintedConversationId}` : null,
      (j) => {
        const c = (j as { conversation?: Record<string, unknown> })?.conversation ?? {};
        const tx = (c.transaction ?? {}) as Record<string, unknown>;
        const shipment = tx.shipment_id ?? (tx.shipment as Record<string, unknown> | undefined)?.id;
        return { ok: keysOf(c).length > 0, info: `transaction ${tx.id !== undefined ? 'présente' : 'absente'} · expédition ${shipment !== undefined && shipment !== null ? 'présente' : 'absente'} · champs : ${keysOf(c).slice(0, 20).join(', ')}` };
      },
      'rien à lire (aucune vente avec sa conversation : importez vos ventes)',
    ],
    ['address', '/api/v2/user_addresses/default_shipping_address', (j) => {
      const a = (j as { user_address?: Record<string, unknown> })?.user_address;
      return { ok: !!a && a.id !== undefined, info: a ? 'adresse d’expédition par défaut présente (contenu non repris ici)' : `pas d’adresse par défaut · clés : ${keysOf(j).join(', ')}` };
    }],
    ['brands', '/api/v2/item_upload/brands?keyword=ralph', (j) => count(j, ['brands'])],
    ['sizes', '/api/v2/item_upload/size_groups?catalog_ids=1812', (j) => count(j, ['size_groups'])],
  ];
  for (const [key, path, describe, none] of steps3) if (!(await probe(key, path, describe, none))) break;
  return steps;
}

export const ACCOUNT_CHECK_KEY = 'accountCheck';
export interface AccountCheck {
  at: number;
  steps: DiagStep[];
}
