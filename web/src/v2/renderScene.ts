/**
 * Render scene: the retained products of a World exposed by reference (no copies), with explicit capabilities and
 * stable revisions. Memoized per World; call it when the appearance or the world changes, not per frame.
 */
import type { World, Settlement, NamesLayer, LandUseLayer } from '../gen/types';
import type { TerrainData } from '../../../rust/bridge/terrain';
import type { RenderCapabilities } from '../render/appearanceRecipe';
import { terrainFromDecor } from '../ui/benchTerrainTransfer';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { nativeCityRecords, nativeCitiesOf, nativeTerrainOf, worldCapabilities } from './nativeProducts';
import { v2WorldDecor } from './urban3d';

export interface SceneRevisions {
  readonly terrain: number; readonly roads: number; readonly landuse: number; readonly settlements: number; readonly names: number;
  /** One revision per native city, by settlement key. */
  readonly cities: Readonly<Record<string, number>>;
}
export interface RenderScene {
  readonly world: World;
  /** The engine's own terrain when retained, else derived from the decor (memoized). */
  readonly terrain: TerrainData;
  /** Only the retained engine terrain; undefined when the world has none (never approximated). */
  readonly nativeTerrain: TerrainData | undefined;
  /** Native snapshots that have a plan to draw. */
  readonly cities: readonly RustTownSnapshot[];
  /** Every snapshot by settlement key (also those without a layout yet). */
  readonly cityByKey: Readonly<Record<string, RustTownSnapshot>>;
  readonly roads: World['roads'];
  readonly landuse: LandUseLayer | undefined;
  readonly settlements: readonly Settlement[] | undefined;
  readonly names: NamesLayer | undefined;
  readonly capabilities: Readonly<RenderCapabilities>;
  readonly revisions: SceneRevisions;
  /** Engine-specific data stays reachable here. */
  readonly extensions: Readonly<{ debug: World['debug'] }>;
}
let counter = 0;
const ids = new WeakMap<object, number>();
/** Stable numeric identity of a product: the same object always has the same revision; absent is 0. */
export function revisionOf(product: object | undefined | null): number {
  if (!product) return 0;
  let id = ids.get(product); if (id === undefined) { id = ++counter; ids.set(product, id); }
  return id;
}
interface Entry { scene: RenderScene; settings?: V2Settings; fallback?: { key: string; data: TerrainData } }
const scenes = new WeakMap<World, Entry>();
const EMPTY: Readonly<Record<string, RustTownSnapshot>> = Object.freeze({});
const climateKey = (settings: V2Settings): string => JSON.stringify([settings.terrain?.climate, settings.terrain?.climateValues, settings.terrain?.motifSize, settings.terrain?.refine, settings.terrain?.relief]);

export function renderScene(world: World, settings?: V2Settings): RenderScene {
  let entry = scenes.get(world);
  if (entry) { if (settings) entry.settings = settings; return entry.scene; }
  const records = nativeCityRecords(world) ?? EMPTY, cities = nativeCitiesOf(world), native = nativeTerrainOf(world);
  const self: Entry = { scene: undefined as unknown as RenderScene, settings };
  const cityRevisions: Record<string, number> = {};
  for (const [key, city] of Object.entries(records)) cityRevisions[key] = revisionOf(city);
  const scene: RenderScene = {
    world, nativeTerrain: native, cities, cityByKey: records, roads: world.roads, landuse: world.landuse, settlements: world.settlements, names: world.names,
    get terrain(): TerrainData {
      if (native) return native;
      const current = self.settings; if (!current) throw new Error('A scene without native terrain needs the V2 settings.');
      const key = climateKey(current);
      if (self.fallback?.key !== key) self.fallback = { key, data: terrainFromDecor(v2WorldDecor(world, current)) };
      return self.fallback.data;
    },
    capabilities: Object.freeze(worldCapabilities(world)),
    revisions: Object.freeze({ terrain: revisionOf(native ?? world.terrain?.height), roads: revisionOf(world.roads), landuse: revisionOf(world.landuse), settlements: revisionOf(world.settlements),
      names: revisionOf(world.names), cities: Object.freeze(cityRevisions) }),
    extensions: Object.freeze({ debug: world.debug }),
  };
  self.scene = scene; scenes.set(world, self);
  return scene;
}
