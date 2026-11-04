/** Soil fertility of the Rust resource model as the -1..1 field `generateRural` used to draw from noise. */
import { decodeResources, type ResourceGrid, type ResourcePayload } from '../../../rust/bridge/resources';

/** Soil depth (saturating at 1.5 m) x (1 - stoniness) x drainage (class / 4), stretched to -1..1 (0 on a typical loam). */
export function fertilityAt(depth: number, stoniness: number, drainage: number): number {
  const g = Math.min(1, depth / 1.5) * (1 - stoniness) * (drainage / 4);
  return Math.max(-1, Math.min(1, 2.8 * g - 1));
}
/** Bilinear sampler (map-frame metres) over the block grid. */
export function ruralSoilField(source: ResourcePayload | ResourceGrid): (x: number, y: number) => number {
  const grid = 'bytes' in source ? source : decodeResources(source), { nx, ny, cell, x0, y0 } = grid;
  const f = new Float32Array(nx * ny);
  for (let k = 0; k < f.length; k++) f[k] = fertilityAt(grid.value('soil_depth', k), grid.value('stoniness', k), grid.value('drainage', k));
  return (x, y) => {
    const gx = Math.max(0, Math.min(nx - 1, (x - x0) / cell - 0.5)), gy = Math.max(0, Math.min(ny - 1, (y - y0) / cell - 0.5));
    const i = Math.floor(gx), j = Math.floor(gy), i1 = Math.min(nx - 1, i + 1), j1 = Math.min(ny - 1, j + 1), tx = gx - i, ty = gy - j;
    return (f[j * nx + i] * (1 - tx) + f[j * nx + i1] * tx) * (1 - ty) + (f[j1 * nx + i] * (1 - tx) + f[j1 * nx + i1] * tx) * ty;
  };
}
