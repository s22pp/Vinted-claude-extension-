/**
 * Studio photo: the geometry only. A photo cut to 3:4 (portrait, Vinted's own frame), the frame moved by the seller
 * within the photo, then scaled down (never up) for a light upload, and named after the article. No pixel is changed:
 * no light, no colour, no retouching — the article stays as photographed (Vinted's rules, and the seller's).
 */

export const RATIO = 3 / 4;
/** The longest side of an exported photo: Vinted shows 800 px wide; 1600 px keeps the zoom sharp. */
export const MAX_LONG_SIDE = 1600;

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The largest 3:4 frame inside a w × h photo, centred, then moved by (ox, oy) in [-1, 1] (−1: against the left/top
 * edge, 1: against the right/bottom edge).
 */
export function cropRect(w: number, h: number, ox = 0, oy = 0, ratio = RATIO): CropRect {
  const clamp = (x: number) => Math.min(1, Math.max(-1, Number.isFinite(x) ? x : 0));
  const sw = Math.min(w, Math.round(h * ratio));
  const sh = Math.min(h, Math.round(sw / ratio));
  const sx = Math.round(((w - sw) / 2) * (1 + clamp(ox)));
  const sy = Math.round(((h - sh) / 2) * (1 + clamp(oy)));
  return { sx, sy, sw, sh };
}

/** The exported size: the frame itself, scaled down so its longest side is at most MAX_LONG_SIDE. */
export function exportSize(sw: number, sh: number, maxLong = MAX_LONG_SIDE): { width: number; height: number } {
  const k = Math.min(1, maxLong / Math.max(sw, sh));
  return { width: Math.round(sw * k), height: Math.round(sh * k) };
}

/** « era-e1c4g-veste-harrington-01.jpg »: the article's reference and name, then the photo's place. */
export function exportName(base: string, index: number, ext: 'jpg' | 'webp'): string {
  const slug =
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'photo';
  return `${slug}-${String(index + 1).padStart(2, '0')}.${ext}`;
}

/** Dragging the frame: a move of (dx, dy) pixels on a preview of the photo shifts the offset, kept within the photo. */
export function dragOffset(o: { x: number; y: number }, dx: number, dy: number, rect: CropRect, w: number, h: number, previewScale: number): { x: number; y: number } {
  const clamp = (x: number) => Math.min(1, Math.max(-1, x));
  const freeX = (w - rect.sw) / 2;
  const freeY = (h - rect.sh) / 2;
  return {
    x: freeX > 0 ? clamp(o.x + dx / previewScale / freeX) : 0,
    y: freeY > 0 ? clamp(o.y + dy / previewScale / freeY) : 0,
  };
}
