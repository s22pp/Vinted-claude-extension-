import { useEffect, useMemo, useState } from 'react';
import type { EraMessage, ImportResult } from '@/data/adapters/vinted/protocol';
import { useI18n } from '@/i18n';
import { stockCsv } from '@/intelligence/accounting';
import { skuOf } from '@/intelligence/listing';
import { normalizeText } from '@/intelligence/normalize';
import { rotation } from '@/intelligence/pro-figures';
import { downloadText } from '@/lib/download';
import { Icon, type IconName } from '@/ui/components/icons';
import { Modal, useToast } from '@/ui/components/overlays';
import { Money } from '@/ui/components/primitives';
import { setTheme } from '../providers';
import { go, useEra } from '../state';

/**
 * Ctrl+K / ⌘K: go anywhere from the keyboard — an article (title, brand or ERA reference), a screen, an action.
 * Arrows to move, Enter to open, Escape to close. Nothing is sent anywhere: it only navigates.
 */
interface Entry {
  key: string;
  label: string;
  hint?: string;
  icon: IconName;
  href?: string;
  /** An action instead of a place (« > … »). */
  run?: () => void;
  price?: number | null;
  words: string;
}

/** Where G then a letter goes. */
const GO_TO: Record<string, string> = { a: 'today', s: 'stock', p: 'automations', m: 'market', v: 'sales', r: 'settings' };
const typing = (el: EventTarget | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

const PLACES: { key: string; href: string; icon: IconName }[] = [
  { key: 'today', href: 'today', icon: 'today' },
  { key: 'stock', href: 'stock', icon: 'stock' },
  { key: 'workshop', href: 'workshop', icon: 'upload' },
  { key: 'quality', href: 'quality', icon: 'target' },
  { key: 'capital', href: 'capital', icon: 'capital' },
  { key: 'ship', href: 'sales?ship=1', icon: 'box' },
  { key: 'sales', href: 'sales', icon: 'sales' },
  { key: 'accounting', href: 'accounting', icon: 'book' },
  { key: 'parcels', href: 'parcels', icon: 'target' },
  { key: 'pilotage', href: 'insights?tab=review', icon: 'calendar' },
  { key: 'report', href: 'report', icon: 'book' },
  { key: 'market', href: 'market', icon: 'market' },
  { key: 'buy', href: 'buy', icon: 'buy' },
  { key: 'shopping', href: 'buy?tab=list', icon: 'tag' },
  { key: 'scanner', href: 'buy?tab=scan', icon: 'search' },
  { key: 'insights', href: 'insights', icon: 'insights' },
  { key: 'automations', href: 'automations', icon: 'heart' },
  { key: 'add', href: 'stock?add=1', icon: 'plus' },
  { key: 'lot', href: 'stock?lot=1', icon: 'layers' },
  { key: 'costs', href: 'stock?costs=1', icon: 'edit' },
  { key: 'settings', href: 'settings', icon: 'settings' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // Single keys: never while typing, never over an open window, never with a modifier.
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        const to = GO_TO[k];
        if (to) {
          e.preventDefault();
          go(to);
        }
        return;
      }
      if (k === 'g') gAt = Date.now();
      else if (k === 'n') {
        e.preventDefault();
        go('stock?add=1');
      } else if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
      }
    };
    const onOpen = () => setOpen(true);
    const onHelp = () => setHelp(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('era:palette', onOpen);
    window.addEventListener('era:shortcuts', onHelp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('era:palette', onOpen);
      window.removeEventListener('era:shortcuts', onHelp);
    };
  }, []);
  // Mounted only while open: every opening starts empty, nothing to clear afterwards.
  return (
    <>
      {open && <Palette onClose={() => setOpen(false)} />}
      <Shortcuts open={help} onClose={() => setHelp(false)} />
    </>
  );
}

