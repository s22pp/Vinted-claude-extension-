import { errorInfo } from '../marketplace';
import { db } from '../../db';
import { DEFAULT_SEARCH_TEMPLATE, SEARCH_TEMPLATE_KEY, VintedTabAdapter, ensureVintedTab, findVintedTab } from './vinted-adapter';
import { currentUserId, firstArray } from './parse';
import type { BudgetStatus, EraMessage } from './protocol';

export type DiagKey = 'worker' | 'tab' | 'session' | 'wardrobe' | 'catalog';
export interface DiagStep {
  key: DiagKey;
  ok: boolean;
  info: string;
}

/**
 * Step-by-step check of the whole chain, stopping at the first failure (no wasted calls).
 * Costs at most 3 budgeted GET calls: users/current, wardrobe page 1, one catalog search.
 */
export async function runVintedDiagnostic(onStep: (s: DiagStep) => void): Promise<DiagStep[]> {
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

  try {
    const json = await adapter.rawGet(`/api/v2/wardrobe/${uid}/items?page=1&per_page=20`);
    const items = firstArray(json, ['items']);
    const keys = [...new Set(items.flatMap((i) => Object.keys(i)))].sort();
    if (!push({ key: 'wardrobe', ok: true, info: `${items.length} articles lus · is_reserved ${keys.includes('is_reserved') ? 'présent' : 'absent'} · champs : ${keys.slice(0, 40).join(', ')}` }))
      return steps;
  } catch (e) {
    return fail('wardrobe', e);
  }

  try {
    const res = await adapter.searchComparables({ text: 'veste ralph lauren', brand: 'Ralph Lauren', category: 'JACKET', gender: null, size: null, condition: null });
    const used = ((await db.settings.get(SEARCH_TEMPLATE_KEY))?.value as string | undefined) ?? DEFAULT_SEARCH_TEMPLATE;
    push({
      key: 'catalog',
      ok: res.candidates.length > 0,
      info: `${res.candidates.length} comparables · total ${res.totalEntries === null ? '?' : res.totalCapped ? '≥ 960' : res.totalEntries} · via ${used.split('?')[0]}`,
    });
  } catch (e) {
    return fail('catalog', e);
  }
  return steps;
}
