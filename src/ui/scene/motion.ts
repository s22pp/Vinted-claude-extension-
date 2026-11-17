import { flushSync } from 'react-dom';
import { type Walk, openingDelay } from './scene-plan';

/** The system's « reduce motion » or ERA's own setting (Réglages → Animations → Réduites): no flight, no walk. */
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let walking = 0;

/**
 * Changes the page as a walk in the shop (View Transitions, composited by the browser: the old page recedes, the new one
 * comes forward, in the direction of the walk). Without the API, with reduced motion or with no walk: changed at once.
 * Another click mid-walk: the browser ends the first one where it is and starts the next — never a blank page.
 */
export function walkTo(walk: Walk | null, apply: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!walk || !doc.startViewTransition || reducedMotion() || document.hidden) {
    apply();
    return;
  }
  const root = document.documentElement;
  const id = ++walking;
  root.dataset.eraWalk = walk;
  const vt = doc.startViewTransition(() => flushSync(apply));
  void vt.finished
    .catch(() => undefined)
    .finally(() => {
      if (walking === id) delete root.dataset.eraWalk;
    });
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
