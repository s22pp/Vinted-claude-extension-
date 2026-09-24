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
