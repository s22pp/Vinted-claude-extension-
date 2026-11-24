import { SEARCH_PROBE_KEY, type SearchProbe } from './adapters/vinted/diagnose';
import { DEFAULT_SEARCH_TEMPLATE, ERROR_LOG_KEY, PLAIN_SEARCH_TEMPLATE, SEARCH_DOWN_KEY, SEARCH_MODE_KEY, SEARCH_OK_KEY, SEARCH_PAUSE_MS, SEARCH_TEMPLATE_KEY, type SearchOk, type VintedErrorEntry } from './adapters/vinted/vinted-adapter';
import { db } from './db';
import type { IntegrationRecords } from './integrations';

const isLearned = (t: string | null) => !!t && t !== DEFAULT_SEARCH_TEMPLATE && t !== PLAIN_SEARCH_TEMPLATE;

/** Everything ERA recorded on this device that says whether a Vinted route works. */
export async function integrationRecords(): Promise<IntegrationRecords> {
  const setting = async <T,>(key: string, fallback: T) => ((await db.settings.get(key))?.value as T | undefined) ?? fallback;
  const analyses = await db.analyses.filter((a) => !a.isDemo && a.analysis.source === 'VINTED' && a.analysis.keptCount > 0).toArray();
  const probe = await setting<SearchProbe | null>(SEARCH_PROBE_KEY, null);
  const down = await setting<{ until: number; detail: string } | null>(SEARCH_DOWN_KEY, null);
  const { eraLastImportError } = (await browser.storage.local.get('eraLastImportError')) as { eraLastImportError?: { at: number; code: string; detail?: string } };
  return {
    now: Date.now(),
    listings: await db.listings.filter((l) => !l.isDemo && /^\d+$/.test(l.platformListingId ?? '')).count(),
    lastImport: await setting<number | null>('lastVintedImport', null),
    importError: eraLastImportError ?? null,
    sold: await db.events.where('type').equals('ITEM_SOLD').filter((e) => !e.isDemo && e.provenance === 'OBSERVED').count(),
    reserved: await db.items.filter((i) => !i.isDemo && i.status === 'RESERVED' && i.meta.status?.p === 'OBSERVED').count(),
    wardrobeKeys: await setting<string[] | null>('vintedWardrobeKeys', null),
    searches: [...analyses.map((a) => ({ at: a.at, via: a.analysis.via ?? null })), ...(probe ? [probe] : [])],
    searchOk: await setting<SearchOk>(SEARCH_OK_KEY, {}),
    // A stored template is a learned address only when it is neither of ERA's own two forms (default, plain).
    searchMode: (await setting(SEARCH_MODE_KEY, null)) ? 'PAGE' : isLearned(await setting<string | null>(SEARCH_TEMPLATE_KEY, null)) ? 'LEARNED' : 'API',
    searchDown: down ? { ...down, at: down.until - SEARCH_PAUSE_MS } : null,
    errors: await setting<VintedErrorEntry[]>(ERROR_LOG_KEY, []),
    purchases: await db.purchases.count(),
    purchasesError: await setting<string | null>('purchasesError', null),
    log: await db.autoLog.toArray(),
  };
}

