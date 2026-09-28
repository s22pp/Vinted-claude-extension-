import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { type AuditListing, PHOTO_AUDIT_KEY, type PhotoAuditCache, auditPhotos, photoAuditSummary, photosToRead } from '@/data/photo-audit';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { analyzeImageBlob } from '@/lib/photo-pixels';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Card } from '@/ui/components/primitives';
import { useEra } from '../state';

/**
 * Every photo of the live listings, scored in the browser from Vinted's image servers: which ones to retake and
 * why. Nothing is modified, generated or sent: ERA says what to reshoot, the seller reshoots.
 */
export function PhotoAuditCard() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const cache = useLiveQuery(() => repo.getSetting<PhotoAuditCache>(PHOTO_AUDIT_KEY, {}), []);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const listings: AuditListing[] = useMemo(
    () =>
      era.views
        .filter((v) => v.inStock && v.current?.status === 'ACTIVE' && (v.current.photoUrls?.length ?? 0) > 0)
        .map((v) => ({ itemId: v.item.id, title: v.item.title, url: v.current!.url, photoUrls: v.current!.photoUrls! })),
    [era.views],
  );
  const summary = useMemo(() => (cache ? photoAuditSummary(listings, cache) : []), [listings, cache]);
  const toRead = useMemo(() => (cache ? photosToRead(listings, cache) : []), [listings, cache]);
  if (era.mode !== 'real' || cache === undefined) return null;

  const run = async () => {
    setProgress({ done: 0, total: toRead.length });
    try {
      const r = await auditPhotos(toRead, cache, analyzeImageBlob, (done, total) => setProgress({ done, total }));
      await repo.setSetting(PHOTO_AUDIT_KEY, r.cache);
      toast(r.failed ? 'warning' : 'success', t('paudit.done', { n: r.read }), r.failed ? t('paudit.failed', { n: r.failed }) : undefined);
    } finally {
      setProgress(null);
    }
  };
  const flagged = summary.filter((s) => s.retake.length || s.improve.length);
  const photos = summary.reduce((a, s) => a + s.photos, 0);
  const read = summary.reduce((a, s) => a + s.read, 0);

  return (
    <Card title={t('paudit.title')} hint={t('paudit.hint')} icon="eye" tone="cyan">
      <div className="stack-3" data-testid="photo-audit">
        {listings.length === 0 ? (
          <p className="t-small t-muted">{t('paudit.none')}</p>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
              <span className="t-small t-muted">{t('paudit.status', { read, photos, n: summary.length })}</span>
              {toRead.length > 0 && (
                <Button size="sm" variant="primary" icon="eye" loading={!!progress} onClick={() => void run()}>
                  {progress ? t('paudit.progress', { done: progress.done, total: progress.total }) : t('paudit.run', { n: toRead.length })}
                </Button>
              )}
            </div>
            {read > 0 && flagged.length === 0 && <p className="t-small">{t('paudit.allGood')}</p>}
            {flagged.slice(0, 12).map((s) => (
              <div key={s.itemId} className="stack" style={{ gap: 6 }}>
                <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <a href={`#/item/${s.itemId}`} style={{ fontWeight: 600 }} className="clamp-1">
                    {s.title}
                  </a>
                  {s.retake.length > 0 && <Badge tone="coral">{t('paudit.retake', { n: s.retake.length })}</Badge>}
                  {s.improve.length > 0 && <Badge tone="amber">{t('paudit.improve', { n: s.improve.length })}</Badge>}
                  {s.url && (
                    <a className="t-small" href={s.url} target="_blank" rel="noopener noreferrer">
                      {t('paudit.open')}
                    </a>
                  )}
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {[...s.retake.map((p) => ({ ...p, v: 'RETAKE' as const })), ...s.improve.map((p) => ({ ...p, v: 'IMPROVE' as const }))].map((p) => (
                    <figure key={p.url} style={{ margin: 0, width: 96 }} title={p.issues.map((i) => t(`photo.issue.${i}`)).join('\n')}>
                      <img src={p.url} alt="" loading="lazy" style={{ width: 96, height: 128, objectFit: 'cover', borderRadius: 8, display: 'block', outline: `2px solid ${p.v === 'RETAKE' ? 'var(--coral)' : 'var(--amber)'}` }} />
                      <figcaption className="t-small t-muted" style={{ marginTop: 4 }}>
                        {p.issues.map((i) => t(`paudit.short.${i}`)).join(' · ')}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
        <p className="t-small t-faint">{t('photo.noAi')}</p>
      </div>
    </Card>
  );
}
