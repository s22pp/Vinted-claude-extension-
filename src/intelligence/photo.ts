/**
 * Photo check — scores REAL photos, never generates or retouches any.
 * Pure: works on raw RGBA pixels (a canvas ImageData), downscaled beforehand.
 */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

export type PhotoIssue = 'BLURRY' | 'TOO_DARK' | 'TOO_BRIGHT' | 'LOW_CONTRAST' | 'LOW_RES' | 'CLUTTERED' | 'COLOR_CAST';

export interface PhotoReport {
  score: number;
  verdict: 'OK' | 'IMPROVE' | 'RETAKE';
  issues: PhotoIssue[];
  metrics: { sharpness: number; brightness: number; clipped: number; contrast: number; border: number; cast: number; minSide: number };
}

export function analyzePhoto(px: Pixels, originalMinSide: number): PhotoReport {
  const { width: w, height: h, data } = px;
  const n = w * h;
  const lum = new Float32Array(n);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const R = data[i * 4]!;
    const G = data[i * 4 + 1]!;
    const B = data[i * 4 + 2]!;
    r += R;
    g += G;
    b += B;
    lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
  }
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    sum += lum[i]!;
    if (lum[i]! < 10 || lum[i]! > 245) clipped++;
  }
  const brightness = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (lum[i]! - brightness) ** 2;
  const contrast = Math.sqrt(varSum / n);

  // Sharpness: variance of the Laplacian. Border clutter: edge density in the outer 12 % frame.
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  let borderEdges = 0;
  let borderCount = 0;
  const bw = Math.max(1, Math.round(w * 0.12));
  const bh = Math.max(1, Math.round(h * 0.12));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * lum[i]! - lum[i - 1]! - lum[i + 1]! - lum[i - w]! - lum[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      count++;
      if (x < bw || x >= w - bw || y < bh || y >= h - bh) {
        borderCount++;
        if (Math.abs(lap) > 30) borderEdges++;
      }
    }
  }
  const lapMean = lapSum / Math.max(1, count);
  const sharpness = lapSq / Math.max(1, count) - lapMean * lapMean;
  const border = borderEdges / Math.max(1, borderCount);
  const means = [r / n, g / n, b / n];
  const cast = Math.max(...means) - Math.min(...means);

  const issues: PhotoIssue[] = [];
  if (sharpness < 60) issues.push('BLURRY');
  if (brightness < 70) issues.push('TOO_DARK');
  if (brightness > 205 || clipped / n > 0.25) issues.push('TOO_BRIGHT');
  if (contrast < 28) issues.push('LOW_CONTRAST');
  if (originalMinSide < 800) issues.push('LOW_RES');
  if (border > 0.14) issues.push('CLUTTERED');
  if (cast > 28) issues.push('COLOR_CAST');

  const penalty: Record<PhotoIssue, number> = { BLURRY: 40, TOO_DARK: 25, TOO_BRIGHT: 20, LOW_CONTRAST: 12, LOW_RES: 15, CLUTTERED: 12, COLOR_CAST: 8 };
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + penalty[i], 0));
  return {
    score,
    verdict: issues.includes('BLURRY') || score < 50 ? 'RETAKE' : score < 80 ? 'IMPROVE' : 'OK',
    issues,
    metrics: { sharpness, brightness, clipped: clipped / n, contrast, border, cast, minSide: originalMinSide },
  };
}

/** The shots that prevent disputes and authenticity holds (verified on the account). */
export const SHOT_CHECKLIST = ['front', 'back', 'brandLabel', 'sizeLabel', 'composition', 'defects', 'measures'] as const;
