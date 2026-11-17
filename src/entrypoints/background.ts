import { MarketplaceError, errorInfo } from '@/data/adapters/marketplace';
import * as budget from '@/data/adapters/vinted/budget-store';
import { SEARCH_TAB_ALARM, closeIdleSearchTab, visitInWorker } from '@/data/adapters/vinted/search-page';
import { ping, waitForLoad } from '@/data/adapters/vinted/tabs';
import { applyDescriptionOnVinted, applyPriceOnVinted, applyTextOnVinted } from '@/data/adapters/vinted/price-edit';
import type { AutoKind, AutoRunResult, DescEditResult, DetailsResult, EraMessage, ImportResult, LabelBatchResult, PriceEditResult, RepostFinishResult, RepostResult, TextEditResult } from '@/data/adapters/vinted/protocol';
import type { TextField, TextOp } from '@/intelligence/text-edit';
import { finishRepost, repostAsDraft } from '@/data/vinted-repost';
import { importFromVinted, importPurchasesFromVinted } from '@/data/vinted-import';
import { loadAutoConfig, refreshContacts, runDelivered, runFavorites, runOffers, vintedTabOpen } from '@/data/automation-runner';
import { createVintedDraft } from '@/data/vinted-draft';
import { getAllLabels, getShippingLabel, readListingDetails, setListingHidden, locateParcel } from '@/data/vinted-actions';
import { type SalesSnapshot, loadRefreshConfig, purchaseStages, salesSnapshot, whatIsNew } from '@/data/refresh';
import { type ParcelStage, arrivedAtPickup, parcelStage } from '@/intelligence/parcels';
import { PILOT_KEY, type PilotConfig, type PilotRound, nextPilotAt, pilotConfig, pilotNotice, runLateRound } from '@/intelligence/pilot';
import { weeklyDue } from '@/intelligence/weekly';
import { WEEKLY_LAST_KEY, runWeeklyTask } from '@/data/weekly-task';
import { parcelAlerts } from '@/intelligence/shipping';
import { pilotMissions } from '@/data/pilot-missions';
import { db } from '@/data/db';
import { loadAutoBackup, runAutoBackup } from '@/data/auto-backup';
import { DIGEST_ALARM, digestEnabled, nextMonday9, runDigest } from '@/data/digest';
import { recordError } from '@/data/error-journal';
import { BUY_ALERTS_KEY, runBuyAlerts } from '@/data/buy-alerts';
import { type PhotoExportResult, exportPhotos } from '@/data/photo-export';
import { repo } from '@/data/repo';
import { AUTO_FLOOR, autoAllowed } from '@/data/budget-plan';
import { journal } from '@/data/journal';

/**
 * The service worker holds no state in memory: it can be killed at any time. Budgets live in
 * chrome.storage; imports and price edits run here so closing the popup never interrupts them.
 */

