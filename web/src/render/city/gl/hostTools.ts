/**
 * What the hosts of the GPU town need beside the renderer: the layers left to their Canvas 2D overlay, picking, and
 * the plan mesh without a context (tests, tools).
 */
import type { Point } from '../../../../../rust/bridge/urban';
import type { CityLayers, CityScene } from '../model/contract';
import type { BuildingSet } from './buildingSet';
import { pickBuilding, pickCity } from '../model/pick';
import { buildFillMeshSync, packPlan, type CityGlFillMesh } from '../../cityGlBuild';
// walls hook (cityWalls.ts)
import { CityGlPick } from './contract';

/** Layers left for the Canvas 2D overlay (drawCity) once the GPU draws the plan:
 * diagnostics, landmark glyphs, labels and district names only. */
export function cityGlOverlayLayers(layers: CityLayers): CityLayers {
  return { ...layers, waterways: layers.waterways !== false, blocks: false, domains: false, streets: false, enclosures: false, parcels: false, gardens: false, places: false };
}
/** Topmost visible item under a world point (building, then parcel, then block), with its id. */
export function cityGlPick(scene: CityScene, buildings: BuildingSet | undefined, point: Point): CityGlPick {
  const hit: CityGlPick = pickCity(scene, buildings && !('towns' in buildings) ? buildings : undefined, point);
  if (buildings && 'towns' in buildings)
    for (let i = buildings.towns.length - 1; i >= 0; i--) {
      const town = buildings.towns[i],
        b = pickBuilding(town.set, point);
      if (b) {
        hit.building = town.parcelOffset && b.parcel !== undefined ? { ...b, parcel: b.parcel + town.parcelOffset } : b;
        break;
      }
    }
  if (hit.building) {
    hit.kind = 'building';
    hit.id = hit.building.id;
  } else if (hit.parcel) {
    hit.kind = 'parcel';
    hit.id = hit.parcel.id;
  } else if (hit.block) hit.kind = 'block';
  return hit;
}

/** Synchronous mesh of a scene (tests, tools): the plan fill mesh. */
export const cityGlPlanMesh = (scene: CityScene): CityGlFillMesh => buildFillMeshSync(packPlan(scene));
