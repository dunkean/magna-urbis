import { proceduralSignatures, stableKey } from '../../../rust/bridge/terrainCheckpoints';
import { GENERATION_STAGE_ROWS, stagesForAction } from './stageRegistry';
import { effectiveTerrainSettings } from './terrainSettings';
import { adaptedExtent } from './settings';
import type { V2Settings } from './contracts';
import { fingerprintBytes, fingerprintNumbers } from './terrainFingerprint';
import type { World } from '../gen/types';
import { urbanSeed } from './urbanSeeds';
import { generationRegion } from './regionSettings';
import { seedRoot, seedSubset, stepSeed } from '../../../rust/bridge/generationSeed';
import { engineIdentityOf, terrainRecipeSettings } from './runtimeChoices';

/** `engine`: identity of the engine that places and routes (engineIdentityOf); a rebuilt engine invalidates its products. */
export function settlementStageValidityKeys(settings: V2Settings, terrainKey?: string, engine = engineIdentityOf(settings)): Map<string, string> {
  const o = settings.options;
  const sites = stableKey([
    terrainKey,
    engine,
    stepSeed(o.seed, 'settle-sites'),
    settings.runtime?.backend,
    o.population,
    o.size,
    o.culture,
    o.siteType,
    o.sitePrefs,
    o.center,
    o.settlements,
    o.workflow,
    settings.settlementCount,
    settings.region?.placement,
    settings.region?.demography,
    settings.region?.resolution,
    settings.region?.cropSurplus,
    Object.entries(settings.local).map(([key, local]) => [key, local.population, local.culture, local.center, local.siteType, local.sitePrefs]),
  ]);
  return new Map([
    ['settle-sites', sites],
    ['settle-hierarchy', sites],
    ['settle-roads', stableKey([sites, stepSeed(o.seed, 'settle-roads'), o.roads, settings.region?.roads, settings.local.main?.roads])],
  ]);
}

/** Conservative UI dependencies for a batch. A house edit preserves the
 * validity of its upstream layout and cadastre, including edits made via JSON. */
export function cityStageValidityKeys(settings: V2Settings, world: World | undefined, scope: string, terrainKey?: string, engine = engineIdentityOf(settings, settings.urban?.backend ?? settings.runtime?.backend)): Map<string, string> {
  const [mode, selected] = JSON.parse(scope) as [string, string[]];
  const keys = mode === 'all' ? (world?.settlements?.map(place => place.key) ?? []) : selected;
  const { importedHeight, style, contours, landuse, labels, ...restOptions } = settings.options;
  const options = { ...restOptions, seed: seedRoot(settings.options.seed) };
  const local = keys.map(key => [key, settings.local[key]]);
  const urban = settings.urban;
  const composition = stableKey([
    scope,
    engine,
    terrainKey,
    world?.stats['v2.terrainKey'],
    world?.stats['v2.planKey'],
    generationRegion(settings.region),
    settings.settlementCount,
    options,
    local,
    urban?.backend ?? settings.runtime?.backend,
    urban?.layout,
    keys.map(key => [urbanSeed(settings, key, 'composition'), urban?.local?.[key]?.layout]),
  ]);
  const layout = stableKey([composition, keys.map(key => urbanSeed(settings, key, 'streets'))]);
  const parcels = stableKey([layout, urban?.parcels, keys.map(key => [urbanSeed(settings, key, 'parcels'), urban?.local?.[key]?.parcels])]);
  const programme = stableKey([parcels, keys.map(key => urbanSeed(settings, key, 'programme'))]);
  const buildings = stableKey([programme, urban?.houses, keys.map(key => [urbanSeed(settings, key, 'buildings'), urban?.local?.[key]?.houses])]);
  const houses = stableKey([buildings, keys.map(key => urbanSeed(settings, key, 'houses')), Object.entries(urban?.buildings ?? {}).filter(([key]) => !key.includes('/') || keys.some(place => key.startsWith(place + '/')))]);
  return new Map([
    ['city-composition', composition],
    ['city-roads', layout],
    ['city-quarters', layout],
    ['city-trim', layout],
    ['city-parcels', parcels],
    ['city-programme', programme],
    ['city-buildings', buildings],
    ['city-houses', houses],
  ]);
}

