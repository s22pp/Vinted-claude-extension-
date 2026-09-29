import type { ComparableQuery, InventorySnapshotItem, ListingObservationSnapshot, MarketplaceAdapter, SearchResult } from '../marketplace';
import { MarketplaceError } from '../marketplace';
import { brandOf, currentUserId, firstArray, parseCatalogCard, parseCatalogItem, parseOrder, parseTotalEntries, parseWardrobeItem, type SoldOrder } from './parse';
import type { ApiResult, BudgetStatus, CatalogPageRead, EraMessage, PageResult } from './protocol';
import { visitSearchPage } from './search-page';
import { ping, waitForLoad } from './tabs';

export { ping, waitForLoad } from './tabs';
export { templateFromObserved, visitSearchPage } from './search-page';
import type { MarketCandidate } from '@/domain/entities';
import { db } from '../../db';

export async function findVintedTab(): Promise<number | null> {
  const tabs = await browser.tabs.query({ url: 'https://www.vinted.fr/*' });
  return tabs.find((t) => t.active)?.id ?? tabs[0]?.id ?? null;
}

/**
 * One-click: reuse an open vinted.fr tab, or open one in the background (a normal page visit, not an API call)
 * and wait until ERA's content script answers there.
 */
export async function ensureVintedTab(): Promise<{ tabId: number; created: boolean }> {
  const existing = await findVintedTab();
  if (existing !== null && (await ping(existing))) return { tabId: existing, created: false };
  // A vinted.fr tab opened before ERA was installed has no content script: reload it. Otherwise open one.
  const tabId = existing ?? (await browser.tabs.create({ url: 'https://www.vinted.fr/', active: false })).id!;
  // Vinted pages are heavy: give a slow connection up to ~15 s before retrying once.
  const pingLoop = async (tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if (await ping(tabId)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  if (existing !== null) await browser.tabs.reload(tabId);
  await waitForLoad(tabId);
  if (await pingLoop()) return { tabId, created: existing === null };
  // One retry covers a first load that failed (network hiccup, interstitial).
  await browser.tabs.update(tabId, { url: 'https://www.vinted.fr/' });
  await waitForLoad(tabId);
  if (await pingLoop()) return { tabId, created: existing === null };
  if (existing === null) await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
  throw new MarketplaceError('NO_VINTED_TAB', 'CONTENT_SCRIPT_UNREACHABLE');
}

export const SEARCH_TEMPLATE_KEY = 'vintedSearchTemplate';
/**
 * After every known form of the search answered 404: the search is paused for a while, its explanation kept.
 * Calls that can only fail again are not spent against the budget (nor seen by Vinted); the diagnostic lifts it.
 */
export const SEARCH_DOWN_KEY = 'vintedSearchDown';
export const SEARCH_PAUSE_MS = 30 * 60_000;
/**
 * Seen on the seller's account (Sept. 2026): /api/v2/catalog/items answers 404 and Vinted's own search page calls no
 * search API — its results come with the page. ERA then reads the listing cards that page shows (EXPERIMENTAL),
 * remembers it, and tries the API again after a week.
 */
export const SEARCH_MODE_KEY = 'vintedSearchMode';
export const PAGE_MODE_RETRY_MS = 7 * 86_400_000;
export const ERROR_LOG_KEY = 'vintedErrorLog';

export interface VintedErrorEntry {
  at: number;
  code: string;
  detail: string;
  path: string;
}

/** Local technical journal of the last Vinted errors, so the exact cause can be copied in one click. */
export async function logVintedError(code: string, detail: string, path: string): Promise<void> {
  try {
    const cur = ((await db.settings.get(ERROR_LOG_KEY))?.value as VintedErrorEntry[] | undefined) ?? [];
    const entry: VintedErrorEntry = { at: Date.now(), code, detail, path: path.split('?')[0]! };
    await db.settings.put({ key: ERROR_LOG_KEY, value: [entry, ...cur].slice(0, 15) });
  } catch {
    /* the journal must never break the call itself */
  }
}
/** From the verified API map. Replaced by the observed endpoint if Vinted answers 404. */
export const DEFAULT_SEARCH_TEMPLATE = '/api/v2/catalog/items?search_text={q}&per_page=60&order=newest_first';
/** The same endpoint in the form a production extension calls it (Sept. 2026): no sort, first page of 20. */
export const PLAIN_SEARCH_TEMPLATE = '/api/v2/catalog/items?search_text={q}&page=1&per_page=20';

export function fillTemplate(template: string, q: string): string {
  return template.replace('{q}', encodeURIComponent(q));
}


/** What a search page held, for the report: counts, and one card's text as the page wrote it (the evidence to adapt to). */
function pageSummary(page: CatalogPageRead): string {
  const sample = page.cards[0]?.text;
  return `${page.links} liens d’annonce, ${page.cards.length} textes, aucun lu comme annonce${sample ? ` · exemple : « ${sample.slice(0, 160)} »` : ''}`;
}

/** The comparables a search page showed, read from its cards; the ones that do not read as a listing are skipped. */
export function candidatesFromPage(page: CatalogPageRead | null): MarketCandidate[] {
  return (page?.cards ?? []).map((c) => parseCatalogCard(c.href, c.text)).filter((c): c is MarketCandidate => c !== null);
}

export async function budgetStatus(): Promise<BudgetStatus | null> {
  try {
    return (await browser.runtime.sendMessage({ type: 'era:budget:status' } satisfies EraMessage)) as BudgetStatus;
  } catch {
    return null;
  }
}

export async function readPageContext(tabId: number): Promise<PageResult | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, { type: 'era:page' } satisfies EraMessage)) as PageResult;
  } catch {
    return null; // not a vinted.fr tab, or content script not injected yet
  }
}

