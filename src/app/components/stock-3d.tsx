import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useI18n } from '@/i18n';
import { stagnationThreshold } from '@/intelligence/stagnation';
import { HIGHLIGHT, type Hung, type Rack, STATE_COLOR, type SceneFilter, type SceneSource, inFilter, layoutRacks, nextAction, sceneItems } from '@/intelligence/stock-scene';
import { Badge, Button } from '@/ui/components/primitives';
import { go, useEra } from '../state';

const FILTERS: SceneFilter[] = ['ALL', 'TO_SHIP', 'CUT_DUE', 'REPOST', 'STALE', 'SOLD'];
const RAIL_Y = 1.62;
const W = 0.56;
const H = 0.74;
const TEX_W = 256;
const TEX_H = 342;

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Without a photo: a neutral garment silhouette with the title — never an invented picture of the article. */
function silhouette(title: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e2e8f0';
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.fillStyle = '#94a3b8';
  g.beginPath();
  // A plain top: shoulders, sleeves, body.
  g.moveTo(88, 40);
  g.lineTo(40, 70);
  g.lineTo(18, 130);
  g.lineTo(52, 142);
  g.lineTo(66, 104);
  g.lineTo(66, 250);
  g.lineTo(190, 250);
  g.lineTo(190, 104);
  g.lineTo(204, 142);
  g.lineTo(238, 130);
  g.lineTo(216, 70);
  g.lineTo(168, 40);
  g.quadraticCurveTo(128, 72, 88, 40);
  g.fill();
  g.fillStyle = '#0f172a';
  g.font = '600 22px system-ui, sans-serif';
  g.textAlign = 'center';
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (g.measureText(`${line} ${w}`.trim()).width > TEX_W - 24 && line) {
      lines.push(line);
      line = w;
    } else line = `${line} ${w}`.trim();
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, TEX_W / 2, 284 + i * 24));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The article's own Vinted photo, read by the extension (its permission on Vinted's image servers), cropped to the hanger. */
async function photoTexture(url: string): Promise<THREE.CanvasTexture | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !(u.hostname === 'vinted.net' || u.hostname.endsWith('.vinted.net'))) return null;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = TEX_W;
    c.height = TEX_H;
    const g = c.getContext('2d')!;
    const k = Math.max(TEX_W / bmp.width, TEX_H / bmp.height);
    g.drawImage(bmp, (TEX_W - bmp.width * k) / 2, (TEX_H - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    bmp.close();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch {
    return null;
  }
}

/**
 * The stock as a shop (skill « era-visuel »): a rack per category, every article hanging with its own Vinted photo and
 * a tag coloured by its state; a rack « À envoyer » and a rack « Vendus ce mois ». Hover tells the price; a click takes
 * the garment off the rail — the camera walks up to it without a cut — and its ticket says the next action. The data
 * are the only reference. Keyboard: ← → to move, Entrée to open, Échap to step back.
 */
export default function Stock3D() {
  const { t, money } = useI18n();
  const era = useEra();
  const host = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<SceneFilter>('ALL');
  const [hover, setHover] = useState<{ p: Hung; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [noGl, setNoGl] = useState(false);
  const api = useRef<{ paint: (f: SceneFilter) => void; select: (i: number | null) => void } | null>(null);

  const { hung, racks } = useMemo(() => {
    const staleDays = stagnationThreshold(era.model);
    const sources: SceneSource[] = era.views.map((v) => {
      const plan = era.markdown.get(v.item.id);
      return {
        itemId: v.item.id,
        title: v.current?.title ?? v.item.title,
        category: v.item.category,
        status: v.item.status,
        inStock: v.inStock,
        priceCents: v.askPrice ?? v.sale?.salePriceCents ?? null,
        views: v.current?.views ?? null,
        favourites: v.current?.favorites ?? null,
        daysListed: v.daysListed,
        photoUrl: v.current?.photoUrls?.[0] ?? v.item.photoUrl ?? null,
        needsShip: !!v.sale?.needsAction && v.sale.status !== 'REFUNDED',
        soldAt: v.sale?.soldAt ?? null,
        cut: plan?.status === 'DUE' && v.askPrice !== null ? { from: v.askPrice, to: plan.step.targetCents } : null,
      };
    });
    return layoutRacks(sceneItems(sources, staleDays, era.now));
  }, [era.views, era.markdown, era.model, era.now]);

  const rackName = (r: Rack) => {
    const base = r.kind === 'TO_SHIP' ? t('stock3d.rackShip') : r.kind === 'SOLD' ? t('stock3d.rackSold') : t(`category.${r.category}`);
    const parts = racks.filter((x) => x.kind === r.kind && x.category === r.category).length;
    return parts > 1 ? `${base} ${r.part}` : base;
  };

  useEffect(() => {
    const el = host.current;
    if (!el || !hung.length) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setNoGl(true);
      return;
    }
    let alive = true;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const size = () => [el.clientWidth || 800, el.clientHeight || 520] as const;
    renderer.setSize(...size());
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, size()[0] / size()[1], 0.1, 200);
    const rows = Math.max(...racks.map((r) => Math.round(-r.z / 3.4))) + 1;
    const width = Math.max(...racks.map((r) => r.x1)) - Math.min(...racks.map((r) => r.x0));
    const home = { pos: new THREE.Vector3(0, 2.4 + rows * 1.2, 4.5 + Math.max(width * 0.55, rows * 2.2)), target: new THREE.Vector3(0, 1, -(rows - 1) * 1.7) };
    camera.position.copy(home.pos);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(home.target);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 1.5;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3f3a36, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(4, 9, 8);
    scene.add(sun);
    // The shop floor: warm, plain — the clothes are the show.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 12, rows * 3.4 + 10), new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -(rows - 1) * 1.7);
    scene.add(floor);

    const disposables: { dispose: () => void }[] = [floor.geometry, floor.material as THREE.Material];
    // The racks: a chrome rail on two posts, and the rack's sign.
    const metal = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.3 });
    disposables.push(metal);
    for (const r of racks) {
      const len = r.x1 - r.x0;
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 12), metal);
      rail.rotation.z = Math.PI / 2;
      rail.position.set((r.x0 + r.x1) / 2, RAIL_Y, r.z);
      scene.add(rail);
      disposables.push(rail.geometry);
      for (const x of [r.x0, r.x1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, RAIL_Y, 10), metal);
        post.position.set(x, RAIL_Y / 2, r.z);
        scene.add(post);
        disposables.push(post.geometry);
      }
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const g = c.getContext('2d')!;
      g.fillStyle = r.kind === 'TO_SHIP' ? 'rgba(109,40,217,0.9)' : r.kind === 'SOLD' ? 'rgba(4,120,87,0.9)' : 'rgba(15,23,42,0.85)';
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#fff';
      g.font = '600 42px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${rackName(r)} · ${r.count}`, 256, 48);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
      sign.scale.set(Math.min(2.6, len), Math.min(2.6, len) * 0.19, 1);
      sign.position.set((r.x0 + r.x1) / 2, RAIL_Y + 0.32, r.z);
      scene.add(sign);
      disposables.push(tex, sign.material);
    }

    // Repeated shapes in one InstancedMesh each: the hangers' bars and the tags (instance i = hung[i]).
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(W * 0.92, 0.022, 0.022), metal, hung.length);
    const tagMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    const tags = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.14), tagMat, hung.length);
    disposables.push(bars.geometry, tags.geometry, tagMat);
    // The garments: one each, wearing its own photo (or the silhouette), and knowing which article it is.
    const garmentGeo = new THREE.PlaneGeometry(W, H);
    disposables.push(garmentGeo);
    const garments = hung.map((h, i) => {
      const tex = silhouette(h.title);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
      const m = new THREE.Mesh(garmentGeo, mat);
      m.position.set(h.x, h.y, h.z);
      m.userData.index = i;
      scene.add(m);
      return m;
    });
    const place = (i: number, dz: number) => {
      const h = hung[i]!;
      garments[i]!.position.z = h.z + dz;
      const m = new THREE.Matrix4();
      m.makeTranslation(h.x, h.y + H / 2 + 0.02, h.z + dz);
      bars.setMatrixAt(i, m);
      m.makeTranslation(h.x + W / 2 - 0.07, h.y + H / 2 - 0.1, h.z + dz + 0.012);
      tags.setMatrixAt(i, m);
      bars.instanceMatrix.needsUpdate = true;
      tags.instanceMatrix.needsUpdate = true;
    };
    hung.forEach((_, i) => place(i, 0));
    scene.add(bars, tags);

    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    // The photos arrive a few at a time; each hanger changes clothes as soon as its own is read.
    void (async () => {
      const queue = hung.map((h, i) => [h, i] as const).filter(([h]) => !!h.photoUrl);
      const worker = async () => {
        while (alive && queue.length) {
          const [h, i] = queue.shift()!;
          const tex = await photoTexture(h.photoUrl!);
          if (!alive || !tex) continue;
          const mat = garments[i]!.material as THREE.MeshStandardMaterial;
          mat.map?.dispose();
          mat.map = tex;
          mat.needsUpdate = true;
          render();
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })();

    let raf = 0;
    let lifted: number | null = null;
    const animate = (to: { pos: THREE.Vector3; target: THREE.Vector3 }, lift: { i: number; from: number; to: number }[]) => {
      cancelAnimationFrame(raf);
      if (reducedMotion()) {
        camera.position.copy(to.pos);
        controls.target.copy(to.target);
        for (const l of lift) place(l.i, l.to);
        controls.update();
        return render();
      }
      const p0 = camera.position.clone();
      const t0 = controls.target.clone();
      const start = performance.now();
      const step = (now: number) => {
        const k = ease(Math.min(1, (now - start) / 1000));
        camera.position.lerpVectors(p0, to.pos, k);
        controls.target.lerpVectors(t0, to.target, k);
        for (const l of lift) place(l.i, l.from + (l.to - l.from) * k);
        controls.update();
        render();
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    api.current = {
      paint: (f) => {
        hung.forEach((h, i) => {
          const on = f !== 'ALL' && inFilter(h, f);
          tags.setColorAt(i, new THREE.Color(on ? HIGHLIGHT : STATE_COLOR[h.state]));
          (garments[i]!.material as THREE.MeshStandardMaterial).color.setScalar(f === 'ALL' || on ? 1 : 0.32);
        });
        tags.instanceColor!.needsUpdate = true;
        render();
      },
      // Taken off the rail: the garment steps forward and the camera walks up to it, in one move; null: back to the shop.
      select: (i) => {
        const lift = [...(lifted !== null && lifted !== i ? [{ i: lifted, from: 0.45, to: 0 }] : []), ...(i !== null && i !== lifted ? [{ i, from: 0, to: 0.45 }] : [])];
        lifted = i;
        if (i === null) return animate(home, lift);
        const h = hung[i]!;
        animate({ pos: new THREE.Vector3(h.x, 1.35, h.z + 2.7), target: new THREE.Vector3(h.x, 1.15, h.z) }, lift);
      },
    };

    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(garments, false)[0];
      return hit ? (hit.object.userData.index as number) : null;
    };
    const onMove = (e: PointerEvent) => {
      const i = pick(e);
      const r = el.getBoundingClientRect();
      setHover(i === null ? null : { p: hung[i]!, x: e.clientX - r.left, y: e.clientY - r.top });
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const i = pick(e);
      if (i !== null) setSel(i);
    };
    const onLeave = () => setHover(null);
    const onResize = () => {
      const [w, h] = size();
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    render();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      for (const g of garments) {
        const mat = g.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
      for (const d of disposables) d.dispose();
      bars.dispose();
      tags.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // rackName reads `racks` and `t`, both already in the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hung, racks, t]);

  useEffect(() => api.current?.paint(filter), [filter, hung]);
  useEffect(() => api.current?.select(sel), [sel]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, f === 'ALL' ? hung.length : hung.filter((p) => inFilter(p, f)).length])), [hung]);
  const s = sel !== null ? hung[sel] : null;
  const onKey = (e: React.KeyboardEvent) => {
    if (!hung.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setSel((i) => (i === null ? 0 : (i + 1) % hung.length));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setSel((i) => (i === null ? hung.length - 1 : (i - 1 + hung.length) % hung.length));
    else if (e.key === 'Escape') setSel(null);
    else if (e.key === 'Enter' && s) go(`item/${s.itemId}`);
    else return;
    e.preventDefault();
  };

  if (!hung.length) return <p className="t-small t-muted">{t('stock3d.empty')}</p>;
  if (noGl) return <p className="t-small t-warn">{t('stock3d.noGl')}</p>;
  return (
    <div className="stack-3" data-testid="stock-3d">
      <div className="row wrap" style={{ gap: 6 }} role="group" aria-label={t('stock3d.filters')}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className="seg__btn" aria-pressed={filter === f} onClick={() => setFilter(f)} disabled={f !== 'ALL' && counts[f] === 0}>
            {t(`stock3d.f.${f}`)} · {counts[f]}
          </button>
        ))}
      </div>
      <div
        ref={host}
        tabIndex={0}
        role="application"
        aria-label={t('stock3d.label', { n: hung.length })}
        onKeyDown={onKey}
        style={{ position: 'relative', height: 'min(70vh, 620px)', borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(180deg, #1f2937 0%, #111827 100%)', outline: 'none' }}
      >
        {hover && !s && (
          <div className="card" style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 14, padding: '8px 10px', pointerEvents: 'none', maxWidth: 260 }}>
            <strong className="t-small">{hover.p.title}</strong>
            <div className="t-small t-muted">
              {hover.p.priceCents === null ? t('stock3d.priceUnknown') : money(hover.p.priceCents)} · {t(`stock3d.s.${hover.p.state}`)}
            </div>
          </div>
        )}
        {s && (
          <div className="card stack" data-testid="stock-3d-ticket" style={{ position: 'absolute', right: 14, top: 14, width: 'min(320px, 80%)', padding: 14, gap: 8 }}>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              {s.photoUrl && <img src={s.photoUrl} alt="" width={72} height={96} style={{ objectFit: 'cover', borderRadius: 8 }} onError={(e) => (e.currentTarget.style.display = 'none')} />}
              <div className="stack" style={{ gap: 4 }}>
                <strong>{s.title}</strong>
                <span className="t-small t-muted">{t('stock3d.hanger', { rack: rackName(racks[s.rack]!), slot: s.slot })}</span>
                <span>
                  <Badge tone={s.state === 'TO_SHIP' ? 'violet' : s.state === 'SOLD' ? 'emerald' : s.state === 'CUT_DUE' ? 'amber' : 'neutral'}>{t(`stock3d.s.${s.state}`)}</Badge>
                </span>
              </div>
            </div>
            <div className="t-small">
              {s.priceCents === null ? t('stock3d.priceUnknown') : money(s.priceCents)} · {t('stock3d.stats', { views: s.views ?? '—', favs: s.favourites ?? '—', days: s.daysListed ?? '—' })}
            </div>
            <p className="t-small" style={{ margin: 0 }}>
              {t(`stock3d.next.${nextAction(s)}`, s.cut ? { from: money(s.cut.from), to: money(s.cut.to) } : {})}
            </p>
            <div className="row wrap" style={{ gap: 6 }}>
              <Button size="sm" variant="primary" onClick={() => go(`item/${s.itemId}`)}>
                {t('stock3d.open')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(null)}>
                {t('stock3d.back')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <p className="t-small t-faint" aria-live="polite">
        {s ? t('stock3d.selected', { title: s.title, n: (sel ?? 0) + 1, total: hung.length }) : t('stock3d.help')}
      </p>
    </div>
  );
}
