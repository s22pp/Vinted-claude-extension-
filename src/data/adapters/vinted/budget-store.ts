import { DEFAULT_EXEC_MODE, EXEC_MODE_KEY, type ExecMode, LIMITS, SESSION_GAP_MS, isExecMode, sessionOver } from '@/data/budget-plan';
import { MarketplaceError, RequestBudget, haltPauseMs } from '../marketplace';
import type { BudgetStatus, ReserveResult } from './protocol';
import { log } from '../../log';

/** `lastAt`: when the session's last call was reserved. */
type Stored = ReturnType<RequestBudget['toJSON']> & { lastAt?: number };

/**
 * A session over (hours without a call, never after a block): its budget, uses and writes start again. Checked before
 * every read of the budget, so the reserve, the status and the writes all see the same session.
 */
async function rollSession(now = Date.now()): Promise<void> {
  const { eraBudget } = (await browser.storage.session.get('eraBudget')) as { eraBudget?: Stored };
  if (sessionOver(eraBudget, now)) await browser.storage.session.remove(['eraBudget', USE_KEY, 'eraWrites']);
}

/** The seller's execution mode (Réglages): Direct unless they chose Prudent. */
export async function execMode(): Promise<ExecMode> {
  const v = (await browser.storage.local.get(EXEC_MODE_KEY))[EXEC_MODE_KEY];
  return isExecMode(v) ? v : DEFAULT_EXEC_MODE;
}

export async function setExecMode(mode: ExecMode): Promise<void> {
  await browser.storage.local.set({ [EXEC_MODE_KEY]: mode });
}

/**
 * Background-only. The request budget lives in storage.session (per browser session, or until hours without a call);
 * a block lives in storage.local with its pause, so a service-worker restart never "forgets" a 403/429 — and once the
 * pause is over, calls take up again by themselves (no restart needed).
 */
