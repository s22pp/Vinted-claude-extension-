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

/**
 * In the stock's selection bar: every photo of the ticked articles, in one dated folder with « articles.txt » —
 * ready to drop into ChatGPT (ERA sends nothing anywhere itself).
 */
export function PhotosForChatGpt({ itemIds }: { itemIds: readonly string[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = (await browser.runtime.sendMessage({ type: 'era:photos:export', scope: 'SELECTED', itemIds: [...itemIds] } satisfies EraMessage)) as PhotoExportResult;
      toast(r.stopped || r.missing ? 'warning' : 'success', t('photos.chatgptDone', { n: r.photos, k: r.listings }), r.stopped ?? (r.missing ? t('photos.missing', { n: r.missing }) : t('photos.chatgptHint')));
    } catch (e) {
      toast('error', t('photos.chatgptFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" icon="download" loading={busy} onClick={() => void run()} data-testid="photos-chatgpt">
      {t('photos.chatgpt', { n: itemIds.length })}
    </Button>
  );
}
