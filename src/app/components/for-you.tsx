import { useLiveQuery } from 'dexie-react-hooks';
import { DropOffShortcut } from './drop-off';
import { db } from '@/data/db';
import { REPLIES_PENDING_KEY } from '@/data/reply-agent';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import type { PendingReply } from '@/intelligence/buyer-messages';
import { parcelStage } from '@/intelligence/parcels';
import { Button } from '@/ui/components/primitives';
import { go, useEra } from '../state';

type TaskKey = 'ship' | 'collect' | 'photos' | 'messages';
const ROUTE: Record<TaskKey, string> = { ship: 'parcels', collect: 'parcels', photos: 'workshop', messages: 'automations' };

/**
 * « Pour vous » (ERA Midnight, PDF p. 4): what is left for the seller — the physical part, and the messages ERA left
 * for them — the most pressing first, large, with the one button that does it; the rest below. Counted from ERA's
 * data only (no Vinted call). Nothing left: said in one line.
 */
export function ForYou() {
  const { t } = useI18n();
  const era = useEra();
  const pending = useLiveQuery(() => repo.getSetting<PendingReply[]>(REPLIES_PENDING_KEY, []), []);
  const toCollect = useLiveQuery(async () => (await db.purchases.toArray()).filter((p) => !p.dismissed && parcelStage(p.status) === 'AT_PICKUP').length, []) ?? 0;
  const tasks: { key: TaskKey; n: number }[] = [
    { key: 'ship', n: era.sales.filter((s) => s.sale.needsAction && s.sale.status !== 'REFUNDED').length },
    { key: 'collect', n: toCollect },
    { key: 'photos', n: era.workshop.toList.length },
    { key: 'messages', n: pending?.length ?? 0 },
  ];
  const open = tasks.filter((x) => x.n > 0);
  const [top, ...rest] = open;
  return (
    <section className="card for-you" aria-labelledby="for-you-title" data-testid="for-you">
      <h2 className="for-you__title" id="for-you-title">
        {t('forYou.title')}
      </h2>
      <div data-testid="day-physical" className="for-you__body">
        {top ? (
          <>
            <p className="for-you__big">
              <span className="num">{top.n}</span> {t(`day.task.${top.key}`, { n: top.n })}
            </p>
            <p className="for-you__hint">{t(`forYou.hint.${top.key}`, { n: top.n })}</p>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" onClick={() => go(ROUTE[top.key])}>
                {t(`forYou.cta.${top.key}`)}
              </Button>
              {top.key === 'ship' && <DropOffShortcut />}
            </div>
            {rest.length > 0 && (
              <ul className="for-you__rest">
                {rest.map((x) => (
                  <li key={x.key}>
                    <button type="button" className="for-you__more" onClick={() => go(ROUTE[x.key])}>
                      <span className="num">{x.n}</span> {t(`day.task.${x.key}`, { n: x.n })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="for-you__hint">{t('forYou.nothing')}</p>
        )}
      </div>
    </section>
  );
}