/** « ? »: every shortcut on one ruled sheet. */
function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const rows: [string[], string][] = [
    [['Ctrl', 'K'], t('shortcuts.palette')],
    [['G', 'A'], t('shortcuts.today')],
    [['G', 'S'], t('shortcuts.stock')],
    [['G', 'P'], t('shortcuts.pilot')],
    [['G', 'M'], t('shortcuts.market')],
    [['G', 'V'], t('shortcuts.sales')],
    [['G', 'R'], t('shortcuts.settings')],
    [['N'], t('shortcuts.add')],
    [['/'], t('shortcuts.search')],
    [['?'], t('shortcuts.help')],
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')}>
      <dl className="shortcuts" data-testid="shortcuts">
        {rows.map(([keys, what]) => (
          <div key={keys.join('+')} className="shortcuts__row">
            <dt>
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="t-faint"> {keys[0] === 'Ctrl' ? '+' : t('shortcuts.then')} </span>}
                  <kbd className="kbd">{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const all = useMemo((): Entry[] => {
    const places = PLACES.map((p) => {
      const label = t(`palette.p.${p.key}`);
      return { key: `p:${p.key}`, label, icon: p.icon, href: p.href, words: normalizeText(label) };
    });
    const items = era.views.map((v) => ({
      key: `i:${v.item.id}`,
      label: v.item.title,
      hint: `${v.item.brand} · ${t(`status.${v.item.status}`)} · ${skuOf(v.item.id)}`,
      icon: 'tag' as IconName,
      href: `item/${v.item.id}`,
      price: v.askPrice ?? v.sale?.salePriceCents ?? null,
      words: normalizeText(`${v.item.title} ${v.item.brand} ${skuOf(v.item.id)} ${v.item.size ?? ''}`),
    }));
    // Actions: what can be done from here, each said as such (« > »), never sent anywhere without the seller.
    const stale = era.views.filter((v) => v.item.status === 'LISTED' && rotation(v.daysListed, null, null).state === 'STALE').length;
    const act = (key: string, icon: IconName, run: () => void, params?: Record<string, string | number>) => {
      const label = `› ${t(`palette.a.${key}`, params)}`;
      return { key: `a:${key}`, label, icon, run, words: normalizeText(`${label} action`) };
    };
    const actions: Entry[] = [
      act('stale', 'repost', () => go('stock?select=stale'), { n: stale }),
      act('csv', 'rows', () => downloadText(`era-stock-${new Date(era.now).toISOString().slice(0, 10)}.csv`, stockCsv(era.views.filter((v) => v.inStock)))),
      act('theme', 'moon', () => void setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')),
      act('import', 'repost', () => {
        toast('info', t('palette.importStarted'));
        void (browser.runtime.sendMessage({ type: 'era:import' } satisfies EraMessage) as Promise<ImportResult>)
          .then((r) => (r.ok ? toast('success', t('vinted.stageCOMPLETE'), t('vinted.imported', { n: r.items, updated: r.updated, sales: r.sales })) : toast('error', r.code, r.detail)))
          .catch(() => undefined);
      }),
      act('shortcuts', 'info', () => window.dispatchEvent(new Event('era:shortcuts'))),
      act('intro', 'eye', () => window.dispatchEvent(new Event('era:intro'))),
    ];
    return [...places, ...actions, ...items];
  }, [era.views, era.now, t, toast]);

  const results = useMemo(() => {
    const words = normalizeText(q).split(' ').filter(Boolean);
    // « > » alone: the actions only.
    if (q.trim().startsWith('>')) {
      const rest = words.filter((w) => w !== '>');
      return all.filter((e) => e.key.startsWith('a:') && rest.every((w) => e.words.includes(w))).slice(0, 12);
    }
    const hit = words.length ? all.filter((e) => words.every((w) => e.words.includes(w))) : all.filter((e) => e.key.startsWith('p:') || e.key.startsWith('a:'));
    return hit.slice(0, 14);
  }, [all, q]);

  const choose = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    if (e.run) e.run();
    else if (e.href) go(e.href);
  };

  return (
    <div className="palette__backdrop" role="presentation" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.title')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette__input">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.title')}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') choose(results[sel]);
            }}
          />
          <kbd className="palette__kbd">Esc</kbd>
        </div>
        <ul className="palette__list" role="listbox" data-testid="palette">
          {results.map((e, i) => (
            <li key={e.key} role="option" aria-selected={i === sel} className={`palette__row ${i === sel ? 'is-sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={() => choose(e)}>
              <Icon name={e.icon} size={15} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="clamp-1">{e.label}</span>
                {e.hint && <span className="t-small t-faint clamp-1">{e.hint}</span>}
              </span>
              {e.price != null && (
                <span className="t-small num">
                  <Money cents={e.price} />
                </span>
              )}
            </li>
          ))}
          {results.length === 0 && <li className="palette__row t-muted">{t('palette.none')}</li>}
        </ul>
      </div>
    </div>
  );
}
