/** Exact City Bench renderer inside V2; no iframe, geometry regeneration or surrogate houses. */
import { v2DisplayForest } from './displayForest';
import type { World } from '../gen/types';
import type { Layout, Partition, Street } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { Decor } from '../ui/decor';
import type { City3d, City3dDetailService, City3dOptions, City3dGround, City3dSurface, City3dViewSettings, City3dWaterDisplay } from '../ui/city3d';
import type { Terrain3dGroundSettings } from '../ui/terrain3d';
import type { TerrainLook } from '../ui/terrainGl';
import type { V2TerrainLayer } from './terrainProjection';
import { effectiveTerrainSettings } from './terrainSettings';
import { DEFAULT_TERRAIN_LIGHTING, DEFAULT_TERRAIN_LAYERS } from '../render/terrainLighting';
import { isRender3dStyle, terrainStyle } from '../render/terrainStyle';
import { CONTOUR_INTERVAL } from '../render/contours';
import { renderV2Number } from '../../../rust/bridge/terrainRenderV2';
import { createTerrainSurfaceSampler } from '../ui/terrainSurface';
import { createGroundDisplacementSampler } from '../../../rust/bridge/terrainGround';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { rustSettlementRaster } from './rustUrban';
import { getLanguage, onLanguageChange } from './i18n';

