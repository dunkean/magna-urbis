import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingGroundConstraints } from './urbanBuildingProjection';
import type { Surface } from '../../../rust/bridge/housesContract';

function contains(surface: Surface, x: number, y: number): boolean {
  return surface.some(shape => {
    let inside = false;
    for (const ring of [shape.outer, ...shape.holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
}
/** Presentation detail exclusion, independent of camera and water visibility.
 * The native physical foundation is never moved to follow refined terrain. */
export class UrbanBuildingGround {
  private cells = new Map<string, { footprint: Surface; height: number }[]>();
  constructor(scene?: Building3dScene) {
    for (const building of scene?.occupationBuildings ?? scene?.buildings ?? []) {
      for (const constraint of buildingGroundConstraints(building)) this.insert(constraint.footprint, constraint.height_m);
    }
  }
  private insert(footprint: Surface, height: number): void {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const shape of footprint) for (const p of shape.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const entry = { footprint, height };
    for (let y = Math.floor(y0 / 64); y <= Math.floor(y1 / 64); y++) for (let x = Math.floor(x0 / 64); x <= Math.floor(x1 / 64); x++) {
      const key = `${x},${y}`, list = this.cells.get(key);
      if (list) list.push(entry); else this.cells.set(key, [entry]);
    }
  }
  constrain(x: number, y: number, height: number): number {
    for (const entry of this.cells.get(`${Math.floor(x / 64)},${Math.floor(y / 64)}`) ?? []) if (contains(entry.footprint, x, y)) height = Math.min(height, entry.height);
    return height;
  }
}
