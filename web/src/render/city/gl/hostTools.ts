/**
 * What the hosts of the GPU town need beside the renderer: the layers left to their Canvas 2D overlay, picking, and
 * the plan mesh without a context (tests, tools).
 */
import type { Point } from '../../../../../rust/bridge/urban';
import type { CityBuildings, CityLayers, CityScene } from '../model/contract';
import { pickCity } from '../model/pick';
import { buildFillMeshSync, packPlan, type CityGlFillMesh } from '../../cityGlBuild';
// walls hook (cityWalls.ts)
import { CityGlPick } from './contract';

/** Layers left for the Canvas 2D overlay (drawCity) once the GPU draws the plan:
 * diagnostics, landmark glyphs, labels and district names only. */
export function cityGlOverlayLayers(layers: CityLayers): CityLayers {
  return { ...layers, waterways: layers.waterways !== false, blocks: false, domains: false, streets: false, enclosures: false, parcels: false, gardens: false, places: false };
}
/** Topmost visible item under a world point (building, then parcel, then block), with its id. */
export function cityGlPick(scene: CityScene, buildings: CityBuildings | undefined, point: Point): CityGlPick {
  const hit: CityGlPick = pickCity(scene, buildings, point);
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
