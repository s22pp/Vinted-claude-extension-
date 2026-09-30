import { HALT_COOLDOWN_MS, MarketplaceError, RequestBudget } from '../marketplace';
import type { BudgetStatus, ReserveResult } from './protocol';

type Stored = ReturnType<RequestBudget['toJSON']>;

/**
 * Background-only. The request budget lives in storage.session (per browser session); a block lives in
 * storage.local with a cool-down, so a service-worker restart never "forgets" a 403/429.
 */
export async function loadBudget(): Promise<{ budget: RequestBudget; haltedUntil: number | null }> {
  const { eraBudget } = (await browser.storage.session.get('eraBudget')) as { eraBudget?: Stored };
  const { eraHalt } = (await browser.storage.local.get('eraHalt')) as { eraHalt?: { code: Stored['halted']; until: number } };
  const budget = RequestBudget.fromJSON(eraBudget);
  if (eraHalt && eraHalt.until > Date.now() && eraHalt.code) budget.report(eraHalt.code === 'RATE_LIMITED' ? 429 : 403);
  return { budget, haltedUntil: eraHalt && eraHalt.until > Date.now() ? eraHalt.until : null };
}

/** What a call was for, from its path: only to say where the session's budget went (never to allow or refuse). */
export type BudgetUse = 'IMPORT' | 'ORDERS' | 'SEARCH' | 'AUTO' | 'LISTING' | 'WRITE' | 'OTHER';

export function useOf(path: string | undefined, method = 'GET'): BudgetUse {
  if (!path) return 'OTHER';
  const p = path.split('?')[0]!;
  if (p === '/catalog' || p.startsWith('/api/v2/catalog') || /[?&]search_text=/.test(path)) return 'SEARCH';
  if (/notifications|\/inbox|\/conversations|\/offers|offer_requests/.test(p)) return 'AUTO';
  if (method !== 'GET') return 'WRITE';
  if (p.startsWith('/api/v2/wardrobe') || p === '/api/v2/users/current') return 'IMPORT';
  if (/order/i.test(p)) return 'ORDERS';
  if (p.startsWith('/api/v2/item_upload/items') || /^\/items\/\d+/.test(p)) return 'LISTING';
  return 'OTHER';
}

const USE_KEY = 'eraBudgetUse';

/** Calls reserved this browser session, by use. */
export async function uses(): Promise<Partial<Record<BudgetUse, number>>> {
  return (((await browser.storage.session.get(USE_KEY)) as Record<string, Partial<Record<BudgetUse, number>> | undefined>)[USE_KEY] ?? {});
}

/**
 * While a scheduled run is going on (refresh, buy alerts, automations), each of its calls is refused once the session
 * is down to the reserve kept for the seller's clicks — checked call by call, not only when the run starts. A counter:
 * runs may overlap.
 */
let scheduledRuns = 0;
let reserveFloor = 0;
export async function asScheduled<T>(floor: number, run: () => Promise<T>): Promise<T> {
  scheduledRuns++;
  reserveFloor = floor;
  try {
    return await run();
  } finally {
    scheduledRuns--;
    if (scheduledRuns === 0) reserveFloor = 0;
  }
}

export async function reserve(use: BudgetUse = 'OTHER'): Promise<ReserveResult> {
  const { budget } = await loadBudget();
  if (scheduledRuns > 0 && budget.remaining <= reserveFloor) return { ok: false, code: 'BUDGET_EXHAUSTED' };
  try {
    const wait = budget.reserve();
    const u = await uses();
    await browser.storage.session.set({ eraBudget: budget.toJSON(), [USE_KEY]: { ...u, [use]: (u[use] ?? 0) + 1 } });
    return { ok: true, wait };
  } catch (e) {
    return { ok: false, code: e instanceof MarketplaceError ? e.code : 'BUDGET_EXHAUSTED' };
  }
}

export async function report(status: number): Promise<void> {
  if (status !== 403 && status !== 429) return;
  const { budget } = await loadBudget();
  budget.report(status);
  await browser.storage.session.set({ eraBudget: budget.toJSON() });
  await browser.storage.local.set({ eraHalt: { code: budget.halted, until: Date.now() + HALT_COOLDOWN_MS } });
}

export async function status(): Promise<BudgetStatus> {
  const { budget, haltedUntil } = await loadBudget();
  return { remaining: budget.remaining, halted: budget.halted, haltedUntil, uses: await uses() };
}

/** Writes are rarer than reads: ≥ 20 s apart and ≤ 15 per browser session, whatever the read budget. */
export const WRITE_SPACING_MS = 20_000;
export const WRITE_MAX = 15;

export async function reserveWrite(now = Date.now()): Promise<void> {
  const { eraWrites } = (await browser.storage.session.get('eraWrites')) as { eraWrites?: { last: number; count: number } };
  const w = eraWrites ?? { last: 0, count: 0 };
  if (w.count >= WRITE_MAX) throw new MarketplaceError('BUDGET_EXHAUSTED', `${WRITE_MAX} modifications maximum par session`);
  const wait = w.last + WRITE_SPACING_MS - now;
  if (wait > 0) throw new MarketplaceError('WRITE_COOLDOWN', `réessayez dans ${Math.ceil(wait / 1000)} s`);
  await browser.storage.session.set({ eraWrites: { last: now, count: w.count + 1 } });
}

/**
 * Automations send little, slowly: ≥ 12 s between two writes and ≤ 40 per day, on top of the read budget
 * (60 per session, 12 per minute) that every request still goes through. A 403/429 stops everything.
 */
export const AUTO_SPACING_MS = 12_000;
export const AUTO_DAY_MAX = 40;

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** How long to wait before the next automated write (0 = now); throws when today's quota is spent. */
export async function autoWriteWait(now = Date.now()): Promise<number> {
  const { eraAuto } = (await browser.storage.local.get('eraAuto')) as { eraAuto?: { day: string; count: number; last: number } };
  const w = eraAuto && eraAuto.day === dayKey(now) ? eraAuto : { day: dayKey(now), count: 0, last: eraAuto?.last ?? 0 };
  if (w.count >= AUTO_DAY_MAX) throw new MarketplaceError('BUDGET_EXHAUSTED', `${AUTO_DAY_MAX} envois automatiques maximum par jour`);
  return Math.max(0, w.last + AUTO_SPACING_MS - now);
}

export async function recordAutoWrite(now = Date.now()): Promise<void> {
  const { eraAuto } = (await browser.storage.local.get('eraAuto')) as { eraAuto?: { day: string; count: number; last: number } };
  const w = eraAuto && eraAuto.day === dayKey(now) ? eraAuto : { day: dayKey(now), count: 0, last: 0 };
  await browser.storage.local.set({ eraAuto: { day: w.day, count: w.count + 1, last: now } });
}
