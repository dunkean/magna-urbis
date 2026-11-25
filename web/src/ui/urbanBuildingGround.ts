import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingGroundConstraints } from './urbanBuildingProjection';
import type { Polygon, Surface } from '../../../rust/bridge/housesContract';
import type { CutBuilding } from '../render/city3d/terrainSeat';
import { ringContains } from '../render/ringRows';

const CELL = 64;
// Keep the terrain triangles beside a facade below its native footing, then
// return smoothly to the relief. A polygon-only cut turns into a sawtooth on
// the regular terrain grid, even when the underlying height field is smooth.
const FOOTING_MARGIN = 2,
  BLEND_MARGIN = 8;
/** One indexed shape: reject its padded bounds before testing rings and edge distances. */
interface Entry {
  shape: Polygon;
  height: number;
  /** False for a building the ground is already shaped to (urbanGroundShape.ts): nothing moves past its walls. */
  collar: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  near?: NearEdges | null;
}
/** Edges of a long shape (a moat ring runs round a whole town) by cells: each edge is listed in the cells its box,
 * grown by the blend margin, touches. */
interface NearEdges {
  cell: number;
  cols: number;
  rows: number;
  lists: (Int32Array | undefined)[];
  edges: Float64Array;
}
/** Shapes with fewer points keep the edge-by-edge loop. */
const NEAR_MIN_POINTS = 48,
  NEAR_CELL = 16;
function nearEdges(e: Entry): NearEdges | null {
  if (e.near !== undefined) return e.near;
  const shape = e.shape;
  let points = shape.outer.length;
  for (const hole of shape.holes) points += hole.length;
  if (points < NEAR_MIN_POINTS || !Number.isFinite(e.x1 - e.x0) || !Number.isFinite(e.y1 - e.y0)) return (e.near = null);
  const gx = e.x0 - BLEND_MARGIN,
    gy = e.y0 - BLEND_MARGIN;
  // Coarser cells on a very large shape: the lists stay within a few entries per point.
  let cell = NEAR_CELL;
  while ((Math.floor((e.x1 + BLEND_MARGIN - gx) / cell) + 1) * (Math.floor((e.y1 + BLEND_MARGIN - gy) / cell) + 1) > 262144) cell *= 2;
  const cols = Math.floor((e.x1 + BLEND_MARGIN - gx) / cell) + 1,
    rows = Math.floor((e.y1 + BLEND_MARGIN - gy) / cell) + 1;
  const lists: number[][] = [],
    edges = new Float64Array(points * 4);
  let id = 0;
  for (let r = -1; r < shape.holes.length; r++) {
    const ring = r < 0 ? shape.outer : shape.holes[r];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++, id++) {
      const a = ring[i],
        b = ring[j];
      edges[id * 4] = a.x;
      edges[id * 4 + 1] = a.y;
      edges[id * 4 + 2] = b.x;
      edges[id * 4 + 3] = b.y;
      // An edge with a point outside the outer ring's box (a hole) or without finite ends: no index for this shape.
      const c0 = Math.floor((Math.min(a.x, b.x) - BLEND_MARGIN - gx) / cell),
        c1 = Math.floor((Math.max(a.x, b.x) + BLEND_MARGIN - gx) / cell);
      const r0 = Math.floor((Math.min(a.y, b.y) - BLEND_MARGIN - gy) / cell),
        r1 = Math.floor((Math.max(a.y, b.y) + BLEND_MARGIN - gy) / cell);
      if (!(c0 >= -1 && r0 >= -1 && c1 <= cols && r1 <= rows)) return (e.near = null);
      for (let row = Math.max(0, r0); row <= Math.min(rows - 1, r1); row++) for (let col = Math.max(0, c0); col <= Math.min(cols - 1, c1); col++) (lists[row * cols + col] ??= []).push(id);
    }
  }
  return (e.near = { cell, cols, rows, lists: lists.map(list => list && Int32Array.from(list)), edges });
}
function distance(e: Entry, x: number, y: number): number {
  if (x < e.x0 - BLEND_MARGIN || x > e.x1 + BLEND_MARGIN || y < e.y0 - BLEND_MARGIN || y > e.y1 + BLEND_MARGIN) return Infinity;
  const near = nearEdges(e);
  if (near) {
    // Inside: the parity over every ring, read on the rows of each. Outside: the caller only reads distances below
    // the blend margin, and an edge that near lists itself in the point's cell, so the minimum is the same.
    let inside = ringContains(e.shape.outer, x, y);
    for (const hole of e.shape.holes) if (ringContains(hole, x, y)) inside = !inside;
    if (inside) return 0;
    const list = near.lists[Math.floor((y - (e.y0 - BLEND_MARGIN)) / near.cell) * near.cols + Math.floor((x - (e.x0 - BLEND_MARGIN)) / near.cell)],
      edges = near.edges;
    let squared = Infinity;
    if (list)
      for (let k = 0; k < list.length; k++) {
        const o = list[k] * 4,
          ax = edges[o],
          ay = edges[o + 1],
          dx = edges[o + 2] - ax,
          dy = edges[o + 3] - ay,
          length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
        squared = Math.min(squared, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2);
      }
    return Math.sqrt(squared);
  }
  let inside = false,
    squared = Infinity;
  const shape = e.shape;
  for (let r = -1; r < shape.holes.length; r++) {
    const ring = r < 0 ? shape.outer : shape.holes[r];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      squared = Math.min(squared, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
    }
  }
  return inside ? 0 : Math.sqrt(squared);
}
/** Presentation detail exclusion, independent of camera and water visibility.
 * The native physical foundation is never moved to follow refined terrain.
 * Each footprint includes a smooth collar around its edges. Every shape is
 * indexed on its own: a yard batch (hundreds of fence strips over
 * 128 m) costs one box test per strip of its 64 m cell, not a full scan. */
