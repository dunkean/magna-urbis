import type { TerrainLayer } from '../gen/types';
import { distanceField, smoothstep } from '../gen/core/field';
import type { SettlementRaster } from '../../../rust/bridge/settlements';

/** The road and land-cover textures share a grid. Negative exposure is damp alluvium, positive is exposed rock. */
export const ROAD_GRID = 256;
type Raster = Pick<SettlementRaster, 'height' | 'water' | 'n' | 'width' | 'rock'>;
type Terrain = TerrainLayer | Raster;
const cache = new WeakMap<Terrain, { id: number; exposure: Int8Array }>();
let revision = 0;

export function roadTerrain(terrain: Terrain) {
  const cached = cache.get(terrain);
  if (cached) return cached;
  const { height, water, n, width, rock }: Raster = 'n' in terrain ? terrain : { height: terrain.height.data, water: terrain.water, n: terrain.height.w, width: terrain.height.cell * terrain.height.w };
  // Keep narrow rivers when reducing a large overview. Carry the bank elevation so a road on a cliff
  // above water stays dry. This field is shared by every rank, season and cover on the retained terrain.
  const side = Math.min(n, ROAD_GRID),
    cell = width / side;
  const wet = new Uint8Array(side * side),
    levels = new Float32Array(wet.length);
  for (let y = 0; y < n; y++) {
    const row = Math.floor((y * side) / n) * side;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!water[i] || water[i] > 3 || rock?.[i]) continue;
      const j = row + Math.floor((x * side) / n);
      const level = water[i] === 1 ? 0 : height[i];
      levels[j] = wet[j] ? Math.max(levels[j], level) : level;
      wet[j] = 1;
    }
  }
  const { dist, val } = distanceField(wet, side, side, cell, levels);
  const exposure = new Int8Array(ROAD_GRID * ROAD_GRID);
  for (let y = 0; y < ROAD_GRID; y++) {
    const sy = Math.floor(((y + 0.5) * n) / ROAD_GRID),
      row = sy * n;
    for (let x = 0; x < ROAD_GRID; x++) {
      const sx = Math.floor(((x + 0.5) * n) / ROAD_GRID),
        i = row + sx;
      const at = Math.floor(((y + 0.5) * side) / ROAD_GRID) * side + Math.floor(((x + 0.5) * side) / ROAD_GRID);
      const dx = height[row + Math.min(n - 1, sx + 1)] - height[row + Math.max(0, sx - 1)];
      const dy = height[Math.min(n - 1, sy + 1) * n + sx] - height[Math.max(0, sy - 1) * n + sx];
      const slope = (Math.hypot(dx, dy) * n) / (2 * width);
      const stone = smoothstep(slope, 0.12, 0.55);
      const damp = (1 - smoothstep(dist[at], 0, 90)) * (1 - smoothstep(height[i] - val![at], 2, 12));
      exposure[y * ROAD_GRID + x] = Math.round(16 * (stone - damp * (1 - stone)));
    }
  }
  const field = { id: ++revision, exposure };
  cache.set(terrain, field);
  return field;
}