export async function loadBudget(): Promise<{ budget: RequestBudget; haltedUntil: number | null; mode: ExecMode }> {
  await rollSession();
  const mode = await execMode();
  const { eraBudget } = (await browser.storage.session.get('eraBudget')) as { eraBudget?: Stored };
  const { eraHalt } = (await browser.storage.local.get('eraHalt')) as { eraHalt?: { code: Stored['halted']; until: number } };
  const active = !!eraHalt && eraHalt.until > Date.now() && !!eraHalt.code;
  // A block whose pause is over no longer stops anything.
  const budget = RequestBudget.fromJSON(eraBudget ? { ...eraBudget, halted: active ? eraBudget.halted : null } : undefined, Date.now, LIMITS[mode]);
  if (active && eraHalt.code) budget.report(eraHalt.code === 'RATE_LIMITED' ? 429 : 403);
  return { budget, haltedUntil: active ? eraHalt.until : null, mode };
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

/** A scheduled run is going on in this worker (nothing it does was clicked by the seller). */
export const isScheduledRun = () => scheduledRuns > 0;

export async function reserve(use: BudgetUse = 'OTHER'): Promise<ReserveResult> {
  const { budget } = await loadBudget();
  if (scheduledRuns > 0 && budget.remaining <= reserveFloor) return { ok: false, code: 'BUDGET_EXHAUSTED' };
  try {
    const wait = budget.reserve();
    const u = await uses();
    await browser.storage.session.set({ eraBudget: { ...budget.toJSON(), lastAt: Date.now() } satisfies Stored, [USE_KEY]: { ...u, [use]: (u[use] ?? 0) + 1 } });
    return { ok: true, wait };
  } catch (e) {
    return { ok: false, code: e instanceof MarketplaceError ? e.code : 'BUDGET_EXHAUSTED' };
  }
}

/** A 403/429 stops every call for its pause (Vinted's Retry-After for a 429 when it gives one). */
export async function report(status: number, retryAfterMs: number | null = null): Promise<void> {
  if (status !== 403 && status !== 429) return;
  const { budget } = await loadBudget();
  budget.report(status);
  await browser.storage.session.set({ eraBudget: { ...budget.toJSON(), lastAt: Date.now() } satisfies Stored });
  const until = Date.now() + haltPauseMs(status, retryAfterMs);
  await browser.storage.local.set({ eraHalt: { code: budget.halted, until } });
  void log('warn', 'budget', `HTTP ${status} de Vinted : tout s’arrête, reprise automatique à ${new Date(until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
}

export async function status(): Promise<BudgetStatus> {
  const { budget, haltedUntil, mode } = await loadBudget();
  const { eraBudget } = (await browser.storage.session.get('eraBudget')) as { eraBudget?: Stored };
  // A new session (a full budget again) once SESSION_GAP_MS go by without a call — unless a block stopped it.
  const resetAt = mode === 'PRUDENT' && eraBudget?.lastAt && !budget.halted ? eraBudget.lastAt + SESSION_GAP_MS : null;
  return { remaining: budget.remaining, halted: budget.halted, haltedUntil, uses: await uses(), resetAt, mode };
}

/** Prudent mode: writes ≥ 20 s apart and ≤ 15 per session, whatever the read budget. Direct: neither. */
export const WRITE_SPACING_MS = 20_000;
export const WRITE_MAX = 15;

export async function reserveWrite(now = Date.now()): Promise<void> {
  await rollSession(now);
  const { eraWrites } = (await browser.storage.session.get('eraWrites')) as { eraWrites?: { last: number; count: number } };
  const w = eraWrites ?? { last: 0, count: 0 };
  if ((await execMode()) === 'PRUDENT') {
    if (w.count >= WRITE_MAX) throw new MarketplaceError('BUDGET_EXHAUSTED', `${WRITE_MAX} modifications maximum par session (mode Prudent)`);
    const wait = w.last + WRITE_SPACING_MS - now;
    if (wait > 0) throw new MarketplaceError('WRITE_COOLDOWN', `réessayez dans ${Math.ceil(wait / 1000)} s`);
  }
  await browser.storage.session.set({ eraWrites: { last: now, count: w.count + 1 } });
}

/** How long before the seller's next write may go (0 = now; always 0 in Direct); throws when Prudent's quota is spent. */
export async function writeWait(now = Date.now()): Promise<number> {
  await rollSession(now);
  if ((await execMode()) === 'DIRECT') return 0;
  const { eraWrites } = (await browser.storage.session.get('eraWrites')) as { eraWrites?: { last: number; count: number } };
  const w = eraWrites ?? { last: 0, count: 0 };
  if (w.count >= WRITE_MAX) throw new MarketplaceError('BUDGET_EXHAUSTED', `${WRITE_MAX} modifications maximum par session (mode Prudent)`);
  return Math.max(0, w.last + WRITE_SPACING_MS - now);
}

/**
 * Prudent mode: automations send ≥ 12 s apart and ≤ 40 per day. Direct: no quota, no wait. Every request still goes
 * through the pacing above, and a 403/429 stops everything.
 */
export const AUTO_SPACING_MS = 12_000;
export const AUTO_DAY_MAX = 40;

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** How long to wait before the next automated write (0 = now; always 0 in Direct); throws when Prudent's day is spent. */
export async function autoWriteWait(now = Date.now()): Promise<number> {
  if ((await execMode()) === 'DIRECT') return 0;
  const { eraAuto } = (await browser.storage.local.get('eraAuto')) as { eraAuto?: { day: string; count: number; last: number } };
  const w = eraAuto && eraAuto.day === dayKey(now) ? eraAuto : { day: dayKey(now), count: 0, last: eraAuto?.last ?? 0 };
  if (w.count >= AUTO_DAY_MAX) throw new MarketplaceError('BUDGET_EXHAUSTED', `${AUTO_DAY_MAX} envois automatiques maximum par jour (mode Prudent)`);
  return Math.max(0, w.last + AUTO_SPACING_MS - now);
}

export async function recordAutoWrite(now = Date.now()): Promise<void> {
  const { eraAuto } = (await browser.storage.local.get('eraAuto')) as { eraAuto?: { day: string; count: number; last: number } };
  const w = eraAuto && eraAuto.day === dayKey(now) ? eraAuto : { day: dayKey(now), count: 0, last: 0 };
  await browser.storage.local.set({ eraAuto: { day: w.day, count: w.count + 1, last: now } });
}
