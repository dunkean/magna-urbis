/**
 * The building volume under a pixel of a tilted view, on the CPU and only on a click: the ray of the pixel
 * (camera.ts `pixelRay`) against the boxes of the building blocks (buildingsBlocks.ts), nearest first, then against the
 * boxes of the buildings of the blocks it enters. The boxes are those the volumes are drawn in (heights as drawn,
 * times the frame's rise), so a click on a roof or a wall finds its building; a box is a little larger than its
 * building, which is what a click wants. Lot boundaries are not picked. The caller compares the distance with the
 * ground's on the same ray (camera.ts `groundHit`): a building behind a hill is not picked.
 */
import type { Building3dVisual } from '../urbanBuildingGeometry';
import { buildingBounds } from './buildingsMesh';
import { buildingSpan, type BuildingBlock } from './buildingsBlocks';
import type { WorldRelief } from './contract';

/** Where the ray from `o` along `d` enters the box: its `t` (0 when it starts inside), Infinity when it misses it. */
export function rayBox(o: ArrayLike<number>, d: ArrayLike<number>, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  let near = 0,
    far = Infinity;
  const slab = (origin: number, direction: number, low: number, high: number): boolean => {
    if (Math.abs(direction) < 1e-12) return origin >= low && origin <= high;
    let a = (low - origin) / direction,
      b = (high - origin) / direction;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    return near <= far;
  };
  return slab(o[0], d[0], minX, maxX) && slab(o[1], d[1], minY, maxY) && slab(o[2], d[2], minZ, maxZ) ? near : Infinity;
}

export interface BuildingPick {
  building: Building3dVisual;
  /** Along the ray's direction, as `rayBox`. */
  t: number;
}

const span: [number, number] = [0, 0];
/** The building first met by the ray from `origin` along `direction` (map metres, z as drawn) before `limit`, among
 * those `accept` takes. `rise`: the share of the relief the frame shows (FrameCamera.rise). */
export function pickBuilding(blocks: readonly BuildingBlock[], origin: ArrayLike<number>, direction: ArrayLike<number>, rise: number, relief: WorldRelief, exaggeration: number, limit: number, accept: (building: Building3dVisual) => boolean): BuildingPick | undefined {
  const entered: { block: BuildingBlock; t: number }[] = [];
  for (const block of blocks) {
    if (block.yard || !block.buildings.length) continue;
    const t = rayBox(origin, direction, block.minX, block.minY, block.low * rise, block.maxX, block.maxY, block.high * rise);
    if (t < limit) entered.push({ block, t });
  }
  entered.sort((a, b) => a.t - b.t);
  let best: BuildingPick | undefined;
  for (const { block, t: entry } of entered) {
    if (best && entry >= best.t) break;
    for (const building of block.buildings) {
      const box = buildingBounds(building);
      buildingSpan(building, box, relief, exaggeration, span);
      const t = rayBox(origin, direction, box[0], box[1], span[0] * rise, box[3], box[4], span[1] * rise);
      if (t < limit && (!best || t < best.t) && accept(building)) best = { building, t };
    }
  }
  return best;
}
