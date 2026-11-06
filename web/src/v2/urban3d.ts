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
import { CONTOUR_INTERVAL } from '../render/contours';
import { createTerrainSurfaceSampler } from '../ui/terrainSurface';
import { createGroundDisplacementSampler } from '../../../rust/bridge/terrainGround';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { rustSettlementRaster } from './rustUrban';
import { getLanguage, onLanguageChange } from './i18n';
import { activityScene } from './activitySites';
import { provideFurniture3d, refreshFurniture3d } from '../ui/legendOverlay3d';
import { buildingColors } from '../render/urbanBuildingStyle';
import { roadGroundTones, roadInkOf, setRoadGround } from '../render/roadStyle';
import { biomePalette } from '../render/biomes';
import { ruralSemanticLegend, urbanSemanticLegend } from '../render/semanticLayer';
import { buildCityScene, type CityScene } from '../render/cityCanvas';
import { terrain3dIllustratedSvg } from '../ui/terrain3dTexture';
import { isFantasyStyle, registerFantasyBrushes } from '../../../rust/bridge/fantasyTerrain';

export interface V2Urban3dOptions {
  host: HTMLElement;
  getWorld(): World | undefined;
  getSettings(): V2Settings;
  getSelected?(): string | undefined;
  onSelect?(id: string): void;
  getBackground?(): string | undefined;
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
/** The towns' scene plus the activity sites (farms, mills, chapels…) of the region, drawn from their massing. */
export function withV2ActivityScene(scene: PlacementBatch | undefined, activities: PlacementBatch | undefined): PlacementBatch | undefined {
  if (!activities?.buildings.length) return scene;
  if (!scene) return activities;
  return { ...scene, materials: [...scene.materials ?? [], ...activities.materials ?? []], buildings: [...scene.buildings, ...activities.buildings] };
}
/** Physical raster reference is cached per terrain. Retained geographic domains are reused by 3D. */
const rasterMetrics = new WeakMap<ReturnType<typeof rustSettlementRaster>, { minHeight: number; maxHeight: number; land: number }>();
const rasterWater = new WeakMap<ReturnType<typeof rustSettlementRaster>, Float32Array>();
const waterDisplays = new WeakMap<ReturnType<typeof rustSettlementRaster>, Map<string, City3dWaterDisplay>>();
function v2WaterDisplay(world: World, settings: V2Settings): City3dWaterDisplay {
  const raster = rustSettlementRaster(world), r = v2Resolved3d(settings, world), shown = r.ground.layers.water, lakes = r.ground.lakes;
  const palette=terrainStyle(r.palette.mapStyle,r.palette.colors).palette,ink=r.composition.networks.water.look==='ink',key=JSON.stringify([shown,lakes,ink,ink?palette.lakeFill:undefined,ink?palette.waterEdge:undefined]);
  let cache = waterDisplays.get(raster); if (!cache) { cache = new Map(); waterDisplays.set(raster, cache); }
  const retained = cache.get(key); if (retained) return retained;
  const texture = document.createElement('canvas'); texture.width = texture.height = raster.n;
  const ctx = texture.getContext('2d')!, pixels = ctx.createImageData(raster.n, raster.n), paths = new Path2D();
  if (shown) {
    const value=parseInt(palette.lakeFill.slice(1),16),rgba=ink?[value>>16&255,value>>8&255,value&255,255]:[74,134,179,255];
    for (let i = 0; i < raster.water.length; i++) if (raster.water[i] > 0 && raster.water[i] < 4 && (lakes || raster.water[i] !== 2)) pixels.data.set(rgba, i * 4);
    const firstLake = world.terrain.coastline.length, lastLake = firstLake + world.terrain.lakes.length;
    for (const [index, polygon] of (raster.geometry?.water ?? []).entries()) {
      if (!lakes && index >= firstLake && index < lastLake) continue;
      for (const ring of polygon) { if (ring.length < 3) continue; paths.moveTo(ring[0].x, ring[0].y); for (const p of ring.slice(1)) paths.lineTo(p.x, p.y); paths.closePath(); }
    }
  }
  ctx.putImageData(pixels, 0, 0); const result = { texture, paths, ...(ink?{ink:{fill:palette.lakeFill,stroke:palette.waterEdge}}:{}) }; cache.set(key, result); return result;
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
  if (ground === 'map') return;
  const config = effectiveTerrainSettings(settings, world.mapSize), r = v2Resolved3d(settings, world), native = renderScene(world, settings).nativeTerrain;
  const style = terrainStyle(ground === 'render' ? 'render3d' : ground, r.palette.colors), relief = config.relief === 'flat' || config.relief === 'hills' || config.relief === 'valley' ? config.relief : 'mountains';
  const layers = r.ground.layers;
  if (!layers.relief || !layers.hypsometry) return;
  return { seed: seedHash(world.seed), climate: { temperature: config.climateValues!.temperature, precipitation: config.climateValues!.precipitation }, climateZone: config.climateZone,
    sourceCell: native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell,
    lighting: { ...r.ground.lighting }, renderV2: style.traits.satelliteVariant, v2Season: r.ground.season, ambience:r.composition.ambience, waterLook:r.composition.networks.water.look,
    waterVisible: layers.water, displacement: r.city.refinement !== 'source', forestBrushes: style.traits.forestBrushes,
    contours: r.ground.contours && layers.relief && config.relief !== 'cavern' ? { step: CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1), color: style.palette.contour, opacity: style.palette.contourOpacity, flat: relief === 'flat' } : undefined };
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
  provideFurniture3d(options.host, () => {
    const world = options.getWorld(); if (!world) return;
    const r = v2Resolved3d(options.getSettings(), world), lu = r.composition.landuse, plan = r.cartography.legend && lu.urban !== 'off' ? legendScene() : undefined;
    return { world, palette: terrainStyle(r.composition.variant, r.palette.colors).palette, legend: r.cartography.legend, cartouche: r.cartography.cartouche,
      semantic: [...ruralSemanticLegend(world.landuse, lu.classes, lu.rural), ...(plan ? urbanSemanticLegend([plan], lu.urban) : [])] };
  });
  const view = mountCity3d({ host: options.host, navigation: true, fastTerrain: true, materialGrounds: true, softwareMaterialFallback: !!options.getBackground, getDecor: () => decor, getLayouts: () => layouts, getPartitions: () => partitions, getRegionalStreets: () => v2Resolved3d(options.getSettings()).cartography.roads ? roads : [],
    getBuildingsVisible: () => { const b = v2Resolved3d(options.getSettings()).composition.buildings; return b.visible && b.meshes !== 'none'; }, getScene: () => scene, getSelected: options.getSelected, onSelect: options.onSelect, getBackground: options.getBackground,
    getIllustrated: illustrated,
    getGroundSettings: ground => { const world = options.getWorld(); return world && v2Terrain3dGround(world, options.getSettings(), ground); },
    getLook: () => {const r=v2Resolved3d(options.getSettings());return {ambience:r.composition.ambience,waterLook:r.composition.networks.water.look,waterVisible:r.ground.layers.water,groundCover:r.composition.vegetation.procedural};},
    getWaterDisplay: () => { const world = options.getWorld(); return world && v2WaterDisplay(world, options.getSettings()); },
    getSurface: () => { const world = options.getWorld(); return world && v2Terrain3dSurface(world, options.getSettings()); }, getHeightSampler: heightSampler,
    getForest: () => {
      // An Illustrated ground has its canopy in the raster draped as the map.
      const settings = options.getSettings(), world = options.getWorld(), r = world && v2Resolved3d(settings, world), field = r && !r.traits.fantasy && v2DisplayForest(world!, settings, r);
      return field &&Number.isInteger(field.n) && field.n > 0 && Number.isFinite(field.width) && field.width > 0 && field.rgba instanceof Uint8Array && field.rgba.length === field.n ** 2 * 4 ? { field, occupation: v2ForestOccupation(world!) } : undefined;
    },
    getText: () => { const r = v2Resolved3d(options.getSettings()); return { world: options.getWorld(), text: r.composition.text, palette: terrainStyle(r.composition.variant, r.palette.colors).palette }; },
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
    getPlanOptions: () => {
      const r = v2Resolved3d(options.getSettings()), city = r.city;
      return { colors: buildingColors(r.palette.colors, r.composition.ambience), view: city.view, palette: city.palette, width: city.width, opacity: city.opacity, labels: r.cartography.labels,
        layers: { ...city.layers, streets: city.layers.streets && r.composition.networks.roads.visible, waterways: r.composition.networks.water.visible && city.layers.waterways !== false }, roadLook: r.composition.networks.roads.look, roadEmphasis: r.composition.networks.roads.emphasis, streetPalette: city.palette === 'terrain' ? 'parchment' as const : city.palette, roadInk: roadInkOf(terrainStyle(r.palette.mapStyle, r.palette.colors).palette, buildingColors(r.palette.colors, r.composition.ambience)), groundBlend: r.composition.networks.roads.look === 'natural',
        night: r.composition.ambience === 'night',
        buildingsVisible: r.composition.buildings.visible && r.composition.buildings.meshes === 'none', appearance: { colors: r.palette.colors, style: city.buildingStyle, diagnostic: city.diagnostic, ambience: r.composition.ambience } };
    },
    getBuildingAppearance: () => { const r = v2Resolved3d(options.getSettings()); return { colors: r.palette.colors, style: r.city.buildingStyle, diagnostic: r.city.diagnostic, ambience: r.composition.ambience }; },
    getTextured: options.getTextured, setTextured: options.setTextured, onCamera: options.onCamera, details: service });
  return { get active() { return view.active; }, get detailStats() { return details?.stats; },
    show: () => { update(); view.show(); refreshFurniture3d(options.host); }, hide: () => view.hide(), refresh: () => { update(); view.refresh(); refreshFurniture3d(options.host); },
    focus: (point, radius) => view.focus(point, radius), getCamera: () => view.getCamera(), setCamera: camera => view.setCamera(camera),
    capture: () => view.capture(), captureIllustration: () => view.captureIllustration(), stats: () => view.stats(),
    dispose: () => { offLocale(); view.dispose(); details?.dispose(); listeners.clear(); },
  };
}
