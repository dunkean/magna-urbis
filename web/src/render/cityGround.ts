/** Display ground follows physical water, never the planner's dry stilt mask. */
import type { Point, Shape } from '../../../rust/bridge/urban';
import { cityCanals, clipCityGround, packClipShapes, unpackClippedGround } from '../../../rust/bridge/renderGeometry';
import { GridIndex } from '../gen/geo/spatial';
import { ringContains } from './ringRows';

export interface CityGroundRaster { width: number; n: number; water: Uint8Array; geometry?: { water: Point[][][] } }
/** One packed clip of `CityGround.clipAhead`: the clipping raster, the canal pieces and a share of the subjects. */
export interface GroundClipTask { n: number; width: number; water: Uint8Array; canals: Float64Array; subjects: Float64Array }
export const isBoardwalk = (role: string): boolean => ['pier', 'boardwalk', 'walkway'].includes(role);
export const boardwalkWidth = (width: number): number => Number.isFinite(width) ? Math.max(1.2, Math.min(3, width)) : 2;
const wet = (v: number): boolean => v > 0 && v < 4;
interface Run { x0: number; x1: number; y0: number; y1: number }
const rectangle = (r: Run, cell: number): Shape => ({ outer: [
  { x: r.x0 * cell, y: r.y0 * cell }, { x: r.x1 * cell, y: r.y0 * cell },
  { x: r.x1 * cell, y: r.y1 * cell }, { x: r.x0 * cell, y: r.y1 * cell },
], holes: [] });
interface Channels { shapes: Shape[]; contains: (p: Point) => boolean }
const channelCache = new WeakMap<object, Channels>();
/** Thin vector canals can fall between two dry raster centres. Keep their actual holes (rings xor-ed in Rust). */
function channels(geometry: NonNullable<CityGroundRaster['geometry']>): Channels {
  const cached = channelCache.get(geometry); if (cached) return cached;
  const shapes = cityCanals(geometry.water);
  const index = new GridIndex<number>(128), large: number[] = [], bounds = shapes.map((shape, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of shape.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    if ((Math.ceil((x1-x0)/128)+1)*(Math.ceil((y1-y0)/128)+1) > 256) large.push(i);
    else index.insertBox(x0, y0, x1, y1, i);
    return { x0, y0, x1, y1 };
  });
  // The point test of `waterAt` (once per structure vertex in 3D): the shapes whose box holds the point, rows on the long rings.
  const inside = (i: number, p: Point): boolean => { const b = bounds[i], s = shapes[i];
    return b.x0 <= p.x && b.y0 <= p.y && b.x1 >= p.x && b.y1 >= p.y && ringContains(s.outer, p.x, p.y) && !s.holes.some(h => ringContains(h, p.x, p.y)); };
  const contains = (p: Point): boolean => {
    for (const i of large) if (inside(i, p)) return true;
    for (const i of index.query(p.x, p.y, p.x, p.y)) if (inside(i, p)) return true;
    return false;
  };
  const result = { shapes, contains };
  channelCache.set(geometry, result); return result;
}

interface SharedGround { ground: CityGround; stamp: number }
const sharedGrounds = new WeakMap<CityGroundRaster, SharedGround>();
let recentGrounds: SharedGround[] = [];
/** Content stamp of the water cells (FNV-1a): a raster edited in place gets a new clipper. */
function waterStamp(raster: CityGroundRaster): number {
  const water = raster.water;
  let hash = Math.imul(0x811c9dc5 ^ raster.n, 0x01000193);
  hash = Math.imul(hash ^ water.length, 0x01000193);
  for (let i = 0; i < water.length; i++) hash = Math.imul(hash ^ water[i], 0x01000193);
  return hash >>> 0;
}
function sameVectorWater(a: Point[][][] | undefined, b: Point[][][] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let g = 0; g < a.length; g++) {
    const ga = a[g], gb = b[g];
    if (ga === gb) continue;
    if (ga.length !== gb.length) return false;
    for (let r = 0; r < ga.length; r++) {
      const ra = ga[r], rb = gb[r];
      if (ra === rb) continue;
      if (ra.length !== rb.length) return false;
      for (let k = 0; k < ra.length; k++) if (ra[k].x !== rb[k].x || ra[k].y !== rb[k].y) return false;
    }
  }
  return true;
}
function sameGround(a: CityGroundRaster, b: CityGroundRaster): boolean {
  if (a === b) return true;
  if (a.n !== b.n || a.width !== b.width || a.water.length !== b.water.length) return false;
  if (a.water !== b.water) for (let i = 0; i < a.water.length; i++) if (a.water[i] !== b.water[i]) return false;
  return sameVectorWater(a.geometry?.water, b.geometry?.water);
}
/** The clipper of a display ground, shared by every plan drawn on it: the 2D plan of each town and the 3D plan clip
 * the same lot, block and quarter shapes, so each shape meets the water once. A raster is matched by identity, else
 * by content (the 3D decor rebuilds the ground the engine retained: same cells, same vector water). */
