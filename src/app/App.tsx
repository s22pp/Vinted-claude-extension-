import { useEffect } from 'react';
import { repo } from '@/data/repo';
import { Onboarding } from './screens/Onboarding';
import { Buy } from './screens/Buy';
import { Insights } from './screens/Insights';
import { ItemDetail } from './screens/ItemDetail';
import { Market } from './screens/Market';
import { Sales } from './screens/Sales';
import { Settings } from './screens/Settings';
import { Stock } from './screens/Stock';
import { Today } from './screens/Today';
import { Tools } from './screens/Tools';
import { Shell } from './Shell';
import { EraDataProvider, go, useEra, useRoute } from './state';

function Router() {
  const route = useRoute();
  const era = useEra();
  useEffect(() => {
    void repo.track('extension_installed');
    void repo.track('dashboard_opened');
  }, []);
  useEffect(() => {
    // First run: nothing imported yet → onboarding. Never shows fake data by default.
    if (era.ready && era.mode === 'empty' && route.name === 'today' && !location.hash.includes('today')) go('onboarding');
  }, [era.ready, era.mode, route.name]);

  if (route.name === 'onboarding') return <Onboarding />;
  if (!era.ready) return <div className="era-backdrop" aria-hidden="true" />;
  let screen: React.ReactNode;
  switch (route.name) {
    case 'stock':
      screen = <Stock route={route} />;
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
      screen = <Sales />;
      break;
    case 'insights':
      screen = <Insights />;
      break;
    case 'tools':
      screen = <Tools />;
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
      <Shell route={route.name}>{screen}</Shell>
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
