import { useState } from 'react';
import { useI18n } from '@/i18n';
import { Button } from '@/ui/components/primitives';
import { CostsDrawer } from './costs';

/**
 * « + Renseigner (n) »: where a figure is unknown for want of purchase prices, the way to fill them in at once — the
 * « Coûts manquants » drawer (sold articles first, the matching Vinted purchase offered when ERA finds one).
 */
export function FillCostsLink({ n }: { n: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fill-costs num" onClick={() => setOpen(true)} data-testid="fill-costs">
        {t('costs.fill', { n })}
      </button>
      <CostsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** A figure unknown for want of purchase prices: the dash, then the way to fill them in (never « 0 »). */
export function UnknownCost({ n }: { n: number }) {
  return (
    <span className="unknown unknown--fill">
      <span aria-hidden="true">—</span>
      {n > 0 && <FillCostsLink n={n} />}
    </span>
  );
}

/** The banner's button: the same drawer, from a full-size button. */
export function MissingCostsButton({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        {children}
      </Button>
      <CostsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
