import { flushSync } from 'react-dom';
import { type Walk, openingDelay } from './scene-plan';

/** The system's « reduce motion » or ERA's own setting (Réglages → Animations → Réduites): no flight, no walk. */
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let walking = 0;

/** Where the new page comes from, by the direction of the walk (the camera of the shop walks the same way). */
const ENTER: Record<Walk, string> = {
  fwd: 'perspective(1400px) translate3d(5%, 8px, -180px) rotateY(-8deg)',
  back: 'perspective(1400px) translate3d(-5%, 8px, -180px) rotateY(8deg)',
  in: 'perspective(1400px) translate3d(0, 16px, -200px) rotateX(6deg)',
  out: 'perspective(1400px) translate3d(0, -6px, 140px)',
};

/**
 * Changes the page as a walk in the shop: the page is changed at once — clickable from the first instant, never a frozen
 * image in between — and comes forward from the depth, in the direction of the walk (Web Animations: transform and
 * opacity only, composited; nothing kept once done). The shop's camera walks the same way behind it: no cut.
 * With reduced motion, or with no walk (same page, a page outside the shop): changed at once, nothing moves.
 */
export function walkTo(walk: Walk | null, apply: () => void) {
  if (!walk || reducedMotion() || document.hidden) {
    apply();
    return;
  }
  const root = document.documentElement;
  const id = ++walking;
  root.dataset.eraWalk = walk;
  // Rendered now, so the new page is animated before it is ever painted (no flash of it in place).
  flushSync(apply);
  const page = document.getElementById('main');
  const done = () => {
    if (walking === id) delete root.dataset.eraWalk;
  };
  if (!page?.animate) return done();
  const anim = page.animate(
    [
      { opacity: 0, transform: ENTER[walk] },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 440, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
  );
  // Cancelled by the next click (the page replaced mid-walk): expected, handled — never a script error.
  void anim.finished.catch(() => undefined).finally(done);
}

let opened = false;

/**
 * The opening, once per window: the page's blocks come up from the depth one after the other, in 3D (Web Animations:
 * transform and opacity only, composited; nothing kept once done — a transform left on the page would move its dialogs).
 * Blocks that arrive a moment later (a screen still loading) join in for a short while.
 */
export function playOpening(page: HTMLElement | null) {
  if (opened || !page) return;
  opened = true;
  if (reducedMotion()) return;
  const start = performance.now();
  let n = 0;
  const seen = new WeakSet<Element>();
  const rise = (el: Element) => {
    if (seen.has(el) || !(el instanceof HTMLElement)) return;
    seen.add(el);
    const late = performance.now() - start;
    el.animate(
      [
        { opacity: 0, transform: 'perspective(1200px) translate3d(0, 28px, -150px) rotateX(9deg)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 620, delay: Math.max(0, openingDelay(n++) - late), easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
    );
  };
  for (const el of Array.from(page.children)) rise(el);
  const mo = new MutationObserver((records) => {
    for (const r of records) for (const el of Array.from(r.addedNodes)) if (el instanceof Element) rise(el);
  });
  mo.observe(page, { childList: true });
  setTimeout(() => mo.disconnect(), 1500);
}
