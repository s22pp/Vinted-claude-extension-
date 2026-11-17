import { EYE, OMEGA_OPEN, OMEGA_WALK, OPENING, ROOMS, ROOM_TONE, type Room, type Spring, doorZ, parseColor, roomZ, settled, stepSpring } from './scene-plan';

/**
 * The shop's WebGL layer: one full-screen triangle and one small shader (no library — a few KB, nothing to download).
 * Drawn only while the camera moves: once it has arrived, not a single frame more until the next page (state « idle »).
 * Mouvements réduits (the system's or ERA's setting): drawn once, in place, no flight (state « static »).
 * WebGL 2 unavailable or lost: nothing drawn (state « off »), the page's own background stays — the scene only decorates.
 */

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uZ;
uniform float uH;
uniform float uHor;
uniform float uAlpha;
uniform vec3 uTone;
uniform float uDoorZ[${ROOMS.length}];
uniform vec3 uDoorCol[${ROOMS.length}];
out vec4 o;

float line(float dPx, float w) { return 1.0 - smoothstep(w - 0.6, w + 0.6, dPx); }

void main() {
  float s = uRes.y;
  vec2 p = (gl_FragCoord.xy - vec2(0.5 * uRes.x, uHor * uRes.y)) / s;
  vec3 col = vec3(0.0);
  float a = 0.0;
  // The shop's floor: a fine grid, every fourth line stronger, fading into the distance.
  if (p.y < -0.0005) {
    float t = uH / -p.y;
    vec2 w = vec2(p.x * t, uZ + t);
    vec2 g = abs(fract(w - 0.5) - 0.5) / max(fwidth(w), vec2(1e-4));
    float minor = 1.0 - min(min(g.x, g.y), 1.0);
    vec2 w4 = w * 0.25;
    vec2 g4 = abs(fract(w4 - 0.5) - 0.5) / max(fwidth(w4), vec2(1e-4));
    float major = 1.0 - min(min(g4.x, g4.y), 1.0);
    float fog = exp(-t * 0.07);
    float edge = smoothstep(0.0, 0.05, -p.y);
    float lines = (minor * 0.07 + major * 0.16) * fog * edge;
    // The room's light pooled on the floor under the page.
    vec2 q = vec2(p.x * 0.85, (p.y + 0.24) * 2.6);
    float pool = exp(-dot(q, q) * 3.2) * 0.12 * edge;
    col += uTone * (lines + pool);
    a += lines + pool;
  }
  // One doorway per room, in its colour: the one ahead frames the page, the next ones wait in the distance.
  for (int k = 0; k < ${ROOMS.length}; k++) {
    float t = uDoorZ[k] - uZ;
    if (t < 0.2) continue;
    float X = p.x * t;
    float Y = uH + p.y * t;
    float px = s / t;
    float W = 3.3;
    float Hd = 3.05;
    float inPost = step(0.0, Y) * step(Y, Hd);
    float inBeam = step(abs(X), W);
    float dPost = abs(abs(X) - W) * px;
    float dBeam = abs(Y - Hd) * px;
    float dSill = abs(Y) * px;
    float d = min(min(mix(1e4, dPost, inPost), mix(1e4, dBeam, inBeam)), mix(1e4, dSill, inBeam));
    float fog = exp(-t * 0.06);
    float near = smoothstep(0.2, 1.2, t);
    float glow = (line(d, 1.1) * 0.55 + exp(-d / 9.0) * 0.16) * fog * near;
    col += uDoorCol[k] * glow;
    a += glow;
  }
  a = clamp(a, 0.0, 1.0);
  o = vec4(min(col, vec3(a)), a) * uAlpha;
}`;

export type SceneState = 'moving' | 'idle' | 'static' | 'off';

interface Camera {
  z: Spring;
  h: Spring;
  alpha: Spring;
  tone: [Spring, Spring, Spring];
  /** The opening flight is done once per window: a remount (data loaded) continues where the camera is. */
  opened: boolean;
}

/** Kept for the window's life, so a remounted scene picks the camera up where it was — never a second opening. */
let camera: Camera | null = null;

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cssColor(token: string): [number, number, number] {
  return parseColor(getComputedStyle(document.documentElement).getPropertyValue(token)) ?? [0.49, 0.36, 1];
}

export interface SceneEngine {
  goTo(room: Room): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement, onState: (s: SceneState) => void): SceneEngine | null {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) {
    onState('off');
    return null;
  }
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    return sh;
  };
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  } catch {
    onState('off');
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // One triangle covering the screen.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = { res: u('uRes'), z: u('uZ'), h: u('uH'), hor: u('uHor'), alpha: u('uAlpha'), tone: u('uTone'), doorZ: u('uDoorZ'), doorCol: u('uDoorCol') };
  gl.uniform1fv(U.doorZ, ROOMS.map((_, i) => doorZ(i)));

  let target: Room = 'today';
  let tone: [number, number, number] = cssColor(ROOM_TONE.today);
  const readColours = () => {
    gl.uniform3fv(U.doorCol, ROOMS.flatMap((r) => cssColor(ROOM_TONE[r])));
    tone = cssColor(ROOM_TONE[target]);
  };
  readColours();

  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const nw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const nh = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (nw === w && nh === h) return false;
    w = canvas.width = nw;
    h = canvas.height = nh;
    gl.viewport(0, 0, w, h);
    return true;
  };

  const draw = () => {
    const c = camera!;
    gl.uniform2f(U.res, w, h);
    gl.uniform1f(U.z, c.z.x);
    gl.uniform1f(U.h, c.h.x);
    gl.uniform1f(U.hor, 0.4);
    gl.uniform1f(U.alpha, Math.max(0, Math.min(1, c.alpha.x)));
    gl.uniform3f(U.tone, c.tone[0].x, c.tone[1].x, c.tone[2].x);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const targets = () => ({ z: roomZ(target), h: EYE, alpha: 1 });
  const snap = () => {
    const t = targets();
    const c = camera!;
    c.z = { x: t.z, v: 0 };
    c.h = { x: t.h, v: 0 };
    c.alpha = { x: 1, v: 0 };
    c.tone = [{ x: tone[0], v: 0 }, { x: tone[1], v: 0 }, { x: tone[2], v: 0 }];
    c.opened = true;
  };

  let raf = 0;
  let last = 0;
  let disposed = false;
  const frame = (now: number) => {
    raf = 0;
    if (disposed) return;
    const c = camera!;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    const t = targets();
    const omega = c.opened ? OMEGA_WALK : OMEGA_OPEN;
    c.z = stepSpring(c.z, t.z, dt, omega);
    c.h = stepSpring(c.h, t.h, dt, omega);
    c.alpha = stepSpring(c.alpha, t.alpha, dt, omega);
    c.tone = [0, 1, 2].map((i) => stepSpring(c.tone[i]!, tone[i]!, dt, OMEGA_WALK)) as Camera['tone'];
    resize();
    draw();
    const done = settled(c.z, t.z) && settled(c.h, t.h) && settled(c.alpha, t.alpha, 2e-3) && c.tone.every((s, i) => settled(s, tone[i]!, 2e-3));
    if (done) {
      c.opened = true;
      last = 0;
      onState('idle');
      return;
    }
    if (!document.hidden) raf = requestAnimationFrame(frame);
  };
  const run = () => {
    if (disposed) return;
    if (reducedMotion()) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      snap();
      resize();
      draw();
      onState('static');
      return;
    }
    if (!raf) {
      last = 0;
      onState('moving');
      raf = requestAnimationFrame(frame);
    }
  };

  if (!camera) {
    camera = {
      z: { x: roomZ(target) + OPENING.dz, v: 0 },
      h: { x: OPENING.height, v: 0 },
      alpha: { x: OPENING.alpha, v: 0 },
      tone: [{ x: tone[0], v: 0 }, { x: tone[1], v: 0 }, { x: tone[2], v: 0 }],
      opened: false,
    };
  }

  const ro = new ResizeObserver(() => {
    if (resize() && !raf) draw();
  });
  ro.observe(canvas);
  // Theme or motion setting changed: the colours read again, the frame drawn again (no flight).
  const mo = new MutationObserver(() => {
    readColours();
    run();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] });
  const onVisible = () => {
    if (!document.hidden) run();
  };
  document.addEventListener('visibilitychange', onVisible);
  const onLost = (e: Event) => {
    e.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    onState('off');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    goTo(room) {
      target = room;
      tone = cssColor(ROOM_TONE[room]);
      run();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}
