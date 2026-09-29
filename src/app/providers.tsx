import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useMemo } from 'react';
import '@/ui/styles/fonts.css';
import '@/ui/styles/base.css';
import '@/ui/styles/core.css';
import { repo } from '@/data/repo';
import { I18nContext, type Locale, createI18n } from '@/i18n';
import { ToastProvider } from '@/ui/components/overlays';

export type ThemeSetting = 'dark' | 'light' | 'system';
/** ERA's own "reduce motion", on top of the system's (which the styles always follow). */
export type MotionSetting = 'system' | 'reduced';

function applyMotion(motion: MotionSetting) {
  if (motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

function resolve(theme: ThemeSetting): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Apply the cached theme (and motion) synchronously before first paint: no flash, no entrance played by mistake. */
export function bootTheme() {
  let cached: ThemeSetting = 'dark';
  let motion: MotionSetting = 'system';
  try {
    cached = (localStorage.getItem('era.theme') as ThemeSetting | null) ?? 'dark';
    motion = (localStorage.getItem('era.motion') as MotionSetting | null) ?? 'system';
  } catch {
    /* storage may be unavailable */
  }
  document.documentElement.dataset.theme = resolve(cached);
  applyMotion(motion);
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

export async function setMotion(motion: MotionSetting) {
  try {
    localStorage.setItem('era.motion', motion);
  } catch {
    /* ignore */
  }
  applyMotion(motion);
  await repo.setSetting('motion', motion);
}

export function Providers({ children }: { children: ReactNode }) {
  const theme = useLiveQuery(() => repo.getSetting<ThemeSetting>('theme', 'dark'), []);
  const motion = useLiveQuery(() => repo.getSetting<MotionSetting>('motion', 'system'), []);
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
    if (!motion) return;
    applyMotion(motion);
    try {
      localStorage.setItem('era.motion', motion);
    } catch {
      /* ignore */
    }
  }, [motion]);
  useEffect(() => {
    document.documentElement.lang = i18n.locale;
  }, [i18n.locale]);
  return (
    <I18nContext.Provider value={i18n}>
      <ToastProvider>{children}</ToastProvider>
    </I18nContext.Provider>
  );
}
