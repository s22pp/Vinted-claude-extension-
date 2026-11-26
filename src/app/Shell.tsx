import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ACTIVATION_STEPS } from './components/domain';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { PILOT_KEY, type PilotConfig, pilotConfig } from '@/intelligence/pilot';
import { AccountIdentity } from './components/account-identity';
import { Icon, type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { LogoMark } from '@/ui/components/Logo';
import { useToast } from '@/ui/components/overlays';
import { Button, DemoBadge } from '@/ui/components/primitives';
import { type ThemeSetting, setTheme } from './providers';
import { VintedImportButton } from './components/vinted-import';
import { type RouteName, go, useEra } from './state';

const NAV: { name: RouteName; icon: IconName; tone: TileTone }[] = [
  { name: 'today', icon: 'today', tone: 'violet' },
  // The autopilot: what ERA does by itself, and the messages waiting for the seller.
  { name: 'automations', icon: 'repost', tone: 'violet' },
  { name: 'stock', icon: 'stock', tone: 'cobalt' },
  { name: 'market', icon: 'market', tone: 'cobalt' },
  { name: 'buy', icon: 'buy', tone: 'violet' },
  { name: 'sales', icon: 'sales', tone: 'emerald' },
  { name: 'insights', icon: 'insights', tone: 'cyan' },
];

import { CommandPalette } from './components/palette';
import { UpdateBanner } from './components/update-banner';

/** The sidebar's head (56 px, ruled underneath): the account's identity. */
function SidebarIdentity() {
  return <AccountIdentity className="sidebar__brand" />;
}

/** The sidebar's foot: ERA's version, the Pilote's state, the palette's shortcut. */
function SidebarStatus() {
  const { t } = useI18n();
  const on = useLiveQuery(async () => pilotConfig(await repo.getSetting<Partial<PilotConfig> | null>(PILOT_KEY, null)).enabled, []) ?? false;
  return (
    <div className="side-status" data-testid="side-status">
      <span className="side-status__cell num">v{browser.runtime.getManifest().version}</span>
      <a className={`side-status__cell side-status__pilot ${on ? 'is-on' : 'is-off'}`} href="#/automations">
        <span aria-hidden="true">●</span> {t(on ? 'side.pilotOn' : 'side.pilotOff')}
      </a>
      <button type="button" className="side-status__cell side-status__kbd" onClick={() => window.dispatchEvent(new Event('era:palette'))} aria-keyshortcuts="Control+K" title={t('palette.open')}>
        <kbd>Ctrl</kbd> + <kbd>K</kbd>
      </button>
    </div>
  );
}

/** « MER. 25 NOV »: the day as the top bar's first cell says it. */
export function topDate(now: number): string {
  const d = new Date(now);
  const wd = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(d).replace(/\.$/, '');
  const mo = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(d).replace(/\.$/, '');
  return `${wd}. ${d.getDate()} ${mo}`.toUpperCase();
}

export function Shell({ route, children }: { route: RouteName; children: ReactNode }) {
  const { t } = useI18n();
  const era = useEra();
  const active = route === 'item' || route === 'capital' || route === 'workshop' ? 'stock' : route === 'accounting' || route === 'parcels' ? 'sales' : route;
  const navRef = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setMarker(el ? el.offsetTop : null);
  }, [active]);
  const urgent = era.priorities.filter((p) => p.tone === 'risk' || p.tone === 'warning').length;
  // Buyers' messages waiting for the seller in ERA (the reply agent's list).
  const waiting = useLiveQuery(async () => ((await repo.getSetting<unknown[]>('autoRepliesPending', [])) ?? []).length, []) ?? 0;
  useMilestones();

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <aside className="sidebar" aria-label="ERA">
        <SidebarIdentity />
        <nav className="nav" ref={navRef} aria-label="Navigation">
          {marker !== null && <span className="nav__marker" style={{ transform: `translateY(${marker}px)` }} aria-hidden="true" />}
          {NAV.map((n) => (
            <a key={n.name} href={`#/${n.name}`} className="nav__item" aria-current={active === n.name ? 'page' : undefined} title={t(`nav.${n.name}Hint`)}>
              <IconTile name={n.icon} tone={n.tone} size="sm" />
              <span className="nav__label">{t(`nav.${n.name}`)}</span>
              {n.name === 'today' && urgent > 0 && <span className="nav__count num">{urgent}</span>}
              {n.name === 'automations' && waiting > 0 && <span className="nav__count num" title={t('nav.waiting', { n: waiting })}>{waiting}</span>}
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
          <SidebarStatus />
        </div>
      </aside>
      <div className="main">
        {era.mode === 'demo' && <DemoBannerBar />}
        <UpdateBanner />
        <Topbar />
        <main id="main" key={route} className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      <CommandPalette />
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
          toast('info', t('settings.demoCleared'));
          go('onboarding');
        }}
      >
        {t('app.demoClear')}
      </Button>
    </div>
  );
}