let importing: Promise<ImportResult> | null = null;
/** What follows an import (purchases, then for a scheduled one the buy alerts): awaited by the scheduled refresh. */
let importFollowUp: Promise<unknown> = Promise.resolve();

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
      importFollowUp = Promise.all([importPurchasesFromVinted().then(async () => afterPurchases(await stagesBefore, auto)), afterImport(await before, auto)]).catch(() => undefined);
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
  if (auto && (await repo.getSetting<{ enabled?: boolean } | null>(BUY_ALERTS_KEY, null))?.enabled && (await scheduledRunAllowed('alerts'))) {
    const { deals, via } = await runBuyAlerts();
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
          // Listings read on the search page (or through an address learned from it): an unverified reading, said so.
          ...(via ? { contextMessage: via === 'PAGE' ? 'Lu sur la page de recherche Vinted · expérimental' : 'Adresse de recherche apprise · non vérifié' } : {}),
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

/** Monday's digest: an alarm every Monday at 9:00 while it is switched on. */
async function scheduleDigest(): Promise<void> {
  await browser.alarms.clear(DIGEST_ALARM);
  if (await digestEnabled()) await browser.alarms.create(DIGEST_ALARM, { when: nextMonday9(Date.now()), periodInMinutes: 7 * 24 * 60 });
}

/** Read-only import every few hours, only if the seller switched it on. */
async function scheduleRefresh(): Promise<void> {
  const cfg = await loadRefreshConfig();
  await browser.alarms.clear(REFRESH_ALARM);
  if (cfg.enabled) await browser.alarms.create(REFRESH_ALARM, { periodInMinutes: Math.max(60, cfg.everyHours * 60) });
}

/**
 * A scheduled run may start only while the session keeps more than its reserve for the seller's own clicks. Below it,
 * the run is skipped — said once per browser session in the journal, as ERA's own limit (never as a Vinted error).
 */
const SCHEDULE_NAME = { refresh: 'Actualisation automatique', alerts: 'Alertes d’achat', auto: 'Automatisations', pilot: 'Pilote automatique' } as const;

async function scheduledRunAllowed(which: keyof typeof SCHEDULE_NAME): Promise<boolean> {
  const s = await budget.status();
  if (s.halted) return false;
  if (autoAllowed(s.remaining)) return true;
  // Said once per browser session and per schedule, under that schedule's name.
  const said = ((await browser.storage.session.get('eraAutoFloorSaid')) as { eraAutoFloorSaid?: Record<string, boolean> }).eraAutoFloorSaid ?? {};
  if (!said[which]) {
    await browser.storage.session.set({ eraAutoFloorSaid: { ...said, [which]: true } });
    await journal({ kind: 'STOP', dryRun: false, ok: false, target: SCHEDULE_NAME[which], detail: `BUDGET_EXHAUSTED · passage sauté : ${s.remaining} requêtes restantes, gardées pour vos actions (réserve de ${AUTO_FLOOR}) jusqu’à 3 h sans requête ou au redémarrage du navigateur` }).catch(() => undefined);
  }
  return false;
}

async function onRefreshAlarm(): Promise<void> {
  if (!(await loadRefreshConfig()).enabled) return;
  // Never opens Vinted by itself, never while blocked, never on top of another Vinted operation, never into the reserve.
  if (!(await vintedTabOpen())) return;
  if (vintedBusy()) return;
  if (!(await scheduledRunAllowed('refresh'))) return;
  // The whole run — import, purchases, buy alerts — stops short of the reserve, call by call.
  await budget.asScheduled(AUTO_FLOOR, async () => {
    await runImport(true);
    await importFollowUp;
  });
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
function runDescEdit(platformListingId: string, text: string, expectBefore?: string): Promise<DescEditResult> {
  if (vintedBusy()) return Promise.resolve({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une autre opération Vinted est en cours' });
  const run = applyDescriptionOnVinted(platformListingId, text, expectBefore)
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

/** A title or description changed by an operation: same lock, never during another Vinted operation. */
function runTextEdit(platformListingId: string, field: TextField, op: TextOp): Promise<TextEditResult> {
  if (vintedBusy()) return Promise.resolve({ ok: false, code: 'WRITE_COOLDOWN', detail: 'une autre opération Vinted est en cours' });
  const run = applyTextOnVinted(platformListingId, field, op)
    .catch((e): TextEditResult => {
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
function runAuto(kind: AutoKind, dryRun: boolean): Promise<AutoRunResult> {
  if (vintedBusy()) return Promise.resolve({ ok: false, kind, dryRun, done: 0, skipped: 0, failed: 0, stopped: 'une autre opération Vinted est en cours' });
  autoRunning = (kind === 'FAV' ? runFavorites(dryRun) : kind === 'OFFERS' ? runOffers(dryRun) : runDelivered(dryRun)).finally(() => {
    autoRunning = null;
  });
  return autoRunning;
}

const AUTO_ALARM = 'era-auto';

/** The schedule follows the saved settings: off unless the seller switched the master switch and one automation on. */
async function scheduleAuto(): Promise<void> {
  const cfg = await loadAutoConfig();
  await browser.alarms.clear(AUTO_ALARM);
  if (cfg.enabled && (cfg.fav.enabled || cfg.offers.enabled || cfg.delivered.enabled)) await browser.alarms.create(AUTO_ALARM, { periodInMinutes: Math.max(15, cfg.everyMinutes) });
}

async function onAutoAlarm(): Promise<void> {
  const cfg = await loadAutoConfig();
  if (!cfg.enabled) return;
  // Blocked by Vinted, no vinted.fr tab open, or the reserve reached: nothing happens (a scheduled pass never opens
  // Vinted itself, never spends the calls kept for the seller's clicks).
  if (!(await vintedTabOpen())) return;
  if (!(await scheduledRunAllowed('auto'))) return;
  await budget.asScheduled(AUTO_FLOOR, async () => {
    if (cfg.offers.enabled) await runAuto('OFFERS', false);
    if (cfg.fav.enabled && (await scheduledRunAllowed('auto'))) await runAuto('FAV', false);
    if (cfg.delivered.enabled && (await scheduledRunAllowed('auto'))) await runAuto('DELIVERED', false);
  });
}

/* ── Autopilot: rounds at the seller's hours ─────────────── */

const PILOT_ALARM = 'era-pilot';
const PILOT_RETRY_ALARM = 'era-pilot-retry';
/** While no vinted.fr tab answers or another operation runs: tried again every 10 min, for an hour at most. */
const PILOT_RETRIES = 6;

async function loadPilot(): Promise<PilotConfig> {
  return pilotConfig(await repo.getSetting<Partial<PilotConfig> | null>(PILOT_KEY, null));
}

/** The next round's alarm. `keep`: at the worker's start, a round already due (Chrome was closed) is not pushed back. */
async function schedulePilot(keep = false): Promise<void> {
  const cfg = await loadPilot();
  if (keep && cfg.enabled && (await browser.alarms.get(PILOT_ALARM))) return;
  await browser.alarms.clear(PILOT_ALARM);
  if (cfg.enabled) await browser.alarms.create(PILOT_ALARM, { when: nextPilotAt(Date.now(), cfg.hours) });
}

let piloting: Promise<PilotRound> | null = null;

/**
 * A vinted.fr tab that answers: the seller's when one does (null returned: nothing to close), else one the pilot opens
 * in the background (its id returned, closed after the round). The seller's tabs are never reloaded or navigated.
 */
async function pilotTab(): Promise<number | null> {
  if (await vintedTabOpen()) return null;
  const url = 'https://www.vinted.fr/';
  const tabId = (await browser.tabs.create({ url, active: false })).id!;
  const answers = async () => {
    await waitForLoad(tabId, 25_000);
    for (let i = 0; i < 60; i++) {
      if (await ping(tabId)) return true;
      await new Promise((res) => setTimeout(res, 250));
    }
    return false;
  };
  // A first load that failed (network hiccup, interstitial) is tried once more — in the pilot's own tab only.
  if (await answers()) return tabId;
  await browser.tabs.update(tabId, { url }).catch(() => undefined);
  if (await answers()) return tabId;
  await browser.tabs.remove(tabId).catch(() => undefined);
  throw new MarketplaceError('NO_VINTED_TAB', 'vinted.fr n’a pas répondu dans l’onglet ouvert par le pilote');
}

/**
 * One round, in the seller's Chrome: refresh, then the automations switched on (offers, favourites, delivered parcels),
 * the buy alerts and the backup if on — within the session's budget and its reserve, stopped by any block or logout.
 * A vinted.fr tab is opened in the background only when none exists (never a reload of the seller's), and closed after.
 * Then one notification: what was done, what is left for the seller.
 */
async function runPilotRound(hour: number): Promise<PilotRound> {
  const r: PilotRound = { hour, stopped: null, imported: null, offers: 0, favourites: 0, delivered: 0, deals: 0, labels: 0, labelsNotSaved: 0, backup: false, toShip: 0, late: 0, toCollect: 0 };
  let openedTab: number | null = null;
  let callsBefore: number | null = null;
  const STOP = /^(NETWORK_403|RATE_LIMITED|NOT_LOGGED_IN|BUDGET_EXHAUSTED|NO_VINTED_TAB)/;
  try {
    if ((await repo.getSetting('dataMode', 'empty')) !== 'real') {
      r.stopped = 'pas de données Vinted importées (démo ou vide)';
      return r;
    }
    if (!(await scheduledRunAllowed('pilot'))) {
      r.stopped = 'budget de la session gardé pour vos clics (réserve) ou Vinted en pause après un blocage';
      return r;
    }
    callsBefore = Object.values(await budget.uses()).reduce((a, b) => a + (b ?? 0), 0);
    openedTab = await pilotTab();
    const cfg = await loadAutoConfig();
    const pilot = await loadPilot();
    await budget.asScheduled(AUTO_FLOOR, async () => {
      const imp = await runImport(false);
      await importFollowUp;
      if (!imp.ok) {
        r.stopped = `${imp.code}${imp.detail ? ` · ${imp.detail}` : ''}`;
        if (STOP.test(imp.code)) return;
      } else r.imported = { listings: imp.items + imp.updated, sold: imp.sales };
      const auto = async (kind: AutoKind, on: boolean) => {
        if (!on || r.stopped?.match(STOP) || !(await scheduledRunAllowed('pilot'))) return 0;
        const a = await runAuto(kind, false);
        if (a.stopped && STOP.test(a.stopped)) r.stopped = a.stopped;
        return a.done;
      };
      r.offers = await auto('OFFERS', cfg.offers.enabled);
      r.favourites = await auto('FAV', cfg.fav.enabled);
      r.delivered = await auto('DELIVERED', cfg.delivered.enabled);
      // The labels of the orders to ship, fetched or ordered like Vinted's own button, saved as PDF (if switched on).
      if (pilot.labels && !r.stopped?.match(STOP) && (await scheduledRunAllowed('pilot'))) {
        const b = await getAllLabels();
        r.labels = b.results.filter((x) => x.ok && x.file).length;
        r.labelsNotSaved = b.results.filter((x) => x.ok && !x.file).length;
        if (b.stopped && STOP.test(b.stopped)) r.stopped = b.stopped;
      }
      if (!r.stopped?.match(STOP) && (await repo.getSetting<{ enabled?: boolean } | null>(BUY_ALERTS_KEY, null))?.enabled && (await scheduledRunAllowed('alerts'))) {
        const a = await runBuyAlerts();
        r.deals = a.deals.length;
      }
      // What followed the contacts (answers, sales): the measures of what makes people answer and buy.
      if (!r.stopped?.match(STOP) && (await scheduledRunAllowed('pilot'))) {
        const c = await refreshContacts().catch(() => null);
        if (c) r.outcomes = c;
      }
    });
  } catch (e) {
    const { code, detail } = errorInfo(e);
    r.stopped = `${code}${detail ? ` · ${detail}` : ''}`;
  } finally {
    if (openedTab !== null) await browser.tabs.remove(openedTab).catch(() => undefined);
  }
  // The round's footprint on Vinted, every agent together (a new session restarts the count: then what it holds now).
  if (callsBefore !== null) {
    const after = Object.values(await budget.uses()).reduce((a, b) => a + (b ?? 0), 0);
    r.calls = after >= callsBefore ? after - callsBefore : after;
  }
  // The backup is local (no Vinted call): made even after a stop, when due.
  r.backup = (await runAutoBackup().catch(() => ({ ok: false }))).ok;
  // What is left for the seller, from what ERA holds now.
  const now = Date.now();
  const sales = await db.sales.filter((s) => !s.isDemo).toArray();
  r.toShip = sales.filter((s) => s.needsAction && s.status !== 'REFUNDED').length;
  r.late = parcelAlerts(sales, now).length;
  r.toCollect = (await db.purchases.toArray()).filter((p) => !p.dismissed && parcelStage(p.status) === 'AT_PICKUP').length;
  // The seller's own plan for today (price cuts, articles to list): from ERA's data, no Vinted call.
  Object.assign(r, await pilotMissions(now).catch(() => ({})));
  return r;
}

/** The week's task (no Vinted call): its journal line and its own notification. */
async function weeklyTask(): Promise<{ title: string; lines: string[] }> {
  const n = await runWeeklyTask();
  await journal({ kind: 'RUN', dryRun: false, ok: true, target: 'Tâche de la semaine', detail: `${n.title} · ${n.lines.join(' · ')}` }).catch(() => undefined);
  await browser.notifications
    .create(`era-weekly-${Date.now()}`, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: n.title, message: n.lines.join('\n'), priority: 1 })
    .catch(() => undefined);
  return n;
}

/** The round, its journal line and its notification; one at a time. Then the week's task, on its day. */
function pilotRound(hour: number): Promise<PilotRound> {
  if (piloting) return piloting;
  piloting = runPilotRound(hour)
    .then(async (r) => {
      const n = pilotNotice(r);
      await journal({ kind: r.stopped ? 'STOP' : 'RUN', dryRun: false, ok: !r.stopped, target: 'Pilote automatique', detail: `${n.title} · ${n.lines.join(' · ')}` }).catch(() => undefined);
      await browser.notifications
        .create(`era-pilot-${Date.now()}`, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: n.title, message: n.lines.join('\n'), priority: 1 })
        .catch(() => undefined);
      await updateBadge().catch(() => undefined);
      // The week's task: in the first round of the chosen day (real data only), once that day.
      const pilot = await loadPilot();
      if (pilot.weekly && !r.stopped?.startsWith('pas de données') && weeklyDue(Date.now(), pilot.weekDay, await repo.getSetting<number | null>(WEEKLY_LAST_KEY, null)))
        await weeklyTask().catch((e) => recordError('service-worker:weekly', e));
      return r;
    })
    .finally(() => {
      piloting = null;
    });
  return piloting;
}

async function onPilotAlarm(alarm: { name: string; scheduledTime: number }): Promise<void> {
  const cfg = await loadPilot();
  if (!cfg.enabled) return;
  const retry = alarm.name === PILOT_RETRY_ALARM;
  const state = ((await browser.storage.session.get('eraPilotRetry')) as { eraPilotRetry?: { hour: number; tries: number } }).eraPilotRetry;
  const hour = retry && state ? state.hour : new Date(alarm.scheduledTime).getHours();
  if (!retry) {
    await schedulePilot();
    // Chrome was closed at the round's hour, long ago — or the next round is close: that one comes instead.
    if (!runLateRound(alarm.scheduledTime, Date.now(), nextPilotAt(Date.now(), cfg.hours))) return;
  }
  // Another Vinted operation running: tried again in 10 min (an hour at most).
  if (vintedBusy() || piloting) {
    const tries = retry && state ? state.tries + 1 : 1;
    if (tries <= PILOT_RETRIES) {
      await browser.storage.session.set({ eraPilotRetry: { hour, tries } });
      await browser.alarms.create(PILOT_RETRY_ALARM, { delayInMinutes: 10 });
    }
    return;
  }
  await browser.storage.session.remove('eraPilotRetry');
  await pilotRound(hour);
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
    if (a.name === DIGEST_ALARM) void runDigest().catch((e) => recordError('service-worker:digest', e));
    if (a.name === PILOT_ALARM || a.name === PILOT_RETRY_ALARM) void onPilotAlarm(a).catch((e) => recordError('service-worker:pilot', e));
    if (a.name === SEARCH_TAB_ALARM) void closeIdleSearchTab().catch(() => undefined);
  });
  // A search tab left from before the worker slept: closed if idle.
  void closeIdleSearchTab().catch(() => undefined);
  void scheduleAuto();
  void scheduleRefresh();
  void scheduleBackup();
  void scheduleDigest();
  void schedulePilot(true);
  void updateBadge().catch(() => undefined);
  // A notification opens what it announces.
  browser.notifications?.onClicked.addListener((id) => {
    if (id.startsWith('era-news-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/sales?ship=1` });
    if (id.startsWith('era-deals-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/buy?tab=scan` });
    if (id.startsWith('era-parcel-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/parcels` });
    if (id.startsWith('era-digest-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/insights?tab=review` });
    if (id.startsWith('era-pilot-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/today` });
    if (id.startsWith('era-weekly-')) void browser.tabs.create({ url: `${browser.runtime.getURL('/dashboard.html')}#/automations` });
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
        return answer(budget.reserve(budget.useOf(msg.path, msg.method)), () => ({ ok: false, code: 'UNAVAILABLE' }));
      case 'era:budget:report':
        return answer(budget.report(msg.status).then(() => ({ ok: true })), unavailable);
      case 'era:budget:status':
        return answer(budget.status(), () => ({ remaining: 0, halted: 'UNAVAILABLE', haltedUntil: null }));
      case 'era:search:visit':
        // One search-page visit, in the worker's own tab (see search-page.ts); the error keeps its code (budget, block…).
        visitInWorker(msg.q).then(
          (v) => sendResponse({ ok: true, ...v }),
          (e: unknown) => sendResponse({ ok: false, ...errorInfo(e) }),
        );
        return true;
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
        reposting = (msg.type === 'era:repost:create' ? repostAsDraft(msg.itemId, Date.now(), msg.priceCents ?? null) : finishRepost(msg.itemId)).finally(() => {
          reposting = null;
        });
        return answer(reposting, unavailable);
      case 'era:auto:schedule':
        return answer(scheduleAuto().then(() => ({ ok: true })), unavailable);
      case 'era:refresh:schedule':
        return answer(scheduleRefresh().then(() => ({ ok: true })), unavailable);
      case 'era:pilot:schedule':
        return answer(schedulePilot().then(() => ({ ok: true })), unavailable);
      case 'era:pilot:run':
        // The seller's click: the same round, now (an import or another operation running: said, not queued).
        if (vintedBusy()) {
          sendResponse({ hour: new Date().getHours(), stopped: BUSY, imported: null, offers: 0, favourites: 0, delivered: 0, deals: 0, labels: 0, labelsNotSaved: 0, backup: false, toShip: 0, late: 0, toCollect: 0 } satisfies PilotRound);
          return undefined;
        }
        return answer(pilotRound(new Date().getHours()), (detail) => ({ hour: new Date().getHours(), stopped: detail, imported: null, offers: 0, favourites: 0, delivered: 0, deals: 0, labels: 0, labelsNotSaved: 0, backup: false, toShip: 0, late: 0, toCollect: 0 }) satisfies PilotRound);
      case 'era:weekly:run':
        // The seller's click: the week's task now, whatever the day (no Vinted call).
        return answer(weeklyTask(), unavailable);
      case 'era:digest:schedule':
        return answer(scheduleDigest().then(() => ({ ok: true })), unavailable);
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
        return answer(runBuyAlerts(), (detail) => ({ deals: [], stopped: detail, via: null }));
      case 'era:badge:update':
        return answer(updateBadge().then(() => ({ ok: true })), unavailable);
      case 'era:price:edit':
        return answer(runPriceEdit(msg.platformListingId, msg.cents, msg.itemId), unavailable);
      case 'era:desc:edit':
        return answer(runDescEdit(msg.platformListingId, msg.text, msg.expectBefore), unavailable);
      case 'era:text:edit':
        return answer(runTextEdit(msg.platformListingId, msg.field, msg.op), unavailable);
      default:
        return undefined;
    }
  });
});