export interface V2Urban3dOptions {
  host: HTMLElement;
  getWorld(): World | undefined;
  getSettings(): V2Settings;
  getSelected?(): string | undefined;
  onSelect?(id: string): void;
  getBackground?(): string | undefined;
  getTextured?(): boolean;
  setTextured?(value: boolean): void;
  onCamera?: City3dOptions['onCamera'];
  onAppearanceChange?(): void;
}
export interface V2Urban3d extends City3d { readonly detailStats: import('../render/urbanBuildingDetails').BuildingDetailStats | undefined }
const stageIndex = (stage: RustTownSnapshot['stage']) => ['layout', 'parcels', 'programme', 'buildings'].indexOf(stage);
export function v2NativeCities(world: World | undefined): RustTownSnapshot[] {
  return Object.values(world?.debug?.v2RustCities as Record<string, RustTownSnapshot> ?? {}).filter(city => city.layouts?.length);
}
/** A union of the same retained native snapshots. Archive identities stay untouched. */
export function combineV2NativeScenes(cities: readonly RustTownSnapshot[]): PlacementBatch | undefined {
  const scenes = cities.filter(city => stageIndex(city.stage) >= 3).map(city => city.scene).filter((scene): scene is PlacementBatch => !!scene);
  if (!scenes.length) return undefined;
  const generator = scenes[0].generator_version;
  if (scenes.some(scene => scene.generator_version !== generator)) throw new Error('The retained native architecture versions differ. Regenerate the affected settlements.');
  // A complete single native scene is already the exact union. Preserve its
  // arrays and compressed archives instead of rebuilding them on every view.
  if (scenes.length === 1 && scenes[0].materials && scenes[0].plan_archives) return scenes[0];
  const materials = new Map(scenes.flatMap(scene => scene.materials ?? []).map(material => [material.id, material]));
  const plan_archives: Record<string, string> = {};
  for (const scene of scenes) for (const [id, archive] of Object.entries(scene.plan_archives ?? {})) {
    if (plan_archives[id] !== undefined && plan_archives[id] !== archive) throw new Error(`Retained plan archive identity collision: ${id}`);
    plan_archives[id] = archive;
  }
  return { schema_version: '1', generator_version: generator, materials: [...materials.values()], buildings: scenes.flatMap(scene => scene.buildings), refusals: scenes.flatMap(scene => scene.refusals), open_spaces: scenes.flatMap(scene => scene.open_spaces), plan_archives };
}
/** Physical raster reference is cached per terrain. Retained geographic domains are reused by 3D. */
const rasterMetrics = new WeakMap<ReturnType<typeof rustSettlementRaster>, { minHeight: number; maxHeight: number; land: number }>();
const rasterWater = new WeakMap<ReturnType<typeof rustSettlementRaster>, Float32Array>();
const waterDisplays = new WeakMap<ReturnType<typeof rustSettlementRaster>, Map<string, City3dWaterDisplay>>();
function v2WaterDisplay(world: World, settings: V2Settings): City3dWaterDisplay {
  const raster = rustSettlementRaster(world), shown = settings.appearance?.terrainLayers?.water !== false, lakes = settings.appearance?.lakes !== false, key = `${shown}:${lakes}`;
  let cache = waterDisplays.get(raster); if (!cache) { cache = new Map(); waterDisplays.set(raster, cache); }
  const retained = cache.get(key); if (retained) return retained;
  const texture = document.createElement('canvas'); texture.width = texture.height = raster.n;
  const ctx = texture.getContext('2d')!, pixels = ctx.createImageData(raster.n, raster.n), paths = new Path2D();
  if (shown) {
    for (let i = 0; i < raster.water.length; i++) if (raster.water[i] > 0 && raster.water[i] < 4 && (lakes || raster.water[i] !== 2)) pixels.data.set([74, 134, 179, 255], i * 4);
    const firstLake = world.terrain.coastline.length, lastLake = firstLake + world.terrain.lakes.length;
    for (const [index, polygon] of (raster.geometry?.water ?? []).entries()) {
      if (!lakes && index >= firstLake && index < lastLake) continue;
      for (const ring of polygon) { if (ring.length < 3) continue; paths.moveTo(ring[0].x, ring[0].y); for (const p of ring.slice(1)) paths.lineTo(p.x, p.y); paths.closePath(); }
    }
  }
  ctx.putImageData(pixels, 0, 0); const result = { texture, paths }; cache.set(key, result); return result;
}
/** Preserve the native control grid and the applied lake levels; never resample the terrain. */
export function v2Terrain3dSurface(world: World, settings: V2Settings): City3dSurface {
  const raster = rustSettlementRaster(world), native = (world.terrain as V2TerrainLayer).v2NativeTerrain, field = native?.field;
  const valid = field && Number.isInteger(field.n) && field.n >= 2 && field.data instanceof Float32Array && field.data.length === field.n ** 2;
  let mask = rasterWater.get(raster);
  if (!mask) { mask = Float32Array.from(raster.water, value => value === 2 ? 1 : -1); rasterWater.set(raster, mask); }
  return { height: { x: 0, y: 0, width: raster.width, n: valid ? field.n : raster.n, data: valid ? field.data : raster.height, ...(valid && field.cave ? { cave: field.cave } : {}) },
    water: settings.appearance?.lakes === false ? undefined : { n: raster.n, mask, levels: raster.waterLevel }, waterVisible: settings.appearance?.terrainLayers?.water !== false };
}
export function v2Terrain3dView(settings: V2Settings): City3dViewSettings {
  const appearance = settings.appearance, city = appearance?.city, style = appearance?.terrainStyle;
  return { ground: city?.ground ?? (style && isRender3dStyle(style) ? style as City3dGround : 'map'), plan: city?.plan ?? true,
    colors: city?.colors ?? (city?.diagnostic === 'uses' ? 'uses' : 'materials'), exaggeration: city?.exaggeration ?? 1, refinement: city?.refinement ?? 'noise' };
}
/** All material modes consume one physical surface and the same display-only recipe. */
export function v2Terrain3dGround(world: World, settings: V2Settings, ground: City3dGround): Terrain3dGroundSettings | undefined {
  if (ground === 'map') return;
  const config = effectiveTerrainSettings(settings, world.mapSize), appearance = settings.appearance, native = (world.terrain as V2TerrainLayer).v2NativeTerrain;
  const style = terrainStyle(ground === 'render' ? 'render3d' : ground, appearance?.colors), relief = config.relief === 'flat' || config.relief === 'hills' || config.relief === 'valley' ? config.relief : 'mountains';
  const layers = { ...DEFAULT_TERRAIN_LAYERS, ...appearance?.terrainLayers };
  if (!layers.relief || !layers.hypsometry) return;
  return { seed: seedHash(world.seed), climate: { temperature: config.climateValues!.temperature, precipitation: config.climateValues!.precipitation }, climateZone: config.climateZone,
    sourceCell: native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell,
    lighting: { ...DEFAULT_TERRAIN_LIGHTING, ...appearance?.lighting }, renderV2: renderV2Number(style.id), v2Season: appearance?.season ?? .5,
    waterVisible: layers.water !== false, displacement: v2Terrain3dView(settings).refinement !== 'source', forestBrushes: ground === 'render3d-brush',
    contours: appearance?.contours !== false && layers.relief && config.relief !== 'cavern' ? { step: CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1), color: style.palette.contour, opacity: style.palette.contourOpacity, flat: relief === 'flat' } : undefined };
}
export function createV2Terrain3dSampler(world: World, settings: V2Settings, ground: City3dGround): ReturnType<typeof createTerrainSurfaceSampler> {
  const base = v2Terrain3dSurface(world, settings).height, config = effectiveTerrainSettings(settings, world.mapSize), native = (world.terrain as V2TerrainLayer).v2NativeTerrain;
  const material = v2Terrain3dGround(world, settings, ground), refinement = v2Terrain3dView(settings).refinement;
  const look: TerrainLook = { colors: settings.appearance?.colors, style: ground === 'map' ? settings.appearance?.terrainStyle ?? settings.appearance?.style ?? settings.options.style : ground === 'render' ? 'render3d' : ground,
    mapWidth: world.mapSize, lighting: material?.lighting ?? DEFAULT_TERRAIN_LIGHTING, layers: { ...DEFAULT_TERRAIN_LAYERS, ...settings.appearance?.terrainLayers },
    climate: { temperature: config.climateValues!.temperature, precipitation: config.climateValues!.precipitation }, seed: seedHash(world.seed),
    globalMin: native?.globalMinHeight ?? 0, globalMax: native?.globalMaxHeight ?? 0, refine: refinement === 'noise' && config.refine !== false && config.relief !== 'cavern',
    sourceCell: material?.sourceCell ?? (native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell), detail: config.detailNoise!, floor: native?.field?.floor ?? 0,
    contours: false, contourStep: 1, flatRelief: config.relief === 'flat', frame: false, background: '#f1f0e9' };
  const sampler = createTerrainSurfaceSampler(base, look, [], true);
  if (!material?.displacement) return sampler;
  return createGroundDisplacementSampler(sampler, { seed: look.seed, sourceCell: look.sourceCell, macroSampler: createTerrainSurfaceSampler(base, { ...look, refine: false }, [], false), climate: [look.climate!.temperature, look.climate!.precipitation] });
}
export function v2WorldDecor(world: World, settings: V2Settings): Decor {
  const raster = rustSettlementRaster(world);
  let metrics = rasterMetrics.get(raster);
  if (!metrics) {
    const heights = raster.height; let minHeight = Infinity, maxHeight = -Infinity, wet = 0;
    for (let i = 0; i < heights.length; i++) { minHeight = Math.min(minHeight, heights[i]); maxHeight = Math.max(maxHeight, heights[i]); if (raster.water[i]) wet++; }
    metrics = { minHeight, maxHeight, land: 1 - wet / heights.length }; rasterMetrics.set(raster, metrics);
  }
  const { minHeight, maxHeight, land } = metrics, native = (world.terrain as V2TerrainLayer).v2NativeTerrain, configuration = effectiveTerrainSettings(settings, world.mapSize);
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
  ]);
  let worldOf: World | undefined, terrainOf: World['terrain'] | undefined, decor: Decor | undefined, climateOf = '';
  let nativeOf: RustTownSnapshot[] = [], scene: PlacementBatch | undefined, layouts: Layout[] = [], partitions: Partition[] = [], roads: Street[] = [];
  let details: InstanceType<typeof UrbanBuildingDetailController> | undefined, renderer: InstanceType<typeof UrbanBuildingLodRenderer> | undefined, runtimeOf = '';
  let sampleOf: Float32Array | undefined, sampleKey = '', sampler: ReturnType<typeof createV2Terrain3dSampler> | undefined;
  const listeners = new Set<() => void>();
  // These reused bench modules follow a shared locale key. Keep their labels aligned
  // with V2 without changing or reloading the V2 settings, seeds or geometry.
  const syncLocale = () => { try { localStorage.setItem('magna-urbis-locale', getLanguage()); } catch { /* Storage is optional. */ } window.dispatchEvent(new Event('magna-locale-change')); };
  syncLocale(); const offLocale = onLanguageChange(syncLocale);
  const update = () => {
    const world = options.getWorld(), settings = options.getSettings();
    if (!world) { if (worldOf) { worldOf = undefined; terrainOf = undefined; decor = undefined; nativeOf = []; scene = undefined; layouts = []; partitions = []; roads = []; details?.dispose(); details = undefined; renderer = undefined; } return; }
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
    const changedScene = !sameV2NativeInputs(nativeOf, cities, 'scene');
    if (changedScene) scene = combineV2NativeScenes(cities);
    if (runtimeKey !== runtimeOf || changedScene) {
      details?.dispose(); details = undefined; renderer = undefined; runtimeOf = runtimeKey;
      if (scene) {
        renderer = new UrbanBuildingLodRenderer(scene);
        details = new UrbanBuildingDetailController({ scene, renderer,
          realize: async (building, context) => (await import('../../../rust/bridge/architecture')).realizeUrbanBuilding(building, runtime, false, context.scene),
          onChange: () => listeners.forEach(listener => listener()),
        });
      }
    }
    nativeOf = cities;
    if (world !== worldOf) { roads = (world.roads ?? []).map(road => ({ path: road.path, widths: road.path.map(() => road.width), rank: road.kind === 'major' ? 1 : road.kind === 'minor' ? 2 : 3, role: 'regional' })); worldOf = world; }
  };
  const heightSampler = () => {
    const world = options.getWorld(); if (!world) return;
    const settings = options.getSettings(), view = v2Terrain3dView(settings), height = v2Terrain3dSurface(world, settings).height;
    const key = JSON.stringify([view.ground, view.refinement, settings.terrain?.refine, settings.terrain?.detailNoise, settings.terrain?.climate, settings.terrain?.climateValues, world.seed]);
    if (sampleOf !== height.data || key !== sampleKey) { sampleOf = height.data; sampleKey = key; sampler = createV2Terrain3dSampler(world, settings, view.ground); }
    return sampler;
  };
  const service: City3dDetailService = {
    setActiveView: view => { if (view === '2d') details?.suspend(); },
    update: view => details?.update(view), cached: () => details?.cachedDetails() ?? [],
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  update();
  const view = mountCity3d({ host: options.host, fastTerrain: true, materialGrounds: true, softwareMaterialFallback: !!options.getBackground, getDecor: () => decor, getLayouts: () => layouts, getPartitions: () => partitions, getRegionalStreets: () => options.getSettings().appearance?.roads === false ? [] : roads,
    getBuildingsVisible: () => options.getSettings().appearance?.buildings !== false, getScene: () => scene, getSelected: options.getSelected, onSelect: options.onSelect, getBackground: options.getBackground,
    getGroundSettings: ground => { const world = options.getWorld(); return world && v2Terrain3dGround(world, options.getSettings(), ground); },
    getWaterDisplay: () => { const world = options.getWorld(); return world && v2WaterDisplay(world, options.getSettings()); },
    getSurface: () => { const world = options.getWorld(); return world && v2Terrain3dSurface(world, options.getSettings()); }, getHeightSampler: heightSampler,
    getForest: () => {
      const settings = options.getSettings(), world = options.getWorld(), field = world && v2DisplayForest(world, settings);
      return field && Number.isInteger(field.n) && field.n > 0 && Number.isFinite(field.width) && field.width > 0 && field.rgba instanceof Uint8Array && field.rgba.length === field.n ** 2 * 4 ? { field } : undefined;
    },
    getViewSettings: () => v2Terrain3dView(options.getSettings()),
    onViewSettingsChange: value => {
      const settings = options.getSettings(), previous = v2Terrain3dView(settings);
      settings.appearance = { style: settings.options.style, ...settings.appearance, city: { ...settings.appearance?.city, ...value } };
      if (value.ground !== 'map' && value.ground !== previous.ground) { settings.appearance.terrainStyle = value.ground === 'render' ? 'render3d' : value.ground; settings.appearance.renderer = 'bench'; }
      options.onAppearanceChange?.();
    },
    getPlanOptions: () => {
      const appearance = options.getSettings().appearance, city = appearance?.city;
      return { colors: appearance?.colors, view: city?.view ?? 'parcels', palette: city?.palette ?? 'terrain', width: city?.width ?? .6, opacity: city?.opacity ?? 1, labels: appearance?.labels,
        layers: { reserve: false, allocated: false, centers: false, domains: false, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false, ...city?.layers }, groundBlend: city?.groundBlend === 'blended' };
    },
    getBuildingAppearance: () => { const city = options.getSettings().appearance?.city; return { colors: options.getSettings().appearance?.colors, style: city?.buildingStyle ?? 'cartographic', diagnostic: city?.diagnostic ?? 'none' }; },
    getTextured: options.getTextured, setTextured: options.setTextured, onCamera: options.onCamera, details: service });
  return { get active() { return view.active; }, get detailStats() { return details?.stats; },
    show: () => { update(); view.show(); }, hide: () => view.hide(), refresh: () => { update(); view.refresh(); },
    focus: (point, radius) => view.focus(point, radius), getCamera: () => view.getCamera(), setCamera: camera => view.setCamera(camera),
    capture: () => view.capture(), captureIllustration: () => view.captureIllustration(), stats: () => view.stats(),
    dispose: () => { offLocale(); view.dispose(); details?.dispose(); listeners.clear(); },
  };
}
