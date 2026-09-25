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

export async function reserve(): Promise<ReserveResult> {
  const { budget } = await loadBudget();
  try {
    const wait = budget.reserve();
    await browser.storage.session.set({ eraBudget: budget.toJSON() });
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
  return { remaining: budget.remaining, halted: budget.halted, haltedUntil };
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

export async function autoWritesToday(now = Date.now()): Promise<number> {
  const { eraAuto } = (await browser.storage.local.get('eraAuto')) as { eraAuto?: { day: string; count: number } };
  return eraAuto && eraAuto.day === dayKey(now) ? eraAuto.count : 0;
}
