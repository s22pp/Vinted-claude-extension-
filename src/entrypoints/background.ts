import { HALT_COOLDOWN_MS, RequestBudget } from '@/data/adapters/marketplace';
import { errorInfo } from '@/data/adapters/marketplace';
import type { BudgetStatus, EraMessage, ImportResult, ReserveResult } from '@/data/adapters/vinted/protocol';
import { importFromVinted } from '@/data/vinted-import';

let importing: Promise<ImportResult> | null = null;

/** The import runs here, not in the popup: closing the popup never interrupts it. One import at a time. */
function runImport(): Promise<ImportResult> {
  importing ??= importFromVinted((stage) => void browser.runtime.sendMessage({ type: 'era:import:stage', stage } satisfies EraMessage).catch(() => undefined))
    .then((r): ImportResult => ({ ok: true, ...r }))
    .catch((e): ImportResult => ({ ok: false, ...errorInfo(e), detail: errorInfo(e).detail ?? undefined }))
    .finally(() => {
      importing = null;
    });
  return importing;
}

type Stored = ReturnType<RequestBudget['toJSON']>;

/**
 * The service worker holds no state in memory: it can be killed at any time.
 * The request budget lives in storage.session (per browser session); a block lives in storage.local
 * with a cool-down, so a restart never "forgets" a 403/429.
 */
async function loadBudget(): Promise<{ budget: RequestBudget; haltedUntil: number | null }> {
  const { eraBudget } = (await browser.storage.session.get('eraBudget')) as { eraBudget?: Stored };
  const { eraHalt } = (await browser.storage.local.get('eraHalt')) as { eraHalt?: { code: Stored['halted']; until: number } };
  const budget = RequestBudget.fromJSON(eraBudget);
  if (eraHalt && eraHalt.until > Date.now() && eraHalt.code) budget.report(eraHalt.code === 'RATE_LIMITED' ? 429 : 403);
  return { budget, haltedUntil: eraHalt && eraHalt.until > Date.now() ? eraHalt.until : null };
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/onboarding` });
  });
  void browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);

  browser.runtime.onMessage.addListener((msg: EraMessage, _sender, sendResponse) => {
    if (msg.type === 'era:budget:reserve') {
      void (async (): Promise<ReserveResult> => {
        const { budget } = await loadBudget();
        try {
          const wait = budget.reserve();
          await browser.storage.session.set({ eraBudget: budget.toJSON() });
          return { ok: true, wait };
        } catch (e) {
          return { ok: false, code: (e as { code?: ReserveResult extends { code: infer C } ? C : never }).code ?? 'BUDGET_EXHAUSTED' };
        }
      })().then(sendResponse);
      return true;
    }
    if (msg.type === 'era:budget:report') {
      void (async () => {
        if (msg.status === 403 || msg.status === 429) {
          const { budget } = await loadBudget();
          budget.report(msg.status);
          await browser.storage.session.set({ eraBudget: budget.toJSON() });
          await browser.storage.local.set({ eraHalt: { code: budget.halted, until: Date.now() + HALT_COOLDOWN_MS } });
        }
      })().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'era:import') {
      void runImport().then(sendResponse);
      return true;
    }
    if (msg.type === 'era:budget:status') {
      void loadBudget()
        .then(({ budget, haltedUntil }): BudgetStatus => ({ remaining: budget.remaining, halted: budget.halted, haltedUntil }))
        .then(sendResponse);
      return true;
    }
  });
});
