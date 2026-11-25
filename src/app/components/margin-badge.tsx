import { useI18n } from '@/i18n';

/** From this estimated margin, a listing is flagged as an opportunity. */
export const OPPORTUNITY_CENTS = 1000;

/**
 * « Marge est. +32 € (Opportunité) »: what a listing would leave the seller, from what this niche really cashes in for
 * them (their sales), minus the all-in cost (price + buyer protection). An estimate, said as one; emerald when worth it.
 */
export function MarginBadge({ cents }: { cents: number }) {
  const { t, money } = useI18n();
  const tone = cents >= OPPORTUNITY_CENTS ? 'is-opportunity' : cents > 0 ? 'is-thin' : 'is-loss';
  return (
    <span className={`margin-badge ${tone}`} data-testid="margin-badge" title={t('marginBadge.hint')}>
      <span aria-hidden="true">●</span> {t('marginBadge.label', { margin: money(cents, { sign: true }) })}
      {cents >= OPPORTUNITY_CENTS && ` ${t('marginBadge.opportunity')}`}
    </span>
  );
}