/**
 * Real Vinted adapter (read-only). Calls go through an open vinted.fr tab so they carry the user's own
 * session; every call is reserved against the session budget by the background worker.
 * Pagination never goes beyond 2 pages.
 */
export class VintedTabAdapter implements MarketplaceAdapter {
  readonly id = 'vinted' as const;
  readonly isDemo = false;
  /** Field names actually returned by the wardrobe endpoint — checked, never assumed. */
  readonly wardrobeKeys = new Set<string>();

  private async api(path: string): Promise<unknown> {
    try {
      // One click: if no vinted.fr tab is open, ERA opens one in the background.
      const { tabId: tab } = await ensureVintedTab();
      let res: ApiResult;
      try {
        res = (await browser.tabs.sendMessage(tab, { type: 'era:api', path } satisfies EraMessage)) as ApiResult;
      } catch {
        throw new MarketplaceError('NO_VINTED_TAB', 'CONTENT_SCRIPT_UNREACHABLE');
      }
      if (!res.ok) throw new MarketplaceError(res.code, res.detail ?? (res.status ? `HTTP ${res.status}` : res.code));
      return res.json;
    } catch (e) {
      if (e instanceof MarketplaceError) await logVintedError(e.code, e.message, path);
      throw e;
    }
  }

  /** Whitelisted GET through the Vinted tab (used by the diagnostic). */
  rawGet(path: string): Promise<unknown> {
    return this.api(path);
  }

  /** The brand of one of MY listings, from its own upload data (verified route), whatever the field shape. */
  async listingBrand(id: string): Promise<string | null> {
    const j = await this.api(`/api/v2/item_upload/items/${id}`);
    const item = typeof j === 'object' && j !== null && 'item' in j ? (j as { item: unknown }).item : null;
    return typeof item === 'object' && item !== null ? brandOf(item as Record<string, unknown>) : null;
  }

  async userId(): Promise<string> {
    const id = currentUserId(await this.api('/api/v2/users/current'));
    if (!id) throw new MarketplaceError('NOT_LOGGED_IN');
    return id;
  }

  /**
   * true when the last getInventory() read the whole wardrobe (its last page was not full). Only then
   * does a listing missing from it mean "gone from Vinted" — never after a page cap.
   */
  inventoryComplete = false;

  async getInventory(): Promise<InventorySnapshotItem[]> {
    const uid = await this.userId();
    const out: InventorySnapshotItem[] = [];
    this.inventoryComplete = false;
    for (let page = 1; page <= 2; page++) {
      const raw = firstArray(await this.api(`/api/v2/wardrobe/${uid}/items?page=${page}&per_page=96`), ['items']);
      for (const it of raw) {
        for (const k of Object.keys(it)) this.wardrobeKeys.add(k);
        const p = parseWardrobeItem(it);
        if (p) out.push(p);
      }
      if (raw.length < 96) {
        this.inventoryComplete = true;
        break;
      }
    }
    return out;
  }

