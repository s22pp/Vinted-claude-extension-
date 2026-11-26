import { useEffect, useRef, useState } from 'react';
import { saveFile } from '@/data/downloads';
import { useI18n } from '@/i18n';
import { skuOf } from '@/intelligence/listing';
import type { PhotoReport } from '@/intelligence/photo';
import { type CropRect, cropRect, dragOffset, exportName, exportSize } from '@/intelligence/photo-crop';
import { analyzeImageBlob } from '@/lib/photo-pixels';
import { useToast } from '@/ui/components/overlays';
import { Badge, Button, Field, Input, Segmented, Select } from '@/ui/components/primitives';
import { useEra } from '../state';

interface Shot {
  id: string;
  name: string;
  url: string;
  w: number;
  h: number;
  offset: { x: number; y: number };
  report: PhotoReport | null;
}

const PREVIEW_W = 168;
const MAX_PHOTOS = 20;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((done, fail) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => fail(new Error('image illisible'));
    img.src = url;
  });

/**
 * Outils → Studio photo, 100 % in the browser: photos dropped in, each cut to 3:4 (Vinted's frame, the frame moved
 * with the mouse or the arrow keys), scaled down to 1600 px, compressed (JPEG or WebP), named after the article, and
 * downloaded together. No pixel is retouched — no light, contrast, sharpening or colour correction: Vinted asks for
 * the article as it is, and a photo that flatters it is a refund waiting. ERA says which photo to retake instead.
 */
export function PhotoStudio() {
  const { t } = useI18n();
  const era = useEra();
  const toast = useToast();
  const [shots, setShots] = useState<Shot[]>([]);
  const [format, setFormat] = useState<'jpg' | 'webp'>('jpg');
  const [itemId, setItemId] = useState('');
  const [base, setBase] = useState('photo');
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const stock = era.views.filter((v) => v.inStock);

  const add = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - shots.length);
    for (const f of list) {
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      try {
        const img = await loadImage(url);
        const shot: Shot = { id: `${f.name}-${url.slice(-8)}`, name: f.name, url, w: img.naturalWidth, h: img.naturalHeight, offset: { x: 0, y: 0 }, report: null };
        setShots((s) => [...s, shot]);
        // The quality note comes after: reading the pixels never holds the photo back.
        void analyzeImageBlob(f)
          .then((report) => setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, report } : x))))
          .catch(() => undefined);
      } catch {
        toast('error', t('studio.unreadable', { name: f.name }));
      }
    }
  };

  const move = (id: string, offset: { x: number; y: number }) => setShots((s) => s.map((x) => (x.id === id ? { ...x, offset } : x)));

  const exportAll = async () => {
    setBusy({ done: 0, total: shots.length });
    let saved = 0;
    const failed: string[] = [];
    for (const [i, s] of shots.entries()) {
      try {
        const img = await loadImage(s.url);
        const r = cropRect(s.w, s.h, s.offset.x, s.offset.y);
        const size = exportSize(r.sw, r.sh);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        // The frame only, scaled: the pixels themselves are not touched (no filter, no adjustment).
        ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, size.width, size.height);
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, format === 'webp' ? 'image/webp' : 'image/jpeg', format === 'webp' ? 0.82 : 0.86));
        if (!blob) throw new Error('compression impossible');
        const url = URL.createObjectURL(blob);
        const res = await saveFile(url, `ERA Studio/${exportName(base, i, format)}`);
        URL.revokeObjectURL(url);
        if (res.ok) saved++;
        else failed.push(`${s.name} : ${res.detail}`);
      } catch (e) {
        failed.push(`${s.name} : ${e instanceof Error ? e.message : String(e)}`);
      }
      setBusy({ done: i + 1, total: shots.length });
    }
    setBusy(null);
    if (failed.length) toast('error', t('studio.someFailed', { n: failed.length }), failed.join(' · '));
    else toast('success', t('studio.saved', { n: saved }), t('studio.savedWhere'));
  };

  return (
    <div className="stack-3" data-testid="photo-studio">
      <p className="t-small t-muted">{t('studio.intro')}</p>
      <label
        className="choice studio__drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void add(e.dataTransfer.files);
        }}
      >
        <input type="file" accept="image/*" multiple className="sr-only" aria-label={t('studio.pick')} onChange={(e) => void add(e.target.files)} data-testid="studio-input" />
        <span className="btn btn--primary">{t('studio.pick')}</span>
        <span className="t-small t-faint">{t('studio.drop', { n: MAX_PHOTOS })}</span>
      </label>
      {shots.length > 0 && (
        <>
          <div className="studio__grid">
            {shots.map((s, i) => (
              <StudioShot key={s.id} shot={s} index={i} onMove={(o) => move(s.id, o)} onRemove={() => setShots((all) => all.filter((x) => x.id !== s.id))} />
            ))}
          </div>
          <div className="studio__bar">
            <Field label={t('studio.item')} htmlFor="studio-item">
              <Select
                id="studio-item"
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value);
                  const v = era.viewById.get(e.target.value);
                  setBase(v ? `${skuOf(v.item.id)} ${v.item.title}` : 'photo');
                }}
                options={[{ value: '', label: t('studio.noItem') }, ...stock.map((v) => ({ value: v.item.id, label: v.item.title }))]}
              />
            </Field>
            <Field label={t('studio.name')} htmlFor="studio-name">
              <Input id="studio-name" value={base} onChange={(e) => setBase(e.target.value)} />
            </Field>
            <Segmented label={t('studio.format')} value={format} onChange={setFormat} options={[{ value: 'jpg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} />
            <Button variant="primary" icon="download" loading={busy !== null} onClick={() => void exportAll()} data-testid="studio-export">
              {busy ? `${busy.done}/${busy.total}` : t('studio.export', { n: shots.length })}
            </Button>
          </div>
          <p className="t-small t-faint">
            {t('studio.example', { name: exportName(base, 0, format) })}
          </p>
        </>
      )}
      <p className="t-small t-faint">{t('studio.noRetouch')}</p>
    </div>
  );
}

