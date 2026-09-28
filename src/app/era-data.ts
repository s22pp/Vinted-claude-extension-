import type { ActivationEvent, Category, Decision, DomainEvent, InventoryItem, Listing, ListingObservation, PricePrediction, Prep, Sale } from '@/domain/entities';
import type { StoredAnalysis } from '@/data/db';
import type { DataMode } from '@/data/repo';
import { sumMetric } from '@/domain/money';
import { type AutoConfig, floorFor, withDefaults } from '@/intelligence/automation';
import { type CapitalSummary, capitalSummary } from '@/intelligence/capital';
import type { ComparableAnalysis } from '@/intelligence/comparables';
import { type ItemIntel, type TodayPriority, computeItemIntel, todayPriorities } from '@/intelligence/decision';
import { favoriteGains } from '@/intelligence/favorites';
import { type LearningSummary, summarizeLearning } from '@/intelligence/learning';
import { DEFAULT_MARKDOWN, type MarkdownPlan, type MarkdownStep, markdownPlan, normalizeSteps, startPrices } from '@/intelligence/markdown';
import { latestAnalyses } from '@/intelligence/market-vs-you';
import { type ItemView, type SaleView, buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { type PrecisionRow, precisionRows } from '@/intelligence/precision';
import { type RefundSummary, refundSummary } from '@/intelligence/refunds';
import { lastReposts } from '@/intelligence/repost';
import { type SellerModel, buildSellerModel } from '@/intelligence/seller-model';
import { buildSensitivityIndex, lastDrops } from '@/intelligence/sensitivity';
import { workshopQueue } from '@/intelligence/workshop';

export interface EraData {
  ready: boolean;
  now: number;
  mode: DataMode;
  views: ItemView[];
  viewById: Map<string, ItemView>;
  sales: SaleView[];
  model: SellerModel;
  learning: LearningSummary;
  capital: CapitalSummary;
  intel: ItemIntel[];
  intelById: Map<string, ItemIntel>;
  analyses: Map<string, ComparableAnalysis>;
  /** Latest analysis per subject, item-bound or not (Buy Analyzer): the market side of Market vs You. */
  marketAnalyses: ComparableAnalysis[];
  precision: PrecisionRow[];
  preps: Map<string, Prep>;
  workshop: { toList: ItemView[]; awaitingImport: ItemView[] };
  refunds: RefundSummary;
  priorities: TodayPriority[];
  predictions: PricePrediction[];
  activation: Set<ActivationEvent['name']>;
  decisions: Decision[];
  /** Plan de baisse of each live listing (price calendar, never below the floor). */
  markdown: Map<string, MarkdownPlan>;
  markdownSteps: MarkdownStep[];
}

/** Everything the dashboard reads from the local database (undefined = not loaded yet). */
export interface EraInputs {
  items?: InventoryItem[];
  listings?: Listing[];
  sales?: Sale[];
  analyses?: StoredAnalysis[];
  predictions?: PricePrediction[];
  activation?: ActivationEvent[];
  decisions?: Decision[];
  observations?: ListingObservation[];
  priceEvents?: DomainEvent[];
  repostEvents?: DomainEvent[];
  mode?: DataMode;
  prepRows?: Prep[];
  mdSteps?: MarkdownStep[] | null;
  autoCfg?: Partial<AutoConfig> | null;
  now: number;
  categoryLabel: (c: Category | string) => string;
}

/*
 * Three layers, each recomputed only when its own rows change (EraDataProvider memoizes each):
 *   core    — articles, listings, sales, the clock          → views, sales, seller model, capital, refunds
 *   intel   — + analyses, predictions, observations, events → per-article intelligence, learning, precision
 *   derived — + decisions, sheets, settings                  → hidden advice, workshop, priorities, plan de baisse
 * Saving a workshop sheet (every 10 s while it is open) or dismissing advice only redoes the last, light layer.
 */

export interface EraCore {
  now: number;
  views: ItemView[];
  viewById: Map<string, ItemView>;
  saleViews: SaleView[];
  model: SellerModel;
  capital: CapitalSummary;
  refunds: RefundSummary;
}

export function computeCore(x: Pick<EraInputs, 'items' | 'listings' | 'sales' | 'now' | 'categoryLabel'>): EraCore {
  const views = buildItemViews(x.items ?? [], x.listings ?? [], x.sales ?? [], x.now);
  const saleViews = buildSaleViews(views, x.sales ?? []);
  const model = buildSellerModel(views, saleViews, { category: x.categoryLabel });
  return {
    now: x.now,
    views,
    viewById: new Map(views.map((v) => [v.item.id, v])),
    saleViews,
    model,
    capital: capitalSummary(views, saleViews, x.now, model.medianDays),
    refunds: refundSummary(saleViews, { category: x.categoryLabel }),
  };
}

export interface EraIntel {
  learning: LearningSummary;
  analyses: Map<string, ComparableAnalysis>;
  marketAnalyses: ComparableAnalysis[];
  precision: PrecisionRow[];
  /** Before the seller's decisions (dismissed advice is removed in the derived layer, on copies). */
  intel: ItemIntel[];
  gains: ReturnType<typeof favoriteGains>;
  startPrices: Map<string, number>;
}

export function computeIntel(core: EraCore, x: Pick<EraInputs, 'analyses' | 'predictions' | 'observations' | 'priceEvents' | 'repostEvents'>): EraIntel {
  const { views, model, capital, now } = core;
  const observations = x.observations ?? [];
  const priceEvents = x.priceEvents ?? [];
  const learning = summarizeLearning(x.predictions ?? []);
  const analysisMap = new Map((x.analyses ?? []).filter((a) => a.inventoryItemId).map((a) => [a.inventoryItemId!, a.analysis]));
  const sensitivity = buildSensitivityIndex(views, observations, priceEvents);
  const drops = lastDrops(priceEvents, observations, now);
  const reposts = lastReposts(x.repostEvents ?? [], observations, now);
  const intel = views
    .filter((v) => v.inStock)
    .map((v) => computeItemIntel(v, analysisMap.get(v.item.id) ?? null, model, learning, capital, now, sensitivity.get(v.item.id), drops.get(v.item.id) ?? null, reposts.get(v.item.id) ?? null));
  return {
    learning,
    analyses: analysisMap,
    marketAnalyses: latestAnalyses(x.analyses ?? []),
    precision: precisionRows(x.predictions ?? []),
    intel,
    gains: favoriteGains(views, observations, now),
    startPrices: startPrices(observations, priceEvents),
  };
}

export function computeDerived(
  core: EraCore,
  li: EraIntel,
  x: Pick<EraInputs, 'decisions' | 'prepRows' | 'mdSteps' | 'autoCfg' | 'activation' | 'mode' | 'predictions'> & { ready: boolean },
): EraData {
  const { views, saleViews, model, capital, refunds, now } = core;
  // Dismissed / snoozed recommendations stay hidden until they change or the snooze ends (copies: the intel layer is shared).
  const hidden = new Set((x.decisions ?? []).filter((d) => d.outcome === 'DISMISSED' || (d.outcome === 'SNOOZED' && (d.until ?? 0) > now)).map((d) => d.recommendationKey));
  const intel = hidden.size ? li.intel.map((i) => (i.recommendation && hidden.has(i.recommendation.key) ? { ...i, recommendation: null } : i)) : li.intel;
  const preps = new Map((x.prepRows ?? []).map((p) => [p.itemId, p]));
  const workshop = workshopQueue(views, preps);
  const priorities = todayPriorities(intel, capital, model, views);
  // Vinted waits for the seller on these orders (shipping…): first thing to do, every day.
  const toHandle = saleViews.filter((s) => s.sale.needsAction && s.sale.status !== 'REFUNDED');
  if (workshop.toList.length) {
    // Owned, paid, and invisible to buyers: the first lever on sales volume.
    const idle = sumMetric(workshop.toList.map((v) => v.cost));
    priorities.unshift({ code: 'TO_LIST', tone: 'warning', count: workshop.toList.length, amount: idle, label: null, itemIds: workshop.toList.map((v) => v.item.id) });
  }
  // A buyer already paid and Vinted waits for the seller (shipping): before anything else.
  if (toHandle.length) priorities.unshift({ code: 'ORDERS_TO_HANDLE', tone: 'risk', count: toHandle.length, amount: null, label: null, itemIds: toHandle.map((s) => s.item.id) });
  // Buyers showing fresh interest: favourites gained since the previous import (no extra Vinted call).
  if (li.gains.length) {
    priorities.push({ code: 'NEW_FAVORITES', tone: 'positive', count: li.gains.reduce((a, g) => a + g.gained, 0), amount: null, label: null, itemIds: li.gains.map((g) => g.itemId) });
  }
  if (refunds.missingReason.length) {
    const ids = saleViews.filter((s) => refunds.missingReason.includes(s.sale.id)).map((s) => s.item.id);
    priorities.push({ code: 'REFUND_REASON', tone: 'info', count: ids.length, amount: null, label: null, itemIds: ids });
  }
  const markdownSteps = normalizeSteps(x.mdSteps ?? DEFAULT_MARKDOWN);
  const minMargin = { minMarginCents: withDefaults(x.autoCfg).minMarginCents };
  const markdown = new Map<string, MarkdownPlan>();
  for (const v of views) {
    if (!v.inStock || v.current?.status !== 'ACTIVE') continue;
    const plan = markdownPlan(
      { askCents: v.askPrice, startCents: li.startPrices.get(v.current.id) ?? v.current.priceCents, listedAt: v.current.listedAt, floorCents: floorFor(v.cost, minMargin), now },
      markdownSteps,
    );
    if (plan.status !== 'NONE') markdown.set(v.item.id, plan);
  }
  return {
    ready: x.ready,
    now,
    mode: x.mode ?? 'empty',
    views,
    viewById: core.viewById,
    sales: saleViews,
    model,
    learning: li.learning,
    capital,
    intel,
    intelById: new Map(intel.map((i) => [i.view.item.id, i])),
    analyses: li.analyses,
    marketAnalyses: li.marketAnalyses,
    precision: li.precision,
    priorities,
    preps,
    workshop,
    refunds,
    predictions: x.predictions ?? [],
    activation: new Set((x.activation ?? []).map((a) => a.name)),
    decisions: x.decisions ?? [],
    markdown,
    markdownSteps,
  };
}

export function isReady(x: Pick<EraInputs, 'items' | 'listings' | 'sales' | 'analyses' | 'predictions' | 'activation' | 'decisions' | 'mode' | 'prepRows'>): boolean {
  return !!(x.items && x.listings && x.sales && x.analyses && x.predictions && x.activation && x.decisions && x.mode && x.prepRows);
}

/** The whole dashboard state from the stored rows: pure, the same answer for the same rows. */
export function computeEraData(x: EraInputs): EraData {
  const core = computeCore(x);
  return computeDerived(core, computeIntel(core, x), { ...x, ready: isReady(x) });
}
