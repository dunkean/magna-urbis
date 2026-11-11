/** Four-sample RGBA8 + depth32 attachments cost 32 bytes per pixel. Keep each
 * view at most 128 MiB before terrain tiles, buildings and a backend warmup. */
export const TERRAIN_3D_FRAME_PIXELS = 4 * 1024 * 1024;
export const TERRAIN_3D_MOVING_PIXELS = 1_250_000;
export const TERRAIN_3D_SETTLE_MS = 200;

export function terrain3dPixelRatio(width: number, height: number, requested: number, maxDimension = 8192, interacting = false): number {
  const w = Number.isFinite(width) ? Math.max(1, width) : 1;
  const h = Number.isFinite(height) ? Math.max(1, height) : 1;
  const ratio = Number.isFinite(requested) && requested > 0 ? Math.min(2, requested) : 1;
  const dimension = Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : 8192;
  const budget = interacting ? TERRAIN_3D_MOVING_PIXELS : TERRAIN_3D_FRAME_PIXELS;
  return Math.min(ratio, Math.sqrt(budget / (w * h)), dimension / w, dimension / h);
}
