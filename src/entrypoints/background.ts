import { errorInfo } from '@/data/adapters/marketplace';
import * as budget from '@/data/adapters/vinted/budget-store';
import { applyDescriptionOnVinted, applyPriceOnVinted } from '@/data/adapters/vinted/price-edit';
import type { AutoRunResult, DescEditResult, DetailsResult, EraMessage, ImportResult, LabelBatchResult, PriceEditResult, RepostFinishResult, RepostResult } from '@/data/adapters/vinted/protocol';
import { finishRepost, repostAsDraft } from '@/data/vinted-repost';
import { importFromVinted, importPurchasesFromVinted } from '@/data/vinted-import';
import { loadAutoConfig, runFavorites, runOffers, vintedTabOpen } from '@/data/automation-runner';
import { createVintedDraft } from '@/data/vinted-draft';
import { getAllLabels, getShippingLabel, readListingDetails, setListingHidden, locateParcel } from '@/data/vinted-actions';
import { type SalesSnapshot, loadRefreshConfig, purchaseStages, salesSnapshot, whatIsNew } from '@/data/refresh';
import { type ParcelStage, arrivedAtPickup } from '@/intelligence/parcels';
import { db } from '@/data/db';
import { loadAutoBackup, runAutoBackup } from '@/data/auto-backup';
import { recordError } from '@/data/error-journal';
import { BUY_ALERTS_KEY, runBuyAlerts } from '@/data/buy-alerts';
import { type PhotoExportResult, exportPhotos } from '@/data/photo-export';
import { repo } from '@/data/repo';

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
  const stagesBefore = purchaseStages().catch(() => null);
  importing = importFromVinted((stage) => {
    reached = stage;
    void browser.runtime.sendMessage({ type: 'era:import:stage', stage } satisfies EraMessage).catch(() => undefined);
  })
    .then(async (r): Promise<ImportResult> => {
      // Purchases follow in the background; the stock is already usable.
      void importPurchasesFromVinted().then(async () => afterPurchases(await stagesBefore, auto));
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
  // Scheduled refresh: the buy alerts run right after, if switched on (a few budgeted searches).
  if (auto && (await repo.getSetting<{ enabled?: boolean } | null>(BUY_ALERTS_KEY, null))?.enabled && !(await budget.status()).halted) {
    const { deals } = await runBuyAlerts();
    if (deals.length && (await loadRefreshConfig()).notify)
      await browser.notifications
        .create(`era-deals-${Date.now()}`, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: deals.length === 1 ? 'Une affaire dans vos niches' : `${deals.length} affaires dans vos niches`,
          message: deals
            .slice(0, 3)
            .map((d) => `${d.title} · ${(d.priceCents / 100).toFixed(0)} € → marge ~${Math.round(d.marginCents / 100)} €`)
            .join('\n'),
          priority: 1,
        })
        .catch(() => undefined);
  }
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

/** A scheduled import found a purchase waiting at its pickup point: said once, if notifications are on. */
async function afterPurchases(before: Map<string, ParcelStage> | null, auto: boolean): Promise<void> {
  if (!auto || !before || !(await loadRefreshConfig()).notify) return;
  const arrived = arrivedAtPickup(before, await db.purchases.toArray());
  if (!arrived.length) return;
  await browser.notifications
    .create(`era-parcel-${Date.now()}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: arrived.length === 1 ? 'Colis à retirer' : `${arrived.length} colis à retirer`,
      message: arrived.slice(0, 4).join('\n'),
      priority: 1,
    })
    .catch(() => undefined);
}

const REFRESH_ALARM = 'era-refresh';
const BACKUP_ALARM = 'era-backup';

/** Automatic backup: checked every 6 hours while on (a copy is written only when one is due). */
async function scheduleBackup(): Promise<void> {
  await browser.alarms.clear(BACKUP_ALARM);
  if ((await loadAutoBackup()).enabled) {
    await browser.alarms.create(BACKUP_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
  }
}

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
  if (vintedBusy()) return;
  await runImport(true);
}

/** The listing edit in progress (price or description): one at a time, each from a single user click. */
let editing: Promise<unknown> | null = null;

function runPriceEdit(platformListingId: string, cents: number, itemId: string): Promise<PriceEditResult> {
  if (editing) return Promise.resolve({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une modification est déjà en cours' });
  const run = applyPriceOnVinted(platformListingId, cents, itemId, (stage) =>
    void browser.runtime.sendMessage({ type: 'era:price:stage', stage } satisfies EraMessage).catch(() => undefined),
  )
    .catch((e): PriceEditResult => {
      const { code, detail } = errorInfo(e);
      return { ok: false, code, detail: detail ?? undefined };
    })
    .finally(() => {
      editing = null;
    });
  editing = run;
  return run;
}

/** A description replaced on Vinted: same lock as the price, never during another Vinted operation. */
function runDescEdit(platformListingId: string, text: string): Promise<DescEditResult> {
  if (vintedBusy()) return Promise.resolve({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une autre opération Vinted est en cours' });
  const run = applyDescriptionOnVinted(platformListingId, text)
    .catch((e): DescEditResult => {
      const { code, detail } = errorInfo(e);
      return { ok: false, code, detail: detail ?? undefined };
    })
    .finally(() => {
      editing = null;
    });
  editing = run;
  return run;
}

let autoRunning: Promise<AutoRunResult> | null = null;
/** A repost copies photos for a while: one at a time, and nothing else writes meanwhile. */
let reposting: Promise<RepostResult | RepostFinishResult> | null = null;
/** All labels at once: a few minutes at most, nothing else writes meanwhile. */
let labelling: Promise<LabelBatchResult> | null = null;
/** Photo export: downloads for a while; reads (if any) share the budget. */
let exportingPhotos: Promise<PhotoExportResult> | null = null;

/** One automation pass at a time, never during an import or a price edit. */
function runAuto(kind: 'FAV' | 'OFFERS', dryRun: boolean): Promise<AutoRunResult> {
  if (vintedBusy()) return Promise.resolve({ ok: false, kind, dryRun, done: 0, skipped: 0, failed: 0, stopped: 'une autre opération Vinted est en cours' });
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

/** One Vinted operation at a time: an import, an automation run, a price edit, a repost or labels. */
function vintedBusy(): boolean {
  return !!(autoRunning || importing || editing || reposting || labelling);
}

export default defineBackground(() => {
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === AUTO_ALARM) void onAutoAlarm();
    if (a.name === REFRESH_ALARM) void onRefreshAlarm();
    if (a.name === BACKUP_ALARM) void runAutoBackup().catch(() => undefined);
  });
  void scheduleAuto();
  void scheduleRefresh();
  void scheduleBackup();
  void updateBadge().catch(() => undefined);
  // A notification opens what it announces.
  browser.notifications?.onClicked.addListener((id) => {
    if (id.startsWith('era-news-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/sales?ship=1` });
    if (id.startsWith('era-deals-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/buy?tab=scan` });
    if (id.startsWith('era-parcel-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/parcels` });
  });
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/onboarding` });
  });
  void browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);

  browser.runtime.onMessage.addListener((msg: EraMessage, _sender, sendResponse) => {
    /**
     * Answers with the operation's result — or, when it throws, with `failed(detail)` and a line in the local error
     * journal: the page never waits on a closed channel, and the diagnostic report says what broke.
     */
    const answer = <T,>(p: Promise<T>, failed: (detail: string) => unknown): true => {
      p.then(sendResponse, (e: unknown) => {
        void recordError(`service-worker:${msg.type}`, e);
        sendResponse(failed(e instanceof Error ? e.message : String(e)));
      });
      return true;
    };
    const unavailable = (detail: string) => ({ ok: false, code: 'UNAVAILABLE', detail });
    const BUSY = 'une autre opération Vinted est en cours';
    switch (msg.type) {
      case 'era:budget:reserve':
        return answer(budget.reserve(), () => ({ ok: false, code: 'UNAVAILABLE' }));
      case 'era:budget:report':
        return answer(budget.report(msg.status).then(() => ({ ok: true })), unavailable);
      case 'era:budget:status':
        return answer(budget.status(), () => ({ remaining: 0, halted: 'UNAVAILABLE', haltedUntil: null }));
      case 'era:import':
        // Mid-repost, the fresh draft is not yet recorded as a copy: an import now would count it as a new article.
        if (reposting) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: 'republication en cours : importez dans un instant' } satisfies ImportResult);
          return undefined;
        }
        return answer(runImport(), unavailable);
      case 'era:auto:run':
        return answer(runAuto(msg.kind, msg.dryRun), (detail) => ({ ok: false, kind: msg.kind, dryRun: msg.dryRun, done: 0, skipped: 0, failed: 0, stopped: detail }));
      case 'era:label:get':
      case 'era:item:hide':
        if (vintedBusy()) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: BUSY });
          return undefined;
        }
        if (msg.type === 'era:label:get') return answer(getShippingLabel(msg.conversationId, msg.title, msg.soldAt), unavailable);
        return answer(setListingHidden(msg.platformListingId, msg.itemId, msg.hidden), unavailable);
      case 'era:details:read':
        if (vintedBusy()) {
          sendResponse({ read: 0, stopped: BUSY } satisfies DetailsResult);
          return undefined;
        }
        return answer(readListingDetails(msg.ids), (detail) => ({ read: 0, stopped: detail }) satisfies DetailsResult);
      case 'era:label:all':
        if (vintedBusy()) {
          sendResponse({ results: [], stopped: BUSY, left: 0 } satisfies LabelBatchResult);
          return undefined;
        }
        labelling = getAllLabels().finally(() => {
          labelling = null;
        });
        return answer(labelling, (detail) => ({ results: [], stopped: detail, left: 0 }) satisfies LabelBatchResult);
      case 'era:draft:create':
      case 'era:repost:create':
      case 'era:repost:finish':
        if (vintedBusy()) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: BUSY });
          return undefined;
        }
        if (msg.type === 'era:draft:create') return answer(createVintedDraft(msg.input), unavailable);
        reposting = (msg.type === 'era:repost:create' ? repostAsDraft(msg.itemId) : finishRepost(msg.itemId)).finally(() => {
          reposting = null;
        });
        return answer(reposting, unavailable);
      case 'era:auto:schedule':
        return answer(scheduleAuto().then(() => ({ ok: true })), unavailable);
      case 'era:refresh:schedule':
        return answer(scheduleRefresh().then(() => ({ ok: true })), unavailable);
      case 'era:backup:schedule':
        // Switched on: the first copy is written now if one is due, then the alarm keeps it up to date.
        return answer(
          scheduleBackup().then(() => runAutoBackup()),
          (detail) => ({ ok: false, reason: 'FAILED', detail }),
        );
      case 'era:photos:export':
        if (vintedBusy() || exportingPhotos) {
          sendResponse({ listings: 0, photos: 0, missing: 0, stopped: BUSY } satisfies PhotoExportResult);
          return undefined;
        }
        exportingPhotos = exportPhotos(msg.scope, (done, total) => void browser.runtime.sendMessage({ type: 'era:photos:progress', done, total } satisfies EraMessage).catch(() => undefined)).finally(() => {
          exportingPhotos = null;
        });
        return answer(exportingPhotos, (detail) => ({ listings: 0, photos: 0, missing: 0, stopped: detail }) satisfies PhotoExportResult);
      case 'era:parcel:locate':
        // One read of the order's conversation, on a click; never while another Vinted operation runs.
        if (vintedBusy()) {
          sendResponse({ ok: false, code: 'WRITE_COOLDOWN', detail: BUSY });
          return undefined;
        }
        return answer(locateParcel(msg.conversationId), unavailable);
      case 'era:alerts:run':
        if (vintedBusy()) {
          sendResponse({ deals: [], stopped: BUSY });
          return undefined;
        }
        return answer(runBuyAlerts(), (detail) => ({ deals: [], stopped: detail }));
      case 'era:badge:update':
        return answer(updateBadge().then(() => ({ ok: true })), unavailable);
      case 'era:price:edit':
        return answer(runPriceEdit(msg.platformListingId, msg.cents, msg.itemId), unavailable);
      case 'era:desc:edit':
        return answer(runDescEdit(msg.platformListingId, msg.text), unavailable);
      default:
        return undefined;
    }
  });
});
