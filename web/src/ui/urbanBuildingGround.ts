import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingGroundConstraints } from './urbanBuildingProjection';
import type { Polygon, Surface } from '../../../rust/bridge/housesContract';

const CELL = 64;
// Keep the terrain triangles beside a facade below its native footing, then
// return smoothly to the relief. A polygon-only cut turns into a sawtooth on
// the regular terrain grid, even when the underlying height field is smooth.
const FOOTING_MARGIN = 2, BLEND_MARGIN = 8;
/** One indexed shape: reject its padded bounds before testing rings and edge distances. */
interface Entry { shape: Polygon; height: number; x0: number; y0: number; x1: number; y1: number }
function distance(e: Entry, x: number, y: number): number {
  if (x < e.x0 - BLEND_MARGIN || x > e.x1 + BLEND_MARGIN || y < e.y0 - BLEND_MARGIN || y > e.y1 + BLEND_MARGIN) return Infinity;
  let inside = false, squared = Infinity;
  const shape = e.shape;
  for (let r = -1; r < shape.holes.length; r++) {
    const ring = r < 0 ? shape.outer : shape.holes[r];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
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
      for (const constraint of buildingGroundConstraints(building)) this.insert(constraint.footprint, constraint.height_m);
    }
  }
  private static key(x: number, y: number): number { return (x + 32768) * 65536 + (y + 32768); }
  private insert(footprint: Surface, height: number): void {
    for (const shape of footprint) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of shape.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      if (!(x0 <= x1 && y0 <= y1)) continue;
      const entry: Entry = { shape, height, x0, y0, x1, y1 };
      for (let y = Math.floor((y0 - BLEND_MARGIN) / CELL); y <= Math.floor((y1 + BLEND_MARGIN) / CELL); y++) for (let x = Math.floor((x0 - BLEND_MARGIN) / CELL); x <= Math.floor((x1 + BLEND_MARGIN) / CELL); x++) {
        const key = UrbanBuildingGround.key(x, y), list = this.cells.get(key);
        if (list) list.push(entry); else this.cells.set(key, [entry]);
      }
    }
  }
  constrain(x: number, y: number, height: number): number {
    const list = this.cells.get(UrbanBuildingGround.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    const original = height;
    if (list) for (const entry of list) if (entry.height < original) {
      const d = distance(entry, x, y);
      if (d >= BLEND_MARGIN) continue;
      const t = Math.max(0, (d - FOOTING_MARGIN) / (BLEND_MARGIN - FOOTING_MARGIN));
      // Evaluate every constraint against the original surface: overlapping
      // collars must not depend on the insertion order of neighbouring houses.
      height = Math.min(height, entry.height + (original - entry.height) * t * t * (3 - 2 * t));
    }
    return height;
  }
}
