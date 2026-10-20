import type { Layout, Shape } from './urban';
import type { Point, RoadOutput } from './settlements';
import { regionalOutsideUrban } from './urbanNetwork';
import type { PaintLanduse } from './fantasyPainting';

export interface UrbanPaintingContext {
  layouts?: Layout[];
  roads?: RoadOutput;
  cities?: { key?: string; center: Point; radius: number }[];
  landuse?: (x: number, y: number) => PaintLanduse | undefined;
}
const masks = new WeakMap<UrbanPaintingContext, { width: number; n: number; contains(x: number, y: number): boolean }>();
function inside(x: number, y: number, ring: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}

/** Painting follows the retained native contours, including their exact holes.
 * The grid indexes candidates; it never replaces an urban boundary with cells. */
export function urbanPaintingMask(width: number, resolution: number, context: UrbanPaintingContext): (x: number, y: number) => boolean {
  const n = Math.min(512, resolution), previous = masks.get(context);
  if (previous?.width === width && previous.n === n) return previous.contains;
  const cell = width / n, roads = new Uint8Array(n * n), candidates = new Map<number, Shape[]>();
  const cells = (x0: number, y0: number, x1: number, y1: number, visit: (i: number, x: number, y: number) => void): void => {
    for (let y = Math.max(0, Math.floor(y0 / cell)); y <= Math.min(n - 1, Math.floor(y1 / cell)); y++) {
      for (let x = Math.max(0, Math.floor(x0 / cell)); x <= Math.min(n - 1, Math.floor(x1 / cell)); x++) visit(y * n + x, (x + .5) * cell, (y + .5) * cell);
    }
  };
  for (const layout of context.layouts ?? []) for (const shape of layout.structure?.allocated ?? layout.quarters.map(q => q.shape)) {
    if (!shape.outer.length) continue;
    const xs = shape.outer.map(p => p.x), ys = shape.outer.map(p => p.y);
    cells(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), i => {
      const list = candidates.get(i); if (list) list.push(shape); else candidates.set(i, [shape]);
    });
  }
  for (const road of regionalOutsideUrban(context.roads, context.layouts ?? [])) for (let i = 1; i < road.path.length; i++) {
    const a = road.path[i - 1], b = road.path[i], clearance = Math.max(cell * 1.5, (road.widths[i - 1] ?? 4) / 2);
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    cells(Math.min(a.x, b.x) - clearance, Math.min(a.y, b.y) - clearance, Math.max(a.x, b.x) + clearance, Math.max(a.y, b.y) + clearance, (j, x, y) => {
      const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) < clearance) roads[j] = 1;
    });
  }
  const cities = context.cities?.filter(c => !context.layouts?.some(l => c.key ? l.key === c.key : l.quarters.length > 0)) ?? [];
  const contains = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= width) return false;
    const i = Math.floor(y / cell) * n + Math.floor(x / cell);
    return roads[i] !== 0 || !!candidates.get(i)?.some(shape => inside(x, y, shape.outer) && !shape.holes.some(h => inside(x, y, h)))
      || cities.some(c => Math.hypot(x - c.center.x, y - c.center.y) < c.radius);
  };
  masks.set(context, { width, n, contains }); return contains;
}
