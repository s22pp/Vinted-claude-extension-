import { useEffect, useState } from 'react';
import type { EraMessage } from '@/data/adapters/vinted/protocol';
import type { PhotoExportResult, PhotoScope } from '@/data/photo-export';
import { useI18n } from '@/i18n';
import { useToast } from '@/ui/components/overlays';
import { Button, Segmented } from '@/ui/components/primitives';
import { useEra } from '../state';

/** "Télécharger toutes mes photos": one folder per listing in Downloads/ERA-photos. */
export function PhotoExport() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const [scope, setScope] = useState<PhotoScope>('LIVE');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<PhotoExportResult | null>(null);
  useEffect(() => {
    const on = (msg: EraMessage) => {
      if (msg.type === 'era:photos:progress') setProgress({ done: msg.done, total: msg.total });
    };
    browser.runtime.onMessage.addListener(on);
    return () => browser.runtime.onMessage.removeListener(on);
  }, []);
  if (era.mode !== 'real') return null;
  const run = async () => {
    setResult(null);
    setProgress({ done: 0, total: 0 });
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:photos:export', scope } satisfies EraMessage)) as PhotoExportResult;
      setResult(r);
      toast(r.stopped ? 'warning' : 'success', t('photos.done', { n: r.photos, k: r.listings }), r.stopped ?? undefined);
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }} data-testid="photo-export">
      <span style={{ fontWeight: 600 }}>{t('photos.title')}</span>
      <span className="t-small t-muted">{t('photos.hint')}</span>
      <div className="row wrap" style={{ gap: 10 }}>
        <Segmented<PhotoScope> label={t('photos.title')} value={scope} onChange={setScope} options={[{ value: 'LIVE', label: t('photos.live') }, { value: 'ALL', label: t('photos.all') }]} />
        <Button icon="download" loading={progress !== null} onClick={run}>
          {progress && progress.total ? t('photos.progress', { done: progress.done, total: progress.total }) : t('photos.go')}
        </Button>
      </div>
      {result && (
        <p className="t-small" data-testid="photo-result">
          {t('photos.result', { n: result.photos, k: result.listings })}
          {result.missing > 0 ? ` ${t('photos.missing', { n: result.missing })}` : ''}
          {result.stopped ? ` ${t('photos.stopped', { why: result.stopped })}` : ''}
        </p>
      )}
    </div>
  );
}