/** The same dependencies as the retained engine, including edits via JSON,
 * seed controls, presets and imports (not just DOM change events). */
export function terrainStageValidityKeys(settings: V2Settings): Map<string, string> {
  settings = terrainRecipeSettings(settings);
  const terrain = effectiveTerrainSettings(settings, adaptedExtent(settings));
  const keys = new Map<string, string>(),
    backend = stableKey([settings.runtime?.backend, settings.runtime?.compute, settings.runtime?.localServer]);
  const signatures = proceduralSignatures(terrain);
  for (const [stage, key] of signatures) {
    const row = GENERATION_STAGE_ROWS[stage];
    if (row && !['sampling', 'retain', 'render'].includes(stage)) keys.set(row, `${backend}|${key}`);
  }
  const initial = `${backend}|${signatures.get('initialize')}`;
  keys.set('relief-source', initial);
  keys.set('relief-climate', stableKey([terrain.climate, terrain.climateZone, terrain.climateValues]));
  keys.set('relief-refine', `${backend}|${signatures.get('sampling')}`);
  keys.set('cover-climate', stableKey([backend, signatures.get('hydrology'), terrain.forest, stepSeed(settings.options.seed, 'cover-climate')]));
  if (!terrain.procedural || settings.options.importedHeight || terrain.sketch || terrain.zones || terrain.modification) {
    const { forest, hydrology, sketch, zones, modification, coastMask, islandMode, coastProfile, procedural, generalSeed, ...relief } = terrain;
    const image = settings.options.importedHeight;
    const { coastAfter, coastIterations, coastIncision, coastThermal, coastDiffusion, enabled, ...generation } = procedural ?? {};
    const { coastCut, coasts, ...generationEnabled } = enabled ?? {};
    const root = stableKey([
      backend,
      relief,
      generation,
      generationEnabled,
      sketch && [sketch.resolution, sketch.processing, fingerprintNumbers(sketch.heights)],
      modification && [modification.resolution, modification.width, fingerprintNumbers(modification.delta)],
      zones && [zones.resolution, fingerprintNumbers(zones.weights)],
      image && [image.w, image.h, image.elevations ? fingerprintBytes(new Uint8Array(image.elevations.buffer, image.elevations.byteOffset, image.elevations.byteLength)) : fingerprintBytes(image.rgba), settings.options.heightScale, settings.options.importSea],
    ]);
    keys.set('relief-heightmap-fit', root);
    const coast = stableKey([root, coastMask, islandMode, coastProfile, coastAfter, coastIterations, coastIncision, coastThermal, coastDiffusion, coastCut, coasts, stepSeed(settings.options.seed, 'relief-coast-cut')]);
    for (const id of keys.keys()) if (id.startsWith('relief-')) keys.set(id, id === 'relief-coast-cut' || id === 'relief-coasts' ? coast : root);
    keys.set('water-hydrology', stableKey([coast, hydrology]));
    keys.set('cover-climate', stableKey([coast, hydrology, forest, stepSeed(settings.options.seed, 'cover-climate')]));
  }
  // The Underdark carve rewrites the relief, so toggling it invalidates every relief, water and cover stage.
  if (terrain.underdark) for (const [id, key] of keys) if (/^(relief|water|cover)-/.test(id)) keys.set(id, `${key}|underdark`);
  return keys;
}

export type StageLed = 'disabled' | 'valid' | 'pending' | 'running';
export function stageLed(enabled: boolean, running: boolean, saved: string | undefined, current: string | undefined): StageLed {
  return !enabled ? 'disabled' : running ? 'running' : saved !== undefined && saved === current ? 'valid' : 'pending';
}

