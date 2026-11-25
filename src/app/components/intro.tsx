import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, lazy, useEffect, useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';

const EraTrainScene = lazy(() => import('./era-train').then((m) => ({ default: m.EraTrainScene })));
const SEEN_KEY = 'era.intro.seen';

/**
 * The entrance, once per version (first opening after an install or an update), and on demand from the palette
 * (« Revoir l'intro »). Never under browser automation: tests open the dashboard hundreds of times. The status says
 * what is true: « stock synchronisé » only after a real import, with its date.
 */
export function Intro() {
  const { t, date } = useI18n();
  const [show, setShow] = useState(false);
  const login = useLiveQuery(() => repo.getSetting<string | null>('vintedLogin', null), []);
  const lastImport = useLiveQuery(() => repo.getSetting<number | null>('lastVintedImport', null), []);
  const version = browser.runtime.getManifest().version;
  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      /* private window: shown, not remembered */
    }
    if (!navigator.webdriver && seen !== version) setShow(true);
    const on = () => setShow(true);
    window.addEventListener('era:intro', on);
    return () => window.removeEventListener('era:intro', on);
  }, [version]);
  if (!show || login === undefined || lastImport === undefined) return null;
  const status = lastImport ? t('intro.statusSynced', { date: date(lastImport) }) : t('intro.statusLocal');
  return (
    <Suspense fallback={null}>
      <EraTrainScene
        name={login ?? 'ERA'}
        status={status}
        onDone={() => {
          try {
            localStorage.setItem(SEEN_KEY, version);
          } catch {
            /* ignore */
          }
          setShow(false);
        }}
      />
    </Suspense>
  );
}
