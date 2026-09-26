import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { skuOf } from '@/intelligence/listing';
import { normalizeText } from '@/intelligence/normalize';
import { Icon, type IconName } from '@/ui/components/icons';
import { Money } from '@/ui/components/primitives';
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
  href: string;
  price?: number | null;
  words: string;
}

const PLACES: { key: string; href: string; icon: IconName }[] = [
  { key: 'today', href: 'today', icon: 'today' },
  { key: 'stock', href: 'stock', icon: 'stock' },
  { key: 'workshop', href: 'workshop', icon: 'upload' },
  { key: 'quality', href: 'quality', icon: 'target' },
  { key: 'capital', href: 'capital', icon: 'capital' },
  { key: 'ship', href: 'sales?ship=1', icon: 'box' },
  { key: 'sales', href: 'sales', icon: 'sales' },
  { key: 'accounting', href: 'accounting', icon: 'book' },
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('era:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('era:palette', onOpen);
    };
  }, []);
  // Mounted only while open: every opening starts empty, nothing to clear afterwards.
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

function Palette({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const era = useEra();
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
    return [...places, ...items];
  }, [era.views, t]);

  const results = useMemo(() => {
    const words = normalizeText(q).split(' ').filter(Boolean);
    const hit = words.length ? all.filter((e) => words.every((w) => e.words.includes(w))) : all.filter((e) => e.key.startsWith('p:'));
    return hit.slice(0, 12);
  }, [all, q]);

  const choose = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    go(e.href);
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