/** Persist product inputs with the world, rather than inferring completion from
 * DOM events or the active tab. Auto extent freezes once terrain exists. */
export function generationValidityKeys(settings: V2Settings, world?: World, town?: string): Map<string, string> {
  // A native service and the browser Rust engine share retained products. The
  // effective run may fall back without changing the user's preferred backend.
  // Placement, roads and towns still carry the identity of the engine binary that runs them (read before
  // the recipe forgets native vs browser): a rebuilt engine is asked again.
  const placeEngine = engineIdentityOf(settings),
    townEngine = engineIdentityOf(settings, settings.urban?.backend ?? settings.runtime?.backend);
  settings = terrainRecipeSettings(settings);
  const frozen = world && settings.extent === 'auto' ? { ...settings, extent: world.mapSize } : settings;
  const compact = (keys: Map<string, string>) => new Map(Array.from(keys, ([id, value]) => [id, fingerprintBytes(new TextEncoder().encode(value))]));
  if (town !== undefined) return compact(cityStageValidityKeys(frozen, world, JSON.stringify(['selection', [town]]), String(world?.stats['v2.terrainKey'] ?? ''), townEngine));
  const terrain = terrainStageValidityKeys(frozen),
    o = settings.options,
    runtime = settings.runtime;
  const { sketch, zones, modification, ...controls } = effectiveTerrainSettings(frozen, adaptedExtent(frozen));
  // Include classic-engine inputs and source switches that procedural checkpoint
  // signatures alone cannot describe. Raster contents are hashed by the terrain keys.
  const terrainInput = stableKey([
    Array.from(terrain),
    controls,
    sketch && [sketch.resolution, sketch.processing, fingerprintNumbers(sketch.heights)],
    zones && [zones.resolution, fingerprintNumbers(zones.weights)],
    modification && [modification.resolution, modification.width, fingerprintNumbers(modification.delta)],
    settings.generation,
    seedSubset(o.seed, key => /^(relief-|water-|cover-)/.test(key)),
    adaptedExtent(frozen),
    o.mapSize,
    o.relief,
    o.coast,
    o.river,
    o.seaLevel,
    (o as typeof o & { lakes?: string }).lakes,
    o.biome,
    runtime?.source,
    runtime?.resolution,
    runtime?.erosion,
    runtime?.neuralAssets,
    settings.decor && [settings.decor.id, fingerprintBytes(settings.decor.bytes)],
  ]);
  const physical = String(world?.stats['v2.terrainKey'] ?? terrainInput);
  return compact(new Map([['terrain', terrainInput], ...terrain, ...settlementStageValidityKeys(frozen, physical, placeEngine)]));
}

export function savedGenerationKey(world: World, stage: string, town?: string): string | number | undefined {
  return world.stats[`v2.valid:${stage}${town === undefined ? '' : ':' + town}`];
}

/** Call only after the corresponding product was successfully produced. City
 * prefixes are stored per settlement so changing the selection loses no history. */
export function recordGenerationValidity(world: World, settings: V2Settings, action: 'terrain' | 'region' | 'roads' | 'town', town?: string, through?: import('./contracts').V2TownStage): void {
  // Placement replaces the city geometry even when the recipe is unchanged.
  if (action === 'region')
    for (const name of Object.keys(world.stats)) {
      if (name.startsWith('v2.valid:city-')) delete world.stats[name];
    }
  const keys = generationValidityKeys(settings, world, town);
  const stages = action === 'terrain' ? ['terrain', ...stagesForAction('terrain')] : stagesForAction(action, through);
  for (const stage of stages) {
    const name = `v2.valid:${stage}${town === undefined ? '' : ':' + town}`,
      key = keys.get(stage);
    if (key !== undefined) world.stats[name] = key;
  }
  if (action === 'town')
    for (const stage of stagesForAction('town')) {
      if (!stages.includes(stage)) delete world.stats[`v2.valid:${stage}:${town}`];
    }
}
