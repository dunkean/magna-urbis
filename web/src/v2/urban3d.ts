import { cityGroundSettings, cityGroundLook } from '../render/cityEnvironment';
import { retainedDecorOf } from './decorTerrain';
import { decorWater3d } from '../ui/decorWater3d';
import { paintSeaCover } from '../render/seaCover';
import { cityRegionalStreets, usesNativeHouseRenderer } from '../render/cityContract';
/** Exact City Bench renderer inside V2; no iframe, geometry regeneration or surrogate houses. */
import { v2DisplayForest, v2ForestOccupation } from './displayForest';
import type { World } from '../gen/types';
import type { Layout, Partition, Street } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { Decor } from '../ui/decor';
import type { City3d, City3dDetailService, City3dOptions, City3dGround, City3dPhysicalGround, City3dSurface, City3dViewSettings, City3dWaterDisplay } from '../ui/city3d';
import type { Terrain3dGroundSettings } from '../ui/terrain3d';
import type { TerrainLook } from '../ui/terrainGl';
import { renderScene } from './renderScene';
import { nativeCitiesOf, nativeTerrainOf } from './nativeProducts';
import { resolveSettingsAppearance } from './appearance';
import type { AppearancePatch, ResolvedAppearance } from '../render/appearanceRecipe';
import { effectiveTerrainSettings } from './terrainSettings';
import { DEFAULT_TERRAIN_LIGHTING } from '../render/terrainLighting';
import { terrainStyle } from '../render/terrainStyle';
import { createTerrainSurfaceSampler } from '../ui/terrainSurface';
import { createGroundDisplacementSampler } from '../../../rust/bridge/terrainGround';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { rustSettlementRaster, townRoadStreets } from './rustUrban';
import { getLanguage, onLanguageChange } from './i18n';
import { getDistanceUnit } from './units';
import { mapPresentation } from './mapPresentation';
import { activityScene } from './activitySites';
import { provideFurniture3d, refreshFurniture3d } from '../ui/legendOverlay3d';
import { city3dPlanOptions } from '../render/cityDrawOptions';
import { roadGroundTones, setRoadGround } from '../render/roadStyle';
import { biomePalette } from '../render/biomes';
import { ruralSemanticLegend, urbanSemanticLegend } from '../render/semanticLayer';
import { buildCityScene, type CityScene } from '../render/cityCanvas';
import { terrain3dIllustratedSvg } from '../ui/terrain3dTexture';
import { paintWaterRegime, vectorRiverPath, type WaterDisplay } from '../ui/vectorWaterRender';
import { waterClimate } from '../render/waterRegime';
import { isFantasyStyle, registerFantasyBrushes } from '../../../rust/bridge/fantasyTerrain';

