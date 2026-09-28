import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { type Backup, exportBackup, parseBackup, restoreBackup } from '@/data/backup';
import { db } from '@/data/db';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { downloadText } from '@/lib/download';
import { Modal, useToast } from '@/ui/components/overlays';
import { Button, Card, Select } from '@/ui/components/primitives';
import { AUTO_BACKUP_DEFAULTS, AUTO_BACKUP_KEY, type AutoBackupConfig, type AutoBackupResult } from '@/data/auto-backup';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import { type CsvLabels, allSalesCsv, itemsCsv } from '@/intelligence/accounting';
import { useEra } from '../state';
import { PhotoExport } from './photo-export';

export { LAST_BACKUP_KEY } from '@/data/auto-backup';
import { LAST_BACKUP_KEY } from '@/data/auto-backup';
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
  const day = new Date(era.now).toISOString().slice(0, 10);
  const labels: CsvLabels = { category: (c) => t(`category.${c}`), condition: (c) => t(`condition.${c}`), status: (s) => t(`status.${s}`), refund: (r) => t(`refunds.r.${r}`) };

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
        <AutoBackupSettings />
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon="sales" onClick={() => downloadText(`era-ventes-${day}.csv`, allSalesCsv(era.sales, labels))} disabled={!era.sales.length}>
            {t('backup.salesCsv', { n: era.sales.length })}
          </Button>
          <Button size="sm" variant="ghost" icon="stock" onClick={() => downloadText(`era-articles-${day}.csv`, itemsCsv(era.views, labels))} disabled={!era.views.length}>
            {t('backup.itemsCsv', { n: era.views.length })}
          </Button>
        </div>
        <PhotoExport />
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

/** Automatic copy, every day or every week, into Téléchargements/ERA-sauvegardes. Off until switched on. */
function AutoBackupSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const era = useEra();
  const stored = useLiveQuery(() => repo.getSetting<Partial<AutoBackupConfig> | null>(AUTO_BACKUP_KEY, null), []);
  // The box follows the click at once; the stored copy follows.
  const [local, setLocal] = useState<AutoBackupConfig | null>(null);
  if (stored === undefined) return null;
  const cfg: AutoBackupConfig = local ?? { ...AUTO_BACKUP_DEFAULTS, ...stored };
  const save = async (patch: Partial<AutoBackupConfig>) => {
    const next = { ...cfg, ...patch };
    setLocal(next);
    await repo.setSetting(AUTO_BACKUP_KEY, next);
    const r = (await browser.runtime.sendMessage({ type: 'era:backup:schedule' } satisfies EraMessage).catch(() => null)) as AutoBackupResult | null;
    if (r?.ok) toast('success', t('backup.autoSaved'), r.file);
    else if (r && r.reason === 'FAILED') toast('error', t('backup.autoFailed'), r.detail ?? '');
  };
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="auto-backup">
      <label htmlFor="ab-on" className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input id="ab-on" type="checkbox" className="checkbox" checked={cfg.enabled} onChange={(e) => void save({ enabled: e.target.checked })} style={{ marginTop: 2 }} />
        <span>
          <span style={{ fontWeight: 600 }}>{t('backup.auto')}</span>
          <span className="t-small t-faint" style={{ display: 'block' }}>
            {era.mode === 'real' ? t('backup.autoHint') : t('backup.autoDemo')}
          </span>
        </span>
      </label>
      {cfg.enabled && (
        <div style={{ paddingLeft: 28 }}>
          <Select
            aria-label={t('backup.autoEvery')}
            value={String(cfg.everyDays)}
            onChange={(e) => void save({ everyDays: Number(e.target.value) === 1 ? 1 : 7 })}
            options={[
              { value: '1', label: t('backup.daily') },
              { value: '7', label: t('backup.weekly') },
            ]}
          />
        </div>
      )}
    </div>
  );
}
