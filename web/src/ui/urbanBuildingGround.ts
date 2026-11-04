import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingGroundConstraints } from './urbanBuildingProjection';
import type { Polygon, Surface } from '../../../rust/bridge/housesContract';

const CELL = 64;
/** One indexed shape: its bounding box first, the even-odd ring test only inside it. */
interface Entry { shape: Polygon; height: number; x0: number; y0: number; x1: number; y1: number }
function contains(e: Entry, x: number, y: number): boolean {
  if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) return false;
  let inside = false;
  const shape = e.shape;
  for (let r = -1; r < shape.holes.length; r++) {
    const ring = r < 0 ? shape.outer : shape.holes[r];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}
/** Presentation detail exclusion, independent of camera and water visibility.
 * The native physical foundation is never moved to follow refined terrain.
 * A footprint constrains where any of its shapes contains the point, so each
 * shape is indexed on its own: a yard batch (hundreds of fence strips over
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
      for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y++) for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) {
        const key = UrbanBuildingGround.key(x, y), list = this.cells.get(key);
        if (list) list.push(entry); else this.cells.set(key, [entry]);
      }
    }
  }
  constrain(x: number, y: number, height: number): number {
    const list = this.cells.get(UrbanBuildingGround.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (list) for (const entry of list) if (entry.height < height && contains(entry, x, y)) height = entry.height;
    return height;
  }
}
