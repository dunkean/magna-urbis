import { cityForestSettings } from '../render/cityEnvironment';
import { defaultCityLayoutConfig } from '../render/cityGeneration';
// Test hook of the V2 page: the v7 review sheet (web/out/planches-styles-v7/run.mjs, v2drive.mjs) drives v2.html through it.
// Active only with `?test=1`; it installs `window.__v2Test` and changes nothing else.
//
//   v2.html?test=1&lang=en&profile=local&localServer=http://127.0.0.1:8791
//   await __v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 500, seed: 'v7-european-organic',
//                            autoPosition: true, site: 'plain', options: ['townMainRoad'], params: { density: '1.2' } })
//   await __v2Test.run()                       // the decor as the whole world -> placement and roads -> the town
//   await __v2Test.view('2d' | '2d-core' | '2d-b')   // frame the town as City Bench's "City" button does, in the real viewport
//   await __v2Test.code()                      // the MU3 generation code of the prepared town (V2 Share dialog)
//   __v2Test.summary()                         // town, site scores, shore distances, camp extent, activity yard
//   __v2Test.camera3d() / __v2Test.setCamera3d(camera)   // the 3D view's camera, once opened with #view3d
//
// The world is the saved decor (web/decors/<id>.decor, City Bench `artifact=`): relief, sea, lakes and rivers with their widths
// are its own cells (settings.decor, v2/decorTerrain.ts). The town is placed by the same rule as City Bench (ui/cityPlacementRule.ts):
// a Rust site search with the site archetype and the framing edge margin (autoPosition), else the decor's own settlement position.
// Placement and road seeds are the decor's seed, as in City Bench; the town seed is `seed`.
// Value modules load on the first call: the hook adds nothing to the page bundle outside `?test=1`.
import type { SettlementSpec, SettlementOutput } from '../../../rust/bridge/settlements';
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urbanConfig';
import { setStepSeed } from '../../../rust/bridge/generationSeed';
import type { View } from '../render/view';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { TERRAIN_RELIEFS } from './terrainSettings';

export interface V2TestBindings {
  getSettings(): V2Settings;
  getWorld(): World | undefined;
  isBusy(): boolean;
  load(project: { settings: V2Settings; mods: unknown[] }): Promise<void>;
  run(): Promise<void>;
  getViewer(): { getView(): View; setView(view: View): void };
  get3d(): { getCamera(): unknown; setCamera(camera: any): void; stats?(): unknown } | undefined;
  prepareCapture?(): void;
  /** Rerolls one town's composition seed and rebuilds that town alone (the "Build town" path). */
  rerollTown?(key: string): void;
  /** Resolves when the progressive display (woods after a town build) has caught up. */
  displaySettled?(): Promise<void>;
}
export interface V2TestRequest {
  decor: string; culture: string; population: number; seed: string;
  /** City Bench "Automatic position": Rust site search with `site` and the framing edge margin. Otherwise the decor's settlement position. */
  autoPosition?: boolean; site?: string;
  /** Review options (City Bench "Reddit" checkbox keys) and layout/parcel parameters (City Bench `data-config` key = value). */
  options?: string[]; params?: Record<string, string>;
  /** Programme intent (`activity` with an activities.json template, or an `isolated-*` intent) and settlement condition. */
  programme?: { intent: string; template?: string }; state?: string;
  /** Footprint family (sheet `formes`) and fortification override. */
  footprint?: string; fortification?: string;
}

/** Review options without a V2 setting yet: render toggles of City Bench's own drawing code. */
const BENCH_ONLY_OPTIONS: Record<string, string> = {
  readableGardens: 'City Bench garden drawing (terrainUrban/cityCanvas); the V2 city renderer has no garden-plank layer',
  visiblePaddocks: 'City Bench rural detail layer (urbanLanduse); the V2 land-use renderer does not draw it',
  concreteFieldBoundaries: 'City Bench rural detail layer (urbanLanduse); the V2 land-use renderer does not draw it',
  rpgLabels: 'City Bench RPG pins (cityRpgPins); the V2 labels are the map label layer',
};
const PARCEL_FLAGS = ['streetAlignedHomes', 'denserSmallholdings'];

/** City Bench `data-config` value, typed by the default of the field it sets. */
function typed(defaults: Record<string, unknown>, key: string, raw: string): unknown {
  const base = defaults[key];
  if (typeof base === 'boolean') return raw === 'true' || raw === '1' || raw === 'on';
  if (typeof base === 'number' || base === null && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    const value = Number(raw); if (!Number.isFinite(value)) throw new Error(`PARAMS ${key}: number expected, got ${raw}`); return value;
  }
  // Structured settings (the hybrid style sheet) come as JSON.
  if (base !== null && typeof base === 'object') return JSON.parse(raw);
  return raw;
}

