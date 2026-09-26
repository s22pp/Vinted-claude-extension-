import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { type Backup, exportBackup, parseBackup, restoreBackup } from '@/data/backup';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { downloadText } from '@/lib/download';
import { Modal, useToast } from '@/ui/components/overlays';
import { Button, Card } from '@/ui/components/primitives';
import { useEra } from '../state';

export const LAST_BACKUP_KEY = 'lastBackupAt';
/** Past this, the daily run reminds the seller to save a copy. */
export const BACKUP_REMIND_DAYS = 14;

/** Download a full copy of ERA's data; restore one (replaces everything, after confirmation). */
export function BackupCard() {
  const { t, date, relative } = useI18n();
  const era = useEra();
  const toast = useToast();
  const last = useLiveQuery(() => repo.getSetting<number | null>(LAST_BACKUP_KEY, null), []);
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const now = Date.now();
    const b = await exportBackup(db, browser.runtime.getManifest().version, now);
    downloadText(`era-sauvegarde-${new Date(now).toISOString().slice(0, 10)}.json`, JSON.stringify(b), 'application/json');
    await repo.setSetting(LAST_BACKUP_KEY, now);
    toast('success', t('backup.saved'), t('backup.savedHint', { n: b.counts.items ?? 0 }));
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const r = parseBackup(await f.text());
    if (file.current) file.current.value = '';
    if (!r.ok) return toast('error', t('backup.invalid'), t(`backup.why.${r.reason}`));
    setPending(r.backup);
  };
  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const n = await restoreBackup(db, pending);
      setPending(null);
      toast('success', t('backup.restored'), t('backup.restoredHint', { n }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('backup.title')} hint={t('backup.hint')} icon="download" tone="emerald">
      <div className="stack-3" data-testid="backup">
        <p className={`t-small ${last && era.now - last < BACKUP_REMIND_DAYS * 86_400_000 ? 't-muted' : 't-warn'}`}>{last ? t('backup.last', { when: relative(last, era.now) }) : t('backup.never')}</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="primary" icon="download" onClick={save}>
            {t('backup.download')}
          </Button>
          <Button icon="upload" onClick={() => file.current?.click()}>
            {t('backup.restore')}
          </Button>
          <input ref={file} type="file" accept="application/json,.json" hidden aria-label={t('backup.restore')} onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      </div>
      <Modal open={!!pending} onClose={() => !busy && setPending(null)} title={t('backup.confirmTitle')}>
        {pending && (
          <>
            <p className="t-small">{t('backup.confirmBody', { date: date(pending.at), items: pending.counts.items ?? 0, sales: pending.counts.sales ?? 0 })}</p>
            <p className="t-small t-warn">{t('backup.confirmWarn')}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" icon="check" loading={busy} onClick={restore}>
                {t('backup.confirmGo')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Card>
  );
}
