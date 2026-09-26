import { errorInfo } from '@/data/adapters/marketplace';
import * as budget from '@/data/adapters/vinted/budget-store';
import { applyPriceOnVinted } from '@/data/adapters/vinted/price-edit';
import type { AutoRunResult, DetailsResult, EraMessage, ImportResult, LabelBatchResult, PriceEditResult, RepostFinishResult, RepostResult } from '@/data/adapters/vinted/protocol';
import { finishRepost, repostAsDraft } from '@/data/vinted-repost';
import { importFromVinted, importPurchasesFromVinted } from '@/data/vinted-import';
import { loadAutoConfig, runFavorites, runOffers, vintedTabOpen } from '@/data/automation-runner';
import { createVintedDraft } from '@/data/vinted-draft';
import { getAllLabels, getShippingLabel, readListingDetails, setListingHidden } from '@/data/vinted-actions';

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
    .then((r): ImportResult => {
      // Purchases follow in the background; the stock is already usable.
      void importPurchasesFromVinted();
      return { ok: true, ...r };
    })
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

let autoRunning: Promise<AutoRunResult> | null = null;
/** A repost copies photos for a while: one at a time, and nothing else writes meanwhile. */
let reposting: Promise<RepostResult | RepostFinishResult> | null = null;
/** All labels at once: a few minutes at most, nothing else writes meanwhile. */
let labelling: Promise<LabelBatchResult> | null = null;

/** One automation pass at a time, never during an import or a price edit. */
function runAuto(kind: 'FAV' | 'OFFERS', dryRun: boolean): Promise<AutoRunResult> {
  if (autoRunning || importing || editing || reposting || labelling) return Promise.resolve({ ok: false, kind, dryRun, done: 0, skipped: 0, failed: 0, stopped: 'une autre opération Vinted est en cours' });
  autoRunning = (kind === 'FAV' ? runFavorites(dryRun) : runOffers(dryRun)).finally(() => {
    autoRunning = null;
  });
  return autoRunning;
}

const AUTO_ALARM = 'era-auto';

/** The schedule follows the saved settings: off unless the seller switched the master switch and one automation on. */
async function scheduleAuto(): Promise<void> {
  const cfg = await loadAutoConfig();
  await browser.alarms.clear(AUTO_ALARM);
  if (cfg.enabled && (cfg.fav.enabled || cfg.offers.enabled)) await browser.alarms.create(AUTO_ALARM, { periodInMinutes: Math.max(15, cfg.everyMinutes) });
}

async function onAutoAlarm(): Promise<void> {
  const cfg = await loadAutoConfig();
  if (!cfg.enabled) return;
  // Blocked by Vinted, or no vinted.fr tab open: nothing happens (a scheduled pass never opens Vinted itself).
  if ((await budget.status()).halted || !(await vintedTabOpen())) return;
  if (cfg.offers.enabled) await runAuto('OFFERS', false);
  if (cfg.fav.enabled) await runAuto('FAV', false);
}

export default defineBackground(() => {
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === AUTO_ALARM) void onAutoAlarm();
  });
  void scheduleAuto();
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
        // Mid-repost, the fresh draft is not yet recorded as a copy: an import now would count it as a new article.
        if (reposting) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: 'republication en cours : importez dans un instant' } satisfies ImportResult);
          return undefined;
        }
        void runImport().then(sendResponse);
        return true;
      case 'era:auto:run':
        void runAuto(msg.kind, msg.dryRun).then(sendResponse);
        return true;
      case 'era:label:get':
      case 'era:item:hide':
        if (autoRunning || importing || editing || reposting || labelling) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une autre opération Vinted est en cours' });
          return undefined;
        }
        void (msg.type === 'era:label:get' ? getShippingLabel(msg.conversationId, msg.title, msg.soldAt) : setListingHidden(msg.platformListingId, msg.itemId, msg.hidden)).then(sendResponse);
        return true;
      case 'era:details:read':
        if (autoRunning || importing || editing || reposting || labelling) {
          sendResponse({ read: 0, stopped: 'une autre opération Vinted est en cours' } satisfies DetailsResult);
          return undefined;
        }
        void readListingDetails(msg.ids).then(sendResponse);
        return true;
      case 'era:label:all':
        if (autoRunning || importing || editing || reposting || labelling) {
          sendResponse({ results: [], stopped: 'une autre opération Vinted est en cours', left: 0 } satisfies LabelBatchResult);
          return undefined;
        }
        labelling = getAllLabels().finally(() => {
          labelling = null;
        });
        void labelling.then(sendResponse);
        return true;
      case 'era:draft:create':
      case 'era:repost:create':
      case 'era:repost:finish':
        if (autoRunning || importing || editing || reposting || labelling) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une autre opération Vinted est en cours' });
          return undefined;
        }
        if (msg.type === 'era:draft:create') {
          void createVintedDraft(msg.input).then(sendResponse);
          return true;
        }
        reposting = (msg.type === 'era:repost:create' ? repostAsDraft(msg.itemId) : finishRepost(msg.itemId)).finally(() => {
          reposting = null;
        });
        void reposting.then(sendResponse);
        return true;
      case 'era:auto:schedule':
        void scheduleAuto().then(() => sendResponse({ ok: true }));
        return true;
      case 'era:price:edit':
        void runPriceEdit(msg.platformListingId, msg.cents, msg.itemId).then(sendResponse);
        return true;
      default:
        return undefined;
    }
  });
});
