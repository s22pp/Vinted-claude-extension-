import { useLiveQuery } from 'dexie-react-hooks';
import { type AutoLogRow, db } from '@/data/db';
import { isVerified } from '@/data/journal';
import { useI18n } from '@/i18n';
import { Badge, Flag } from '@/ui/components/primitives';

/**
 * EXPERIMENTAL next to a Vinted write until the journal shows each of its routes accepted AND shown back by Vinted
 * on this device; then "Vérifié ici". Simulations and sends Vinted did not show back never count.
 */
export function RouteFlag({ kinds }: { kinds: AutoLogRow['kind'][] }) {
  const { t } = useI18n();
  const verified = useLiveQuery(
    async () => {
      const ok = await db.autoLog.filter((r) => isVerified(r) && kinds.includes(r.kind)).toArray();
      return kinds.every((k) => ok.some((r) => r.kind === k));
    },
    [kinds.join()],
  );
  if (!verified) return <Flag kind="EXPERIMENTAL" />;
  return (
    <Badge tone="emerald" dot title={t('integrations.verifiedHint')}>
      {t('integrations.verifiedShort')}
    </Badge>
  );
}