export class UrbanBuildingGround {
  private cells = new Map<number, Entry[]>();
  constructor(scene?: Building3dScene) {
    for (const building of scene?.occupationBuildings ?? scene?.buildings ?? []) {
      const collar = !(building as CutBuilding).cutGround;
      for (const constraint of buildingGroundConstraints(building)) this.insert(constraint.footprint, constraint.height_m, collar);
    }
  }
  private static key(x: number, y: number): number {
    return (x + 32768) * 65536 + (y + 32768);
  }
  private insert(footprint: Surface, height: number, collar: boolean): void {
    for (const shape of footprint) {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const p of shape.outer) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      if (!(x0 <= x1 && y0 <= y1)) continue;
      const entry: Entry = { shape, height, collar, x0, y0, x1, y1 };
      for (let y = Math.floor((y0 - BLEND_MARGIN) / CELL); y <= Math.floor((y1 + BLEND_MARGIN) / CELL); y++)
        for (let x = Math.floor((x0 - BLEND_MARGIN) / CELL); x <= Math.floor((x1 + BLEND_MARGIN) / CELL); x++) {
          const key = UrbanBuildingGround.key(x, y),
            list = this.cells.get(key);
          if (list) list.push(entry);
          else this.cells.set(key, [entry]);
        }
    }
  }
  constrain(x: number, y: number, height: number): number {
    const list = this.cells.get(UrbanBuildingGround.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    const original = height;
    if (list)
      for (const entry of list)
        if (entry.height < original) {
          const d = distance(entry, x, y);
          if (d >= BLEND_MARGIN || (d > 0 && !entry.collar)) continue;
          const t = Math.max(0, (d - FOOTING_MARGIN) / (BLEND_MARGIN - FOOTING_MARGIN));
          // Evaluate every constraint against the original surface: overlapping
          // collars must not depend on the insertion order of neighbouring houses.
          height = Math.min(height, entry.height + (original - entry.height) * t * t * (3 - 2 * t));
        }
    return height;
  }
}
