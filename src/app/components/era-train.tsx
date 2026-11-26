import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useI18n } from '@/i18n';
import '@/ui/styles/era-train.css';

/**
 * The entrance (3.2 s): a night tunnel under cold strip lights, a brutalist archive train run along it, a pass under a
 * monumental bridge, then the camera draws back onto the bridge's face, where the house's name is cut in the stone —
 * the seller's own Vinted login, read on this device (never written in the code), or « ERA ».
 * Échap or the button skip it; with reduced motion, the last frame only. Everything three.js made is disposed of.
 */

const RUN_MS = 3200;
const BRIDGE_X = 46;
const ease = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)); // close to cubic-bezier(0.19, 1, 0.22, 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const reduced = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The name cut into the bridge: serif capitals, a light edge above, a shadow below (a relief, drawn). */
function engraving(name: string): THREE.CanvasTexture {
  // At the face's own ratio (26 × 3): the letters are never stretched.
  const c = document.createElement('canvas');
  c.width = 2600;
  c.height = 300;
  const g = c.getContext('2d')!;
  const stone = g.createLinearGradient(0, 0, 0, 300);
  stone.addColorStop(0, '#1a2230');
  stone.addColorStop(1, '#0d131d');
  g.fillStyle = stone;
  g.fillRect(0, 0, 2600, 300);
  g.strokeStyle = 'rgba(148,163,184,0.35)';
  g.lineWidth = 3;
  g.strokeRect(18, 18, 2564, 264);
  let size = 200;
  const font = (s: number) => `500 ${s}px "Bodoni Moda Variable", "Bodoni 72", Didot, serif`;
  g.font = font(size);
  g.letterSpacing = '18px';
  while (g.measureText(name).width > 2200 && size > 70) {
    size -= 10;
    g.font = font(size);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Relief: the cut's lower lip catches the light, its upper edge falls into shadow.
  g.fillStyle = 'rgba(0,0,0,0.65)';
  g.fillText(name, 1300, 158);
  g.fillStyle = 'rgba(226,232,240,0.25)';
  g.fillText(name, 1300, 148);
  const metal = g.createLinearGradient(0, 60, 0, 240);
  metal.addColorStop(0, '#f4f2ec');
  metal.addColorStop(0.55, '#94a3b8');
  metal.addColorStop(1, '#e2e8f0');
  g.fillStyle = metal;
  g.fillText(name, 1300, 152);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function serial(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0f151f';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#94a3b8';
  g.font = '500 64px "JetBrains Mono Variable", ui-monospace, monospace';
  g.textBaseline = 'middle';
  g.fillText('ERA-01', 24, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function EraTrainScene({ name, status, onDone }: { name: string; status: string; onDone: () => void }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    window.setTimeout(onDone, reduced() ? 0 : 450);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (revealed && e.key === 'Enter')) {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setRevealed(true);
      return;
    }
    let alive = true;
    const W = () => el.clientWidth || window.innerWidth;
    const H = () => el.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(W(), H());
    renderer.setClearColor(0x080c12, 1);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080c12, 0.028);
    // A 35 mm look: a narrower field than the default, low and slightly up at the train.
    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 400);
    scene.add(new THREE.HemisphereLight(0xe2e8f0, 0x080c12, 0.7));
    // A cold rim from above and ahead: the train's edges read against the dark.
    const rim = new THREE.DirectionalLight(0xe2e8f0, 0.9);
    rim.position.set(30, 14, 12);
    scene.add(rim);

    // The tunnel: floor, rails, a back wall, a ceiling lined with cold strip lights.
    const stone = keep(new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.9, metalness: 0.1 }));
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(260, 30)), stone);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(60, 0, 0);
    scene.add(floor);
    // The tunnel ends before the bridge: from its mouth on, open night.
    const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(100, 12)), stone);
    wall.position.set(-20, 6, -5);
    scene.add(wall);
    const ceiling = new THREE.Mesh(keep(new THREE.PlaneGeometry(100, 30)), stone);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(-20, 7.5, 0);
    scene.add(ceiling);
    const steel = keep(new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.9 }));
    for (const z of [-0.8, 0.8]) {
      const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(260, 0.08, 0.08)), steel);
      rail.position.set(60, 0.05, z);
      scene.add(rail);
    }
    const stripGeo = keep(new THREE.BoxGeometry(3.2, 0.05, 0.12));
    const stripBlue = keep(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    const stripIce = keep(new THREE.MeshBasicMaterial({ color: 0xe2e8f0 }));
    for (let x = -63; x < 30; x += 7) {
      const s = new THREE.Mesh(stripGeo, (x / 7) % 2 === 0 ? stripBlue : stripIce);
      s.position.set(x, 7.42, 0);
      scene.add(s);
      if (x % 14 === 0) {
        const l = new THREE.PointLight(0xbfe6ff, 0.9, 14, 2);
        l.position.set(x, 7, 0);
        scene.add(l);
      }
    }

    // The train: matte wagons, a 1 px steel edge, the serial on the engine.
    const train = new THREE.Group();
    const body = keep(new THREE.MeshStandardMaterial({ color: 0x141c28, roughness: 0.7, metalness: 0.45 }));
    const edge = keep(new THREE.LineBasicMaterial({ color: 0x94a3b8 }));
    const groove = keep(new THREE.MeshStandardMaterial({ color: 0x0a0f17, roughness: 0.9 }));
    const wagonGeo = keep(new THREE.BoxGeometry(6, 2.4, 2.6));
    const wagonEdges = keep(new THREE.EdgesGeometry(wagonGeo));
    const grooveGeo = keep(new THREE.BoxGeometry(0.05, 2.0, 0.02));
    const bandGeo = keep(new THREE.BoxGeometry(5.6, 0.05, 0.02));
    for (let i = 0; i < 5; i++) {
      const w = new THREE.Mesh(wagonGeo, body);
      w.position.set(-i * 6.4, 1.5, 0);
      w.add(new THREE.LineSegments(wagonEdges, edge));
      // Brutalist panels: vertical grooves and one band along the side the camera sees.
      for (const gx of [-1.8, -0.6, 0.6, 1.8]) {
        if (i === 0 && gx > 0) continue;
        const g = new THREE.Mesh(grooveGeo, groove);
        g.position.set(gx, 0, 1.31);
        w.add(g);
      }
      const band = new THREE.Mesh(bandGeo, edge as unknown as THREE.Material);
      band.position.set(0, -0.7, 1.312);
      w.add(band);
      train.add(w);
    }
    const plate = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.2, 0.55)), keep(new THREE.MeshBasicMaterial({ map: keep(serial()) })));
    plate.position.set(0.6, 1.7, 1.31);
    train.add(plate);
    const lamp = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 0.25, 0.9)), keep(new THREE.MeshBasicMaterial({ color: 0xf4f2ec })));
    lamp.position.set(3.02, 1.2, 0);
    train.add(lamp);
    // The headlight: a beam ahead of the engine, sweeping the underside of the bridge as it passes.
    const beam = new THREE.SpotLight(0xf4f2ec, 40, 40, 0.35, 0.6, 1.4);
    beam.position.set(3.1, 1.3, 0);
    beam.target.position.set(20, 4, 0);
    train.add(beam, beam.target);
    scene.add(train);

    // The bridge: a monumental deck on two piers, across the track at an angle, the name cut in its face.
    const bridge = new THREE.Group();
    const concrete = keep(new THREE.MeshStandardMaterial({ color: 0x131b29, roughness: 0.75, metalness: 0.3 }));
    const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(5, 3.2, 34)), concrete);
    deck.position.set(0, 9.2, 0);
    bridge.add(deck);
    for (const z of [-12, 12]) {
      const pier = new THREE.Mesh(keep(new THREE.BoxGeometry(4, 9, 3)), concrete);
      pier.position.set(0, 3.8, z);
      bridge.add(pier);
    }
    // The face: 26 × 3 units, the canvas drawn at that ratio; the cut letters glow faintly (the metal catching light).
    const faceTex = keep(engraving(name));
    const faceMat = keep(new THREE.MeshStandardMaterial({ map: faceTex, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.6 }));
    const face = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 3)), faceMat);
    face.rotation.y = -Math.PI / 2;
    face.position.set(-2.52, 9.2, 0);
    bridge.add(face);
    bridge.position.set(BRIDGE_X, 0, 0);
    // Across the track at an angle, its face turned toward the camera's side.
    bridge.rotation.y = 0.32;
    scene.add(bridge);
    const faceLight = new THREE.SpotLight(0xe2e8f0, 160, 70, 0.55, 0.5, 1.2);
    faceLight.position.set(BRIDGE_X - 24, 4, 12);
    faceLight.target.position.set(BRIDGE_X - 2.4, 9.2, 0.8);
    scene.add(faceLight, faceLight.target);

    const look = new THREE.Vector3();
    const frame = (ms: number) => {
      const p = Math.min(1, ms / RUN_MS);
      // The train: from far left, under the bridge, on past it.
      const tx = lerp(-24, 92, Math.min(1, ms / 2600));
      train.position.x = tx;
      if (ms < 2400) {
        // Low, alongside, slightly up at it; a short shudder while the camera passes under the arch.
        const cx = tx - 3;
        const under = Math.abs(cx - BRIDGE_X) < 4 && ms > 1200;
        const shake = under ? 0.035 : 0;
        camera.position.set(cx + (Math.random() - 0.5) * shake, 0.9 + (Math.random() - 0.5) * shake, 10);
        look.set(tx + 3, 2.4, 0);
      } else {
        // The draw-back: square onto the bridge's face, the name in the light.
        const k = ease((ms - 2400) / 800);
        camera.position.set(lerp(tx - 3, BRIDGE_X - 25.2, k), lerp(0.9, 9.4, k), lerp(10, 8.4, k));
        look.set(lerp(tx + 3, BRIDGE_X - 2.4, k), lerp(2.4, 9.2, k), lerp(0, 0.8, k));
      }
      camera.lookAt(look);
      renderer.render(scene, camera);
      return p;
    };

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    const draw = async () => {
      // The serif for the cut name, before the texture is drawn.
      await document.fonts.load('500 120px "Bodoni Moda Variable"').catch(() => undefined);
      if (!alive) return;
      const fresh = keep(engraving(name));
      faceMat.map = fresh;
      faceMat.emissiveMap = fresh;
      faceMat.needsUpdate = true;
      if (reduced()) {
        frame(RUN_MS + 1000);
        setRevealed(true);
        return;
      }
      const t0 = performance.now();
      const loop = (now: number) => {
        if (!alive) return;
        const ms = now - t0;
        frame(ms);
        if (ms >= 2600) setRevealed(true);
        if (ms < RUN_MS + 200) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    void draw();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [name]);

  // Once revealed, the house opens by itself a moment later (or at once, on the button).
  useEffect(() => {
    if (!revealed || reduced()) return;
    const id = window.setTimeout(finish, 2600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  return (
    <div className={`era-train ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label={t('intro.label', { name })} data-testid="era-intro">
      <div ref={host} className="era-train__stage" />
      <div className={`era-train__reveal ${revealed ? 'is-on' : ''}`}>
        <p className="era-train__ready num" data-testid="intro-ready">
          {t('intro.ready')}
        </p>
        <p className="era-train__status num">{status}</p>
        <button type="button" className="btn btn--primary era-train__enter" onClick={finish}>
          {t('intro.enter')} <span aria-hidden="true">→</span>
        </button>
      </div>
      {/* Once « Accéder à l'espace » is there, the skip has nothing left to skip. */}
      {!revealed && (
        <button type="button" className="era-train__skip num" onClick={finish}>
          {t('intro.skip')} <kbd className="kbd">Échap</kbd>
        </button>
      )}
    </div>
  );
}
