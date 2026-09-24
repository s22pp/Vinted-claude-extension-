import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useMemo } from 'react';
import '@fontsource-variable/geist';
import '@fontsource/instrument-serif/400-italic.css';
import '@/ui/styles/base.css';
import { repo } from '@/data/repo';
import { I18nContext, type Locale, createI18n } from '@/i18n';
import { ToastProvider } from '@/ui/components/overlays';

export type ThemeSetting = 'dark' | 'light' | 'system';

function resolve(theme: ThemeSetting): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Apply the cached theme synchronously before first paint to avoid a flash. */
export function bootTheme() {
  let cached: ThemeSetting = 'dark';
  try {
    cached = (localStorage.getItem('era.theme') as ThemeSetting | null) ?? 'dark';
  } catch {
    /* storage may be unavailable */
  }
  document.documentElement.dataset.theme = resolve(cached);
}

export async function setTheme(theme: ThemeSetting) {
  try {
    localStorage.setItem('era.theme', theme);
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = resolve(theme);
  await repo.setSetting('theme', theme);
}

export function Providers({ children }: { children: ReactNode }) {
  const theme = useLiveQuery(() => repo.getSetting<ThemeSetting>('theme', 'dark'), []);
  const locale = useLiveQuery(() => repo.getSetting<Locale>('locale', 'fr'), []);
  const i18n = useMemo(() => createI18n(locale ?? 'fr'), [locale]);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = resolve(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => (document.documentElement.dataset.theme = resolve('system'));
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = i18n.locale;
  }, [i18n.locale]);
  return (
    <I18nContext.Provider value={i18n}>
      <ToastProvider>{children}</ToastProvider>
    </I18nContext.Provider>
  );
}
