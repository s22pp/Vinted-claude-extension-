import { useLiveQuery } from 'dexie-react-hooks';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { PROFILE_KEY, identity, validProfile } from '@/intelligence/profile';

/**
 * The account's identity, the same everywhere (sidebar, popup, side panel): the seller's Vinted avatar in a 32 px square
 * and their login in serif, over « ● COMPTE SYNCHRONISÉ » — before the first import, ERA's serif E, « ERA » and
 * « ● EN ATTENTE D'IMPORT ». Read from this device only.
 */
export function AccountIdentity({ className = '', href = '#/today', onClick }: { className?: string; href?: string; onClick?: (e: React.MouseEvent) => void }) {
  const { t } = useI18n();
  const stored = useLiveQuery(async () => validProfile(await repo.getSetting<unknown>(PROFILE_KEY, null)), []);
  const id = identity(stored ?? null);
  return (
    <a className={`side-id ${className}`.trim()} href={href} onClick={onClick} aria-label={t('app.fullName')} data-testid="side-id" data-synced={id.synced}>
      {id.avatar ? <img className="side-id__avatar" src={id.avatar} alt="" width={32} height={32} /> : <span className="side-id__avatar side-id__avatar--mark" aria-hidden="true">E</span>}
      <span className="side-id__text">
        <span className="side-id__name">{id.name}</span>
        <span className={`side-id__status ${id.synced ? 'is-synced' : 'is-waiting'}`}>
          <span aria-hidden="true">●</span> {t(id.synced ? 'side.synced' : 'side.waiting')}
        </span>
      </span>
    </a>
  );
}
