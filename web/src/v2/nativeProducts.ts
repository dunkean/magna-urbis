/** Typed, side-effect-free reads of the retained native products of a World. The only place that knows where they hide. */
import type { World } from '../gen/types';
import type { TerrainData } from '../../../rust/bridge/terrain';
import type { RenderCapabilities } from '../render/appearanceRecipe';
import type { RustTownSnapshot } from './rustUrban';
import type { V2TerrainLayer } from './terrainProjection';
import { nativeCityStageView } from './cityStageOutput';

const NONE: readonly RustTownSnapshot[] = Object.freeze([]);
const stageViews = new WeakMap<World, { source: Readonly<Record<string, RustTownSnapshot>>; stage: string; selection: string; cities: readonly RustTownSnapshot[] }>();
/** Every retained snapshot by settlement key, including those without a layout yet. */
export function nativeCityRecords(world: World | undefined): Readonly<Record<string, RustTownSnapshot>> | undefined {
  return world?.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined;
}
/** Snapshots with a plan to draw. */
export function nativeCitiesOf(world: World | undefined): readonly RustTownSnapshot[] {
  const record = nativeCityRecords(world);
  if (!record || !world) return NONE;
  const stage = String(world.stats?.['v2.cityOutput'] ?? ''), selection = String(world.stats?.['v2.cityOutputKeys'] ?? '');
  if (!stage) return Object.values(record).filter(city => city.layouts?.length);
  const cached = stageViews.get(world);
  if (cached?.source === record && cached.stage === stage && cached.selection === selection) return cached.cities;
  let targets: Set<string> | undefined;
  try { const keys: unknown = JSON.parse(selection); if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) targets = new Set(keys); } catch { /* Older preview metadata applies to every displayed city. */ }
  const cities = Object.entries(record).filter(([, city]) => city.layouts?.length).map(([key, city]) => !targets || targets.has(key) ? nativeCityStageView(city, stage) : city);
  stageViews.set(world, { source: record, stage, selection, cities });
  return cities;
}
/** The engine-annotated terrain layer (native terrain, forest field…), when the world has one. */
export function nativeTerrainLayer(world: World | undefined): V2TerrainLayer | undefined { return world?.terrain as V2TerrainLayer | undefined; }
export function nativeTerrainOf(world: World | undefined): TerrainData | undefined { return nativeTerrainLayer(world)?.v2NativeTerrain; }
export function worldCapabilities(world: World | undefined): RenderCapabilities {
  const native = nativeTerrainOf(world), cities = nativeCitiesOf(world);
  return { nativeCities: cities.length > 0, nativeTerrain: !!native, vectorWater: !!native?.water, hydrology: !!native?.hydrology,
    parcels: cities.some(city => !!city.partitions?.length), buildings: cities.some(city => !!city.scene?.buildings.length) };
}
