import { type ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { errorInfo } from '@/data/adapters/marketplace';
import { useI18n } from '@/i18n';
import { Icon, type IconName } from './icons';

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close]), [tabindex="0"]') ?? el;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]')];
        if (f.length === 0) return;
        const a = f[0]!;
        const z = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useFocusTrap(open, onClose);
  const id = useId();
  const { t } = useI18n();
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="drawer__head">
          <h2 className="t-h2 grow" id={id}>
            {title}
          </h2>
          <button className="icon-btn" data-close type="button" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__foot">{footer}</div>}
      </div>
    </>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useFocusTrap(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <>
      <div className="scrim" style={{ zIndex: 'var(--z-modal)' as unknown as number }} onClick={onClose} aria-hidden="true" />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div style={{ padding: 'var(--s-6)' }} className="stack-4">
          <h2 className="t-h2" id={id}>
            {title}
          </h2>
          {children}
        </div>
      </div>
    </>
  );
}

type ToastKind = 'success' | 'info' | 'warning' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  leaving?: boolean;
}

const ToastCtx = createContext<(kind: ToastKind, title: string, body?: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

/** Error toast that always carries the technical cause, so it can be reported and fixed. */
export function useErrorToast() {
  const toast = useContext(ToastCtx);
  const { t } = useI18n();
  return (e: unknown) => {
    const { code, detail } = errorInfo(e);
    toast('error', t(`errors.${code}`), `${t(`errors.hint.${code}`)} — ${detail ?? t('errors.noDetail')}`);
  };
}

const TOAST_ICON: Record<ToastKind, IconName> = { success: 'check', info: 'info', warning: 'alert', error: 'alert' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { id, kind, title, body }]);
    setTimeout(() => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 3800);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4100);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={`toast toast--${x.kind} ${x.leaving ? 'toast--leaving' : ''}`}>
            <span className="toast__icon">
              <Icon name={TOAST_ICON[x.kind]} size={17} strokeWidth={2} />
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>{x.title}</div>
              {x.body && <div className="t-small t-muted">{x.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