  async getSoldOrders(): Promise<SoldOrder[]> {
    const out: SoldOrder[] = [];
    for (let page = 1; page <= 2; page++) {
      // `status=all` (as read by two production tools) also returns refunded and cancelled orders;
      // if Vinted refuses the parameter, fall back once to the plain list.
      const json = await this.api(`/api/v2/my_orders?type=sold&status=all&page=${page}&per_page=20`).catch((e) => {
        if (page === 1 && e instanceof MarketplaceError && e.code === 'UNAVAILABLE') return this.api(`/api/v2/my_orders?type=sold&page=${page}&per_page=20`);
        throw e;
      });
      const raw = firstArray(json, ['my_orders', 'orders']);
      out.push(...raw.map(parseOrder).filter((o): o is SoldOrder => o !== null));
      if (raw.length < 20) break;
    }
    return out;
  }

  async getListing(): Promise<InventorySnapshotItem | null> {
    // No verified public endpoint for a single listing by id (/api/v2/items/{id} does not exist).
    return null;
  }

  async getListingObservations(): Promise<ListingObservationSnapshot[]> {
    // History is built locally from successive imports; Vinted exposes none.
    return [];
  }

  async searchComparables(query: ComparableQuery): Promise<SearchResult> {
    const down = (await db.settings.get(SEARCH_DOWN_KEY))?.value as { until: number; detail: string } | undefined;
    if (down && down.until > Date.now()) {
      const at = new Date(down.until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      throw new MarketplaceError('UNAVAILABLE', `recherche Vinted en pause jusqu’à ${at} (aucun appel envoyé) · ${down.detail}`);
    }
    // The API search is known gone: read the search page directly (the API is tried again after a week).
    const mode = (await db.settings.get(SEARCH_MODE_KEY))?.value as { at: number } | undefined;
    if (mode && Date.now() - mode.at < PAGE_MODE_RETRY_MS) return this.searchByPage(query);
    const stored = (await db.settings.get(SEARCH_TEMPLATE_KEY))?.value as string | undefined;
    const template = stored ?? DEFAULT_SEARCH_TEMPLATE;
    let json: unknown;
    let learnedUsed = template !== DEFAULT_SEARCH_TEMPLATE && template !== PLAIN_SEARCH_TEMPLATE;
    // Every try is kept: when all fail, the error says exactly which form answered what.
    const attempts: string[] = [];
    const short = (e: MarketplaceError) => e.message.replace(/ · \/api\/[^ ]*/, '');
    try {
      json = await this.api(fillTemplate(template, query.text));
    } catch (e) {
      // 404: first the exact form a production tool uses on this endpoint (page=1, per_page=20, no sort);
      // then learn the endpoint Vinted's own search page uses. Each is tried once.
      if (!(e instanceof MarketplaceError) || !/HTTP 404/.test(e.message)) throw e;
      attempts.push(`${template === DEFAULT_SEARCH_TEMPLATE ? 'forme par défaut' : 'forme mémorisée'} ${template.split('?')[0]} → ${short(e)}`);
      if (template !== PLAIN_SEARCH_TEMPLATE) {
        try {
          json = await this.api(fillTemplate(PLAIN_SEARCH_TEMPLATE, query.text));
          await db.settings.put({ key: SEARCH_TEMPLATE_KEY, value: PLAIN_SEARCH_TEMPLATE });
        } catch (e2) {
          if (!(e2 instanceof MarketplaceError) || !/HTTP 404/.test(e2.message)) throw e2;
          attempts.push(`forme simple → ${short(e2)}`);
        }
      }
    }
    if (json === undefined) {
      const visit = await visitSearchPage(query.text);
      // What Vinted's own search page called (paths only): the fact that decides what to do next, kept in every report.
      const observed = ` · appels observés sur la page de recherche : ${visit.observed.join(' | ') || 'aucun'}`;
      const giveUp = async (tail: string) => {
        const detail = `recherche Vinted introuvable · ${attempts.join(' · ')}${tail}`;
        // Every form failed: pause the search rather than send calls that can only fail again.
        await db.settings.put({ key: SEARCH_DOWN_KEY, value: { until: Date.now() + SEARCH_PAUSE_MS, detail } });
        const err = new MarketplaceError('UNAVAILABLE', detail);
        await logVintedError(err.code, err.message, 'catalog');
        return err;
      };
      // An API search the page itself called: tried once, and kept only if it answers.
      let samePath = false;
      if (visit.template && visit.template !== template) {
        try {
          json = await this.api(fillTemplate(visit.template, query.text));
          await db.settings.put({ key: SEARCH_TEMPLATE_KEY, value: visit.template });
          learnedUsed = true;
        } catch (e3) {
          if (!(e3 instanceof MarketplaceError) || !/HTTP 404/.test(e3.message)) throw e3;
          attempts.push(`adresse de la page de recherche ${visit.template.split('?')[0]} → ${short(e3)}`);
          // Same path as ours, refused all the same: the difference is in the request, not the address.
          samePath = visit.template.split('?')[0] === template.split('?')[0];
        }
      }
      if (json === undefined) {
        // No API search answers: the listings the search page shows are the comparables (EXPERIMENTAL), from now on.
        const cards = candidatesFromPage(visit.page);
        if (cards.length > 0) {
          await db.settings.put({ key: SEARCH_MODE_KEY, value: { at: Date.now() } });
          await db.settings.delete(SEARCH_TEMPLATE_KEY);
          await logVintedError('INFO', `recherche par l’API indisponible (${attempts.join(' · ')}) : comparables lus sur la page de recherche`, 'catalog');
          return { candidates: cards, totalEntries: null, totalCapped: false, fetchedAt: Date.now(), via: 'PAGE' };
        }
        const pageFacts = visit.page ? ` · page de recherche : ${pageSummary(visit.page)}` : ' · page de recherche : non lue';
        throw await giveUp(`${samePath ? ' · même chemin que la page de Vinted : la différence vient de la requête, pas de l’adresse' : ''}${pageFacts}${observed}`);
      }
    }
    // A search answers with a list of listings (`items`, even empty). Anything else is another endpoint: a learned
    // address that was wrong is forgotten and the default form tried once — never "0 listings" read from the wrong reply.
    let candidates = firstArray(json, ['items']).map(parseCatalogItem).filter((c) => c !== null);
    const isSearch = (j: unknown) => typeof j === 'object' && j !== null && Array.isArray((j as { items?: unknown }).items);
    if (!isSearch(json) && candidates.length === 0) {
      const keys = typeof json === 'object' && json !== null ? Object.keys(json).slice(0, 12).join(', ') : typeof json;
      if (learnedUsed) {
        await db.settings.delete(SEARCH_TEMPLATE_KEY);
        await logVintedError('UNAVAILABLE', `adresse de recherche apprise oubliée : réponse sans annonces (clés : ${keys})`, 'catalog');
        json = await this.api(fillTemplate(DEFAULT_SEARCH_TEMPLATE, query.text));
        learnedUsed = false;
        candidates = firstArray(json, ['items']).map(parseCatalogItem).filter((c) => c !== null);
      }
      if (!isSearch(json) && candidates.length === 0) {
        const err = new MarketplaceError('UNAVAILABLE', `recherche Vinted : réponse sans liste d’annonces (clés : ${keys})`);
        await logVintedError(err.code, err.message, 'catalog');
        throw err;
      }
    }
    const { total, capped } = parseTotalEntries(json);
    // The API answers again: back to it.
    await db.settings.delete(SEARCH_MODE_KEY);
    return { candidates, totalEntries: total, totalCapped: capped, fetchedAt: Date.now(), via: learnedUsed ? 'LEARNED' : null };
  }

  /**
   * Comparables read on Vinted's search page (EXPERIMENTAL): one page visit, the listing cards it shows. The total is
   * not shown there: unknown, never 0. Cards that no longer read as listings say so — never "no comparables".
   */
  private async searchByPage(query: ComparableQuery): Promise<SearchResult> {
    const visit = await visitSearchPage(query.text);
    if (!visit.page) {
      const err = new MarketplaceError('UNAVAILABLE', 'page de recherche Vinted sans réponse (onglet non lu)');
      await logVintedError(err.code, err.message, 'catalog');
      throw err;
    }
    const candidates = candidatesFromPage(visit.page);
    if (visit.page.links > 0 && candidates.length === 0) {
      // Vinted writes its cards another way now: forget the page mode, so the next search tries the API again.
      await db.settings.delete(SEARCH_MODE_KEY);
      const err = new MarketplaceError('UNAVAILABLE', `page de recherche lue mais aucune annonce reconnue : la présentation de Vinted a changé · ${pageSummary(visit.page)}`);
      await logVintedError(err.code, err.message, 'catalog');
      throw err;
    }
    return { candidates, totalEntries: null, totalCapped: false, fetchedAt: Date.now(), via: 'PAGE' };
  }

}
