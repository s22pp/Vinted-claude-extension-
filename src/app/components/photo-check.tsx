import { useState } from 'react';
import { useI18n } from '@/i18n';
import { type PhotoReport, SHOT_CHECKLIST, analyzePhoto } from '@/intelligence/photo';
import { Ring } from '@/ui/charts/charts';
import { Badge } from '@/ui/components/primitives';

async function analyzeFile(f: File): Promise<{ url: string; name: string; report: PhotoReport }> {
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { url: URL.createObjectURL(f), name: f.name, report: analyzePhoto(img, Math.min(bmp.width, bmp.height)) };
}

/** Local only: photos are read in the browser, never uploaded, never modified. */
export function PhotoCheck() {
  const { t } = useI18n();
  const [results, setResults] = useState<Awaited<ReturnType<typeof analyzeFile>>[]>([]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    const out = [];
    for (const f of [...files].filter((x) => x.type.startsWith('image/')).slice(0, 20)) out.push(await analyzeFile(f));
    setResults(out);
    setBusy(false);
  };
  return (
    <div className="stack-3">
      <p className="t-small t-muted">{t('photo.intro')}</p>
      <label
        className="choice"
        style={{ justifyContent: 'center', padding: 20, borderStyle: 'dashed' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFiles(e.dataTransfer.files);
        }}
      >
        <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void onFiles(e.target.files)} />
        <span className="btn btn--primary">{busy ? t('common.loading') : t('photo.pick')}</span>
      </label>
      {results.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {results.map((r) => (
            <figure key={r.url} className="strategy" style={{ margin: 0, padding: 8 }}>
              <img src={r.url} alt={r.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 8, display: 'block' }} />
              <figcaption className="stack" style={{ gap: 4, marginTop: 6 }}>
                <span className="row-between">
                  <Badge tone={r.report.verdict === 'OK' ? 'emerald' : r.report.verdict === 'IMPROVE' ? 'amber' : 'coral'}>{t(`photo.verdict.${r.report.verdict}`)}</Badge>
                  <Ring value={r.report.score} max={100} size={34} stroke={4}>
                    <span className="num" style={{ fontSize: 10, fontWeight: 700 }}>
                      {r.report.score}
                    </span>
                  </Ring>
                </span>
                {r.report.issues.map((i) => (
                  <span key={i} className="t-small t-muted">
                    · {t(`photo.issue.${i}`)}
                  </span>
                ))}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div>
        <div className="t-caption" style={{ marginBottom: 6 }}>
          {t('photo.checklist')}
        </div>
        <div className="stack" style={{ gap: 4 }}>
          {SHOT_CHECKLIST.map((k) => (
            <label key={k} className="row t-small" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={checked.has(k)}
                onChange={() =>
                  setChecked((s) => {
                    const n = new Set(s);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
              />
              {t(`photo.shot.${k}`)}
            </label>
          ))}
        </div>
      </div>
      <p className="t-small t-faint">{t('photo.noAi')}</p>
    </div>
  );
}
