/**
 * What the volumes of the tilted map read (v2/display/worldVolumes.ts): the towns' retained native scenes as one scene,
 * their 3D appearance and the settings of the ground they stand on. No geometry is generated here.
 */
import { underdarkSceneLook } from '../render/underdarkLighting';
import { cityGroundSettings } from '../render/cityEnvironment';
import type { World } from '../gen/types';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { City3dGround } from '../ui/city3d';
import type { Terrain3dGroundSettings } from '../ui/terrain3d';
import { renderScene } from './renderScene';
import { nativeCitiesOf } from './nativeProducts';
import { resolveSettingsAppearance } from './appearance';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { displayTerrainSettings } from './displayBiome';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';

const stageIndex = (stage: RustTownSnapshot['stage']) => ['layout', 'parcels', 'programme', 'buildings'].indexOf(stage);
export function v2NativeCities(world: World | undefined): readonly RustTownSnapshot[] {
  return nativeCitiesOf(world);
}
let resolution: { key: string; resolved: ResolvedAppearance } | undefined;
/** The resolved appearance of the volumes (target 'view3d'). Memoized on the inputs it reads: callable from draw callbacks. */
export function v2Resolved3d(settings: V2Settings, world?: World): ResolvedAppearance {
  const o = settings.options,
    cities = world ? renderScene(world, settings).capabilities.nativeCities : false;
  const key = JSON.stringify([settings.appearance, o.style, o.biome, o.contours, o.landuse, o.labels, o.legend, settings.terrain?.forest, cities]);
  if (resolution?.key !== key) resolution = { key, resolved: resolveSettingsAppearance(settings, world, 'view3d') };
  return resolution.resolved;
}
/** A union of the same retained native snapshots. Archive identities stay untouched. */
export function combineV2NativeScenes(cities: readonly RustTownSnapshot[]): PlacementBatch | undefined {
  const scenes = cities
    .filter(city => stageIndex(city.stage) >= 3)
    .map(city => city.scene)
    .filter((scene): scene is PlacementBatch => !!scene);
  if (!scenes.length) return undefined;
  // Towns may use different architectures (city volumes, compact plans, detailed houses). The union header names
  // the native generator when any town has one: the LOD and detail code skip the silhouette buildings.
  const generator = (scenes.find(scene => scene.generator_version !== 'silhouette') ?? scenes[0]).generator_version;
  // A complete single native scene is already the exact union. Preserve its
  // arrays and compressed archives instead of rebuilding them on every view.
  if (scenes.length === 1 && scenes[0].materials && scenes[0].plan_archives) return scenes[0];
  const materials = new Map(scenes.flatMap(scene => scene.materials ?? []).map(material => [material.id, material]));
  const plan_archives: Record<string, string> = {};
  // A partial scene (cancelled build) may lack archives or arrays; the first archive of an id wins.
  for (const scene of scenes) for (const [id, archive] of Object.entries(scene.plan_archives ?? {})) plan_archives[id] ??= archive;
  return {
    schema_version: '1',
    generator_version: generator,
    materials: [...materials.values()],
    buildings: scenes.flatMap(scene => scene.buildings ?? []),
    refusals: scenes.flatMap(scene => scene.refusals ?? []),
    open_spaces: scenes.flatMap(scene => scene.open_spaces ?? []),
    plan_archives,
  };
}
/** The towns' scene plus the activity sites (farms, mills, chapels…) of the region, drawn from their massing. */
export function withV2ActivityScene(scene: PlacementBatch | undefined, activities: PlacementBatch | undefined): PlacementBatch | undefined {
  if (!activities?.buildings.length) return scene;
  if (!scene) return activities;
  // Activity buildings planned by the houses crate bring their archive table and the native generator header.
  const native = (value: PlacementBatch): boolean => value.generator_version.startsWith('architectural-plans-');
  const materials = new Map([...(scene.materials ?? []), ...(activities.materials ?? [])].map(material => [material.id, material]));
  const plan_archives = { ...activities.plan_archives, ...scene.plan_archives };
  return {
    ...scene,
    generator_version: !native(scene) && native(activities) ? activities.generator_version : scene.generator_version,
    materials: [...materials.values()],
    buildings: [...scene.buildings, ...activities.buildings],
    ...(Object.keys(plan_archives).length ? { plan_archives } : {}),
  };
}
/** The material ground under the volumes: the display-only recipe City Bench gives its 3D view (cityGroundSettings). */
export function v2Terrain3dGround(world: World, settings: V2Settings, ground: City3dGround): Terrain3dGroundSettings | undefined {
  const config = displayTerrainSettings(settings, world.mapSize),
    r = v2Resolved3d(settings, world),
    native = renderScene(world, settings).nativeTerrain;
  return cityGroundSettings(r, ground, {
    seed: world.seed,
    climate: config.climateValues!,
    climateZone: config.climateZone,
    ...underdarkSceneLook(world.options.biome, r.composition.ambience, world.settlements, world.landuse?.farmsteads),
    sourceCell: native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell,
    relief: config.relief,
  });
}
/** Stage metadata can change without changing native geometry. Keep renderer
 * indexes when only progress/warnings/bookkeeping headers have changed. */
export function sameV2NativeInputs(before: readonly RustTownSnapshot[], after: readonly RustTownSnapshot[], part: 'layouts' | 'partitions' | 'scene'): boolean {
  if (before.length !== after.length) return false;
  const minimum = part === 'scene' ? 3 : part === 'partitions' ? 1 : 0;
  return after.every((city, i) => (stageIndex(city.stage) >= minimum ? city[part] : undefined) === (stageIndex(before[i].stage) >= minimum ? before[i][part] : undefined));
}
