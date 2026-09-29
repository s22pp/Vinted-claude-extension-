import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Category } from '@/domain/entities';
import { db } from '@/data/db';
import { type DataMode, repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { AutoConfig } from '@/intelligence/automation';
import { MARKDOWN_KEY, type MarkdownStep } from '@/intelligence/markdown';
import { OVERLAY_KEY, overlayNiches } from '@/intelligence/overlay';
import { shoppingList } from '@/intelligence/shopping';
import { type EraData, computeCore, computeDerived, computeIntel, isReady } from './era-data';
import { useReplyKitPublisher } from './reply-kit';

export type { EraData } from './era-data';

const Ctx = createContext<EraData | null>(null);

export function useEra(): EraData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEra outside provider');
  return v;
}

export function EraDataProvider({ children }: { children: ReactNode }) {
  const { t, money } = useI18n();
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
  const mdSteps = useLiveQuery(() => repo.getSetting<MarkdownStep[] | null>(MARKDOWN_KEY, null), []);
  const autoCfg = useLiveQuery(() => repo.getSetting<Partial<AutoConfig> | null>('automations', null), []);

  // Three layers (see era-data.ts): a sheet saved or a decision taken only redoes the last one.
  const core = useMemo(() => computeCore({ items, listings, sales, now, categoryLabel: (c: Category | string) => t(`category.${c}`) }), [items, listings, sales, now, t]);
  const layer = useMemo(() => computeIntel(core, { analyses, predictions, observations, priceEvents, repostEvents }), [core, analyses, predictions, observations, priceEvents, repostEvents]);
  const value = useMemo<EraData>(() => {
    const ready = isReady({ items, listings, sales, analyses, predictions, activation, decisions, mode, prepRows });
    return computeDerived(core, layer, { decisions, prepRows, mdSteps, autoCfg, activation, mode, predictions, ready });
  }, [core, layer, decisions, prepRows, mdSteps, autoCfg, activation, mode, predictions, items, listings, sales, analyses]);

  // Your niches for ERA's marks on vinted.fr pages — real data only (demo niches never reach real Vinted pages).
  // Written only when they change: every write makes each open vinted.fr tab redraw its marks.
  const lastOverlay = useRef('');
  useEffect(() => {
    if (!value.ready) return;
    const niches = value.mode === 'real' ? overlayNiches(shoppingList(value.model)) : [];
    // Your own listings never get a mark (on your profile they are not deals for you).
    const own = value.views.flatMap((v) => v.listings.map((l) => l.platformListingId)).filter((x): x is string => !!x && /^\d+$/.test(x));
    const next = { [OVERLAY_KEY]: niches, eraOwnListings: own };
    const json = JSON.stringify(next);
    if (json === lastOverlay.current) return;
    lastOverlay.current = json;
    void browser.storage.local.set(next).catch(() => undefined);
  }, [value.ready, value.mode, value.model, value.views]);

  // Your templates (and, real data only, each live listing's context) for the "Réponses ERA" button on vinted.fr.
  useReplyKitPublisher({ ready: value.ready, real: value.mode === 'real', intel: value.intel, preps: value.preps, model: value.model }, { t, money });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ── Hash router ─────────────────────────────────────────── */

export type RouteName = 'today' | 'stock' | 'capital' | 'workshop' | 'accounting' | 'parcels' | 'invoice' | 'dossier' | 'quality' | 'item' | 'market' | 'buy' | 'sales' | 'insights' | 'tools' | 'automations' | 'settings' | 'onboarding';
export interface Route {
  name: RouteName;
  id: string | null;
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = '', qs = ''] = hash.replace(/^#\/?/, '').split('#')[0]!.split('?');
  const [name, id] = path.split('/');
  const known: RouteName[] = ['today', 'stock', 'capital', 'workshop', 'accounting', 'parcels', 'invoice', 'dossier', 'quality', 'item', 'market', 'buy', 'sales', 'insights', 'tools', 'automations', 'settings', 'onboarding'];
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
