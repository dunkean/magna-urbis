import type { Options, World, TerrainLayer } from '../gen/types';
import { Rng } from '../gen/core/rng';
import { generateNaturalCover } from '../gen/landuse/natural';
import { refreshCavernMask } from '../gen/terrain/caverns';
import type { V2Project, V2Settings, V2UrbanSettings } from './contracts';
import { TerrainCache, terrainCache, V2_ENGINE_VERSION } from './cache';
import { terrainCacheKey } from './engine';
import { validateSettings, validateWorld } from './project';
import type { V2TerrainLayer } from './terrainProjection';

/** These fields own the territory. Everything else in Options belongs to its use or inhabitants. */
const TERRAIN_OPTIONS = [
  'seed', 'relief', 'biome', 'coast', 'river', 'seaLevel', 'lakes',
  'importedHeight', 'heightScale', 'importSea', 'mapSize',
] as const;
const URBAN_OPTIONS = [
  'workflow', 'settlementMode', 'size', 'siteType', 'sitePrefs', 'center', 'walls', 'moat', 'castles', 'castle',
  'cathedral', 'palace', 'monasteries', 'port', 'arena', 'activities', 'suburbs', 'shantytowns', 'roads',
  'culture', 'cultureMix', 'plan', 'population', 'sprawl', 'language', 'settlements', 'eagerPop',
] as const;
const PROVENANCE_FIELDS = ['backend', 'generationBackend', 'samplingBackend', 'generationReason', 'modelIdentity', 'modelProfile'] as const;

function replaceOptions(target: Options, source: Options, keys: readonly string[], owned = false): void {
  const destination = target as unknown as Record<string, unknown>;
  const origin = source as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (origin[key] === undefined) delete destination[key];
    else destination[key] = owned ? origin[key] : structuredClone(origin[key]);
  }
}
/** Skip overwritten terrain inputs before cloning; a discarded heightmap can be many MB. */
function cloneWithoutTerrainOptions(settings: V2Settings): V2Settings {
  const { options, ...rest } = settings;
  const kept = Object.fromEntries(Object.entries(options).filter(([key]) => !(TERRAIN_OPTIONS as readonly string[]).includes(key)));
  return { ...structuredClone(rest), options: structuredClone(kept) as unknown as Options };
}
function effectiveUrban(settings: V2Settings): V2UrbanSettings {
  // Materialise the previous implicit choice before importing a different terrain runtime.
  return structuredClone(settings.urban ?? { backend: settings.runtime?.backend ?? 'typescript' });
}

interface TerritoryRecipe { settings: V2Settings; snapshotInput: boolean }

/** A project may contain a new settings draft while its visible world still belongs to the previous run. */
function territoryRecipe(world: World, draft: V2Settings): TerritoryRecipe {
  validateWorld(world);
  validateSettings(draft);
  const proposed = { ...draft, extent: world.mapSize, options: { ...draft.options, mapSize: world.mapSize } };
  const coherent = world.seed === draft.options.seed && world.stats['v2.terrainKey'] === terrainCacheKey(proposed);
  const settings = coherent ? structuredClone(proposed) : cloneWithoutTerrainOptions(draft);
  settings.extent = world.mapSize;
  if (!coherent) {
    // Do not run a changed model/seed and pretend it is the imported map. The exact retained
    // altitudes become a portable FP32 input; the imported hydrology itself is retained below.
    replaceOptions(settings.options, world.options, TERRAIN_OPTIONS.filter(key => key !== 'importedHeight'));
    settings.options.importedHeight = {
      name: `Territoire conservé · ${world.seed}`,
      w: world.terrain.height.w,
      h: world.terrain.height.h,
      rgba: new Uint8Array(0),
      elevations: world.terrain.height.data.slice(),
    };
    settings.options.heightScale = 1;
    settings.options.importSea = 0;
  }
  // The displayed biome is authoritative when an ungenerated draft is imported.
  if (world.options.biome === undefined) delete settings.options.biome;
  else settings.options.biome = world.options.biome;
  settings.options.seed = world.seed;
  settings.options.mapSize = world.mapSize;
  validateSettings(settings);
  return { settings, snapshotInput: !coherent };
}

