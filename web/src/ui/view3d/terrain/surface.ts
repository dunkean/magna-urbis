/**
 * The relief of a 3D terrain view and its one height function. Terrain3d sets the inputs (height layer, lakes, detail
 * sampler, building footings, moat cuts); patches, meshes, camera, picking, trees and mushrooms read heights here, so
 * the mesh, the eye clearance and every placed instance agree on the same ground.
 */
import { cavernRoofAt, cavernWallAt, type CavernField } from '../../../render/underdarkCavern';
import { lakeSample } from '../../lakeGeometry';
import type { HeightLayer } from '../../terrain/contract';
import { UrbanBuildingGround } from '../../urbanBuildingGround';
import { UrbanGroundCuts } from '../../urbanGroundCuts';
import { clamp } from './policy';
import type { TerrainViewContext } from './context';
import type { WaterSurface } from './contract';

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

export class TerrainSurface {
  layer?: HeightLayer;
  water?: WaterSurface;
  waterVisible = true;
  /** Relief span and steepest slope of the layer (patch bounds, camera framing, far plane). */
  heightRange = 0;
  maxSlope = 0;
  /** Detailed ground sampler (the material ground's displacement), else the layer's spline. */
  heightSampler?: (x: number, y: number, metresPerPixel: number) => number;
  /** Building footings and town moats carved into the ground. */
  buildingGround = new UrbanBuildingGround();
  groundCuts = new UrbanGroundCuts();
  /** The layer uploaded by the backend for the ground shader's macro relief (Terrain3d writes it with the layer). */
  macroTexture!: WebGLTexture;

  constructor(
    private readonly context: TerrainViewContext,
    /** The Underdark section cut, when there is one: rock stops at its roof. */
    private readonly cavern: () => CavernField | undefined,
  ) {}

  /** Whether (layer, water, visibility) are the current inputs already. */
  same(layer: HeightLayer, water: WaterSurface | undefined, waterVisible: boolean): boolean {
    return (
      this.layer?.data === layer.data &&
      this.layer.n === layer.n &&
      this.layer.width === layer.width &&
      this.layer.x === layer.x &&
      this.layer.y === layer.y &&
      this.water?.mask === water?.mask &&
      this.water?.levels === water?.levels &&
      this.water?.n === water?.n &&
      this.waterVisible === waterVisible
    );
  }

  /** Relief span and steepest slope of the current layer. */
  measure(): void {
    const layer = this.layer!;
    let low = Infinity,
      high = -Infinity,
      slope = 0;
    const cell = layer.width / layer.n;
    for (let i = 0; i < layer.data.length; i++) {
      const value = layer.data[i];
      low = Math.min(low, value);
      high = Math.max(high, value);
      if ((i % layer.n) + 1 < layer.n) slope = Math.max(slope, Math.abs(layer.data[i + 1] - value) / cell);
      if (i + layer.n < layer.data.length) slope = Math.max(slope, Math.abs(layer.data[i + layer.n] - value) / cell);
    }
    this.maxSlope = slope * Math.SQRT2;
    this.heightRange = Math.max(0, high - low);
  }

  /** `carved`: false skips the building footings and moat cuts, giving the natural drawn ground that those
   * footings and structures are themselves seated on (groundAt). */
  surface(x: number, y: number, metresPerPixel: number, detail = true, carved = true): number {
    const layer = this.layer;
    if (!layer) return 0;
    const u = (x - layer.x) / layer.width,
      v = (y - layer.y) / layer.width;
    // The mountain field is canonical. Only the optional centimetre ground
    // residual is filtered to the mesh footprint to avoid geometric aliasing.
    const footprint = this.context.ground?.displacement ? metresPerPixel : 0;
    let height = detail && this.heightSampler ? this.heightSampler(x, y, footprint) : spline(layer.data, layer.n, u, v);
    if (!Number.isFinite(height)) height = spline(layer.data, layer.n, u, v);
    // Underdark: rock stops at the roof of its chamber (the section cut); floors stay below it.
    const cavern = this.cavern();
    if (cavern) {
      // Rock rises as a steep wall from its contour to the roof and stops there: the lid rests on the walls.
      const roof = cavernRoofAt(cavern, x, y),
        wall = cavernWallAt(cavern, x, y);
      height = Math.min(height, roof);
      if (wall > 0) height += (roof - height) * wall;
    }
    if (carved) {
      height = this.buildingGround.constrain(x, y, height);
      height = this.groundCuts.lower(x, y, height);
    }
    if (this.waterVisible) {
      height = Math.max(0, height);
      const lake = this.water && lakeHeight(this.water, u, v);
      if (lake !== undefined) height = lake;
    }
    return Number.isFinite(height) ? height : 0;
  }

  heightAt(x: number, y: number): number | undefined {
    if (!this.layer) return undefined;
    return this.surface(x, y, 0);
  }

  /** The drawn ground before building footings and moats carve it (metres, unexaggerated). Town structures seat on it:
   * sampling heightAt instead would feed each footing back into the next rebuild and sink the town step by step. */
  groundAt(x: number, y: number): number | undefined {
    if (!this.layer) return undefined;
    // Seats are read once per structure vertex (millions for a region): at a 2 m footprint the centimetre ground
    // residual is filtered to exactly 0, as on the mesh a town is seen on, and its five extra relief probes and
    // noise field per sample are skipped. The relief itself is the same.
    return this.surface(x, y, 2, true, false);
  }
}
