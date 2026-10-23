import type { TerrainGrid } from './model';

export type ReconstructedTerrain = TerrainGrid & { reconstruction?: 'bilinear-samples' | 'cubic-bspline-controls' };
/** Source-kernel evaluation, in physical coordinates. This never changes stored
 * values, native spacing, identity, or the environmental analysis grid. */
export function sampleTerrainHeight(t: ReconstructedTerrain, x: number, z: number): number {
  const clampIndex = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));
  const cubic = t.reconstruction === 'cubic-bspline-controls';
  const rawX = (x - t.originX) / t.spacingM, rawZ = (z - t.originZ) / t.spacingM;
  const gx = cubic ? rawX : Math.max(0, Math.min(t.width - 1, rawX)), gz = cubic ? rawZ : Math.max(0, Math.min(t.height - 1, rawZ));
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  if (cubic) {
    const weights = (v: number) => [(1 - v) ** 3 / 6, (3 * v ** 3 - 6 * v * v + 4) / 6, (-3 * v ** 3 + 3 * v * v + 3 * v + 1) / 6, v ** 3 / 6];
    const wx = weights(fx), wz = weights(fz); let height = 0;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) height += t.heights[clampIndex(iz + row - 1, t.height) * t.width + clampIndex(ix + col - 1, t.width)] * wx[col] * wz[row];
    return height;
  }
  const x1 = clampIndex(ix + 1, t.width), z1 = clampIndex(iz + 1, t.height);
  return (t.heights[iz * t.width + ix] * (1 - fx) + t.heights[iz * t.width + x1] * fx) * (1 - fz)
    + (t.heights[z1 * t.width + ix] * (1 - fx) + t.heights[z1 * t.width + x1] * fx) * fz;
}