async function terrainOnly(
  retained: World,
  settings: V2Settings,
  composition: 'terrain' | 'urban-recipe',
  notice: string,
  snapshotInput: boolean,
  cache: TerrainCache,
): Promise<World> {
  const started = performance.now();
  const terrain = structuredClone(retained.terrain);
  // This display layer depends on the old towns. It is rebuilt after those towns are removed;
  // no height, water, flow, receiver, coast, river or lake geometry is recomputed.
  delete terrain.caverns;
  const key = terrainCacheKey({ ...settings, extent: retained.mapSize });
  const persisted = await cache.put(key, terrain);
  const provenance: Record<string, string | number> = {};
  const retainedProvenance = (terrain as TerrainLayer & { v2EngineStats?: Record<string, string | number> }).v2EngineStats;
  for (const field of PROVENANCE_FIELDS) {
    const value = retained.stats[field] ?? retainedProvenance?.[field];
    if (typeof value === 'string' || typeof value === 'number') provenance[field] = value;
  }
  const options = { ...structuredClone(settings.options), mapSize: retained.mapSize, workflow: 'environment' as const };
  const world: World = {
    seed: retained.seed,
    mapSize: retained.mapSize,
    options,
    terrain,
    landuse: generateNaturalCover(terrain, options.biome === 'underdark-caverns' ? 'underdark' : options.biome, new Rng('magna-urbis:' + retained.seed),(terrain as V2TerrainLayer).v2NaturalForest),
    stats: {
      ...provenance,
      'v2.stage': 'terrain',
      'v2.engine': V2_ENGINE_VERSION,
      'v2.terrainKey': key,
      'v2.cache': 'import',
      'v2.persisted': persisted ? 1 : 0,
      'v2.composition': composition,
      'v2.compositionNotice': notice,
      'v2.snapshotInput': snapshotInput ? 1 : 0,
      'ms.total': Math.round(performance.now() - started),
    },
  };
  refreshCavernMask(world);
  validateWorld(world);
  return world;
}

/**
 * Import a territory without computing its relief or hydrology again. Its exact physical
 * grids and vectors are kept, while the current settlement recipe remains configurable.
 * Geometry edits are deliberately not transplanted onto unrelated building identities.
 */
export async function composeTerrain(source: V2Project, current: V2Settings, cache: TerrainCache = terrainCache): Promise<V2Project> {
  if (!source.world) throw new Error('Ce fichier contient une recette, sans territoire conservé à importer.');
  validateSettings(current);
  const adopted = territoryRecipe(source.world, source.settings);
  const settings = cloneWithoutTerrainOptions(current);
  replaceOptions(settings.options, adopted.settings.options, TERRAIN_OPTIONS, true);
  settings.extent = source.world.mapSize;
  settings.generation = adopted.settings.generation;
  if(adopted.settings.terrain)settings.terrain=adopted.settings.terrain;else delete settings.terrain;
  if (adopted.settings.runtime) settings.runtime = adopted.settings.runtime;
  else delete settings.runtime;
  settings.urban = effectiveUrban(current);
  validateSettings(settings);
  const notice = 'Territoire importé sans recalcul du relief ni de l’hydrologie. Recette des peuplements conservée ; implantations, routes, villes et modifications géométriques à reconstruire.';
  const world = await terrainOnly(source.world, settings, 'terrain', notice, adopted.snapshotInput, cache);
  world.stats['v2.importEngine'] = source.engine;
  return { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, world, mods: [] };
}

/**
 * Import only a settlement recipe onto the current territory. No source town geometry,
 * road or manual building edit is merged, because its physical validity is unproven.
 * The source's stable-key generation overrides remain part of the imported recipe.
 */
export async function composeUrbanRecipe(
  source: V2Project,
  currentWorld: World,
  current: V2Settings,
  currentMods: unknown[] = [],
  cache: TerrainCache = terrainCache,
): Promise<V2Project> {
  validateSettings(source.settings);
  const adopted = territoryRecipe(currentWorld, current);
  const settings = adopted.settings;
  replaceOptions(settings.options, source.settings.options, URBAN_OPTIONS);
  settings.settlementCount = source.settings.settlementCount;
  settings.local = structuredClone(source.settings.local);
  settings.urban = effectiveUrban(source.settings);
  if(source.settings.region)settings.region=structuredClone(source.settings.region);else delete settings.region;
  validateSettings(settings);
  const discarded = currentMods.length + (source.mods?.length ?? 0);
  const notice = `Recette des peuplements importée sur le territoire actuel. Implantations, routes et villes à reconstruire ; ${discarded} modification(s) géométrique(s) non fusionnée(s).`;
  const world = await terrainOnly(currentWorld, settings, 'urban-recipe', notice, adopted.snapshotInput, cache);
  world.stats['v2.importEngine'] = source.engine;
  return { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, world, mods: [] };
}
