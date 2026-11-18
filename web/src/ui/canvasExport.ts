import type { ExportRect } from './exportCropGeometry';

/** Native asynchronous PNG encoding: never turn a retained raster into a base64 SVG just to decode it again. */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PNG encoding timed out')), 120000);
    try {
      canvas.toBlob(blob => {
        clearTimeout(timer);
        if (blob) resolve(blob);
        else reject(new Error('PNG encoding failed'));
      }, 'image/png');
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** Crop the already captured pixels, preserving transparency and the selection's aspect ratio. Caller owns the source. */
export async function cropCanvasPng(source: HTMLCanvasElement, bounds: ExportRect, rect: ExportRect, pixels: { width: number; height: number }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no PNG canvas context');
    ctx.drawImage(source, ((rect.x - bounds.x) / bounds.width) * source.width, ((rect.y - bounds.y) / bounds.height) * source.height, (rect.width / bounds.width) * source.width, (rect.height / bounds.height) * source.height, 0, 0, pixels.width, pixels.height);
    return await canvasPng(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
