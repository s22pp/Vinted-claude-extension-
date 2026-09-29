import { useLiveQuery } from 'dexie-react-hooks';
import { type ComponentProps, type ComponentType, Suspense, createElement, lazy, useEffect } from 'react';
import { type DataMode, repo } from '@/data/repo';
import { Skeleton } from '@/ui/components/primitives';
import { ErrorBoundary } from './components/error-boundary';
import { Today } from './screens/Today';

/**
 * A screen loaded on first visit — or before: once the dashboard has settled, every screen is fetched while the
 * browser is idle, so the first click shows it at once (no skeleton). Rendered directly once loaded.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScreen = ComponentType<any>;

function lazyScreen<C extends AnyScreen>(load: () => Promise<C>) {
  let Loaded: C | null = null;
  let pending: Promise<C> | null = null;
  const preload = () =>
    (pending ??= load()
      .then((c) => (Loaded = c))
      .catch((e: unknown) => {
        pending = null; // a failed fetch is retried on the next visit
        throw e;
      }));
  const Lazy = lazy(() => preload().then((c) => ({ default: c })));
  function Screen(props: ComponentProps<C>) {
    return Loaded ? createElement(Loaded, props) : createElement(Lazy, props);
  }
  Screen.preload = preload;
  return Screen;
}

const Onboarding = lazyScreen(() => import('./screens/Onboarding').then((m) => m.Onboarding));
const Buy = lazyScreen(() => import('./screens/Buy').then((m) => m.Buy));
const Insights = lazyScreen(() => import('./screens/Insights').then((m) => m.Insights));
const ItemDetail = lazyScreen(() => import('./screens/ItemDetail').then((m) => m.ItemDetail));
const Market = lazyScreen(() => import('./screens/Market').then((m) => m.Market));
const Sales = lazyScreen(() => import('./screens/Sales').then((m) => m.Sales));
const Settings = lazyScreen(() => import('./screens/Settings').then((m) => m.Settings));
const Stock = lazyScreen(() => import('./screens/Stock').then((m) => m.Stock));
const Accounting = lazyScreen(() => import('./screens/Accounting').then((m) => m.Accounting));
const Parcels = lazyScreen(() => import('./screens/Parcels').then((m) => m.Parcels));
const Invoice = lazyScreen(() => import('./screens/Invoice').then((m) => m.Invoice));
const Dossier = lazyScreen(() => import('./screens/Dossier').then((m) => m.Dossier));
const Report = lazyScreen(() => import('./screens/Report').then((m) => m.Report));
const Workshop = lazyScreen(() => import('./screens/Workshop').then((m) => m.Workshop));
const Capital = lazyScreen(() => import('./screens/Capital').then((m) => m.Capital));
const Quality = lazyScreen(() => import('./screens/Quality').then((m) => m.Quality));
const Tools = lazyScreen(() => import('./screens/Tools').then((m) => m.Tools));
const Automations = lazyScreen(() => import('./screens/Automations').then((m) => m.Automations));

// Most visited first.
const PRELOAD = [Stock, ItemDetail, Sales, Workshop, Buy, Market, Insights, Settings, Accounting, Parcels, Capital, Quality, Tools, Automations, Dossier, Invoice];

function usePreloadScreens() {
  useEffect(() => {
    const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
    let cancelled = false;
    const next = (i: number) => {
      if (cancelled || i >= PRELOAD.length) return;
      void PRELOAD[i]!.preload()
        .catch(() => undefined)
        .finally(() => idle(() => next(i + 1)));
    };
    idle(() => next(0));
    return () => {
      cancelled = true;
    };
  }, []);
}

function PageSkeleton() {
  return (
    <div className="stack-4" aria-busy="true">
      <Skeleton w={280} h={30} />
      <Skeleton h={120} r={14} />
      <div className="grid-12">
        <div className="span-8">
          <Skeleton h={260} r={14} />
        </div>
        <div className="span-4">
          <Skeleton h={260} r={14} />
        </div>
      </div>
    </div>
  );
}
import { Shell } from './Shell';
import { EraDataProvider, go, useEra, useRoute } from './state';

function Router() {
  const route = useRoute();
  const era = useEra();
  usePreloadScreens();
  useEffect(() => {
    void repo.track('extension_installed');
    void repo.track('dashboard_opened');
  }, []);
  const onboardingDone = useLiveQuery(() => repo.getSetting('onboardingDone', false), []);
  useEffect(() => {
    // First run: nothing imported and onboarding never finished → onboarding. Never shows fake data by default.
    // Read both settings again before redirecting: the live values can lag behind the database by a moment — right
    // after "Passer", or right after a first import (items shown, data mode not yet "real") — which would send the
    // seller back to the onboarding.
    if (era.ready && era.mode === 'empty' && onboardingDone === false && route.name !== 'onboarding' && route.name !== 'settings')
      void Promise.all([repo.getSetting('onboardingDone', false), repo.getSetting<DataMode>('dataMode', 'empty')]).then(([done, mode]) => {
        if (!done && mode === 'empty') go('onboarding');
      });
  }, [era.ready, era.mode, route.name, onboardingDone]);

  const key = `${route.name}/${route.id ?? ''}`;
  if (route.name === 'onboarding')
    return (
      <ErrorBoundary where="onboarding" resetKey={key}>
        <Suspense fallback={<div className="era-backdrop" aria-hidden="true" />}>
          <Onboarding />
        </Suspense>
      </ErrorBoundary>
    );
  if (!era.ready) {
    // Data still loading: the menu and the page's outline right away, never a blank window.
    if (route.name === 'invoice' || route.name === 'dossier' || route.name === 'report') return <div className="era-backdrop" aria-hidden="true" />;
    return (
      <>
        <div className="era-backdrop" aria-hidden="true" />
        <Shell route={route.name}>
          <PageSkeleton />
        </Shell>
      </>
    );
  }
  // A printable document: no app chrome around it.
  if (route.name === 'invoice')
    return (
      <ErrorBoundary where="invoice" resetKey={key}>
        <Suspense fallback={null}>
          <Invoice saleId={route.id ?? ''} />
        </Suspense>
      </ErrorBoundary>
    );
  if (route.name === 'dossier')
    return (
      <ErrorBoundary where="dossier" resetKey={key}>
        <Suspense fallback={null}>
          <Dossier saleId={route.id ?? ''} />
        </Suspense>
      </ErrorBoundary>
    );
  if (route.name === 'report')
    return (
      <ErrorBoundary where="report" resetKey={key}>
        <Suspense fallback={null}>
          <Report id={route.id} />
        </Suspense>
      </ErrorBoundary>
    );
  let screen: React.ReactNode;
  switch (route.name) {
    case 'stock':
      screen = <Stock route={route} />;
      break;
    case 'accounting':
      screen = <Accounting />;
      break;
    case 'parcels':
      screen = <Parcels />;
      break;
    case 'workshop':
      screen = <Workshop route={route} />;
      break;
    case 'capital':
      screen = <Capital />;
      break;
    case 'quality':
      screen = <Quality />;
      break;
    case 'item':
      screen = <ItemDetail id={route.id ?? ''} />;
      break;
    case 'market':
      screen = <Market route={route} />;
      break;
    case 'buy':
      screen = <Buy route={route} />;
      break;
    case 'sales':
      screen = <Sales route={route} />;
      break;
    case 'insights':
      screen = <Insights route={route} />;
      break;
    case 'tools':
      screen = <Tools />;
      break;
    case 'automations':
      screen = <Automations />;
      break;
    case 'settings':
      screen = <Settings />;
      break;
    default:
      screen = <Today />;
  }
  return (
    <>
      <div className="era-backdrop" aria-hidden="true" />
      <Shell route={route.name}>
        {/* A screen that fails shows why and how to go on; the menu and the other screens keep working. */}
        <ErrorBoundary where={route.name} resetKey={key}>
          <Suspense fallback={<PageSkeleton />}>{screen}</Suspense>
        </ErrorBoundary>
      </Shell>
    </>
  );
}

export function App() {
  return (
    <EraDataProvider>
      <Router />
    </EraDataProvider>
  );
}
