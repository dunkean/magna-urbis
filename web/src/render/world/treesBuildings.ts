/** Building footprints for modelled trees. The world tree layer indexes a published town scene once; block builders
 * query only the cells around a trunk. Painted ground crowns keep their existing occupation-raster rules. */
import type { Point, Polygon } from '../../../../rust/bridge/housesContract';
import { isYardMesh, type Building3dScene } from '../urbanBuildingGeometry';
import { ringContains } from '../ringRows';
import { TREES_BLOCK } from './treesBlocks';

const CELL = 32;
/** Widest wall margin (m): the footprints this near a block decide which of its trees stand. */
const REACH = 3;
/** Small trees keep their crown clear of a wall; large trees may overhang, but their trunk stays outside. */
export const treeBuildingMargin = (radius: number): number => Math.min(REACH, Math.max(0.5, radius));

function segmentDistanceSquared(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy,
    t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
  return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
}

const hash = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

export class TreeBuildings {
  private readonly cells = new Map<string, Polygon[]>();
  /** Per block of trees: sum and exclusive or of the hashes of the footprints that reach it, whatever their order. */
  private readonly blocks = new Map<number, [number, number]>();
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
        const signature = hash(JSON.stringify(shape));
        for (let y = Math.floor((minY - REACH) / TREES_BLOCK); y <= Math.floor((maxY + REACH) / TREES_BLOCK); y++)
          for (let x = Math.floor((minX - REACH) / TREES_BLOCK); x <= Math.floor((maxX + REACH) / TREES_BLOCK); x++) {
            const key = y * 65536 + x,
              block = this.blocks.get(key);
            if (block) {
              block[0] = (block[0] + signature) >>> 0;
              block[1] = (block[1] ^ signature) >>> 0;
            } else this.blocks.set(key, [signature, signature]);
          }
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

  /** Stamp of the footprints that can affect the block (bx, by); 0 off the buildings. Cheap: read per frame. */
  blockKey(bx: number, by: number): number {
    const block = this.blocks.get(by * 65536 + bx);
    return block ? block[0] * 0x100000 + (block[1] & 0xfffff) : 0;
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
