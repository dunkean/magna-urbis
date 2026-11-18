/**
 * Canonical terrain and lake sampling called by patches, navigation and public height queries.
 * Reads/writes: Reads layer, water, cavern, footings and cuts from the supplied context; spline helpers reuse module-local weight scratch arrays.
 */
import { cavernRoofAt, cavernWallAt } from '../../render/underdarkCavern';
import { lakeSample } from '../lakeGeometry';
import { clamp } from './terrainPolicy';
import { WaterSurface } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

/** Cubic B-spline of cell-centred samples, identical to TerrainGl's surface. */
export function spline(data: Float32Array, n: number, u: number, v: number): number {
  const gx = clamp(u, 0, 1) * n - 0.5,
    gy = clamp(v, 0, 1) * n - 0.5;
  const bx = Math.floor(gx),
    by = Math.floor(gy);
  splineWeights(gx - bx, wx);
  splineWeights(gy - by, wy);
  return splineSum(data, n, bx, by);
}

const wx = new Float64Array(4),
  wy = new Float64Array(4);

function splineWeights(t: number, out: Float64Array): void {
  const cube = t ** 3;
  out[0] = (1 - t) ** 3 / 6;
  out[1] = (3 * cube - 6 * t * t + 4) / 6;
  out[2] = (-3 * cube + 3 * t * t + 3 * t + 1) / 6;
  out[3] = cube / 6;
}

function splineSum(data: Float32Array, n: number, bx: number, by: number): number {
  let height = 0;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      height += data[clamp(by + y - 1, 0, n - 1) * n + clamp(bx + x - 1, 0, n - 1)] * wx[x] * wy[y];
    }
  return height;
}

export function lakeHeight(water: WaterSurface, u: number, v: number): number | undefined {
  const { n, mask, levels, field, width } = water;
  const gx = clamp(u, 0, 1) * n - 0.5,
    gy = clamp(v, 0, 1) * n - 0.5;
  const bx = Math.floor(gx),
    by = Math.floor(gy);
  splineWeights(gx - bx, wx);
  splineWeights(gy - by, wy);
  // The spline of the ±1 cell mask rounds the cell staircase only; the shore field is the lake's one definition.
  if (field && width ? lakeSample(field, width, clamp(u, 0, 1) * width, clamp(v, 0, 1) * width) < 0 : splineSum(mask, n, bx, by) <= 0) return undefined;
  let height = 0,
    weight = 0;
  // Dry controls need not carry a water elevation. Excluding them keeps the
  // lake horizontal right up to its B-spline shore, including old .decor files.
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const i = clamp(by + y - 1, 0, n - 1) * n + clamp(bx + x - 1, 0, n - 1);
      if (mask[i] <= 0 || !Number.isFinite(levels[i])) continue;
      const w = wx[x] * wy[y];
      height += levels[i] * w;
      weight += w;
    }
  return weight > 0 ? height / weight : undefined;
}
/** `carved`: false skips the building footings and moat cuts, giving the natural drawn ground that those
 * footings and structures are themselves seated on (groundAt). */
export function surface(context: Terrain3dContext, x: number, y: number, metresPerPixel: number, detail: boolean, carved: boolean): number {
  const layer = context.layer;
  if (!layer) return 0;
  const u = (x - layer.x) / layer.width,
    v = (y - layer.y) / layer.width;
  // The mountain field is canonical. Only the optional centimetre ground
  // residual is filtered to the mesh footprint to avoid geometric aliasing.
  const footprint = context.groundSettings?.displacement ? metresPerPixel : 0;
  let height = detail && context.heightSampler ? context.heightSampler(x, y, footprint) : spline(layer.data, layer.n, u, v);
  if (!Number.isFinite(height)) height = spline(layer.data, layer.n, u, v);
  // Underdark: rock stops at the roof of its chamber (the section cut); floors stay below it.
  if (context.cavern) {
    // Rock rises as a steep wall from its contour to the roof and stops there: the lid rests on the walls.
    const roof = cavernRoofAt(context.cavern, x, y),
      wall = cavernWallAt(context.cavern, x, y);
    height = Math.min(height, roof);
    if (wall > 0) height += (roof - height) * wall;
  }
  if (carved) {
    height = context.buildingGround.constrain(x, y, height);
    height = context.groundCuts.lower(x, y, height);
  }
  if (context.waterVisible) {
    height = Math.max(0, height);
    const lake = context.water && lakeHeight(context.water, u, v);
    if (lake !== undefined) height = lake;
  }
  return Number.isFinite(height) ? height : 0;
}

export function heightAt(context: Terrain3dContext, x: number, y: number): number | undefined {
  if (!context.layer) return undefined;
  return context.surface(x, y, 0);
}

/** The drawn ground before building footings and moats carve it (metres, unexaggerated). Town structures seat on it:
 * sampling heightAt instead would feed each footing back into the next rebuild and sink the town step by step. */
export function groundAt(context: Terrain3dContext, x: number, y: number): number | undefined {
  if (!context.layer) return undefined;
  // Seats are read once per structure vertex (millions for a region): at a 2 m footprint the centimetre ground
  // residual is filtered to exactly 0, as on the mesh a town is seen on, and its five extra relief probes and
  // noise field per sample are skipped. The relief itself is the same.
  return context.surface(x, y, 2, true, false);
}