function Topbar() {
  const { t } = useI18n();
  const era = useEra();
  const theme = useLiveQuery(() => repo.getSetting<ThemeSetting>('theme', 'dark'), []) ?? 'dark';
  const next: Record<ThemeSetting, ThemeSetting> = { dark: 'light', light: 'system', system: 'dark' };
  const themeIcon: Record<ThemeSetting, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' };
  const inStock = era.views.filter((v) => v.inStock).length;
  // One row of cells, 56 px high, each separated from the next by a 1 px rule; « + Ajouter » fills the last one.
  return (
    <header className="topbar topbar--cells">
      <span className="only-sm" style={{ display: 'none' }}>
        <LogoMark size={24} />
      </span>
      <span className="topbar__cell topbar__when topbar__hide-sm num" data-testid="topbar-when">
        {topDate(era.now)} <span className="topbar__sep" aria-hidden="true">|</span> {t('topbar.stock', { n: inStock })}
      </span>
      <button type="button" className="topbar__cell topbar__search topbar__hide-sm" onClick={() => window.dispatchEvent(new Event('era:palette'))} aria-keyshortcuts="Control+K">
        <Icon name="search" size={14} /> <span>{t('palette.open')}</span> <kbd className="topbar__kbd">CTRL K</kbd>
      </button>
      <span className="topbar__spacer" />
      <span className="topbar__cell topbar__action">
        <VintedImportButton size="sm" variant="ghost" label="short" />
      </span>
      <span className="topbar__cell topbar__action topbar__hide-sm">
        <Button size="sm" variant="ghost" icon="buy" onClick={() => go('buy')}>
          {t('buy.title')}
        </Button>
      </span>
      <button
        type="button"
        className="topbar__cell topbar__theme"
        aria-label={`${t('settings.theme')} : ${t(`settings.theme${theme[0]!.toUpperCase()}${theme.slice(1)}`)}`}
        title={`${t('settings.theme')} : ${t(`settings.theme${theme[0]!.toUpperCase()}${theme.slice(1)}`)}`}
        onClick={() => void setTheme(next[theme])}
      >
        <Icon name={themeIcon[theme]} size={16} />
      </button>
      <button type="button" className="topbar__cell topbar__add" aria-label={t('stock.add')} onClick={() => go('stock?add=1')}>
        <Icon name="plus" size={15} /> <span className="topbar__label">{t('stock.add')}</span>
      </button>
    </header>
  );
}

export function PageHead({ eyebrow, title, sub, actions, tabs }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__titles">
        {eyebrow && <div className="page-head__eyebrow">{eyebrow}</div>}
        <h1 className="t-h1">
          <span className="t-h1__line">{title}</span>
        </h1>
        {sub && <p className="page-head__sub">{sub}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
      {tabs && <div className="page-head__tabs">{tabs}</div>}
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

const MILESTONES_KEY = 'era.milestones.v1';

/** Discreet, local-only celebration when an activation step is completed for the first time. */
function useMilestones() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  useEffect(() => {
    if (!era.ready) return;
    const done = ACTIVATION_STEPS.filter((s) => era.activation.has(s.name)).map((s) => s.name as string);
    let seen: string[] | null = null;
    try {
      seen = JSON.parse(localStorage.getItem(MILESTONES_KEY) ?? 'null') as string[] | null;
    } catch {
      seen = null;
    }
    const save = () => {
      try {
        localStorage.setItem(MILESTONES_KEY, JSON.stringify(done));
      } catch {
        /* per-viewer convenience only */
      }
    };
    // First run on this browser: take the current state as the baseline, silently.
    if (seen === null) return save();
    const fresh = done.filter((d) => !seen!.includes(d));
    if (!fresh.length) return;
    save();
    if (done.length === ACTIVATION_STEPS.length) toast('success', t('activation.allDone'), t('activation.allDoneHint'));
    else for (const f of fresh) toast('success', t('activation.milestone', { done: done.length, total: ACTIVATION_STEPS.length }), t(`activation.${f}`));
  }, [era.ready, era.activation, t, toast]);
}