/** Layout and parcel settings of the request: review options, parameters, programme, condition, footprint. */
function urbanSettings(req: V2TestRequest, layoutDefaults: Record<string, unknown>, parcelDefaults: Record<string, unknown>): { layout: Partial<LayoutConfig>; parcels: Partial<ParcelConfig>; options: string[] } {
  const layout: Record<string, unknown> = {}, parcels: Record<string, unknown> = {}, applied: string[] = [];
  const unsupported = (req.options ?? []).filter(key => BENCH_ONLY_OPTIONS[key]);
  if (unsupported.length) throw new Error(`OPTS without a V2 setting: ${unsupported.map(key => `${key} (${BENCH_ONLY_OPTIONS[key]})`).join('; ')}`);
  const unknown = (req.options ?? []).filter(key => !PARCEL_FLAGS.includes(key) && typeof layoutDefaults[key] !== 'boolean');
  if (unknown.length) throw new Error(`Unknown OPTS: ${unknown.join(', ')}`);
  for (const key of req.options ?? []) { (PARCEL_FLAGS.includes(key) ? parcels : layout)[key] = true; applied.push(key); }
  for (const [key, raw] of Object.entries(req.params ?? {})) {
    if (key in layoutDefaults && key !== 'programme' && key !== 'footprint') layout[key] = typed(layoutDefaults, key, raw);
    else if (key in parcelDefaults || PARCEL_FLAGS.includes(key)) parcels[key] = typed({ ...parcelDefaults, streetAlignedHomes: false, denserSmallholdings: false }, key, raw);
    else throw new Error(`Unknown PARAMS key: ${key}`);
  }
  if (req.programme || req.state) layout.programme = { ...(req.programme ?? {}), ...(req.state ? { state: req.state } : {}) };
  if (req.footprint) layout.footprint = { family: req.footprint };
  if (req.fortification) layout.fortification = req.fortification;
  return { layout: layout as Partial<LayoutConfig>, parcels: parcels as Partial<ParcelConfig>, options: applied };
}

