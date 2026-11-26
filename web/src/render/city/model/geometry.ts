/**
 * Boxes, rings and spatial bins of the town model. Called by the model builders (scene.ts, buildings.ts, pick.ts)
 * and by the renderers for culling: a query returns the items whose box meets a viewport.
 */
import type { Point, Shape } from '../../../../../rust/bridge/urban';
import type { Surface } from '../../../../../rust/bridge/housesContract';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { Box } from './contract';

export const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
export function grow(box: Box, points: readonly Point[], pad = 0): Box {
  for (const p of points) {
    if (p.x - pad < box.minX) box.minX = p.x - pad;
    if (p.y - pad < box.minY) box.minY = p.y - pad;
    if (p.x + pad > box.maxX) box.maxX = p.x + pad;
    if (p.y + pad > box.maxY) box.maxY = p.y + pad;
  }
  return box;
}
export const shapeBox = (shape: Shape): Box => grow({ ...EMPTY }, shape.outer);
export const surfaceBox = (surface: Surface): Box => surface.reduce((box, shape) => grow(box, shape.outer), { ...EMPTY });
export const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
function inRing(ring: readonly Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].y > p.y !== ring[j].y > p.y && p.x < ((ring[j].x - ring[i].x) * (p.y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) hit = !hit;
  return hit;
}
export const shapeContains = (shape: Shape, p: Point): boolean => inRing(shape.outer, p) && !(shape.holes ?? []).some(h => inRing(h, p));
/** Area-weighted centroid of the outer rings. */
export function centroid(shapes: readonly Shape[]): Point | undefined {
  let a = 0,
    x = 0,
    y = 0;
  for (const { outer } of shapes)
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const c = outer[j].x * outer[i].y - outer[i].x * outer[j].y;
      a += c;
      x += (outer[j].x + outer[i].x) * c;
      y += (outer[j].y + outer[i].y) * c;
    }
  if (Math.abs(a) > 1e-6) return { x: x / (3 * a), y: y / (3 * a) };
  const box = shapes.reduce((b, s) => grow(b, s.outer), { ...EMPTY });
  return Number.isFinite(box.minX) ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : undefined;
}

// ---------------------------------------------------------------- spatial bins
/** Uniform bins over item boxes; a query returns each candidate once, in input order. */
export class SpatialBins {
  /** Merge query results in original town order without reinserting their boxes into another grid. */
  static combined(parts: readonly SpatialBins[]): SpatialBins {
    if (parts.length === 1) return parts[0];
    const offsets: number[] = [];
    let n = 0;
    for (const p of parts) {
      offsets.push(n);
      n += p.boxes.length;
    }
    const result = new SpatialBins([]);
    // Most live scenes only query the bins. Direct box lookups materialise the reference array once.
    let boxes: Box[] | undefined;
    Object.defineProperty(result, 'boxes', { get: () => (boxes ??= parts.flatMap(p => p.boxes)) });
    result.query = box => parts.flatMap((p, i) => p.query(box).map(index => index + offsets[i]));
    return result;
  }
  private cells = new Map<number, number[]>();
  private overflow: number[] = [];
  private seen: Uint32Array;
  private stamp = 0;
  constructor(
    readonly boxes: readonly Box[],
    private readonly cell = 96,
  ) {
    this.seen = new Uint32Array(boxes.length);
    boxes.forEach((box, index) => {
      if (!(box.minX <= box.maxX && box.minY <= box.maxY)) return;
      const x0 = Math.floor(box.minX / cell),
        x1 = Math.floor(box.maxX / cell),
        y0 = Math.floor(box.minY / cell),
        y1 = Math.floor(box.maxY / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) {
        this.overflow.push(index);
        return;
      }
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const key = (x + 32768) * 65536 + (y + 32768),
            list = this.cells.get(key);
          if (list) list.push(index);
          else this.cells.set(key, [index]);
        }
    });
  }
  query(box: Box): number[] {
    const result: number[] = [],
      stamp = ++this.stamp;
    if (stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const take = (i: number): void => {
      if (this.seen[i] !== this.stamp && overlaps(this.boxes[i], box)) {
        this.seen[i] = this.stamp;
        result.push(i);
      }
    };
    const x0 = Math.floor(box.minX / this.cell),
      x1 = Math.floor(box.maxX / this.cell),
      y0 = Math.floor(box.minY / this.cell),
      y1 = Math.floor(box.maxY / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const list of this.cells.values()) for (const i of list) take(i);
    } else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const i of this.cells.get((x + 32768) * 65536 + (y + 32768)) ?? []) take(i);
    for (const i of this.overflow) take(i);
    return result.sort((a, b) => a - b);
  }
}
