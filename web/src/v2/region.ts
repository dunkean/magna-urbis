import type { World, Settlement, Options, SiteArchetype, SiteLayer } from '../gen/types';
import type { SettlementOutput, RoadOutput, SettlementRaster, RoadSite } from '../../../rust/bridge/settlements';
import { roadSitesOf } from '../../../rust/bridge/roadSites';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { Rng } from '../gen/core/rng';
import { chooseSiteRust } from '../../../rust/bridge/siteNative';
import { sizeForPop } from '../gen/options';
import { circle, clipConvex, voronoiRegions } from '../gen/settlements/planner';
import { effectiveRegion, usesGrowthPlacement, validateRegionSettings } from './regionSettings';
import type { V2Settings, ProgressCallback } from './contracts';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
import { loopbackServer } from './platform';
import { sampleGrid } from '../gen/core/grid';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { effectiveTerrainSettings } from './terrainSettings';
import type { ResourcePayload } from '../../../rust/bridge/resources';
import { chooseIsolatedSites, regionalPopulation } from './regionalPopulation';
import { engineIdentityOf, retryNativeStage } from './runtimeChoices';

export interface RustRegionSnapshot {
  placement: SettlementOutput;
  roads: RoadOutput | null;
}
let retainedEngine: { runtimeKey: string; terrainKey: string; engine: SettlementEngine } | undefined;
/** Routing resolution controls sampling, not the information content of an imported coarse heightmap. */
export function resampleRegionalRaster(source: SettlementRaster, n: number): SettlementRaster {
  if (source.n === n) return source;
  const width = source.width,
    cell = width / n,
    data = (values: Float32Array) => ({ w: source.n, h: source.n, cell: width / source.n, data: values });
  const height = new Float32Array(n * n),
    waterLevel = height.slice(),
    riverWidth = height.slice(),
    water = new Uint8Array(n * n),
    riverIds = new Int32Array(n * n);
  const h = data(source.height),
    levels = data(source.waterLevel);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        wx = (x + 0.5) * cell,
        wy = (y + 0.5) * cell;
      const j = Math.min(source.n - 1, Math.floor(((y + 0.5) * source.n) / n)) * source.n + Math.min(source.n - 1, Math.floor(((x + 0.5) * source.n) / n));
      height[i] = sampleGrid(h, wx, wy);
      waterLevel[i] = sampleGrid(levels, wx, wy);
      water[i] = source.water[j];
      riverIds[i] = source.riverIds[j];
      riverWidth[i] = source.riverWidth[j];
    }
  return { ...source, n, height, waterLevel, riverWidth, water, riverIds };
}
async function regionalRaster(world: World, resolution: number, settings: V2Settings): Promise<SettlementRaster> {
  const native = (world.terrain as typeof world.terrain & { v2NativeTerrain?: TerrainData }).v2NativeTerrain;
  const raster = native ? (await import('../../../rust/bridge/settlements')).settlementRaster(native, resolution) : (await import('./rustUrban')).rustSettlementRaster(world);
  // Resource-model inputs (Rust `resources::RegionInput`): geology, soil, potentials and activity anchors derive from them.
  const effective = effectiveTerrainSettings(settings, world.mapSize),
    climate = effective.climateValues!;
  raster.region ??= { seed: settings.options.seed, temperature: climate.temperature, precipitation: climate.precipitation, biome: effective.climateZone ?? 'temperate', x: native?.x ?? 0, y: native?.y ?? 0 };
  return resampleRegionalRaster(raster, resolution);
}
const runtimeOf = (settings: V2Settings) => ({ profile: settings.runtime?.backend === 'native' ? 'local' : 'web', server: settings.runtime?.backend === 'native' ? loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') : 'http://127.0.0.1:8791' }) as const;
/** `engine`: the engine build (engineIdentityOf): a rebuilt or restarted-as-new engine gets a new handle and the raster again. */
async function engineFor(runtime: ReturnType<typeof runtimeOf>, engine: string): Promise<NonNullable<typeof retainedEngine>> {
  const runtimeKey = JSON.stringify([runtime, engine]);
  if (!retainedEngine || retainedEngine.runtimeKey !== runtimeKey) {
    retainedEngine?.engine.dispose?.();
    retainedEngine = undefined;
    retainedEngine = { runtimeKey, terrainKey: '', engine: await (await import('../../../rust/bridge/settlementEngine')).createSettlementEngine(runtime) };
  }
  return retainedEngine;
}
/** Compact resource payload of the retained terrain (view layers, rural soil): once per terrain, undefined without a Rust region. */
let retainedResources: { key: string; payload: ResourcePayload } | undefined;
export async function regionResources(world: World, settings: V2Settings): Promise<ResourcePayload | undefined> {
  if (!settings.runtime?.backend || settings.runtime.backend === 'typescript') return undefined;
  const { resolution } = effectiveRegion(settings),
    runtime = runtimeOf(settings);
  const identity = engineIdentityOf(settings),
    terrainKey = JSON.stringify([world.stats['v2.terrainKey'] ?? null, world.stats['v2.waterEditRevision'] ?? 0, world.mapSize, resolution]),
    key = JSON.stringify([runtime, identity, terrainKey, settings.options.seed]);
  if (retainedResources?.key === key) return retainedResources.payload;
  const engine = await engineFor(runtime, identity);
  const raster = engine.terrainKey === terrainKey && world.stats['v2.terrainKey'] !== undefined ? undefined : await regionalRaster(world, resolution, settings);
  const response = await engine.engine.run({ id: 1, seed: stepSeed(settings.options.seed, 'settle-sites'), ...(raster ? { raster } : {}), roads: null, resources: true, runtime });
  // A failed run may leave the engine without this terrain: the next run sends the raster again.
  if ('error' in response) {
    engine.terrainKey = '';
    throw new Error(response.error);
  }
  engine.terrainKey = terrainKey;
  if (!response.resources) throw new Error('The engine returned no resource payload.');
  retainedResources = { key, payload: response.resources };
  return response.resources;
}
/** Main-town site fields (a whole-map Rust request) still in flight while the town stages run: see planRustRegion `deferSite`. */
let pendingSite: { token: string; site: Promise<SiteLayer> } | undefined;
const siteToken = (world: World): string => {
  const main = world.settlements?.find(s => s.main);
  return `${world.seed}|${main?.key}|${main?.center.x},${main?.center.y}|${world.stats['v2.terrainKey']}`;
};
/** Install the deferred site of this world (no-op when its site was chosen in planRustRegion). */
export async function settleRegionSite(world: World): Promise<void> {
  const pending = pendingSite;
  if (!pending) return;
  pendingSite = undefined;
  if (pending.token === siteToken(world)) world.site = await pending.site;
}
export async function planRustRegion(world: World, settings: V2Settings, onProgress?: ProgressCallback, roadsOnly = false, deferSite = false): Promise<World> {
  pendingSite = undefined;
  const t0 = performance.now(),
    { placement, roads, resolution } = effectiveRegion(settings);
  validateRegionSettings({ placement, roads, resolution }, world.mapSize);
  const populationPlan = regionalPopulation(settings);
  if (!roadsOnly && placement.mode === 'list' && !placement.list.length) {
    world.settlements = [];
    world.roads = [];
    world.bridges = [];
    world.debug = { ...world.debug, v2RustRegion: { placement: { settlements: [], activities: [], warnings: [], requested: 0, usableKm2: 0, ms: 0 }, roads: null } satisfies RustRegionSnapshot };
    Object.assign(world.stats, { 'v2.stage': 'region', settlements: 0, 'settlements.requested': 0, 'v2.regionPopulation': 0, 'v2.requestedRegionPopulation': populationPlan.population });
    return world;
  }
  const runtime = runtimeOf(settings);
  onProgress?.({ stage: 'sites', label: roadsOnly ? 'Routing roads between retained sites…' : 'Rust · evaluating regional settlement sites…', completed: 0, total: 3 });
  if (roadsOnly && !world.settlements?.length) throw new Error('Place settlements before routing their roads.');
  const terrainKey = JSON.stringify([world.stats['v2.terrainKey'] ?? null, world.stats['v2.waterEditRevision'] ?? 0, world.mapSize, resolution]);
  const engine = await engineFor(runtime, engineIdentityOf(settings));
  // The worker serializes requests. A route-only change reuses both the sampled raster and the native/WASM handle.
  const raster = engine.terrainKey === terrainKey && world.stats['v2.terrainKey'] !== undefined ? undefined : await regionalRaster(world, resolution, settings);
  const placeSeed = stepSeed(settings.options.seed, 'settle-sites'),
    roadSeed = stepSeed(settings.options.seed, 'settle-roads');
  // Reroute: the retained settlements, then the retained activity sites' access points.
  const retainedActivities = (world.debug?.v2RustRegion as RustRegionSnapshot | undefined)?.placement.activities ?? [];
  const retainedSites = (): RoadSite[] => [
    ...world.settlements!.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius })),
    ...roadSitesOf({ settlements: [], warnings: [], requested: 0, usableKm2: 0, ms: 0, activities: retainedActivities }),
  ];
  // A failed run may leave the engine without this terrain: the next run sends the raster again.
  const failed = (error: string): Error => {
    engine.terrainKey = '';
    return new Error(error);
  };
  const placementRequest = usesGrowthPlacement(settings) ? { ...placement, engine: 'growth' } : placement;
  let response = await engine.engine.run({ id: 1, seed: roadsOnly ? roadSeed : placeSeed, ...(raster ? { raster } : {}), ...(roadsOnly ? { sites: retainedSites() } : { place: placementRequest }), roads: roadsOnly ? roads : null, runtime });
  if ('error' in response) throw failed(response.error);
  if (!roadsOnly) {
    const placed = response.settlements;
    if (!placed) throw new Error('Missing retained settlement placement.');
    placed.activities = chooseIsolatedSites(placed.activities ?? [], populationPlan.isolatedCount, settings.options.seed);
    const routed = await engine.engine.run({ id: 2, seed: roadSeed, sites: roadSitesOf(placed), roads, runtime });
    if ('error' in routed) throw failed(routed.error);
    response = { ...routed, settlements: placed };
  }
  if (!roadsOnly && response.settlements) response.settlements.activities = chooseIsolatedSites(response.settlements.activities ?? [], populationPlan.isolatedCount, settings.options.seed);
  engine.terrainKey = terrainKey;
  const previous = world.debug?.v2RustRegion as RustRegionSnapshot | undefined;
  const output = response.settlements ?? previous?.placement;
  if (!output?.settlements.length) throw new Error('No settlement can be placed with this recipe. Adjust the constraints or use a manual list.');
  if (response.roads?.nodes) response.roads.nodes = chooseIsolatedSites(response.roads.nodes, Math.max(0, populationPlan.isolatedCount - (output.activities?.length ?? 0)), settings.options.seed);
  if (!roadsOnly) {
    const regions = voronoiRegions(
      output.settlements.map(s => s.center),
      world.mapSize,
    );
    world.settlements = output.settlements.map((s, index): Settlement => ({
      key: s.key,
      index,
      main: index === 0,
      cls: s.cls as Settlement['cls'],
      population: s.population,
      culture: s.culture,
      center: s.center,
      archetype: s.archetype as SiteArchetype,
      radius: s.radius,
      extent: clipConvex(circle(s.center, s.radius), regions[index]),
      region: regions[index],
      fixed: s.scores.manual,
      name: s.name || undefined,
      detail: index === 0 ? 'main' : s.cls === 'farmstead' ? 'farmstead' : 'lazy',
    }));
    const main = world.settlements[0],
      opts: Options = { ...settings.options, ...settings.local[main.key], population: main.population, culture: main.culture, size: sizeForPop(main.population), center: main.center, siteType: main.archetype, mapSize: world.mapSize };
    // Native placement owns the site and land use computes its own fields: only the display planes (dWater, hab) are requested.
    const site = retryNativeStage(
      settings,
      effective => chooseSiteRust(world.terrain, opts, world.mapSize, new Rng('magna-urbis:' + world.seed), runtimeOf(effective), true),
      (_effective, note) => onProgress?.({ stage: 'runtime-fallback', label: note, completed: 0, total: 0 }),
    ).then(site => {
      site.center = { ...main.center };
      site.archetype = main.archetype;
      site.reserveRadius = main.radius;
      return site;
    });
    if (deferSite && runtime.profile === 'local' && (settings.urban?.backend ?? settings.runtime?.backend) !== 'typescript') {
      // The native engine answers it on its own connection while the town stages run; finishTowns installs it.
      site.catch(() => undefined);
      pendingSite = { token: siteToken(world), site };
      world.site = { center: { ...main.center }, archetype: main.archetype, reserveRadius: main.radius, offers: {} } as unknown as SiteLayer;
    } else world.site = await site;
    for (const s of world.settlements) {
      world.stats['v2.population:' + s.key] = s.population;
      world.stats['v2.culture:' + s.key] = s.culture;
    }
  }
  onProgress?.({ stage: 'roads', label: 'Rust · projecting regional routes and crossings…', completed: 2, total: 3 });
  // Crossings are measured on routing cells: snap them once onto the drawn water, for every display and the towns.
  const drawnWater = (world.terrain as typeof world.terrain & { v2NativeTerrain?: TerrainData }).v2NativeTerrain?.water;
  if (response.roads && drawnWater) {
    const [{ drawnRiverClearance }, { snapRoadCrossings }] = await Promise.all([import('../ui/vectorWaterRender'), import('../render/cityBridges')]);
    response.roads = { ...response.roads, segments: snapRoadCrossings(response.roads.segments, drawnRiverClearance(drawnWater), (1.5 * world.mapSize) / resolution) };
  }
  world.roads = (response.roads?.segments ?? []).map(s => ({ path: s.path, width: s.width, kind: s.class === 'highway' || s.class === 'main' ? 'major' : s.class === 'local' ? 'minor' : 'track' }));
  world.bridges = (response.roads?.segments ?? []).flatMap(s => s.crossings.filter(c => c.kind === 'bridge').map(c => ({ a: c.path[0], b: c.path[c.path.length - 1], width: s.width })));
  // Dug road tunnels join the natural ones: the names and the 2D tunnel strokes read them there (replaced on every run).
  const caverns = world.terrain.caverns;
  if (caverns) {
    const dug = (response.roads?.segments ?? []).flatMap(s => (s.tunnels ?? []).filter(t => t.path.length >= 2).map(t => ({ kind: 'dug' as const, path: t.path, halfWidth: s.width / 2 + 1 })));
    const tunnels = [...(caverns.tunnels ?? []).filter(t => t.kind !== 'dug'), ...dug];
    if (tunnels.length) caverns.tunnels = tunnels;
    else delete caverns.tunnels;
  }
  world.debug = { ...world.debug, v2RustRegion: { placement: output, roads: response.roads } satisfies RustRegionSnapshot, v2BaseBridges: structuredClone(world.bridges), v2TownBridges: {} };
  const warnings = [...output.warnings, ...(response.roads?.warnings ?? [])];
  Object.assign(world.stats, { 'v2.regionPopulation': world.settlements?.reduce((n, p) => n + p.population, 0) ?? 0, 'v2.requestedRegionPopulation': populationPlan.population, 'v2.requestedIsolatedSites': populationPlan.isolatedCount });
  Object.assign(world.stats, {
    'v2.stage': 'region',
    'v2.regionBackend': runtime.profile === 'local' ? 'rust-native-cpu' : 'rust-wasm-cpu',
    'v2.regionalRoads': world.roads.length,
    'v2.baseBridges': world.bridges.length,
    'v2.unreachable': response.roads?.unreachable.length ?? 0,
    settlements: world.settlements!.length,
    'settlements.requested': output.requested,
    'settlements.warning': warnings.join(' | '),
    'ms.region': Math.round(performance.now() - t0),
  });
  onProgress?.({ stage: 'network', label: 'Regional settlements and roads ready', completed: 3, total: 3 });
  return world;
}
