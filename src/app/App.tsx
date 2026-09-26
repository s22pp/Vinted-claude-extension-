import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { repo } from '@/data/repo';
import { Suspense, lazy } from 'react';
import { Skeleton } from '@/ui/components/primitives';
import { Today } from './screens/Today';

// Today is the landing screen and ships in the main chunk; the rest loads on first visit.
const Onboarding = lazy(() => import('./screens/Onboarding').then((m) => ({ default: m.Onboarding })));
const Buy = lazy(() => import('./screens/Buy').then((m) => ({ default: m.Buy })));
const Insights = lazy(() => import('./screens/Insights').then((m) => ({ default: m.Insights })));
const ItemDetail = lazy(() => import('./screens/ItemDetail').then((m) => ({ default: m.ItemDetail })));
const Market = lazy(() => import('./screens/Market').then((m) => ({ default: m.Market })));
const Sales = lazy(() => import('./screens/Sales').then((m) => ({ default: m.Sales })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Stock = lazy(() => import('./screens/Stock').then((m) => ({ default: m.Stock })));
const Accounting = lazy(() => import('./screens/Accounting').then((m) => ({ default: m.Accounting })));
const Invoice = lazy(() => import('./screens/Invoice').then((m) => ({ default: m.Invoice })));
const Dossier = lazy(() => import('./screens/Dossier').then((m) => ({ default: m.Dossier })));
const Workshop = lazy(() => import('./screens/Workshop').then((m) => ({ default: m.Workshop })));
const Capital = lazy(() => import('./screens/Capital').then((m) => ({ default: m.Capital })));
const Tools = lazy(() => import('./screens/Tools').then((m) => ({ default: m.Tools })));
const Automations = lazy(() => import('./screens/Automations').then((m) => ({ default: m.Automations })));

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
  useEffect(() => {
    void repo.track('extension_installed');
    void repo.track('dashboard_opened');
  }, []);
  const onboardingDone = useLiveQuery(() => repo.getSetting('onboardingDone', false), []);
  useEffect(() => {
    // First run: nothing imported and onboarding never finished → onboarding. Never shows fake data by default.
    if (era.ready && era.mode === 'empty' && onboardingDone === false && route.name !== 'onboarding' && route.name !== 'settings') go('onboarding');
  }, [era.ready, era.mode, route.name, onboardingDone]);

  if (route.name === 'onboarding')
    return (
      <Suspense fallback={<div className="era-backdrop" aria-hidden="true" />}>
        <Onboarding />
      </Suspense>
    );
  if (!era.ready) return <div className="era-backdrop" aria-hidden="true" />;
  // A printable document: no app chrome around it.
  if (route.name === 'invoice')
    return (
      <Suspense fallback={null}>
        <Invoice saleId={route.id ?? ''} />
      </Suspense>
    );
  if (route.name === 'dossier')
    return (
      <Suspense fallback={null}>
        <Dossier saleId={route.id ?? ''} />
      </Suspense>
    );
  let screen: React.ReactNode;
  switch (route.name) {
    case 'stock':
      screen = <Stock route={route} />;
      break;
    case 'accounting':
      screen = <Accounting />;
      break;
    case 'workshop':
      screen = <Workshop route={route} />;
      break;
    case 'capital':
      screen = <Capital />;
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
        <Suspense fallback={<PageSkeleton />}>{screen}</Suspense>
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
