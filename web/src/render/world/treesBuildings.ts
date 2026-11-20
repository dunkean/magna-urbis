/** Building footprints for modelled trees. The world tree layer indexes a published town scene once; block builders
 * query only the cells around a trunk. Painted ground crowns keep their existing occupation-raster rules. */
import type { Point, Polygon } from '../../../../rust/bridge/housesContract';
import { isYardMesh, type Building3dScene } from '../urbanBuildingGeometry';
import { ringContains } from '../ringRows';

const CELL = 32;
/** Small trees keep their crown clear of a wall; large trees may overhang, but their trunk stays outside. */
export const treeBuildingMargin = (radius: number): number => Math.min(3, Math.max(0.5, radius));

function segmentDistanceSquared(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy,
    t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
  return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
}

export class TreeBuildings {
  private readonly cells = new Map<string, Polygon[]>();
  private readonly signatures = new WeakMap<Polygon, string>();
  constructor(scene: Building3dScene) {
    for (const building of scene.buildings) {
      if (isYardMesh(building)) continue;
      for (const shape of building.footprint) {
        if (shape.outer.length < 3) continue;
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const p of shape.outer) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;
        this.signatures.set(shape, JSON.stringify(shape));
        for (const ring of [shape.outer, ...shape.holes]) ringContains(ring, minX, minY);
        for (let y = Math.floor(minY / CELL); y <= Math.floor(maxY / CELL); y++)
          for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
            const key = `${x},${y}`,
              cell = this.cells.get(key);
            if (cell) cell.push(shape);
            else this.cells.set(key, [shape]);
          }
      }
    }
  }

  /** Only footprints within the maximum wall margin can affect this block. */
  key(x: number, y: number, size: number): string {
    const shapes = new Set<Polygon>();
    for (let cy = Math.floor((y - 3) / CELL); cy <= Math.floor((y + size + 3) / CELL); cy++) for (let cx = Math.floor((x - 3) / CELL); cx <= Math.floor((x + size + 3) / CELL); cx++) for (const shape of this.cells.get(`${cx},${cy}`) ?? []) shapes.add(shape);
    return [...shapes]
      .map(shape => this.signatures.get(shape)!)
      .sort()
      .join('|');
  }

  keeps(x: number, y: number, radius: number): boolean {
    const margin = treeBuildingMargin(radius),
      distance = margin * margin;
    for (let cy = Math.floor((y - margin) / CELL); cy <= Math.floor((y + margin) / CELL); cy++)
      for (let cx = Math.floor((x - margin) / CELL); cx <= Math.floor((x + margin) / CELL); cx++)
        for (const shape of this.cells.get(`${cx},${cy}`) ?? []) {
          if (ringContains(shape.outer, x, y) && !shape.holes.some(hole => ringContains(hole, x, y))) return false;
          for (const ring of [shape.outer, ...shape.holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segmentDistanceSquared(x, y, ring[j], ring[i]) <= distance) return false;
        }
    return true;
  }
}

const indexes = new WeakMap<Building3dScene, TreeBuildings>();
export function treeBuildings(scene: Building3dScene | undefined): TreeBuildings | undefined {
  if (!scene) return undefined;
  let index = indexes.get(scene);
  if (!index) indexes.set(scene, (index = new TreeBuildings(scene)));
  return index;
}
