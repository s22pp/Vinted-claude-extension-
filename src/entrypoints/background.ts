import { errorInfo } from '@/data/adapters/marketplace';
import * as budget from '@/data/adapters/vinted/budget-store';
import { applyPriceOnVinted } from '@/data/adapters/vinted/price-edit';
import type { AutoRunResult, DetailsResult, EraMessage, ImportResult, LabelBatchResult, PriceEditResult, RepostFinishResult, RepostResult } from '@/data/adapters/vinted/protocol';
import { finishRepost, repostAsDraft } from '@/data/vinted-repost';
import { importFromVinted, importPurchasesFromVinted } from '@/data/vinted-import';
import { loadAutoConfig, runFavorites, runOffers, vintedTabOpen } from '@/data/automation-runner';
import { createVintedDraft } from '@/data/vinted-draft';
import { getAllLabels, getShippingLabel, readListingDetails, setListingHidden } from '@/data/vinted-actions';
import { type SalesSnapshot, loadRefreshConfig, salesSnapshot, whatIsNew } from '@/data/refresh';

/**
 * The service worker holds no state in memory: it can be killed at any time. Budgets live in
 * chrome.storage; imports and price edits run here so closing the popup never interrupts them.
 */

let importing: Promise<ImportResult> | null = null;

/** One import at a time. After it: the icon's count, and what is new (notification, if switched on). */
function runImport(auto = false): Promise<ImportResult> {
  let reached = 'START';
  if (importing) return importing;
  const before = salesSnapshot().catch(() => null);
  importing = importFromVinted((stage) => {
    reached = stage;
    void browser.runtime.sendMessage({ type: 'era:import:stage', stage } satisfies EraMessage).catch(() => undefined);
  })
    .then(async (r): Promise<ImportResult> => {
      // Purchases follow in the background; the stock is already usable.
      void importPurchasesFromVinted();
      void afterImport(await before, auto);
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

/** The toolbar icon shows how many orders wait to be shipped (nothing when none). */
async function updateBadge(): Promise<void> {
  const n = (await salesSnapshot()).toShip.size;
  await browser.action.setBadgeBackgroundColor({ color: '#e8634f' }).catch(() => undefined);
  await browser.action.setBadgeText({ text: n > 0 ? String(n) : '' }).catch(() => undefined);
}

async function afterImport(before: SalesSnapshot | null, auto: boolean): Promise<void> {
  await updateBadge();
  // A notification only for what the seller did not watch arrive: the scheduled imports.
  const cfg = await loadRefreshConfig();
  if (!auto || !before || !cfg.notify) return;
  const news = whatIsNew(before, await salesSnapshot());
  const lines = [...news.toShip.map((title) => `À envoyer : ${title}`), ...(news.sold > news.toShip.length ? [`${news.sold} nouvelle(s) vente(s)`] : [])];
  if (!lines.length) return;
  await browser.notifications
    .create(`era-news-${Date.now()}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: news.toShip.length ? (news.toShip.length === 1 ? 'Nouvelle commande à envoyer' : `${news.toShip.length} commandes à envoyer`) : 'Nouvelle vente',
      message: lines.slice(0, 4).join('\n'),
      priority: 1,
    })
    .catch(() => undefined);
}

const REFRESH_ALARM = 'era-refresh';

/** Read-only import every few hours, only if the seller switched it on. */
async function scheduleRefresh(): Promise<void> {
  const cfg = await loadRefreshConfig();
  await browser.alarms.clear(REFRESH_ALARM);
  if (cfg.enabled) await browser.alarms.create(REFRESH_ALARM, { periodInMinutes: Math.max(60, cfg.everyHours * 60) });
}

async function onRefreshAlarm(): Promise<void> {
  if (!(await loadRefreshConfig()).enabled) return;
  // Never opens Vinted by itself, never while blocked, never on top of another Vinted operation.
  if ((await budget.status()).halted || !(await vintedTabOpen())) return;
  if (importing || editing || autoRunning || reposting || labelling) return;
  await runImport(true);
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
    if (a.name === REFRESH_ALARM) void onRefreshAlarm();
  });
  void scheduleAuto();
  void scheduleRefresh();
  void updateBadge().catch(() => undefined);
  // A notification opens what it announces.
  browser.notifications?.onClicked.addListener((id) => {
    if (id.startsWith('era-news-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/sales?ship=1` });
  });
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
      case 'era:refresh:schedule':
        void scheduleRefresh().then(() => sendResponse({ ok: true }));
        return true;
      case 'era:badge:update':
        void updateBadge().then(() => sendResponse({ ok: true }));
        return true;
      case 'era:price:edit':
        void runPriceEdit(msg.platformListingId, msg.cents, msg.itemId).then(sendResponse);
        return true;
      default:
        return undefined;
    }
  });
});
