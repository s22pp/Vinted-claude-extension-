import { MarketplaceError } from '../marketplace';
import * as budget from './budget-store';
import type { CatalogPageRead, EraMessage, ReserveResult } from './protocol';
import { ping, waitForLoad } from './tabs';

/**
 * Visits of Vinted's public search page, owned by the service worker. One background tab is reused from one search
 * to the next and closed once idle, whoever asked (a popup that closes mid-search leaves no tab behind). Visits run
 * one at a time; each costs one unit of the call budget (a normal page view).
 */

export interface SearchPageVisit {
  template: string | null;
  observed: string[];
  page: CatalogPageRead | null;
}

/** Paths the search page calls that are not a listing search (seen: promoted_closets — another member's wardrobe). */
const NOT_A_SEARCH = /promoted|closet|banner|suggest|saved_search|conversation|notification/i;

/** Turn an observed search URL into a reusable template: same path and params, our text in search_text. */
export function templateFromObserved(url: string): string | null {
  const [path, qs = ''] = url.split('?');
  if (!path?.startsWith('/api/') || NOT_A_SEARCH.test(path)) return null;
  const params = new URLSearchParams(qs);
  if (!params.has('search_text')) return null;
  params.set('search_text', '__Q__');
  // Keep the page's own paging and filters, but never ask for more than 2 pages' worth.
  params.delete('page');
  return `${path}?${params.toString().replace('__Q__', '{q}')}`;
}

const TAB_KEY = 'eraSearchTab';
export const SEARCH_TAB_ALARM = 'era-search-tab';
/** A tab not used for this long is closed (checked by an alarm: the worker may sleep in between). */
export const SEARCH_TAB_IDLE_MS = 45_000;

const inWorker = () => typeof (globalThis as { ServiceWorkerGlobalScope?: unknown }).ServiceWorkerGlobalScope !== 'undefined' && typeof window === 'undefined';

/** From any extension page, or from the worker itself. */
export async function visitSearchPage(q: string): Promise<SearchPageVisit> {
  if (inWorker()) return visitInWorker(q);
  const r = (await browser.runtime.sendMessage({ type: 'era:search:visit', q } satisfies EraMessage)) as ({ ok: true } & SearchPageVisit) | { ok: false; code: string; detail?: string };
  if (!r || !r.ok) throw new MarketplaceError((r?.code ?? 'UNAVAILABLE') as never, r && 'detail' in r ? r.detail : undefined);
  return { template: r.template, observed: r.observed, page: r.page };
}

let queue: Promise<unknown> = Promise.resolve();

/** Worker side: one visit after the other. */
export function visitInWorker(q: string): Promise<SearchPageVisit> {
  const run = queue.then(() => visit(q));
  queue = run.catch(() => undefined);
  return run;
}

async function visit(q: string): Promise<SearchPageVisit> {
  const r: ReserveResult = await budget.reserve('SEARCH');
  if (!r.ok) throw new MarketplaceError(r.code);
  if (r.wait > 0) await new Promise((res) => setTimeout(res, r.wait));
  const url = `https://www.vinted.fr/catalog?search_text=${encodeURIComponent(q)}&order=newest_first`;
  const tabId = await searchTab(url);
  await browser.storage.session.set({ [TAB_KEY]: { id: tabId, at: Date.now() } });
  try {
    await waitForLoad(tabId, 15_000);
    // First load failed (network hiccup, interstitial): no content script answers. Navigate once more right away.
    if (!(await ping(tabId))) {
      await browser.tabs.update(tabId, { url });
      await waitForLoad(tabId, 15_000);
    }
    let observed: string[] = [];
    let template: string | null = null;
    let page: CatalogPageRead | null = null;
    // Results can arrive after load: look for up to ~12 s. Only the page of THIS search counts (a reused tab may still
    // show the previous one for a moment).
    for (let i = 0; i < 24; i++) {
      await new Promise((res) => setTimeout(res, i === 0 ? 250 : 500));
      try {
        const read = (await browser.tabs.sendMessage(tabId, { type: 'era:catalog:read' } satisfies EraMessage)) as CatalogPageRead;
        if (read.query !== q) continue;
        page = read;
        observed = ((await browser.tabs.sendMessage(tabId, { type: 'era:observe' } satisfies EraMessage)) as { urls: string[] }).urls;
        template = observed.map(templateFromObserved).find((x): x is string => x !== null) ?? null;
        if (template || page.cards.length > 0) break;
      } catch {
        /* content script not ready yet */
      }
      // Still nothing half-way (a second failed load): one more navigation.
      if (i === 10 && !page && !(await ping(tabId))) await browser.tabs.update(tabId, { url });
    }
    return { template, observed: [...new Set(observed.map((u) => u.split('?')[0]!))], page };
  } finally {
    await browser.storage.session.set({ [TAB_KEY]: { id: tabId, at: Date.now() } });
    await browser.alarms.create(SEARCH_TAB_ALARM, { delayInMinutes: 1 });
  }
}

/** The search tab of the last visits when it is still there, else a new one in the background. */
async function searchTab(url: string): Promise<number> {
  const kept = ((await browser.storage.session.get(TAB_KEY)) as { [TAB_KEY]?: { id: number } })[TAB_KEY];
  if (kept) {
    const tab = await browser.tabs.get(kept.id).catch(() => null);
    if (tab?.url?.startsWith('https://www.vinted.fr/catalog')) {
      await browser.tabs.update(kept.id, { url });
      return kept.id;
    }
  }
  return (await browser.tabs.create({ url, active: false })).id!;
}

/** Closes the search tab once it has been idle (alarm, and at the worker's start). */
export async function closeIdleSearchTab(now = Date.now()): Promise<void> {
  const kept = ((await browser.storage.session.get(TAB_KEY)) as { [TAB_KEY]?: { id: number; at: number } })[TAB_KEY];
  if (!kept) return;
  if (now - kept.at < SEARCH_TAB_IDLE_MS) {
    await browser.alarms.create(SEARCH_TAB_ALARM, { delayInMinutes: 1 });
    return;
  }
  await browser.storage.session.remove(TAB_KEY);
  const tab = await browser.tabs.get(kept.id).catch(() => null);
  // Only ERA's own search tab, still on a search page: a tab the seller took over is left alone.
  if (tab && !tab.active && tab.url?.startsWith('https://www.vinted.fr/catalog')) await browser.tabs.remove(kept.id).catch(() => undefined);
}