export function mountV2TestHook(bindings: V2TestBindings): void {
  if (new URLSearchParams(location.search).get('test') !== '1') return;
  let request: V2TestRequest | undefined;
  const town = () => {
    const world = bindings.getWorld(), place = world?.settlements?.[0];
    const snapshot = place ? (world?.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined)?.[place.key] : undefined;
    return { world, place, snapshot };
  };
  const mapSize = (): HTMLElement => {
    const map = document.querySelector<HTMLElement>('#map'); if (!map) throw new Error('No #map viewport'); return map;
  };
  /** Nearest water cell (sea, lake, river) of the world's own mask, within `reach` metres. */
  const nearWater = (world: World, x: number, y: number, reach: number): number => {
    const grid = world.terrain.height, n = grid.w, cell = world.mapSize / n, k = Math.ceil(reach / cell), cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = Infinity;
    for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) {
      const gx = cx + i, gy = cy + j; if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
      const w = world.terrain.water[gy * n + gx]; if (!w || w === 4) continue;
      best = Math.min(best, Math.hypot((gx + .5) * cell - x, (gy + .5) * cell - y));
    }
    return best;
  };
  const api = {
    ready: true,
    async prepare(req: V2TestRequest): Promise<{ mapSize: number; options: string[]; edgeMargin: number; position?: { x: number; y: number } }> {
      const [{ decodeDecor }, { decorBiome, decorClimate, decorClimateZone }, { cityPlacementRequest, framedEdgeMargin }, { defaultSettlementConfig }, { defaultLayoutConfig, defaultParcelConfig }] = await Promise.all([
        import('../ui/decor'), import('../ui/decorClimate'), import('../ui/cityPlacementRule'), import('../../../rust/bridge/settlements'), import('../../../rust/bridge/urbanConfig')]);
      const response = await fetch(`/decors/${req.decor}.decor`);
      if (!response.ok) throw new Error(`Decor not found: ${req.decor}`);
      const bytes = new Uint8Array(await response.arrayBuffer()), decor = decodeDecor(bytes), meta = decor.meta, width = decor.raster.width;
      const query = new URLSearchParams(meta.query), relief = query.get('relief') ?? meta.tags.relief ?? 'flat';
      const settings = structuredClone(bindings.getSettings());
      delete settings.options.importedHeight; delete settings.options.center;
      settings.decor = { id: req.decor, bytes };
      settings.generation = 'procedural';
      // City Bench places and routes with the decor's seed; the town keeps its own seed.
      const placementSeed = meta.seed || req.seed;
      Object.assign(settings.options, {
        seed: setStepSeed(setStepSeed(req.seed, 'settle-sites', placementSeed), 'settle-roads', placementSeed),
        culture: req.culture, population: req.population, workflow: 'list', mapSize: width, biome: decorBiome(meta),
      });
      // The decor relief goes to terrain.relief (options.relief only takes the legacy families, as in cityCode).
      settings.terrain = { ...settings.terrain, ...((TERRAIN_RELIEFS as readonly string[]).includes(relief) ? { relief: relief as NonNullable<V2Settings['terrain']>['relief'] } : {}), climate: decorClimateZone(meta), climateValues: decorClimate(meta), forest: cityForestSettings(query) };
      settings.extent = width; settings.settlementCount = 1; settings.local = {};
      // Placement: the shared City Bench rule.
      const original = meta.settlements[0];
      const spec: SettlementSpec = { key: original?.key ?? 'main', name: original?.name ?? '', population: req.population, culture: req.culture, sitePrefs: {},
        siteType: req.autoPosition ? req.site ?? 'auto' : original?.siteType ?? 'auto',
        ...(req.autoPosition ? {} : { position: original ? { ...original.center } : { x: width / 2, y: width / 2 } }) };
      const edgeMargin = req.autoPosition ? framedEdgeMargin(req.population, width) : defaultSettlementConfig().edgeMargin;
      const placement = cityPlacementRequest({ ...defaultSettlementConfig(), mode: 'list', relief: (TERRAIN_RELIEFS as readonly string[]).includes(relief) ? relief : 'flat', main: spec, list: [spec], edgeMargin });
      settings.region = { placement, ...(meta.roadConfig ? { roads: { ...meta.roadConfig } } : {}), resolution: Math.max(64, Math.min(1024, decor.raster.n)) };
      const urban = urbanSettings(req, defaultCityLayoutConfig() as unknown as Record<string, unknown>, defaultParcelConfig() as unknown as Record<string, unknown>);
      settings.urban = { ...settings.urban, layout: urban.layout, parcels: urban.parcels };
      delete settings.urban.local;
      request = req;
      await bindings.load({ settings, mods: [] });
      return { mapSize: width, options: urban.options, edgeMargin, ...(spec.position ? { position: spec.position } : {}) };
    },
    /** Town edit: new composition seed for the first town, rebuilt alone; resolves when the page is idle again. */
    async rerollTown(): Promise<void> {
      const { place } = town(); if (!place || !bindings.rerollTown) throw new Error('No town');
      bindings.rerollTown(place.key);
      while (bindings.isBusy()) await new Promise(resolve => setTimeout(resolve, 20));
      await bindings.displaySettled?.();
    },
    async run(): Promise<void> {
      if (!request) throw new Error('prepare() first');
      await bindings.run();
      await bindings.displaySettled?.();
      const world = bindings.getWorld();
      if (!world?.settlements?.length) throw new Error(`The chain produced no placed town (stage ${world?.stats?.['v2.stage'] ?? '?'}, backend ${world?.stats?.['v2.regionBackend'] ?? '?'}, requested ${world?.stats?.['settlements.requested'] ?? '?'}, warning: ${world?.stats?.['settlements.warning'] || 'none'})`);
      if (world.stats.decor !== request.decor) throw new Error(`The world is not the saved decor ${request.decor} (terrain backend ${world.stats.backend})`);
    },
    /** Frames the town in the real viewport (#map size): City Bench's "City" rule, its core at 1.4 px/m, an activity yard at 7 px/m. */
    async view(kind: '2d' | '2d-core' | '2d-b'): Promise<View> {
      const { world, place, snapshot } = town(); if (!world || !place) throw new Error('No town');
      const [{ layoutExtent }, { cityFocusView }] = await Promise.all([import('../../../rust/bridge/urban'), import('../ui/cityPlacementRule')]);
      const extent = layoutExtent(snapshot?.layouts) ?? { center: place.center, radius: place.radius };
      const map = mapSize(), w = map.clientWidth, h = map.clientHeight, yard = api.summary().focus;
      let view: View = yard ? { cx: yard.x, cy: yard.y, scale: 7 } : cityFocusView(extent, w, h);
      if (kind === '2d-core') view = { ...view, scale: 1.4 };
      // The frame stays inside the map (no band past its edge), as the bench's clampViewToMap.
      const hw = w / (2 * view.scale), hh = h / (2 * view.scale);
      if (2 * hw < world.mapSize) view.cx = Math.max(hw, Math.min(world.mapSize - hw, view.cx));
      if (2 * hh < world.mapSize) view.cy = Math.max(hh, Math.min(world.mapSize - hh, view.cy));
      bindings.getViewer().setView(view); return bindings.getViewer().getView();
    },
    /** The V2 generation code (MU3) of the prepared town: paste it in the V2 Share dialog to generate it again. */
    async code(): Promise<string> {
      const { encodeCityCode } = await import('./cityCode');
      return encodeCityCode(bindings.getSettings(), []);
    },
    /** The current world, for capture scripts (engine request replays). */
    world: () => bindings.getWorld(),
    summary() {
      const { world, place, snapshot } = town();
      const urban = (place as any)?.urban ?? (world as any)?.urban;
      const placed = (world?.debug?.v2RustRegion as { placement?: SettlementOutput } | undefined)?.placement?.settlements?.find(s => s.key === place?.key);
      const layout = snapshot?.layouts?.[0];
      // Activity rows frame their working yard: the parcels allocated to the activity, else the first block.
      let focus: { x: number; y: number } | undefined;
      if (request?.programme) {
        const partition = (snapshot?.programmePartitions ?? snapshot?.partitions)?.[0] as any;
        const ids = new Set((partition?.programme?.allocations ?? []).filter((a: any) => a.role === 'craft.activity').map((a: any) => a.parcelId));
        const ring: { x: number; y: number }[] = (partition?.parcels ?? []).filter((q: any) => ids.has(q.id)).flatMap((q: any) => q.shape.outer);
        const points = ring.length ? ring : layout?.blocks?.[0]?.shape.outer ?? [];
        if (points.length) focus = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
      }
      let shore: { centreToWaterM: number; builtToWaterM: number } | undefined;
      let campRadius: number | undefined;
      if (world && place) {
        let built = Infinity, radius = 150;
        for (const block of layout?.blocks ?? []) for (const q of block.shape.outer) {
          built = Math.min(built, nearWater(world, q.x, q.y, 250));
          radius = Math.max(radius, Math.hypot(q.x - place.center.x, q.y - place.center.y));
        }
        shore = { centreToWaterM: Math.round(nearWater(world, place.center.x, place.center.y, 1500)), builtToWaterM: Math.round(built) };
        campRadius = Math.min(radius, 900);
      }
      return { ready: true, busy: bindings.isBusy(), mapSize: world?.mapSize, decor: world?.stats.decor,
        town: place ? { key: place.key, x: place.center.x, y: place.center.y, radius: place.radius, archetype: place.archetype,
          buildings: urban?.buildings?.length ?? 0, scores: placed?.scores, layoutArchetype: (layout as any)?.archetype } : null,
        shore, campRadius, focus };
    },
    /** A whole procedural region from the page's own settings, patched by `options` (seed, culture, population, relief, biome...),
     * `extent` and `settlementCount`: several towns and their road network, no saved decor. */
    async runRegion(patch: { options?: Record<string, unknown>; extent?: number; settlementCount?: number; generation?: 'procedural' | 'neural';
      runtime?: Record<string, unknown>; terrain?: Record<string, unknown> }): Promise<void> {
      const settings = structuredClone(bindings.getSettings());
      Object.assign(settings.options, patch.options ?? {});
      if (patch.runtime) settings.runtime = { ...settings.runtime, ...patch.runtime } as V2Settings['runtime'];
      if (patch.terrain) settings.terrain = { ...settings.terrain, ...patch.terrain } as V2Settings['terrain'];
      if (patch.extent) settings.extent = patch.extent;
      if (patch.settlementCount) settings.settlementCount = patch.settlementCount;
      if (patch.generation) settings.generation = patch.generation;
      request = undefined;
      await bindings.load({ settings, mods: [] });
      await bindings.run();
      await bindings.displaySettled?.();
      if (!bindings.getWorld()?.settlements?.length) throw new Error('The region has no placed town');
    },
    /** The 2D view (centre in metres, px/m), for capture scripts that move the camera frame by frame. */
    getView: () => bindings.getViewer().getView(),
    setView: (view: View) => { bindings.getViewer().setView(view); return bindings.getViewer().getView(); },
    /** Complete the exact, full-quality 2D overlay before a review-sheet screenshot. */
    prepareCapture: () => bindings.prepareCapture?.(),
    camera3d: () => bindings.get3d()?.getCamera(),
    setCamera3d: (camera: unknown) => bindings.get3d()?.setCamera(camera),
    /** The 3D view's stats (buildings shown, terrain tile loading: lod.tiles / ready / pending), for the sheet's settle wait. */
    stats3d: () => bindings.get3d()?.stats?.(),
  };
  (window as any).__v2Test = api;
}
