import { type PhotoReport, analyzePhoto } from '@/intelligence/photo';

/** Reads an image in the browser (downscaled to 512 px) and scores it. Nothing is uploaded or modified. */
export async function analyzeImageBlob(blob: Blob): Promise<PhotoReport> {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, h);
    return analyzePhoto(ctx.getImageData(0, 0, w, h), Math.min(bmp.width, bmp.height));
  } finally {
    bmp.close();
  }
}
