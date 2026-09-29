/**
 * The design system's motion, as the page resolves it right now. Read from the tokens (tokens.css), so a script-driven
 * animation follows the same durations and curve as the CSS ones — and gets 0 when motion is reduced, by the system
 * setting or by ERA's own (both set the tokens to 0ms).
 */
export type MotionToken = '--t-fast' | '--t-normal' | '--t-slow';

export function motionMs(token: MotionToken): number {
  if (typeof document === 'undefined') return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith('ms') ? n : n * 1000;
}

export function motionEase(): string {
  if (typeof document === 'undefined') return 'ease';
  return getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease';
}