/** One photo: its 3:4 frame over it, moved with the pointer or the arrow keys; its quality note under it. */
function StudioShot({ shot, index, onMove, onRemove }: { shot: Shot; index: number; onMove: (o: { x: number; y: number }) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const scale = PREVIEW_W / shot.w;
  const r: CropRect = cropRect(shot.w, shot.h, shot.offset.x, shot.offset.y);
  const drag = useRef<{ px: number; py: number; o: { x: number; y: number } } | null>(null);
  const report = shot.report;
  return (
    <figure className="studio__shot">
      <div className="studio__frame-wrap" style={{ width: PREVIEW_W, height: Math.round(shot.h * scale) }}>
        <img src={shot.url} alt={shot.name} width={PREVIEW_W} height={Math.round(shot.h * scale)} draggable={false} />
        <div
          className="studio__frame"
          role="slider"
          tabIndex={0}
          aria-label={t('studio.frame', { n: index + 1 })}
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round((shot.w > shot.h * 0.75 ? shot.offset.x : shot.offset.y) * 100)}
          data-testid="studio-frame"
          style={{ left: r.sx * scale, top: r.sy * scale, width: r.sw * scale, height: r.sh * scale }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { px: e.clientX, py: e.clientY, o: shot.offset };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) onMove(dragOffset(d.o, e.clientX - d.px, e.clientY - d.py, cropRect(shot.w, shot.h), shot.w, shot.h, scale));
          }}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={(e) => {
            const step = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
            if (!step) return;
            e.preventDefault();
            const c = (x: number) => Math.round(Math.min(1, Math.max(-1, x)) * 100) / 100;
            onMove({ x: shot.w > shot.h * 0.75 ? c(shot.offset.x + step[0]!) : 0, y: shot.w > shot.h * 0.75 ? 0 : c(shot.offset.y + step[1]!) });
          }}
        />
      </div>
      <figcaption className="studio__cap">
        <span className="num t-small">{String(index + 1).padStart(2, '0')}</span>
        {report ? <Badge tone={report.verdict === 'OK' ? 'emerald' : report.verdict === 'IMPROVE' ? 'amber' : 'coral'}>{t(`photo.verdict.${report.verdict}`)}</Badge> : <span className="t-small t-faint">{t('common.loading')}</span>}
        <button type="button" className="studio__remove" aria-label={t('studio.remove', { n: index + 1 })} onClick={onRemove}>
          ×
        </button>
      </figcaption>
      {report && report.issues.length > 0 && <p className="t-small t-muted studio__issues">{report.issues.map((i) => t(`photo.issue.${i}`)).join(' · ')}</p>}
    </figure>
  );
}
