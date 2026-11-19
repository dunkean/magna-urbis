/** Local content signatures for tree blocks. Raster halos cover bilinear reads and occupation gradients; exact
 * geometry is indexed once per input. Water/height callbacks are checked at the actual queries recorded by the
 * builder, including rejected water candidates, so callback identity never invalidates an unchanged stand. */
import type { TreeInputs } from '../../ui/terrain3dTrees';
import type { ForestCorridor } from '../forestRoom';
import type { TreeBuildings } from './treesBuildings';
import { TREES_BLOCK } from './treesBlocks';

type Point = { x: number; y: number };
const REACH = 32; // Largest candidate crown is 1.14 * 16 m; orchard exclusion tests reach 1.22 times that.
class Hash {
  private a = 0x811c9dc5;
  private b = 0x9e3779b9;
  add(value: string): void {
    for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i));
    this.byte(257);
  }
  byte(value: number): void {
    this.a = Math.imul(this.a ^ value, 0x01000193);
    this.b = Math.imul(this.b ^ value, 0x85ebca6b);
  }
  value(): string {
    return `${this.a >>> 0}:${this.b >>> 0}`;
  }
}

class Geometry {
  private readonly cells = new Map<string, { value: string }[]>();
  add(points: readonly Point[], value: unknown, margin = REACH): void {
    if (!points.length) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    const entry = { value: JSON.stringify(value) };
    for (let y = Math.floor((y0 - margin) / TREES_BLOCK); y <= Math.floor((y1 + margin) / TREES_BLOCK); y++)
      for (let x = Math.floor((x0 - margin) / TREES_BLOCK); x <= Math.floor((x1 + margin) / TREES_BLOCK); x++) {
        const key = `${x},${y}`,
          cell = this.cells.get(key);
        if (cell) cell.push(entry);
        else this.cells.set(key, [entry]);
      }
  }
  key(bx: number, by: number, hash: Hash): void {
    for (const entry of this.cells.get(`${bx},${by}`) ?? []) hash.add(entry.value);
  }
}

const geometries = new WeakMap<object, Geometry>();
function geometryOf(inputs: TreeInputs): Geometry {
  const occupation = inputs.occupation;
  if (!occupation) return new Geometry();
  let index = geometries.get(occupation);
  if (index) return index;
  index = new Geometry();
  for (const shape of occupation.clearings ?? []) index.add(shape.outer, ['clearing', shape]);
  for (const patch of occupation.detail?.orchards ?? []) index.add(patch.poly, ['orchard', patch]);
  for (const way of occupation.ways ?? []) {
    const half = (i: number) => (typeof way.half === 'number' ? way.half : way.half[i]);
    for (let i = 1; i < way.path.length; i++) index.add([way.path[i - 1], way.path[i]], ['way', way.path[i - 1], way.path[i], half(i - 1), half(i), way.covered, (way as ForestCorridor).crownSetback], REACH + Math.max(half(i - 1), half(i)));
  }
  geometries.set(occupation, index);
  return index;
}

type Raster = { x: number; y: number; width: number; n: number };
/** Hash every texel that a local sample can read, including clamped boundary texels. */
function raster(hash: Hash, grid: Raster | undefined, data: Uint8Array | undefined, channels: number, x: number, y: number, halo = 0): void {
  hash.add(grid && data ? JSON.stringify([grid.x, grid.y, grid.width, grid.n]) : 'absent');
  if (!grid || !data) return;
  const cell = grid.width / grid.n,
    clamp = (v: number) => Math.max(0, Math.min(grid.n - 1, v));
  const x0 = clamp(Math.floor((x - halo - grid.x) / cell - 0.5)),
    x1 = clamp(Math.floor((x + TREES_BLOCK + halo - grid.x) / cell - 0.5) + 1),
    y0 = clamp(Math.floor((y - halo - grid.y) / cell - 0.5)),
    y1 = clamp(Math.floor((y + TREES_BLOCK + halo - grid.y) / cell - 0.5) + 1);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) for (let c = 0; c < channels; c++) hash.byte(data[(j * grid.n + i) * channels + c]);
}

export class TreeContent {
  private readonly geometry: Geometry;
  private readonly keys = new Map<number, string>();
  private readonly look: string;
  constructor(
    private readonly inputs: TreeInputs,
    private readonly buildings?: TreeBuildings,
  ) {
    this.geometry = geometryOf(inputs);
    this.look = JSON.stringify([inputs.seed, inputs.renderV2, inputs.zone, inputs.season, inputs.crownSnow, inputs.climateZone, inputs.calendar, inputs.climate, inputs.field.bankDensity, inputs.field.clearingProfile]);
  }
  key(bx: number, by: number): string {
    const block = by * 65536 + bx,
      held = this.keys.get(block);
    if (held !== undefined) return held;
    const hash = new Hash(),
      x = bx * TREES_BLOCK,
      y = by * TREES_BLOCK,
      { field, occupation } = this.inputs;
    hash.add(this.look);
    raster(hash, field, field.rgba, 4, x, y);
    raster(hash, field, field.bank, 4, x, y);
    raster(hash, field.beach, field.beach?.data, 1, x, y);
    // The clearing-side class probe follows the distance gradient up to one crown radius beyond the trunk.
    raster(hash, occupation, occupation?.rgba, 4, x, y, occupation ? REACH + occupation.width / occupation.n : 0);
    raster(hash, occupation?.detail, occupation?.detail?.rgba, 4, x, y);
    this.geometry.key(bx, by, hash);
    hash.add(this.buildings?.key(x, y, TREES_BLOCK) ?? '');
    const key = hash.value();
    this.keys.set(block, key);
    return key;
  }
}

/** Recorded callbacks are triples (x, y, value); NaN represents an undefined height. */
export interface TreeSamples {
  water: Float64Array;
  height: Float64Array;
}
export function treeSamplesMatch(samples: TreeSamples, inputs: TreeInputs): boolean {
  for (const kind of ['water', 'height'] as const) {
    const values = samples[kind];
    for (let i = 0; i < values.length; i += 3) {
      const value = inputs[kind](values[i], values[i + 1]);
      if (!Object.is(value ?? NaN, values[i + 2])) return false;
    }
  }
  return true;
}
