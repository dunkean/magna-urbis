/** Display ground follows physical water, never the planner's dry stilt mask. */
import type { Point, Shape } from '../../../rust/bridge/urban';
import { cityCanals, clipCityGround } from '../../../rust/bridge/renderGeometry';
import { GridIndex } from '../gen/geo/spatial';
import { polygonContains } from '../gen/core/geom';

export interface CityGroundRaster { width: number; n: number; water: Uint8Array; geometry?: { water: Point[][][] } }
export const isBoardwalk = (role: string): boolean => ['pier', 'boardwalk', 'walkway'].includes(role);
export const boardwalkWidth = (width: number): number => Number.isFinite(width) ? Math.max(1.2, Math.min(3, width)) : 2;
const wet = (v: number): boolean => v > 0 && v < 4;
interface Run { x0: number; x1: number; y0: number; y1: number }
const rectangle = (r: Run, cell: number): Shape => ({ outer: [
  { x: r.x0 * cell, y: r.y0 * cell }, { x: r.x1 * cell, y: r.y0 * cell },
  { x: r.x1 * cell, y: r.y1 * cell }, { x: r.x0 * cell, y: r.y1 * cell },
], holes: [] });
interface Channels { shapes: Shape[]; query: (x0: number, y0: number, x1: number, y1: number) => Shape[] }
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
  const query = (x0: number, y0: number, x1: number, y1: number) => [...new Set([...large, ...index.query(x0, y0, x1, y1)])]
    .filter(i => { const b = bounds[i]; return b.x0 <= x1 && b.y0 <= y1 && b.x1 >= x0 && b.y1 >= y0; }).map(i => shapes[i]);
  const result = { shapes, query };
  channelCache.set(geometry, result); return result;
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
    return wet(water[y * n + x]) || !!this.channels?.query(p.x, p.y, p.x, p.y).some(s => polygonContains(s.outer, p) && !s.holes.some(h => polygonContains(h, p)));
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
