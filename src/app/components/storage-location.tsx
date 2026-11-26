import { useEffect, useRef, useState } from 'react';
import { STORAGE_MAX } from '@/domain/entities';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';

/** « [ BAC A ] »: where the piece waits at home, in the machine voice — read at a glance when it sells. */
export function LocationBadge({ value }: { value: string | null | undefined }) {
  const { t } = useI18n();
  if (!value?.trim()) return null;
  return (
    <span className="loc-badge" title={t('storage.where')} data-testid="loc-badge">
      [ {value.trim().toUpperCase()} ]
    </span>
  );
}

/**
 * The storage place, edited where it is shown: a click turns it into a field (focused), Entrée saves with a brief
 * emerald flash, Échap cancels. None yet: « + Emplacement », never a passive « inconnu ».
 */
export function InlineLocation({ itemId, value, disabled = false }: { itemId: string; value: string | null | undefined; disabled?: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value ?? ''), [value]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 300);
    return () => clearTimeout(id);
  }, [flash]);

  if (editing)
    return (
      <form
        className="loc-edit"
        onSubmit={async (e) => {
          e.preventDefault();
          await repo.setStorageLocation(itemId, draft);
          setEditing(false);
          setFlash(true);
        }}
      >
        <input
          ref={input}
          autoFocus
          className="loc-edit__input"
          value={draft}
          maxLength={STORAGE_MAX}
          aria-label={t('storage.label')}
          placeholder={t('storage.ph')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(value ?? '');
              setEditing(false);
            }
          }}
          onBlur={() => {
            setDraft(value ?? '');
            setEditing(false);
          }}
        />
      </form>
    );
  return (
    <button type="button" className={`loc-btn${flash ? ' is-saved' : ''}`} disabled={disabled} onClick={() => setEditing(true)} data-testid="loc-btn" aria-label={value ? t('storage.edit', { where: value }) : t('storage.add')}>
      {value ? <LocationBadge value={value} /> : <span className="fill-costs">{t('storage.add')}</span>}
    </button>
  );
}
