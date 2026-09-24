import { errorInfo } from '@/data/adapters/marketplace';
import * as budget from '@/data/adapters/vinted/budget-store';
import { applyPriceOnVinted } from '@/data/adapters/vinted/price-edit';
import type { EraMessage, ImportResult, PriceEditResult } from '@/data/adapters/vinted/protocol';
import { importFromVinted } from '@/data/vinted-import';

/**
 * The service worker holds no state in memory: it can be killed at any time. Budgets live in
 * chrome.storage; imports and price edits run here so closing the popup never interrupts them.
 */

let importing: Promise<ImportResult> | null = null;

/** One import at a time. */
function runImport(): Promise<ImportResult> {
  let reached = 'START';
  importing ??= importFromVinted((stage) => {
    reached = stage;
    void browser.runtime.sendMessage({ type: 'era:import:stage', stage } satisfies EraMessage).catch(() => undefined);
  })
    .then((r): ImportResult => ({ ok: true, ...r }))
    .catch((e): ImportResult => {
      const { code, detail } = errorInfo(e);
      const r: ImportResult = { ok: false, code, detail: `étape ${reached} · ${detail ?? (e instanceof Error ? e.message : String(e))}` };
      void browser.storage.local.set({ eraLastImportError: { ...r, at: Date.now() } });
      return r;
    })
    .finally(() => {
      importing = null;
    });
  return importing;
}

let editing: Promise<PriceEditResult> | null = null;

/** One price edit at a time; each one comes from a single user click. */
function runPriceEdit(platformListingId: string, cents: number, itemId: string): Promise<PriceEditResult> {
  if (editing) return Promise.resolve({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une modification est déjà en cours' });
  editing = applyPriceOnVinted(platformListingId, cents, itemId, (stage) =>
    void browser.runtime.sendMessage({ type: 'era:price:stage', stage } satisfies EraMessage).catch(() => undefined),
  )
    .catch((e): PriceEditResult => {
      const { code, detail } = errorInfo(e);
      return { ok: false, code, detail: detail ?? undefined };
    })
    .finally(() => {
      editing = null;
    });
  return editing;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/onboarding` });
  });
  void browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);

  browser.runtime.onMessage.addListener((msg: EraMessage, _sender, sendResponse) => {
    switch (msg.type) {
      case 'era:budget:reserve':
        void budget.reserve().then(sendResponse);
        return true;
      case 'era:budget:report':
        void budget.report(msg.status).then(() => sendResponse({ ok: true }));
        return true;
      case 'era:budget:status':
        void budget.status().then(sendResponse);
        return true;
      case 'era:import':
        void runImport().then(sendResponse);
        return true;
      case 'era:price:edit':
        void runPriceEdit(msg.platformListingId, msg.cents, msg.itemId).then(sendResponse);
        return true;
      default:
        return undefined;
    }
  });
});
