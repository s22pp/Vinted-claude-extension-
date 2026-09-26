import { useI18n } from '@/i18n';
import type { TodayPriority } from '@/intelligence/decision';
import { type IconName, IconTile, type TileTone } from '@/ui/components/icons';
import { go } from '../state';

export const PRIO: Record<TodayPriority['code'], { icon: IconName; tone: TileTone }> = {
  RESERVED: { icon: 'check', tone: 'emerald' },
  MISSING_SALE: { icon: 'sales', tone: 'amber' },
  STAGNANT: { icon: 'hourglass', tone: 'coral' },
  OVERPRICED: { icon: 'price', tone: 'amber' },
  TRAPS: { icon: 'trap', tone: 'coral' },
  CAPITAL_AGED: { icon: 'capital', tone: 'amber' },
  MISSING_COST: { icon: 'edit', tone: 'cyan' },
  MISSING_SHIPPING: { icon: 'box', tone: 'cyan' },
  NO_ANALYSIS: { icon: 'market', tone: 'cobalt' },
  NICHE: { icon: 'trendUp', tone: 'emerald' },
  TO_LIST: { icon: 'upload', tone: 'violet' },
  REFUND_REASON: { icon: 'alert', tone: 'coral' },
  NEW_FAVORITES: { icon: 'heart', tone: 'pink' },
  ORDERS_TO_HANDLE: { icon: 'box', tone: 'coral' },
};

/** Vinted's own orders page (the address the seller uses): orders are handled there, never by ERA. */
export const VINTED_ORDERS_URL = 'https://www.vinted.fr/my_orders';

/** Every priority opens exactly the items it counts. */
export const priorityHref = (p: TodayPriority) =>
  p.code === 'TO_LIST' ? 'workshop' : p.code === 'REFUND_REASON' ? 'sales?refunds=1' : p.code === 'ORDERS_TO_HANDLE' ? 'sales?ship=1' : p.code === 'MISSING_COST' ? 'stock?costs=1' : `stock?focus=${p.code}`;

export function usePriorityTitle() {
  const { t } = useI18n();
  return (p: TodayPriority) =>
    p.code === 'CAPITAL_AGED'
      ? t('today.P_CAPITAL_AGED', { amount: p.amount && p.amount.status !== 'unknown' ? p.amount.value : null, n: p.count })
      : p.code === 'NEW_FAVORITES'
        ? t('today.P_NEW_FAVORITES', { n: p.count, k: p.itemIds.length })
      : p.code === 'TO_LIST' && p.amount && p.amount.status !== 'unknown' && p.amount.value > 0
        ? t('today.P_TO_LIST_amount', { n: p.count, amount: p.amount.value })
      : p.code === 'NICHE'
        ? t('today.P_NICHE', { label: p.label ?? '' })
        : t(`today.P_${p.code}`, { n: p.count });
}

export function PriorityList({ priorities }: { priorities: TodayPriority[] }) {
  const { t } = useI18n();
  const title = usePriorityTitle();
  return (
    <div className="prio">
      {priorities.map((p, idx) => {
        const cfg = PRIO[p.code];
        return (
          <button
            key={p.code}
            type="button"
            className={`prio__item prio__item--${p.tone}`}
            style={{ animationDelay: `${idx * 55}ms` }}
            onClick={() => go(priorityHref(p))}
          >
            <IconTile name={cfg.icon} tone={cfg.tone} />
            <span className="prio__body">
              <span className="prio__title">{title(p)}</span>
              <span className="prio__hint">{t(`today.P_${p.code}_hint`)}</span>
            </span>
            <span className="prio__go" aria-hidden="true">
              {p.itemIds.length > 0 ? <span className="num">{p.itemIds.length}</span> : null} →
            </span>
          </button>
        );
      })}
    </div>
  );
}
