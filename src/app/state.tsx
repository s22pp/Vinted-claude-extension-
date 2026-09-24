import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ActivationEventName, Category, Decision, PricePrediction } from '@/domain/entities';
import { db } from '@/data/db';
import { type DataMode, repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type CapitalSummary, capitalSummary } from '@/intelligence/capital';
import type { ComparableAnalysis } from '@/intelligence/comparables';
import { type ItemIntel, type TodayPriority, computeItemIntel, todayPriorities } from '@/intelligence/decision';
import { type LearningSummary, summarizeLearning } from '@/intelligence/learning';
import { type ItemView, type SaleView, buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { type SellerModel, buildSellerModel } from '@/intelligence/seller-model';

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
  const mode = useLiveQuery(() => repo.getSetting<DataMode>('dataMode', 'empty'), []);

  const value = useMemo<EraData>(() => {
    const ready = !!(items && listings && sales && analyses && predictions && activation && decisions && mode);
    const views = buildItemViews(items ?? [], listings ?? [], sales ?? [], now);
    const saleViews = buildSaleViews(views, sales ?? []);
    const model = buildSellerModel(views, saleViews, { category: (c: Category) => t(`category.${c}`) });
    const learning = summarizeLearning(predictions ?? []);
    const capital = capitalSummary(views, saleViews, now);
    const analysisMap = new Map((analyses ?? []).filter((a) => a.inventoryItemId).map((a) => [a.inventoryItemId!, a.analysis]));
    const intel = views.filter((v) => v.inStock).map((v) => computeItemIntel(v, analysisMap.get(v.item.id) ?? null, model, learning, capital, now));
    // Dismissed / snoozed recommendations stay hidden until they change or the snooze ends.
    const hidden = new Set((decisions ?? []).filter((d) => d.outcome === 'DISMISSED' || (d.outcome === 'SNOOZED' && (d.until ?? 0) > now)).map((d) => d.recommendationKey));
    for (const i of intel) if (i.recommendation && hidden.has(i.recommendation.key)) i.recommendation = null;
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
      priorities: todayPriorities(intel, capital, model),
      predictions: predictions ?? [],
      activation: new Set((activation ?? []).map((a) => a.name)),
      decisions: decisions ?? [],
    };
  }, [items, listings, sales, analyses, predictions, activation, decisions, mode, now, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ── Hash router ─────────────────────────────────────────── */

export type RouteName = 'today' | 'stock' | 'item' | 'market' | 'buy' | 'sales' | 'insights' | 'tools' | 'settings' | 'onboarding';
export interface Route {
  name: RouteName;
  id: string | null;
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = '', qs = ''] = hash.replace(/^#\/?/, '').split('#')[0]!.split('?');
  const [name, id] = path.split('/');
  const known: RouteName[] = ['today', 'stock', 'item', 'market', 'buy', 'sales', 'insights', 'tools', 'settings', 'onboarding'];
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