export interface V2Urban3dOptions {
  host: HTMLElement;
  getWorld(): World | undefined;
  getSettings(): V2Settings;
  getSelected?(): string | undefined;
  onSelect?(id: string): void;
  getBackground?(): string | undefined;
  getBackgroundImage?(): HTMLCanvasElement | undefined;
  /** The 2D map's physical land use, for the ground tiles. */
  getPhysicalGround?(): City3dPhysicalGround | undefined;
  getTextured?(): boolean;
  setTextured?(value: boolean): void;
  onCamera?: City3dOptions['onCamera'];
  /** 3D interactions request appearance changes; the orchestration applies them to the shared settings. */
  onAppearancePatch(patch: AppearancePatch): void;
}
export interface V2Urban3d extends City3d { readonly detailStats: import('../render/urbanBuildingDetails').BuildingDetailStats | undefined }
const stageIndex = (stage: RustTownSnapshot['stage']) => ['layout', 'parcels', 'programme', 'buildings'].indexOf(stage);
export function v2NativeCities(world: World | undefined): readonly RustTownSnapshot[] { return nativeCitiesOf(world); }
let resolution: { key: string; resolved: ResolvedAppearance } | undefined;
/** The 3D view's resolved appearance (target 'view3d'). Memoized on the inputs it reads: callable from draw callbacks. */
export function v2Resolved3d(settings: V2Settings, world?: World): ResolvedAppearance {
  const o = settings.options, cities = world ? renderScene(world, settings).capabilities.nativeCities : false;
  const key = JSON.stringify([settings.appearance, o.style, o.contours, o.landuse, o.labels, o.legend, settings.terrain?.forest, cities]);
  if (resolution?.key !== key) resolution = { key, resolved: resolveSettingsAppearance(settings, world, 'view3d') };
  return resolution.resolved;
}
/** A union of the same retained native snapshots. Archive identities stay untouched. */
export function combineV2NativeScenes(cities: readonly RustTownSnapshot[]): PlacementBatch | undefined {
  const scenes = cities.filter(city => stageIndex(city.stage) >= 3).map(city => city.scene).filter((scene): scene is PlacementBatch => !!scene);
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
  return { schema_version: '1', generator_version: generator, materials: [...materials.values()], buildings: scenes.flatMap(scene => scene.buildings ?? []), refusals: scenes.flatMap(scene => scene.refusals ?? []), open_spaces: scenes.flatMap(scene => scene.open_spaces ?? []), plan_archives };
}
/** The towns' scene plus the activity sites (farms, mills, chapels…) of the region, drawn from their massing. */
export function withV2ActivityScene(scene: PlacementBatch | undefined, activities: PlacementBatch | undefined): PlacementBatch | undefined {
  if (!activities?.buildings.length) return scene;
  if (!scene) return activities;
  // Activity buildings planned by the houses crate bring their archive table and the native generator header.
  const native = (value: PlacementBatch): boolean => value.generator_version.startsWith('architectural-plans-');
  const materials = new Map([...scene.materials ?? [], ...activities.materials ?? []].map(material => [material.id, material]));
  const plan_archives = { ...activities.plan_archives, ...scene.plan_archives };
  return { ...scene, generator_version: !native(scene) && native(activities) ? activities.generator_version : scene.generator_version, materials: [...materials.values()],
    buildings: [...scene.buildings, ...activities.buildings], ...(Object.keys(plan_archives).length ? { plan_archives } : {}) };
}
/** Physical raster reference is cached per terrain. Retained geographic domains are reused by 3D. */
const rasterMetrics = new WeakMap<ReturnType<typeof rustSettlementRaster>, { minHeight: number; maxHeight: number; land: number }>();
const rasterWater = new WeakMap<ReturnType<typeof rustSettlementRaster>, Float32Array>();
const waterDisplays = new WeakMap<ReturnType<typeof rustSettlementRaster>, Map<string, City3dWaterDisplay>>();
function v2WaterDisplay(world: World, settings: V2Settings): City3dWaterDisplay {
  const raster = rustSettlementRaster(world), r = v2Resolved3d(settings, world), shown = r.ground.layers.water, lakes = r.ground.lakes;
  const palette=terrainStyle(r.palette.mapStyle,r.palette.colors).palette,ink=r.composition.networks.water.look==='ink';
  // The seasonal water regime as in 2D (vectorWaterRender.ts): same network, display threshold and calendar.
  const vector = renderScene(world, settings).terrain.water, effective = effectiveTerrainSettings(settings, world.mapSize);
  const regimeDisplay: WaterDisplay | undefined = vector && shown ? { style: ink ? r.palette.mapStyle : 'render3d', colors: r.palette.colors, showLakes: lakes, showOxbows: r.ground.oxbows,
    riverArea: vector.riverArea ?? .02, riverMode: effective.hydrology?.riverMode ?? 'vector', overlay: 'none', season: { zone: effective.climateZone, season: r.ground.season, calendar: r.ground.calendar } } : undefined;
  const climate = regimeDisplay?.season?.zone ? waterClimate(regimeDisplay.season) : undefined, active = !!climate && (climate.aridity > 0 || climate.ice > 0), frozenLakes = active && climate!.ice >= .5;
  const exactRivers = !!vector?.rivers && regimeDisplay?.riverMode === 'vector';
  // A decor world hands its smoothed banks to the 3D view (getRetainedWater): its rivers come from them alone, never
  // again from the planning cells or their grid-cornered polygons, which drew a staircase beside the smooth bank.
  const banks = !!retainedDecorOf(world.terrain) && r.composition.networks.water.visible, vectorCourses = exactRivers || banks;
  const key=JSON.stringify([shown,lakes,ink,ink?palette.lakeFill:undefined,ink?palette.waterEdge:undefined,regimeDisplay,banks]);
  let cache = waterDisplays.get(raster); if (!cache) { cache = new Map(); waterDisplays.set(raster, cache); }
  const retained = cache.get(key); if (retained) return retained;
  // The sea follows the 2D coast: the zero level of the native field at its own spacing (terrainGl's land cover).
  // The settlement cells (78 m on a 40 km map) mark a cell sea when its mean height is <= 0, which drowned shore houses.
  const field = renderScene(world, settings).nativeTerrain?.field;
  const sea = field && Number.isInteger(field.n) && field.n >= 2 && field.data instanceof Float32Array && field.data.length === field.n ** 2 && !(field.floor > 0) && !field.cave?.length ? field : undefined;
  const side = sea?.n ?? raster.n;
  const texture = document.createElement('canvas'); texture.width = texture.height = side;
  const ctx = texture.getContext('2d')!, pixels = ctx.createImageData(raster.n, raster.n), paths = new Path2D(), lakePaths = new Path2D();
  if (shown) {
    const value=parseInt(palette.lakeFill.slice(1),16),rgba=ink?[value>>16&255,value>>8&255,value&255,255]:[74,134,179,255];
    for (let i = 0; i < raster.water.length; i++) if (raster.water[i] > 0 && raster.water[i] < 4 && !(sea && raster.water[i] === 1) && !(vectorCourses && raster.water[i] === 3) && (lakes || raster.water[i] !== 2) && !(frozenLakes && raster.water[i] === 2)) pixels.data.set(rgba, i * 4);
    if (sea) {
      const cells = document.createElement('canvas'); cells.width = cells.height = raster.n; cells.getContext('2d')!.putImageData(pixels, 0, 0);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(cells, 0, 0, side, side); ctx.imageSmoothingEnabled = true;
      const out = ctx.getImageData(0, 0, side, side);
      paintSeaCover(out.data, sea.data, rgba);
      ctx.putImageData(out, 0, 0);
    }
    const firstLake = world.terrain.coastline.length, lastLake = firstLake + world.terrain.lakes.length, redrawn = active && !ink && regimeDisplay?.riverMode === 'vector' && !!vector?.rivers;
    for (const [index, polygon] of (raster.geometry?.water ?? []).entries()) {
      const lake = index >= firstLake && index < lastLake;
      if (lake && !lakes) continue;
      // Material grounds under an active regime keep the river ribbons out of the closed water: each tile redraws the
      // running courses from the 2D vector banks and leaves the dry and frozen ones to their bed and ice.
      if (index >= lastLake && (redrawn || vectorCourses)) continue;
      // Frozen lakes leave the water cover: their ice is painted on the ground.
      const target = lake && frozenLakes ? lakePaths : paths;
      for (const ring of polygon) { if (ring.length < 3) continue; target.moveTo(ring[0].x, ring[0].y); for (const p of ring.slice(1)) target.lineTo(p.x, p.y); target.closePath(); }
    }
  }
  if (!sea) ctx.putImageData(pixels, 0, 0);
  const fill = ink ? palette.lakeFill : '#4a86b3';
  const regime = active && vector && regimeDisplay ? (target: CanvasRenderingContext2D, mode: 'erase' | 'ground' | 'ice' | 'ink', mpp: number): boolean => paintWaterRegime(target, vector, regimeDisplay, mode, mpp, lakePaths, fill) : undefined;
  if (regime) { ctx.setTransform(side / raster.width, 0, 0, side / raster.width, 0, 0); regime(ctx, 'erase', raster.width / side); ctx.setTransform(1, 0, 0, 1, 0, 0); }
  const result = { texture, paths, ...(exactRivers ? { riverPaths: vectorRiverPath(vector!, regimeDisplay!) } : {}), ...(ink?{ink:{fill:palette.lakeFill,stroke:palette.waterEdge}}:{}), ...(regime ? { regime, frozen: climate!.ice > 0 } : {}) }; cache.set(key, result); return result;
}
/** Preserve the native control grid and the applied lake levels; never resample the terrain. */
export function v2Terrain3dSurface(world: World, settings: V2Settings): City3dSurface {
  const raster = rustSettlementRaster(world), native = renderScene(world, settings).nativeTerrain, field = native?.field, r = v2Resolved3d(settings, world);
  const valid = field && Number.isInteger(field.n) && field.n >= 2 && field.data instanceof Float32Array && field.data.length === field.n ** 2;
  let mask = rasterWater.get(raster);
  if (!mask) { mask = Float32Array.from(raster.water, value => value === 2 ? 1 : -1); rasterWater.set(raster, mask); }
  return { height: { x: 0, y: 0, width: raster.width, n: valid ? field.n : raster.n, data: valid ? field.data : raster.height, ...(valid && field.cave ? { cave: field.cave } : {}) },
    water: r.ground.lakes ? { n: raster.n, mask, levels: raster.waterLevel } : undefined, waterVisible: r.ground.layers.water };
}
export function v2Terrain3dView(settings: V2Settings): City3dViewSettings {
  const city = v2Resolved3d(settings).city;
  return { ground: city.ground as City3dGround, plan: city.plan, colors: city.colors, exaggeration: city.exaggeration, refinement: city.refinement };
}
/** All material modes consume one physical surface and the same display-only recipe. */
export function v2Terrain3dGround(world: World, settings: V2Settings, ground: City3dGround): Terrain3dGroundSettings | undefined {
  const config = effectiveTerrainSettings(settings, world.mapSize), r = v2Resolved3d(settings, world), native = renderScene(world, settings).nativeTerrain;
  return cityGroundSettings(r, ground, { seed: world.seed, climate: config.climateValues!, climateZone: config.climateZone,
    sourceCell: native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell, relief: config.relief });
}
export function createV2Terrain3dSampler(world: World, settings: V2Settings, ground: City3dGround): ReturnType<typeof createTerrainSurfaceSampler> {
  const base = v2Terrain3dSurface(world, settings).height, config = effectiveTerrainSettings(settings, world.mapSize), native = renderScene(world, settings).nativeTerrain;
  const r = v2Resolved3d(settings, world), material = v2Terrain3dGround(world, settings, ground), refinement = r.city.refinement;
  const look: TerrainLook = { colors: r.palette.colors, style: ground === 'map' ? r.styleId : ground === 'render' ? 'render3d' : ground,
    mapWidth: world.mapSize, lighting: material?.lighting ?? DEFAULT_TERRAIN_LIGHTING, layers: { ...r.ground.layers },
    climate: { temperature: config.climateValues!.temperature, precipitation: config.climateValues!.precipitation }, seed: seedHash(world.seed),
    globalMin: native?.globalMinHeight ?? 0, globalMax: native?.globalMaxHeight ?? 0, refine: refinement === 'noise' && config.refine !== false && config.relief !== 'cavern',
    sourceCell: material?.sourceCell ?? (native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell), detail: config.detailNoise!, floor: native?.field?.floor ?? 0,
    contours: false, contourStep: 1, flatRelief: config.relief === 'flat', frame: false, background: '#f1f0e9' };
  const sampler = createTerrainSurfaceSampler(base, look, [], true);
  if (!material?.displacement) return sampler;
  return createGroundDisplacementSampler(sampler, { seed: look.seed, sourceCell: look.sourceCell, macroSampler: createTerrainSurfaceSampler(base, { ...look, refine: false }, [], false), climate: [look.climate!.temperature, look.climate!.precipitation] });
}
export function v2WorldDecor(world: World, settings: V2Settings): Decor {
  const retained = retainedDecorOf(world.terrain); if (retained) return retained;
  const raster = rustSettlementRaster(world);
  let metrics = rasterMetrics.get(raster);
  if (!metrics) {
    const heights = raster.height; let minHeight = Infinity, maxHeight = -Infinity, wet = 0;
    for (let i = 0; i < heights.length; i++) { minHeight = Math.min(minHeight, heights[i]); maxHeight = Math.max(maxHeight, heights[i]); if (raster.water[i]) wet++; }
    metrics = { minHeight, maxHeight, land: 1 - wet / heights.length }; rasterMetrics.set(raster, metrics);
  }
  const { minHeight, maxHeight, land } = metrics, native = nativeTerrainOf(world), configuration = effectiveTerrainSettings(settings, world.mapSize);
  // The zone names the decor; its effective values travel with it.
  const climate = configuration.climateZone ?? configuration.climate ?? 'temperate';
  const query = new URLSearchParams({ climate });
  for (const [key, value] of Object.entries(configuration.climateValues ?? {})) query.set(key, String(value));
  return { raster, meta: { format: 'magna-decor', version: 1, id: `v2-${world.seed}`, label: 'Magna Urbis V2', tags: { climate }, seed: world.seed, width: world.mapSize,
    query: query.toString(), created: '', settlements: [], roadConfig: null, roads: null, waterSvg: '',
    terrainDisplay: { floor: native?.field?.floor ?? minHeight, sourceCell: native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell, refine: configuration.refine !== false && configuration.relief !== 'cavern', globalMinHeight: native?.globalMinHeight ?? minHeight, globalMaxHeight: native?.globalMaxHeight ?? maxHeight, motifSize: native?.motifSize ?? configuration.motifSize },
    stats: { land, minHeight, maxHeight, riverKm: 0, roadKm: 0 } } };
}
/** Stage metadata can change without changing native geometry. Keep renderer
 * indexes when only progress/warnings/bookkeeping headers have changed. */
