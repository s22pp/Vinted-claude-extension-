import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useI18n } from '@/i18n';
import { stagnationThreshold } from '@/intelligence/stagnation';
import { ARC, ARC_START, HIGHLIGHT, type Placed, RADIUS, ROW_RISE, ROW_STEP, STATE_COLOR, type SceneFilter, type SceneSource, inFilter, layoutArena, nextAction, sceneItems } from '@/intelligence/stock-scene';
import { Badge, Button } from '@/ui/components/primitives';
import { go, useEra } from '../state';

const FILTERS: SceneFilter[] = ['ALL', 'TO_SHIP', 'CUT_DUE', 'REPOST', 'STALE', 'SOLD'];
const HOME = { pos: new THREE.Vector3(0, 15, 22), target: new THREE.Vector3(0, 1.2, 0) };

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The stock as a stadium (skill « era-visuel »): every article a card on its stand (category), coloured by its state;
 * hover tells its price, a click flies the camera to it without a cut and opens its « ticket » with the next action.
 * The data are the only reference: the scene shows them, invents nothing. Keyboard: ← → to move, Entrée to open.
 */
export default function Stock3D() {
  const { t, money } = useI18n();
  const era = useEra();
  const host = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<SceneFilter>('ALL');
  const [hover, setHover] = useState<{ p: Placed; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [noGl, setNoGl] = useState(false);
  const api = useRef<{ paint: (f: SceneFilter, sel: number | null) => void; fly: (i: number | null) => void } | null>(null);

  const { placed, stands } = useMemo(() => {
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
    return layoutArena(sceneItems(sources, staleDays, era.now));
  }, [era.views, era.markdown, era.model, era.now]);

  // The scene: built once per layout, painted per filter, flown per selection.
  useEffect(() => {
    const el = host.current;
    if (!el || !placed.length) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setNoGl(true);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const size = () => [el.clientWidth || 800, el.clientHeight || 520] as const;
    renderer.setSize(...size());
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, size()[0] / size()[1], 0.1, 200);
    camera.position.copy(HOME.pos);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(HOME.target);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 4;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(8, 20, 10);
    scene.add(sun);
    // The pitch: plain, the articles are the show.
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(7.5, 64), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.9 }));
    pitch.rotation.x = -Math.PI / 2;
    scene.add(pitch);
    // Its markings: the halfway line and the centre circle.
    const lines = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.7 });
    const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * 1.6, 0.01, Math.sin((i / 64) * Math.PI * 2) * 1.6))), lines);
    const halfway = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, -7.4), new THREE.Vector3(0, 0.01, 7.4)]), lines);
    scene.add(circle, halfway);
    // The bowl: concrete steps, one per row, on the stands' arc (open on the entrance side, like a stadium).
    const maxRows = Math.max(...stands.map((s) => s.rows));
    const profile: THREE.Vector2[] = [new THREE.Vector2(RADIUS - 0.7, 0)];
    for (let r = 0; r < maxRows; r++) {
      const inner = RADIUS + r * ROW_STEP - 0.55;
      profile.push(new THREE.Vector2(inner, r * ROW_RISE), new THREE.Vector2(inner + ROW_STEP, r * ROW_RISE));
      if (r < maxRows - 1) profile.push(new THREE.Vector2(inner + ROW_STEP, (r + 1) * ROW_RISE));
    }
    profile.push(new THREE.Vector2(RADIUS + maxRows * ROW_STEP - 0.55, -0.01));
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 96, Math.PI / 2 - (ARC_START + ARC), ARC), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95, side: THREE.DoubleSide }));
    scene.add(bowl);

    // Every article in ONE InstancedMesh: instance i is placed[i] (it knows its stand, row, seat, state).
    const card = new THREE.BoxGeometry(0.8, 1, 0.08);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(card, mat, placed.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    placed.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(0, p.rotY, 0));
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, p.h, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(STATE_COLOR[p.state]));
    });
    scene.add(mesh);
    // The selected seat's marker.
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 16), new THREE.MeshStandardMaterial({ color: HIGHLIGHT, emissive: HIGHLIGHT, emissiveIntensity: 0.4 }));
    marker.rotation.x = Math.PI;
    marker.visible = false;
    scene.add(marker);
    // Stand labels: the category, written once on a sprite.
    const sprites: THREE.Sprite[] = stands.map((s) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(15,23,42,0.75)';
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#fff';
      g.font = '600 44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${t(`category.${s.category}`)} · ${s.count}`, 256, 48);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      sp.scale.set(3.2, 0.6, 1);
      // Above the back row of its stand, like the stand's own sign.
      const r = RADIUS + s.rows * ROW_STEP + 0.4;
      sp.position.set(Math.cos(s.angle) * r, s.rows * ROW_RISE + 1.6, Math.sin(s.angle) * r);
      scene.add(sp);
      return sp;
    });

    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    let raf = 0;
    const flyTo = (pos: THREE.Vector3, target: THREE.Vector3) => {
      cancelAnimationFrame(raf);
      if (reducedMotion()) {
        camera.position.copy(pos);
        controls.target.copy(target);
        controls.update();
        return render();
      }
      const p0 = camera.position.clone();
      const t0 = controls.target.clone();
      const start = performance.now();
      const step = (now: number) => {
        const k = ease(Math.min(1, (now - start) / 1100));
        camera.position.lerpVectors(p0, pos, k);
        controls.target.lerpVectors(t0, target, k);
        controls.update();
        render();
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    api.current = {
      paint: (f, s) => {
        placed.forEach((p, i) => {
          const on = f !== 'ALL' && inFilter(p, f);
          const c = new THREE.Color(on ? HIGHLIGHT : STATE_COLOR[p.state]);
          if (f !== 'ALL' && !on) c.multiplyScalar(0.3);
          mesh.setColorAt(i, c);
        });
        mesh.instanceColor!.needsUpdate = true;
        marker.visible = s !== null;
        if (s !== null) marker.position.set(placed[s]!.x, placed[s]!.y + placed[s]!.h / 2 + 0.45, placed[s]!.z);
        render();
      },
      // Down to the seat in one continuous move (no cut); null: back to the whole bowl.
      fly: (i) => {
        if (i === null) return flyTo(HOME.pos, HOME.target);
        const p = placed[i]!;
        const dir = new THREE.Vector3(p.x, 0, p.z).normalize();
        const target = new THREE.Vector3(p.x, p.y, p.z);
        flyTo(target.clone().sub(dir.multiplyScalar(6)).add(new THREE.Vector3(0, 2.4, 0)), target);
      },
    };

    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObject(mesh)[0];
      return hit?.instanceId ?? null;
    };
    const onMove = (e: PointerEvent) => {
      const i = pick(e);
      const r = el.getBoundingClientRect();
      setHover(i === null ? null : { p: placed[i]!, x: e.clientX - r.left, y: e.clientY - r.top });
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      // A click, not the end of a drag of the camera.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const i = pick(e);
      if (i !== null) setSel(i);
    };
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
    renderer.domElement.addEventListener('pointerleave', () => setHover(null));
    window.addEventListener('resize', onResize);
    render();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      card.dispose();
      mat.dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      pitch.geometry.dispose();
      (pitch.material as THREE.Material).dispose();
      bowl.geometry.dispose();
      (bowl.material as THREE.Material).dispose();
      circle.geometry.dispose();
      halfway.geometry.dispose();
      lines.dispose();
      for (const s of sprites) {
        s.material.map?.dispose();
        s.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [placed, stands, t]);

  useEffect(() => api.current?.paint(filter, sel), [filter, sel, placed]);
  useEffect(() => api.current?.fly(sel), [sel]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, f === 'ALL' ? placed.length : placed.filter((p) => inFilter(p, f)).length])), [placed]);
  const s = sel !== null ? placed[sel] : null;
  const order = placed; // already by stand, then the urgent first: the keyboard follows the bowl
  const onKey = (e: React.KeyboardEvent) => {
    if (!order.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setSel((i) => (i === null ? 0 : (i + 1) % order.length));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setSel((i) => (i === null ? order.length - 1 : (i - 1 + order.length) % order.length));
    else if (e.key === 'Escape') setSel(null);
    else if (e.key === 'Enter' && s) go(`item/${s.itemId}`);
    else return;
    e.preventDefault();
  };

  if (!placed.length) return <p className="t-small t-muted">{t('stock3d.empty')}</p>;
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
        aria-label={t('stock3d.label', { n: placed.length })}
        onKeyDown={onKey}
        style={{ position: 'relative', height: 'min(70vh, 620px)', borderRadius: 14, overflow: 'hidden', background: 'radial-gradient(ellipse at center, #1e293b 0%, #0b1220 75%)', outline: 'none' }}
      >
        {hover && !s && (
          <div className="card" style={{ position: 'absolute', left: Math.min(hover.x + 14, 9999), top: hover.y + 14, padding: '8px 10px', pointerEvents: 'none', maxWidth: 260 }}>
            <strong className="t-small">{hover.p.title}</strong>
            <div className="t-small t-muted">
              {hover.p.unknownPrice ? t('stock3d.priceUnknown') : money(hover.p.priceCents)} · {t(`stock3d.s.${hover.p.state}`)}
            </div>
          </div>
        )}
        {s && (
          <div className="card stack" data-testid="stock-3d-ticket" style={{ position: 'absolute', right: 14, top: 14, width: 'min(320px, 80%)', padding: 14, gap: 8 }}>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              {s.photoUrl && <img src={s.photoUrl} alt="" width={72} height={96} style={{ objectFit: 'cover', borderRadius: 8 }} onError={(e) => (e.currentTarget.style.display = 'none')} />}
              <div className="stack" style={{ gap: 4 }}>
                <strong>{s.title}</strong>
                <span className="t-small t-muted">{t('stock3d.seat', { stand: t(`category.${s.category}`), row: s.row, seat: s.seat })}</span>
                <span>
                  <Badge tone={s.state === 'TO_SHIP' ? 'violet' : s.state === 'SOLD' ? 'emerald' : s.state === 'CUT_DUE' ? 'amber' : 'neutral'}>{t(`stock3d.s.${s.state}`)}</Badge>
                </span>
              </div>
            </div>
            <div className="t-small">
              {s.unknownPrice ? t('stock3d.priceUnknown') : money(s.priceCents)} · {t('stock3d.stats', { views: s.views ?? '—', favs: s.favourites ?? '—', days: s.daysListed ?? '—' })}
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
        {s ? t('stock3d.selected', { title: s.title, n: (sel ?? 0) + 1, total: placed.length }) : t('stock3d.help')}
      </p>
    </div>
  );
}
