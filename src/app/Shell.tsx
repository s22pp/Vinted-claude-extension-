import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { Icon, type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { LogoMark, Wordmark } from '@/ui/components/Logo';
import { useToast } from '@/ui/components/overlays';
import { Button, DemoBadge, IconButton } from '@/ui/components/primitives';
import { type ThemeSetting, setTheme } from './providers';
import { type RouteName, go, useEra } from './state';

const NAV: { name: RouteName; icon: IconName; tone: TileTone }[] = [
  { name: 'today', icon: 'today', tone: 'violet' },
  { name: 'stock', icon: 'stock', tone: 'cobalt' },
  { name: 'market', icon: 'market', tone: 'cobalt' },
  { name: 'buy', icon: 'buy', tone: 'violet' },
  { name: 'sales', icon: 'sales', tone: 'emerald' },
  { name: 'insights', icon: 'insights', tone: 'cyan' },
];

export function Shell({ route, children }: { route: RouteName; children: ReactNode }) {
  const { t } = useI18n();
  const era = useEra();
  const active = route === 'item' ? 'stock' : route;
  const navRef = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setMarker(el ? el.offsetTop : null);
  }, [active]);
  const urgent = era.priorities.filter((p) => p.tone === 'risk' || p.tone === 'warning').length;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <aside className="sidebar" aria-label="ERA">
        <a className="sidebar__brand" href="#/today" aria-label={t('app.fullName')}>
          <Wordmark />
        </a>
        <nav className="nav" ref={navRef} aria-label="Navigation">
          {marker !== null && <span className="nav__marker" style={{ transform: `translateY(${marker}px)` }} aria-hidden="true" />}
          {NAV.map((n) => (
            <a key={n.name} href={`#/${n.name}`} className="nav__item" aria-current={active === n.name ? 'page' : undefined} title={t(`nav.${n.name}Hint`)}>
              <IconTile name={n.icon} tone={n.tone} size="sm" />
              <span className="nav__label">{t(`nav.${n.name}`)}</span>
              {n.name === 'today' && urgent > 0 && <span className="nav__count num">{urgent}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar__foot">
          <a href="#/tools" className="nav__item" aria-current={active === 'tools' ? 'page' : undefined}>
            <IconTile name="layers" tone="pink" size="sm" />
            <span className="nav__label">{t('tools.title')}</span>
          </a>
          <a href="#/settings" className="nav__item" aria-current={active === 'settings' ? 'page' : undefined}>
            <IconTile name="settings" tone="neutral" size="sm" />
            <span className="nav__label">{t('nav.settings')}</span>
          </a>
        </div>
      </aside>
      <div className="main">
        {era.mode === 'demo' && <DemoBannerBar />}
        <Topbar />
        <main id="main" key={route} className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function DemoBannerBar() {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <div className="demo-banner" role="note">
      <DemoBadge />
      <span className="grow">{t('app.demoBanner')}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await repo.clearDemo();
          toast('info', t('settings.clearDemo'));
          go('onboarding');
        }}
      >
        {t('app.demoClear')}
      </Button>
    </div>
  );
}

function Topbar() {
  const { t, dateLong } = useI18n();
  const era = useEra();
  const theme = useLiveQuery(() => repo.getSetting<ThemeSetting>('theme', 'dark'), []) ?? 'dark';
  const next: Record<ThemeSetting, ThemeSetting> = { dark: 'light', light: 'system', system: 'dark' };
  const themeIcon: Record<ThemeSetting, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' };
  const inStock = era.views.filter((v) => v.inStock).length;
  return (
    <header className="topbar">
      <span className="only-sm" style={{ display: 'none' }}>
        <LogoMark size={24} />
      </span>
      <span className="t-small t-muted topbar__hide-sm" style={{ textTransform: 'capitalize' }}>
        {dateLong(era.now)}
      </span>
      <span className="badge b-emerald topbar__hide-sm" title={t('settings.dataLocal')}>
        <span className="badge-dot" aria-hidden="true" />
        {era.mode === 'empty' ? t('data.stateEmpty') : t('data.stateLocal', { n: inStock })}
      </span>
      <span className="topbar__spacer" />
      <Button size="sm" icon="buy" onClick={() => go('buy')}>
        {t('buy.title')}
      </Button>
      <Button size="sm" variant="primary" icon="plus" onClick={() => go('stock?add=1')}>
        {t('stock.add')}
      </Button>
      <IconButton
        icon={themeIcon[theme]}
        label={`${t('settings.theme')} : ${t(`settings.theme${theme[0]!.toUpperCase()}${theme.slice(1)}`)}`}
        onClick={() => void setTheme(next[theme])}
      />
    </header>
  );
}

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__titles">
        {eyebrow && <div className="page-head__eyebrow">{eyebrow}</div>}
        <h1 className="t-h1">{title}</h1>
        {sub && <p className="page-head__sub">{sub}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="btn btn--ghost btn--sm" style={{ paddingLeft: 4 }}>
      <Icon name="chevronLeft" size={15} />
      {label}
    </a>
  );
}
