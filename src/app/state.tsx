import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ActivationEventName, Category, Decision, PricePrediction, Prep } from '@/domain/entities';
import { db } from '@/data/db';
import { type DataMode, repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type CapitalSummary, capitalSummary } from '@/intelligence/capital';
import type { ComparableAnalysis } from '@/intelligence/comparables';
import { type ItemIntel, type TodayPriority, computeItemIntel, todayPriorities } from '@/intelligence/decision';
import { type LearningSummary, summarizeLearning } from '@/intelligence/learning';
import { type ItemView, type SaleView, buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { type SellerModel, buildSellerModel } from '@/intelligence/seller-model';
import { lastReposts } from '@/intelligence/repost';
import { buildSensitivityIndex, lastDrops } from '@/intelligence/sensitivity';
import { latestAnalyses } from '@/intelligence/market-vs-you';
import { type PrecisionRow, precisionRows } from '@/intelligence/precision';
import { type RefundSummary, refundSummary } from '@/intelligence/refunds';
import { workshopQueue } from '@/intelligence/workshop';
import { favoriteGains } from '@/intelligence/favorites';
import { sumMetric } from '@/domain/money';

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
  activation: Set<ActivationEventName>;
  decisions: Decision[];
}

const Ctx = createContext<EraData | null>(null);

export function useEra(): EraData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEra outside provider');
  return v;
}

export function EraDataProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10 * 60_000);
    return () => clearInterval(id);
  }, []);

  const items = useLiveQuery(() => db.items.toArray(), []);
  const listings = useLiveQuery(() => db.listings.toArray(), []);
  const sales = useLiveQuery(() => db.sales.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const predictions = useLiveQuery(() => db.predictions.toArray(), []);
  const activation = useLiveQuery(() => db.activation.toArray(), []);
  const decisions = useLiveQuery(() => db.decisions.toArray(), []);
  const observations = useLiveQuery(() => db.observations.toArray(), []);
  const priceEvents = useLiveQuery(() => db.events.where('type').equals('PRICE_CHANGED').toArray(), []);
  const repostEvents = useLiveQuery(() => db.events.where('type').equals('LISTING_REPUBLISHED').toArray(), []);
  const mode = useLiveQuery(() => repo.getSetting<DataMode>('dataMode', 'empty'), []);
  const prepRows = useLiveQuery(() => db.preps.toArray(), []);

  const value = useMemo<EraData>(() => {
    const ready = !!(items && listings && sales && analyses && predictions && activation && decisions && mode && prepRows);
    const views = buildItemViews(items ?? [], listings ?? [], sales ?? [], now);
    const saleViews = buildSaleViews(views, sales ?? []);
    const model = buildSellerModel(views, saleViews, { category: (c: Category) => t(`category.${c}`) });
    const learning = summarizeLearning(predictions ?? []);
    const capital = capitalSummary(views, saleViews, now, model.medianDays);
    const analysisMap = new Map((analyses ?? []).filter((a) => a.inventoryItemId).map((a) => [a.inventoryItemId!, a.analysis]));
    const sensitivity = buildSensitivityIndex(views, observations ?? [], priceEvents ?? []);
    const drops = lastDrops(priceEvents ?? [], observations ?? [], now);
    const reposts = lastReposts(repostEvents ?? [], observations ?? [], now);
    const intel = views
      .filter((v) => v.inStock)
      .map((v) => computeItemIntel(v, analysisMap.get(v.item.id) ?? null, model, learning, capital, now, sensitivity.get(v.item.id), drops.get(v.item.id) ?? null, reposts.get(v.item.id) ?? null));
    // Dismissed / snoozed recommendations stay hidden until they change or the snooze ends.
    const hidden = new Set((decisions ?? []).filter((d) => d.outcome === 'DISMISSED' || (d.outcome === 'SNOOZED' && (d.until ?? 0) > now)).map((d) => d.recommendationKey));
    for (const i of intel) if (i.recommendation && hidden.has(i.recommendation.key)) i.recommendation = null;
    const preps = new Map((prepRows ?? []).map((p) => [p.itemId, p]));
    const workshop = workshopQueue(views, preps);
    const refunds = refundSummary(saleViews, { category: (c) => t(`category.${c}`) });
    const priorities = todayPriorities(intel, capital, model, views);
    // Vinted waits for the seller on these orders (shipping…): first thing to do, every day.
    const toHandle = saleViews.filter((x) => x.sale.needsAction && x.sale.status !== 'REFUNDED');
    if (workshop.toList.length) {
      // Owned, paid, and invisible to buyers: the first lever on sales volume.
      const idle = sumMetric(workshop.toList.map((v) => v.cost));
      priorities.unshift({ code: 'TO_LIST', tone: 'warning', count: workshop.toList.length, amount: idle, label: null, itemIds: workshop.toList.map((v) => v.item.id) });
    }
    // A buyer already paid and Vinted waits for the seller (shipping): before anything else.
    if (toHandle.length) priorities.unshift({ code: 'ORDERS_TO_HANDLE', tone: 'risk', count: toHandle.length, amount: null, label: null, itemIds: toHandle.map((x) => x.item.id) });
    // Buyers showing fresh interest: favourites gained since the previous import (no extra Vinted call).
    const gains = favoriteGains(views, observations ?? [], now);
    if (gains.length) {
      priorities.push({ code: 'NEW_FAVORITES', tone: 'positive', count: gains.reduce((a, g) => a + g.gained, 0), amount: null, label: null, itemIds: gains.map((g) => g.itemId) });
    }
    if (refunds.missingReason.length) {
      const ids = saleViews.filter((x) => refunds.missingReason.includes(x.sale.id)).map((x) => x.item.id);
      priorities.push({ code: 'REFUND_REASON', tone: 'info', count: ids.length, amount: null, label: null, itemIds: ids });
    }
    return {
      ready,
      now,
      mode: mode ?? 'empty',
      views,
      viewById: new Map(views.map((v) => [v.item.id, v])),
      sales: saleViews,
      model,
      learning,
      capital,
      intel,
      intelById: new Map(intel.map((i) => [i.view.item.id, i])),
      analyses: analysisMap,
      marketAnalyses: latestAnalyses(analyses ?? []),
      precision: precisionRows(predictions ?? []),
      priorities,
      preps,
      workshop,
      refunds,
      predictions: predictions ?? [],
      activation: new Set((activation ?? []).map((a) => a.name)),
      decisions: decisions ?? [],
    };
  }, [items, listings, sales, analyses, predictions, activation, decisions, mode, now, t, observations, priceEvents, repostEvents, prepRows]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ── Hash router ─────────────────────────────────────────── */

export type RouteName = 'today' | 'stock' | 'capital' | 'workshop' | 'accounting' | 'invoice' | 'item' | 'market' | 'buy' | 'sales' | 'insights' | 'tools' | 'settings' | 'onboarding';
export interface Route {
  name: RouteName;
  id: string | null;
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = '', qs = ''] = hash.replace(/^#\/?/, '').split('#')[0]!.split('?');
  const [name, id] = path.split('/');
  const known: RouteName[] = ['today', 'stock', 'capital', 'workshop', 'accounting', 'invoice', 'item', 'market', 'buy', 'sales', 'insights', 'tools', 'settings', 'onboarding'];
  return { name: known.includes(name as RouteName) ? (name as RouteName) : 'today', id: id ?? null, query: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      document.querySelector('.main')?.scrollTo?.({ top: 0 });
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string) {
  location.hash = `#/${path.replace(/^\/?/, '')}`;
}