export function cityGroundFor(raster: CityGroundRaster): CityGround {
  const stamp = waterStamp(raster);
  let entry = sharedGrounds.get(raster);
  // A shared clipper built on another raster object stays valid only while that raster keeps the same cells.
  if (!entry || entry.stamp !== stamp || entry.ground.raster !== raster && waterStamp(entry.ground.raster) !== stamp) {
    entry = recentGrounds.find(e => e.stamp === stamp && waterStamp(e.ground.raster) === stamp && sameGround(e.ground.raster, raster)) ?? { ground: new CityGround(raster), stamp };
    sharedGrounds.set(raster, entry);
    recentGrounds = [entry, ...recentGrounds.filter(e => e !== entry)].slice(0, 2);
  }
  return entry.ground;
}

/** Cached per plan, not per frame. The water boolean runs in Rust (i_overlay), batched per scene. */
export class CityGround {
  private cache = new WeakMap<Shape, Shape[]>();
  private channels?: Channels;
  private clippingRaster: CityGroundRaster;
  constructor(readonly raster: CityGroundRaster) {
    this.channels = raster.geometry && channels(raster.geometry);
    // River/lake raster cells are conservative planning envelopes. Their square
    // edges must not cut a staircase outside the retained physical vector banks.
    this.clippingRaster = this.channels?.shapes.length ? { ...raster, water: Uint8Array.from(raster.water, v => v === 1 ? 1 : 0) } : raster;
  }
  waterAt(p: Point): boolean {
    const { n, width, water } = this.clippingRaster;
    const x = Math.max(0, Math.min(n - 1, Math.floor(p.x * n / width))), y = Math.max(0, Math.min(n - 1, Math.floor(p.y * n / width)));
    return wet(water[y * n + x]) || !!this.channels?.contains(p);
  }
  private dryRuns(): Run[] {
    const { n } = this.raster, finished: Run[] = [];
    let active = new Map<string, Run>();
    for (let y = 0; y < n; y++) {
      const next = new Map<string, Run>();
      for (let x = 0; x < n;) {
        if (wet(this.clippingRaster.water[y * n + x])) { x++; continue; }
        const start = x++;
        while (x < n && !wet(this.clippingRaster.water[y * n + x])) x++;
        const key = `${start}:${x}`, run = active.get(key) ?? { x0: start, x1: x, y0: y, y1: y + 1 };
        run.y1 = y + 1; next.set(key, run); active.delete(key);
      }
      finished.push(...active.values()); active = next;
    }
    finished.push(...active.values()); return finished;
  }
  /** Dry rectangles also provide one batched SVG clip for the land-use layer. */
  land(): Shape[] {
    const { n, width } = this.raster;
    return this.clipMany(this.dryRuns().map(r => rectangle(r, width / n))).flat();
  }
  clip(shape: Shape): Shape[] { return this.cache.get(shape) ?? this.clipMany([shape])[0]; }
  /** Clips ahead, elsewhere: the shapes not clipped yet go to `run` in `shares` packed tasks (workers run the same
   * Rust kernel on each, `clipCityGroundPacked`), and the results are kept, so the next `clipMany` of these shapes
   * only reads them. Returns the number of shapes clipped ahead; a failed run leaves them to `clipMany`. */
  async clipAhead(shapes: readonly Shape[], shares: number, run: (tasks: GroundClipTask[]) => Promise<Float64Array[]>): Promise<number> {
    const missing = [...new Set(shapes.filter(s => !this.cache.has(s)))];
    if (!missing.length || !(shares >= 1)) return 0;
    const { n, width, water } = this.clippingRaster, canals = packClipShapes(this.channels?.shapes ?? []);
    // Dealt in turn: the lots along a river cost far more than the others and come in runs (a town, a quarter).
    const parts: Shape[][] = Array.from({ length: Math.min(Math.floor(shares), missing.length) }, () => []);
    missing.forEach((shape, i) => parts[i % parts.length].push(shape));
    const results = await run(parts.map(part => ({ n, width, water, canals, subjects: packClipShapes(part) })));
    if (results.length !== parts.length) return 0;
    parts.forEach((part, k) => unpackClippedGround(results[k], part).forEach((clipped, i) => { if (!this.cache.has(part[i])) this.cache.set(part[i], clipped); }));
    return missing.length;
  }
  /** Shapes of `shapes` that `clipMany` would still send to the kernel. */
  unclipped(shapes: readonly Shape[]): number { let n = 0; for (const s of shapes) if (!this.cache.has(s)) n++; return n; }
  /** One WASM call for every shape not clipped yet; a shape far from water is returned as itself. */
  clipMany(shapes: readonly Shape[]): Shape[][] {
    const missing = [...new Set(shapes.filter(s => !this.cache.has(s)))];
    if (missing.length) {
      const clipped = clipCityGround(this.clippingRaster, this.channels?.shapes ?? [], missing);
      missing.forEach((s, i) => this.cache.set(s, clipped[i]));
    }
    return shapes.map(s => this.cache.get(s)!);
  }
}
