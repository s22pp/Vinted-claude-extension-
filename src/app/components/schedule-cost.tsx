import { useLiveQuery } from 'dexie-react-hooks';
import { AUTO_FLOOR, SESSION_CALLS, scheduleCost } from '@/data/budget-plan';
import { BUY_ALERTS_KEY } from '@/data/buy-alerts';
import { REFRESH_DEFAULTS, REFRESH_KEY, type RefreshConfig } from '@/data/refresh';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { type AutoConfig, withDefaults } from '@/intelligence/automation';

/**
 * What the schedules spend by themselves at the least, and how long the session budget lasts at that pace before they
 * stop short of the reserve kept for the seller's clicks. `auto`: the automations as being edited (else as saved).
 */
export function ScheduleCost({ auto }: { auto?: Pick<AutoConfig, 'enabled' | 'everyMinutes' | 'fav' | 'offers'> }) {
  const { t } = useI18n();
  const saved = useLiveQuery(async () => ({
    auto: withDefaults(await repo.getSetting<Parameters<typeof withDefaults>[0]>('automations', null)),
    refresh: { ...REFRESH_DEFAULTS, ...(await repo.getSetting<Partial<RefreshConfig> | null>(REFRESH_KEY, null)) },
    alerts: !!(await repo.getSetting<{ enabled?: boolean } | null>(BUY_ALERTS_KEY, null))?.enabled,
  }));
  if (!saved) return null;
  const a = auto ?? saved.auto;
  const cost = scheduleCost({
    autoEveryMinutes: a.enabled ? a.everyMinutes : null,
    fav: a.fav.enabled,
    offers: a.offers.enabled,
    refreshEveryHours: saved.refresh.enabled ? saved.refresh.everyHours : null,
    alerts: saved.alerts,
  });
  if (cost.hoursToReserve === null) return null;
  return (
    <p className="t-small t-muted" data-testid="schedule-cost">
      {t('budgetPlan.cost', { perHour: cost.perHour, hours: cost.hoursToReserve, reserve: AUTO_FLOOR, total: SESSION_CALLS })}
    </p>
  );
}
