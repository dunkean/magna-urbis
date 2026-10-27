/** Display ground follows physical water, never the planner's dry stilt mask. */
import type { Point, Shape } from '../../../rust/bridge/urban';
import { fromGeom, toGeom, tryDifference } from '../gen/geo/bool';
import { GridIndex } from '../gen/geo/spatial';
import { polygonContains } from '../gen/core/geom';
import polygonClipping from '../vendor/polygonClipping';

export interface CityGroundRaster { width: number; n: number; water: Uint8Array; geometry?: { water: Point[][][] } }
export const isBoardwalk = (role: string): boolean => ['pier', 'boardwalk', 'walkway'].includes(role);
export const boardwalkWidth = (width: number): number => Number.isFinite(width) ? Math.max(1.2, Math.min(3, width)) : 2;
const wet = (v: number): boolean => v > 0 && v < 4;
interface Run { x0: number; x1: number; y0: number; y1: number }
const rectangle = (r: Run, cell: number): Shape => ({ outer: [
  { x: r.x0 * cell, y: r.y0 * cell }, { x: r.x1 * cell, y: r.y0 * cell },
  { x: r.x1 * cell, y: r.y1 * cell }, { x: r.x0 * cell, y: r.y1 * cell },
], holes: [] });
type Channels = (x0: number, y0: number, x1: number, y1: number) => Shape[];
const channelCache = new WeakMap<object, Channels>();
const xor = polygonClipping.xor as (...geometries: ReturnType<typeof toGeom>[]) => ReturnType<typeof toGeom>;
/** Thin vector canals can fall between two dry raster centres. Keep their actual holes. */
function channels(geometry: NonNullable<CityGroundRaster['geometry']>): Channels {
  const cached = channelCache.get(geometry); if (cached) return cached;
  const shapes = geometry.water.flatMap(group => {
    const rings = group.filter(r => r.length >= 3);
    return rings.length > 1 ? fromGeom(xor(...rings.map(r => toGeom(r))), 0.001, false, true)
      : rings.length ? [{ outer: rings[0], holes: [] }] : [];
  });
  const index = new GridIndex<number>(128), large: number[] = [], bounds = shapes.map((shape, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of shape.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    if ((Math.ceil((x1-x0)/128)+1)*(Math.ceil((y1-y0)/128)+1) > 256) large.push(i);
    else index.insertBox(x0, y0, x1, y1, i);
    return { x0, y0, x1, y1 };
  });
  const query: Channels = (x0, y0, x1, y1) => [...new Set([...large, ...index.query(x0, y0, x1, y1)])]
    .filter(i => { const b = bounds[i]; return b.x0 <= x1 && b.y0 <= y1 && b.x1 >= x0 && b.y1 >= y0; }).map(i => shapes[i]);
  channelCache.set(geometry, query); return query;
}

/** Cached per plan, not per frame. Only mixed shoreline polygons need a boolean. */
export class CityGround {
  private cache = new WeakMap<Shape, Shape[]>();
  private channels?: Channels;
  constructor(readonly raster: CityGroundRaster) { this.channels = raster.geometry && channels(raster.geometry); }
  waterAt(p: Point): boolean {
    const { n, width, water } = this.raster;
    const x = Math.max(0, Math.min(n - 1, Math.floor(p.x * n / width))), y = Math.max(0, Math.min(n - 1, Math.floor(p.y * n / width)));
    return wet(water[y * n + x]) || !!this.channels?.(p.x, p.y, p.x, p.y).some(s => polygonContains(s.outer, p) && !s.holes.some(h => polygonContains(h, p)));
  }
  private runs(x0: number, y0: number, x1: number, y1: number, water: boolean): Run[] {
    const { n } = this.raster, finished: Run[] = [];
    let active = new Map<string, Run>();
    for (let y = y0; y < y1; y++) {
      const next = new Map<string, Run>();
      for (let x = x0; x < x1;) {
        if (wet(this.raster.water[y * n + x]) !== water) { x++; continue; }
        const start = x++;
        while (x < x1 && wet(this.raster.water[y * n + x]) === water) x++;
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
    return this.runs(0, 0, n, n, false).flatMap(r => this.clip(rectangle(r, width / n)));
  }
  clip(shape: Shape): Shape[] {
    const cached = this.cache.get(shape); if (cached) return cached;
    const { n, width } = this.raster, cell = width / n;
    if (!n || !(cell > 0) || this.raster.water.length !== n * n || !shape.outer.length) return [shape];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of shape.outer) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const x0 = Math.max(0, Math.floor(minX / cell)), y0 = Math.max(0, Math.floor(minY / cell));
    const x1 = Math.min(n, Math.ceil(maxX / cell)), y1 = Math.min(n, Math.ceil(maxY / cell));
    const water = this.runs(x0, y0, x1, y1, true);
    let result: Shape[];
    if (!water.length) result = [shape];
    else if (minX >= 0 && minY >= 0 && maxX <= width && maxY <= width
      && water.reduce((sum, r) => sum + (r.x1 - r.x0) * (r.y1 - r.y0), 0) === (x1 - x0) * (y1 - y0)) result = [];
    else result = tryDifference(shape, water.map(r => rectangle(r, cell))).pieces;
    const canals = result.length ? this.channels?.(minX, minY, maxX, maxY) : undefined;
    if (canals && canals.length) result = tryDifference(result, canals).pieces;
    this.cache.set(shape, result); return result;
  }
}
