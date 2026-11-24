import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from './primitives';

/**
 * « Actions ••• »: the less frequent actions of a screen behind one button (a disclosure, keyboard first). The actions
 * stay mounted while it is closed — a dialog one of them opened keeps its state — and the list closes as soon as one
 * is chosen, on Escape (focus back on the button) or on a click outside.
 */
export function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    box.current?.querySelector<HTMLButtonElement>('.more-menu__list button:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="more-menu" ref={box}>
      <Button ref={trigger} icon="dots" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label}
      </Button>
      <div
        id={id}
        className="more-menu__list"
        hidden={!open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
