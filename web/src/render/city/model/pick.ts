/**
 * Picking in the town model: the topmost item under a world point, by exact polygon test over the spatial bins.
 * Called by the pages' pointer handlers and by the GPU town's pick.
 */
import type { Point } from '../../../../../rust/bridge/urban';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { Box, CityScene, CityBuildings, CityPick } from './contract';
import { shapeContains } from './geometry';

export function pickBuilding(buildings: CityBuildings, p: Point) {
  const point = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  for (const i of buildings.bins.query(point).reverse()) if (buildings.items[i].surface.some(s => shapeContains(s, p))) return buildings.items[i];
}
/** Topmost item under a world point: building, then parcel, then block. */
export function pickCity(scene: CityScene, buildings: CityBuildings | undefined, p: Point): CityPick {
  const point: Box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
    result: CityPick = {};
  if (buildings) {
    const building = pickBuilding(buildings, p);
    if (building) result.building = building;
  }
  for (const i of scene.bins.parcels.query(point).reverse())
    if (shapeContains(scene.parcels[i].shape, p)) {
      result.parcel = scene.parcels[i];
      break;
    }
  for (const i of scene.bins.blocks.query(point).reverse())
    if (shapeContains(scene.blocks[i].shape, p)) {
      result.block = scene.blocks[i];
      break;
    }
  return result;
}
