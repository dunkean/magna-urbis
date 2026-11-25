/**
 * The parts of a town's display scene in volume: the buildings of the source scene as display meshes, the structures
 * that stand on the terrain (bridges, walls, quays and canals, boardwalks), the farm buildings and stand-in houses,
 * and the scene with those added. No state: each function is one derivation.
 *
 * Called by the two views that show a town in volume, each with its own ground and its own caches: the separate 3D
 * view (ui/view3d/cityBuildings.ts, which also keeps statistics and its detail swaps) and the tilted world view
 * (v2/display/worldVolumes.ts, for render/world/buildingsLayer.ts).
 */
import type { Farmstead } from '../../gen/types';
import type { Layout, Street } from '../../../../rust/bridge/urban';
import type { PlacementBatch, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { NativeBuildingProjectionScene } from '../../ui/urbanBuildingProjection';
import type { Parent3dScene } from '../../ui/urbanParent3d';
import { city3dBoardwalks } from '../city3dBoardwalks';
import { city3dQuays, city3dWaterways } from '../city3dQuays';
import { cityBridgeStreets } from '../cityBridges';
import { farmPlacedBuildings } from '../farmRoofs';
import type { Building3dVisual } from '../urbanBuildingGeometry';
import { city3dBridges } from './bridges';
import { groundShapePads, type GroundShapePad } from '../../ui/urbanGroundShape';
import { buildingSeats, city3dProjectionScene, city3dScene, type City3dDisplayScene, type City3dSceneOptions } from './scene';
import type { SeatGround } from './terrainSeat';
import type { City3dHeight } from './types';
import { city3dWalls } from './walls';

/** The buildings of a source scene (a placement batch, or a projection of accepted plans) as display meshes, each on
 * the ground under it; `waterAt` lifts stilt houses over the water, `details` are the exact meshes already made. */
export function city3dBuildings(scene: PlacementBatch | NativeBuildingProjectionScene | Parent3dScene | undefined, options: City3dSceneOptions): City3dDisplayScene | undefined {
  return scene ? ('projection' in scene ? city3dProjectionScene(scene, { details: options.details }) : city3dScene(scene, options)) : undefined;
}

/** The ground the structures stand on and the water they cross or border. `height` is the undug ground: moat water
 * and gate bridges are not dug a second time. */
export interface City3dStructureGround {
  height?: City3dHeight;
  bridgeWater?: City3dHeight;
  /** The water causeways cross, where it is known apart from `bridgeWater`. */
  causewayWater?: City3dHeight;
  quayHeight?: City3dHeight;
  quayWater?: City3dHeight;
}
/** What stands on the terrain of a town besides its buildings: bridges of the town and regional streets, walls of
 * every circuit, quays and canals (`canalSurfaces`: the canals carry their own water surface), boardwalks. */
export function city3dStructures(
  layouts: readonly Layout[],
  regional: readonly Street[],
  ground: City3dStructureGround,
  waterColor: string | undefined,
  canalSurfaces: boolean,
  /** The town is drawn as a plan in ink: its moat water keeps the plan's wash. */
  engraved = false,
): { bridges: PlacedBuilding[]; walls: PlacedBuilding[]; quays: PlacedBuilding[]; boardwalks: PlacedBuilding[] } {
  const bridgeStreets = cityBridgeStreets(layouts, regional);
  return {
    bridges: city3dBridges(bridgeStreets, ground.height, ground.bridgeWater, ground.causewayWater),
    walls: layouts.flatMap((l, li) => city3dWalls(l.enclosures ?? [], ground.height, String(li), l.culture, waterColor, engraved)),
    quays: [...city3dQuays(layouts, ground.quayHeight, ground.quayWater), ...city3dWaterways(layouts, waterColor, canalSurfaces)],
    boardwalks: city3dBoardwalks(bridgeStreets, ground.height, ground.bridgeWater),
  };
}

/** Farm buildings and the stand-in houses of places still waiting for their plan, as placed buildings on the natural ground. */
export const city3dFarmSources = (farmsteads: readonly Farmstead[] | undefined, placeholders: readonly PlacedBuilding[] | undefined, naturalAt: City3dHeight | undefined): PlacedBuilding[] => [
  ...(farmsteads?.length ? farmPlacedBuildings(farmsteads, naturalAt ?? (() => 0)) : []),
  ...(placeholders ?? []),
];

/** Those buildings as meshes like every other one: the massing-to-mesh code, materials, classes, tint and snow of the
 * towns, each on the terrain under its own footprint. */
export const city3dFarmBuildings = (buildings: PlacedBuilding[], options: City3dSceneOptions): Building3dVisual[] => (buildings.length ? city3dScene({ schema_version: '1', generator_version: 'silhouette', buildings, refusals: [], open_spaces: [] }, options).buildings : []);

/** Buildings seated between two steps of city3dPadSteps. */
const SEATS_PER_STEP = 48;
/** What the ground is shaped to under buildings (urbanGroundShape.ts): the seats of each one on the natural ground. */
export function* city3dPadSteps(buildings: readonly PlacedBuilding[], ground: SeatGround, waterAt?: City3dHeight): Generator<void, GroundShapePad[]> {
  const pads: GroundShapePad[] = [];
  for (let i = 0; i < buildings.length; i++) {
    for (const pad of groundShapePads(buildings[i].footprint, buildingSeats(buildings[i], ground, waterAt))) pads.push(pad);
    if (i % SEATS_PER_STEP === SEATS_PER_STEP - 1) yield;
  }
  return pads;
}

/** The display scene with `extra` meshes added to its buildings (and to those that clear the forest); a scene of
 * them alone when there is no display. */
export function city3dWithExtras(display: City3dDisplayScene | undefined, extra: Building3dVisual[]): City3dDisplayScene | undefined {
  if (!extra.length) return display;
  return display
    ? { ...display, buildings: [...display.buildings, ...extra], ...(display.occupationBuildings ? { occupationBuildings: [...display.occupationBuildings, ...extra] } : {}) }
    : { materials: city3dScene({ schema_version: '1', generator_version: '', buildings: [], refusals: [], open_spaces: [] }).materials, buildings: extra, kinds: { silhouette: 0, compact: 0, detailed: 0 } };
}

/** Tree dwellings in a town beyond which city3dScene gives each one its light mesh (scene.ts LIGHT_TREES_FROM). */
const LIGHT_TREES_FROM = 400;
/** Buildings meshed per step of city3dBuildingsSteps. */
const BUILDINGS_PER_STEP = 24;
/** A building whose city massing holds a tree (scene.ts hasTreeDwelling: the rule that counts them). */
const isTreeDwelling = (b: PlacedBuilding): boolean => {
  const massing = (b as PlacedBuilding & { programme?: { massing?: { volumes?: { form?: string }[] }[] } }).programme?.massing;
  return Array.isArray(massing) && massing.some(m => m?.volumes?.some(v => v.form === 'tree'));
};

/** city3dBuildings in steps of a few buildings, for a caller that spreads a large town over idle slices: the same
 * buildings, kinds and materials, in the same order. city3dScene decides light tree meshes from the number of tree
 * dwellings it is given; above the threshold the tree dwellings go in steps of more than it, so each step decides as
 * the whole town would. */
export function* city3dBuildingsSteps(scene: PlacementBatch | NativeBuildingProjectionScene | Parent3dScene | undefined, options: City3dSceneOptions): Generator<void, City3dDisplayScene | undefined> {
  if (!scene || 'projection' in scene) return city3dBuildings(scene, options);
  const trees = scene.buildings.filter(isTreeDwelling),
    light = trees.length > LIGHT_TREES_FROM,
    order = new Map(scene.buildings.map((b, i) => [b, i]));
  const chunks: PlacedBuilding[][] = [];
  const rest = light ? scene.buildings.filter(b => !isTreeDwelling(b)) : scene.buildings;
  for (let i = 0; i < rest.length; i += BUILDINGS_PER_STEP) chunks.push(rest.slice(i, i + BUILDINGS_PER_STEP));
  if (light) {
    const size = LIGHT_TREES_FROM + 1,
      steps = Math.floor(trees.length / size);
    for (let k = 0; k < steps; k++) chunks.push(trees.slice(k * size, k === steps - 1 ? trees.length : (k + 1) * size));
  }
  const made: { source: PlacedBuilding; building: PlacedBuilding }[] = [],
    kinds = { silhouette: 0, compact: 0, detailed: 0 };
  let materials: City3dDisplayScene['materials'];
  for (const chunk of chunks) {
    if (!chunk.length) continue;
    const part = city3dScene({ ...scene, buildings: chunk }, options);
    materials ??= part.materials;
    for (const kind of ['silhouette', 'compact', 'detailed'] as const) kinds[kind] += part.kinds[kind];
    part.buildings.forEach((building, i) => made.push({ source: chunk[i], building }));
    yield;
  }
  made.sort((a, b) => order.get(a.source)! - order.get(b.source)!);
  return { ...scene, materials: materials ?? city3dScene({ ...scene, buildings: [] }).materials, buildings: made.map(m => m.building), kinds };
}