export function sameV2NativeInputs(before: readonly RustTownSnapshot[], after: readonly RustTownSnapshot[], part: 'layouts' | 'partitions' | 'scene'): boolean {
  if (before.length !== after.length) return false;
  const minimum = part === 'scene' ? 3 : part === 'partitions' ? 1 : 0;
  return after.every((city, i) => (stageIndex(city.stage) >= minimum ? city[part] : undefined) === (stageIndex(before[i].stage) >= minimum ? before[i][part] : undefined));
}

/** Lazy import keeps WebGL, the native exterior cache and terrain renderer off the initial UI path. */
export async function mountV2Urban3d(options: V2Urban3dOptions): Promise<V2Urban3d> {
  const [{ mountCity3d }, { UrbanBuildingDetailController }, { UrbanBuildingLodRenderer }] = await Promise.all([
    import('../ui/city3d'), import('../render/urbanBuildingDetails'), import('../render/urbanBuildingLod'),
    // Choose the prepared backend before taking a canvas context. Otherwise the first opening always
    // starts WebGL2, compiling the same ground in ANGLE while WebGPU prepares a second view behind it.
    import('../ui/terrain3dRenderer').then(module => module.terrain3dBackendReady()),
  ]);
  let worldOf: World | undefined, terrainOf: World['terrain'] | undefined, decor: Decor | undefined, climateOf = '';
  let nativeOf: readonly RustTownSnapshot[] = [], activitiesOf: PlacementBatch | undefined, scene: PlacementBatch | undefined, layouts: Layout[] = [], partitions: Partition[] = [], roads: Street[] = [];
  let details: InstanceType<typeof UrbanBuildingDetailController> | undefined, renderer: InstanceType<typeof UrbanBuildingLodRenderer> | undefined, runtimeOf = '';
  let sampleOf: Float32Array | undefined, sampleKey = '', sampler: ReturnType<typeof createV2Terrain3dSampler> | undefined;
  const listeners = new Set<() => void>();
  let illustrationRevision = 0;
  let illustration: { url: string; terrain: import('../../../rust/bridge/terrain').TerrainData; key: string; value: NonNullable<ReturnType<NonNullable<City3dOptions['getIllustrated']>>> } | undefined;
  const illustrated = (): ReturnType<NonNullable<City3dOptions['getIllustrated']>> => {
    const world=options.getWorld(),settings=options.getSettings(); if (!world) return;
    const r=v2Resolved3d(settings,world),style=r.ground.style,url=options.getBackground?.();
    if (!isFantasyStyle(style) || !r.ground.layers.relief || !url?.startsWith('data:image/svg+xml')) return;
    const terrain=renderScene(world,settings).terrain,config={...effectiveTerrainSettings(settings,world.mapSize),seed:world.seed};
    const key=JSON.stringify([style,config.seed,config.width,config.climate,config.climateValues,r.vegetation.fantasy]);
    if (illustration?.url===url && illustration.terrain===terrain && illustration.key===key) return illustration.value;
    let pending: ReturnType<typeof terrain3dIllustratedSvg> | undefined;
    const value={key:String(++illustrationRevision),load:()=> pending??=(async()=>{
      const {fantasyLibraries}=await import('../render/fantasyBrushAssets'); registerFantasyBrushes(fantasyLibraries);
      return terrain3dIllustratedSvg(url,terrain,style,config,r.vegetation.fantasy);
    })().catch(error=>{pending=undefined;throw error;})};
    illustration={url,terrain,key,value}; return value;
  };
  // These reused bench modules follow a shared locale key. Keep their labels aligned
  // with V2 without changing or reloading the V2 settings, seeds or geometry.
  const syncLocale = () => { try { localStorage.setItem('magna-urbis-locale', getLanguage()); } catch { /* Storage is optional. */ } window.dispatchEvent(new Event('magna-locale-change')); };
  syncLocale(); const offLocale = onLanguageChange(syncLocale);
  const update = () => {
    const world = options.getWorld(), settings = options.getSettings();
    if (!world) { if (worldOf) { worldOf = undefined; terrainOf = undefined; decor = undefined; nativeOf = []; scene = undefined; layouts = []; partitions = []; roads = []; details?.dispose(); details = undefined; renderer = undefined; activitiesOf = undefined; } return; }
    const r = v2Resolved3d(settings, world);
    setRoadGround(world.landuse, world.mapSize, roadGroundTones(r.ground.traits.family === 'material', biomePalette(r.palette.mapStyle, world.options.biome)), r.composition.ambience === 'night');
    const climate = JSON.stringify([settings.terrain?.climate, settings.terrain?.climateValues, settings.terrain?.motifSize, settings.terrain?.refine, settings.terrain?.relief]);
    if (world.terrain !== terrainOf) { terrainOf = world.terrain; decor = v2WorldDecor(world, settings); }
    else if (climate !== climateOf && decor) decor.meta = v2WorldDecor(world, settings).meta;
    climateOf = climate;
    const cities = v2NativeCities(world), runtime = settings.urban?.backend === 'native' ? { profile: 'local' as const, server: settings.runtime?.localServer ?? 'http://127.0.0.1:8791' } : undefined;
    const runtimeKey = JSON.stringify(runtime);
    if (!sameV2NativeInputs(nativeOf, cities, 'layouts')) layouts = cities.length === 1 ? cities[0].layouts : cities.flatMap(city => city.layouts);
    if (!sameV2NativeInputs(nativeOf, cities, 'partitions')) {
      const visible = cities.filter(city => stageIndex(city.stage) >= 1); partitions = visible.length === 1 ? visible[0].partitions ?? [] : visible.flatMap(city => city.partitions ?? []);
    }
    const activities = activityScene(world);
    const changedScene = !sameV2NativeInputs(nativeOf, cities, 'scene') || activities !== activitiesOf;
    if (changedScene) { scene = withV2ActivityScene(combineV2NativeScenes(cities), activities); activitiesOf = activities; }
    if (runtimeKey !== runtimeOf || changedScene) {
      details?.dispose(); details = undefined; renderer = undefined; runtimeOf = runtimeKey;
      if (usesNativeHouseRenderer(scene)) {
        renderer = new UrbanBuildingLodRenderer(scene!);
        details = new UrbanBuildingDetailController({ scene: scene!, renderer,
          realize: async (building, context) => (await import('../../../rust/bridge/architecture')).realizeUrbanBuilding(building, runtime, false, context.scene),
          onChange: () => listeners.forEach(listener => listener()),
        });
      }
    }
    nativeOf = cities;
    if (world !== worldOf) { roads = townRoadStreets(world); worldOf = world; }
  };
  const heightSampler = () => {
    const world = options.getWorld(); if (!world) return;
    const settings = options.getSettings(), view = v2Terrain3dView(settings), height = v2Terrain3dSurface(world, settings).height;
    const key = JSON.stringify([view.ground, view.refinement, settings.terrain?.refine, settings.terrain?.detailNoise, settings.terrain?.climate, settings.terrain?.climateValues, world.seed]);
    if (sampleOf !== height.data || key !== sampleKey) { sampleOf = height.data; sampleKey = key; sampler = createV2Terrain3dSampler(world, settings, view.ground); }
    return sampler;
  };
  const detailed = () => { const b = v2Resolved3d(options.getSettings()).composition.buildings; return b.visible && b.meshes === 'detailed'; };
  const service: City3dDetailService = {
    setActiveView: view => { if (view === '2d' || !detailed()) details?.suspend(); },
    update: view => { if (detailed()) return details?.update(view); details?.suspend(); return details?.stats; }, cached: () => detailed() ? details?.cachedDetails() ?? [] : [],
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  update();
  // The legend only needs the blocks' classes: a terrain-free plan of the retained layouts, rebuilt when they change.
  let legendPlan: { layouts: Layout[]; partitions: Partition[]; scene: CityScene } | undefined;
  const legendScene = (): CityScene | undefined => {
    if (!layouts.length) return;
    if (legendPlan?.layouts !== layouts || legendPlan.partitions !== partitions) legendPlan = { layouts, partitions, scene: buildCityScene(layouts, partitions) };
    return legendPlan.scene;
  };
  let presentedSource: World | undefined, presentedKey = '', presentedWorld: World | undefined;
  const textWorld = (): World | undefined => {
    const world = options.getWorld(), key = `${getLanguage()}:${getDistanceUnit()}:${options.getSettings().naming?.mode ?? 'localized'}`;
    if (world !== presentedSource || key !== presentedKey) { presentedSource = world; presentedKey = key; presentedWorld = world ? mapPresentation(world, options.getSettings()) : undefined; }
    return presentedWorld;
  };
  provideFurniture3d(options.host, () => {
    const world = options.getWorld(); if (!world) return;
    const r = v2Resolved3d(options.getSettings(), world), lu = r.composition.landuse, plan = r.cartography.legend && lu.urban !== 'off' ? legendScene() : undefined;
    return { world: textWorld()!, palette: terrainStyle(r.composition.variant, r.palette.colors).palette, legend: r.cartography.legend, cartouche: r.cartography.cartouche,
      semantic: [...ruralSemanticLegend(world.landuse, lu.classes, lu.rural), ...(plan ? urbanSemanticLegend([plan], lu.urban) : [])] };
  });
  const view = mountCity3d({ host: options.host, navigation: true, fastTerrain: true, materialGrounds: true, softwareMaterialFallback: !!options.getBackground, getDecor: () => decor, getLayouts: () => layouts, getPartitions: () => partitions, getRegionalStreets: () => cityRegionalStreets(v2Resolved3d(options.getSettings(), options.getWorld()), roads),
    getBuildingsVisible: () => { const b = v2Resolved3d(options.getSettings()).composition.buildings; return b.visible && b.meshes !== 'none'; }, getScene: () => scene, getSelected: options.getSelected, onSelect: options.onSelect, getBackground: options.getBackground, getBackgroundImage: options.getBackgroundImage,
    getIllustrated: illustrated,
    getGroundSettings: ground => { const world = options.getWorld(); return world && v2Terrain3dGround(world, options.getSettings(), ground); },
    getLook: () => cityGroundLook(v2Resolved3d(options.getSettings())),
    getWaterDisplay: () => { const world = options.getWorld(); return world && v2WaterDisplay(world, options.getSettings()); },
    getRetainedWater: () => {
      const world = options.getWorld(), decor = world && retainedDecorOf(world.terrain); if (!world || !decor) return;
      const settings = options.getSettings(), r = v2Resolved3d(settings, world); if (!r.composition.networks.water.visible) return;
      const effective = effectiveTerrainSettings(settings, world.mapSize);
      return decorWater3d(decor, r.composition.networks.water.look === 'ink' ? r.palette.mapStyle : 'render3d', r.ground.lakes, r.palette.colors,
        { zone: effective.climateZone, season: r.ground.season, calendar: r.ground.calendar });
    },
    getSurface: () => { const world = options.getWorld(); return world && v2Terrain3dSurface(world, options.getSettings()); }, getHeightSampler: heightSampler,
    getForest: () => {
      // An Illustrated ground has its canopy in the raster draped as the map.
      const settings = options.getSettings(), world = options.getWorld(), r = world && v2Resolved3d(settings, world), field = r && !r.traits.fantasy && v2DisplayForest(world!, settings, r, () => view.refresh());
      return field &&Number.isInteger(field.n) && field.n > 0 && Number.isFinite(field.width) && field.width > 0 && field.rgba instanceof Uint8Array && field.rgba.length === field.n ** 2 * 4 ? { field, occupation: v2ForestOccupation(world!) } : undefined;
    },
    getText: () => { const r = v2Resolved3d(options.getSettings()); return { world: textWorld(), text: r.composition.text, palette: terrainStyle(r.composition.variant, r.palette.colors).palette }; },
    getSemantic: () => {
      const world = options.getWorld(), settings = options.getSettings(); if (!world) return;
      const { rural, urban, opacity, classes, depth } = v2Resolved3d(settings, world).composition.landuse;
      return { landuse: world.landuse, rural, urban, opacity, classes, depth };
    },
    // The painter follows `composition.vegetation` (cartographic classes, painted brushes). A map ground always shows its fields, as in 2D; a material ground only with vector vegetation.
    getPhysicalGround: material => !material || v2Resolved3d(options.getSettings(), options.getWorld()).composition.vegetation.cartographic ? options.getPhysicalGround?.() : undefined,
    getViewSettings: () => v2Terrain3dView(options.getSettings()),
    // The view never writes the shared settings: it emits a patch, the orchestration applies it.
    onViewSettingsChange: value => {
      const previous = v2Terrain3dView(options.getSettings());
      const patch: AppearancePatch = { city: value };
      if (value.ground !== 'map' && value.ground !== previous.ground) { patch.terrainStyle = value.ground === 'render' ? 'render3d' : value.ground; patch.renderer = 'bench'; }
      options.onAppearancePatch(patch);
    },
    getPlanOptions: () => city3dPlanOptions(v2Resolved3d(options.getSettings(), options.getWorld())),
    getBuildingAppearance: () => { const r = v2Resolved3d(options.getSettings()); return { colors: r.palette.colors, style: r.city.buildingStyle, diagnostic: r.city.diagnostic, ambience: r.composition.ambience }; },
    getTextured: options.getTextured, setTextured: options.setTextured, onCamera: options.onCamera, details: service });
  return { get active() { return view.active; }, get detailStats() { return details?.stats; },
    prepare: () => { update(); return view.prepare(); },
    show: () => { update(); view.show(); refreshFurniture3d(options.host); }, hide: () => view.hide(), refresh: () => { update(); view.refresh(); refreshFurniture3d(options.host); },
    focus: (point, radius) => view.focus(point, radius), getCamera: () => view.getCamera(), setCamera: camera => view.setCamera(camera),
    toMapView: () => view.toMapView(), fromMapView: mapView => view.fromMapView(mapView),
    capture: () => view.capture(), captureIllustration: () => view.captureIllustration(), stats: () => view.stats(),
    dispose: () => { offLocale(); view.dispose(); details?.dispose(); listeners.clear(); },
  };
}
