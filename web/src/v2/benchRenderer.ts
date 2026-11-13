import { underdarkFarmBeds } from '../../../rust/bridge/terrainRenderUnderdark';
import { rasterizeSvg as imageOf } from '../render/svgRaster';
import { RetainedBudget } from '../render/retainedBudget';
import { retainTerrainDisplayPreparation } from './displayPrep';
import { RenderReadiness } from '../render/renderReadiness';
import { LiveTileFill } from '../render/liveTileFill';
import { getLanguage } from './i18n';
import { getDistanceUnit } from './units';
import { cityOverlayLandKinds, cityOverlayLandKey, cityWaterCutsLand, cityCountrysideCanvasOptions } from '../render/cityEnvironment';
import { retainedDecorOf } from './decorTerrain';
import { decorWaterSvg } from '../ui/decorWater';
import { displayQualityFor } from '../render/displayQuality';
import { getVectorEngine, onVectorEngineChange, noteLivePart } from '../render/vectorEngine';
import { newPath } from '../render/gpu/path';
import { RecordingContext } from '../render/gpu/recorder';
/** Display adapters for the retained RustBench terrain and CityBench geometry.
 * No generation entry point is imported here. The original Canvas renderer remains available. */
import type { MaterialRasterContext } from '../../../rust/bridge/terrainMaterialContext';
import type { World, LandKind } from '../gen/types';
import type { V2Settings } from './contracts';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { City3dPhysicalGround as PhysicalGround } from '../ui/city3d';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import { roadGroundTones, setRoadCanopy, setRoadGround } from '../render/roadStyle';
import { setWhiteWater } from '../render/whiteWater';
import { vectorWhiteWater } from '../render/whiteWaterCourses';
import { displayWorld } from '../render/displayWorld';
import { buildingOccupationShapes } from '../ui/forestOccupation';
import { v2DisplayForestAsync, v2ForestOccupation, v2ForestOccupationParts, withBuildingOccupationAsync } from './displayForest';
import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
import { nativeCitiesOf } from './nativeProducts';
import { activityScene } from './activitySites';
import { setMapClimateZone, setMapSeason, mapSeasonKey } from '../render/seasonPalette';
import { biomePalette } from '../render/biomes';
import { terrainStyle } from '../render/terrainStyle';
import { moonlightSvg } from '../render/materialLook';
import { renderRustTerrain, renderTerrainCanopy, terrainLandClip } from '../../../rust/bridge/terrainRender';
import { seaDistanceSurface, seaMaterialSvg } from '../render/terrainWater';
import { renderSvg } from '../render/svg';
import { DEFAULT_FRACTAL_DETAIL, seedHash } from '../../../rust/bridge/terrainAdjust';
import { climateOf, type TerrainData, type TerrainSettings } from '../../../rust/bridge/terrain';
import { settlementRaster, type SettlementRaster } from '../../../rust/bridge/settlements';
import { v1LandCanvas } from '../render/v1Landscape';
import { effectiveTerrainSettings } from './terrainSettings';
import { createTerrainRenderer, terrainRendererCanvas, terrainRendererBackend, type TerrainRenderer } from '../ui/terrainRenderer';
import { riverSegments, vectorWaterSvg, vectorOverlaySvg, vectorOverlayPixels, type WaterDisplay, type VectorOverlay } from '../ui/vectorWaterRender';
import { renderHydrology, hydrologySegments, hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import type { HydrologyOverlay } from '../../../rust/bridge/hydrology';
import { registerFantasyBrushes, isFantasyStyle, renderFantasyTerrain, prepareFantasyTerrain } from '../../../rust/bridge/fantasyTerrain';
import { drawFantasyRaster, fantasyClearance, fantasyRasterImages, prepareFantasyRaster, suspendFantasyRaster, KEEP_NONE, type FantasyRaster } from '../ui/fantasyRaster';
import { decodeBrushes, type BrushImages } from '../render/brushes';
import { renderScene, type RenderScene } from './renderScene';
import { PassState, ResourceCache, passKeys, type PassInput } from './passes/pass';
import { buildScene, type SceneMask } from '../render/scene';
import { createNativeCityMap, type NativeCityHooks } from './nativeCityMap';
import { drawRuralSemantic, drawUrbanSemantic, ruralSemanticLegend, urbanSemanticLegend } from '../render/semanticLayer';
import { contourDrawOf, type SemanticLook } from '../render/composition';
import type { SemanticLegendEntry } from '../render/legend';
import type { CityScene } from '../render/cityCanvas';
import { viewRect } from '../render/view';
import { sceneDirty, worldDirty, changedShapes, shapeKey, mergeRects } from '../render/sceneDiff';
import type { Scene } from '../render/scene';
import type { Rect } from '../render/tileindex';
import { seedSubset } from '../../../rust/bridge/generationSeed';
/** Overlay repaints slower than this follow pan/zoom as a transformed bitmap, repainted LIVE_SETTLE_MS after the view rests. */
const LIVE_DEFER_MS = 40, LIVE_SETTLE_MS = 160;
import { cityContourPaths, cityFineContours, cityContoursPending, cityContourPathsReady } from '../render/cityContours';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../render/strokes';
import { viewRasterFits, viewRasterRegion, type ViewRasterRegion } from '../render/viewRaster';
import { isResourceDiagnostic } from '../render/displayDiagnostics';
import { resourceOverlayBody, type ResourceSource } from './resourceLayer';
import { getDisplayQuality, initializeDisplayQuality, noteDisplayNavigation, reportDisplayRenderer, onDisplayQualityChange, setDisplayAppearanceQuality } from '../render/displayQuality';

let brushes: Promise<BrushImages | null> | undefined;
export async function paintedBrushes(): Promise<BrushImages | null> {
  return brushes ??= import('../render/assets/brushAssets').then(({ BRUSH_SOURCES }) => decodeBrushes(BRUSH_SOURCES));
}
/** A world-coordinate SVG body as a document rasterizing `region` at its density. */
const svgOf = (body: string, region: ViewRasterRegion): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(region.width * region.density))}" height="${Math.max(1, Math.round(region.height * region.density))}" viewBox="${region.x} ${region.y} ${region.width} ${region.height}" preserveAspectRatio="none">${body}</svg>`;
/** svgOf as Blob parts around a body encoded once: a view raster never re-encodes megabytes of water paths. */
const svgPartsOf = (body: Uint8Array, region: ViewRasterRegion): BlobPart[] => {
  const [head, tail] = svgOf('\uE000', region).split('\uE000');
  return [head, body as BlobPart, tail];
};
/** Pixel width of the whole-map renderSvg overlay of exports. */
const EXPORT_OVERLAY_PX = 4096;
const wholeMap = (width: number): ViewRasterRegion => ({ x: 0, y: 0, width, height: width, density: 2048 / width });
/** The overlay decorations (tree marks, brushes) follow the map, not a town's own variations: rerolling a town must not reshuffle every wood. */
const displaySeed = (seed: string): string => seedSubset(seed, key => !key.startsWith('city/'));
/** Building footprints and activity yards: the woods clear around them (the cartography buildingClearings hook). */
const clearingBuildings = (world: World) => [...nativeCitiesOf(world).flatMap(city => city.scene?.buildings ?? []), ...(activityScene(world)?.buildings ?? [])];
/** Reach of the overlay products derived from a changed shape (forest wash fringe 140 m, lone trees 120 m, clearings, sprites). */
const DERIVED_REACH = 220;
/** Resources a live renderer shares with its exports: derived products keyed by revisions, and the native city map. */
export interface SharedPassResources { cache: ResourceCache; city?: { key: string; map: ReturnType<typeof createNativeCityMap> } }
/** `svg`: the terrain of the 3D background; `image`: the 2D base, with the crowns of a hidden relief. */
type BaseRaster = { svg: string; image?: HTMLCanvasElement; fantasy?: FantasyRaster };
type CartographyProduct = { renderer: CanvasRenderer; overlay: HTMLCanvasElement; state: { config: string; scene: Scene; world: World }; physical?: PhysicalGround };
/** Contour width factor on the 3D drape tiles. */
const DRAPE_CONTOUR_WEIGHT = 1.8;
/** Parsed contour paths, kept as long as their cached strings. */
const CONTOUR_PATHS = new WeakMap<object, Partial<Record<'thin' | 'index' | 'recThin' | 'recIndex', Path2D>>>();
/** Contour data is absolute M/L/Z only. The GPU engine cannot record a native Path2D(string), so it gets the same lines as a RecPath2D. */
function recordedContourPath(d: string): Path2D {
  // A character scan (the producer writes `M x,y L x,y ... Z` with fixed decimals): map-wide sets hold megabytes, which a
  // regular expression and split parse an order of magnitude slower.
  const path = newPath(), n = d.length;
  let i = 0;
  const num = (): number => {
    let sign = 1, whole = 0, frac = 0, div = 1, c = d.charCodeAt(i);
    if (c === 45) { sign = -1; i++; }
    while (i < n && (c = d.charCodeAt(i)) >= 48 && c <= 57) { whole = whole * 10 + c - 48; i++; }
    if (d.charCodeAt(i) === 46) { i++; while (i < n && (c = d.charCodeAt(i)) >= 48 && c <= 57) { frac = frac * 10 + c - 48; div *= 10; i++; } }
    return sign * (whole + frac / div);
  };
  while (i < n) {
    const c = d.charCodeAt(i++);
    if (c === 90) path.closePath();
    else if (c === 77 || c === 76) { const x = num(); i++; const y = num(); if (c === 77) path.moveTo(x, y); else path.lineTo(x, y); }
  }
  return path;
}
const contourPath = (set: { thin: string; index: string }, kind: 'thin' | 'index', recording = false): Path2D => {
  let parsed = CONTOUR_PATHS.get(set); if (!parsed) CONTOUR_PATHS.set(set, parsed = {});
  if (recording) return parsed[kind === 'thin' ? 'recThin' : 'recIndex'] ??= recordedContourPath(set[kind]);
  return parsed[kind] ??= new Path2D(set[kind]);
};

export class BenchRenderer {
  private retained = new RetainedBudget();
  private cartographyKey = '';
  private presentationKey = '';
  private cachedFrameKey = '';
  private restoredFrameKey = '';
  private programWork?: Promise<void>;
  private programError?: unknown;
  private cityRevision = 0;
  private request?: RenderReadiness;
  private suspended = false;
  get requestId(): number | undefined { return this.request?.id; }
  retainedStorage(): { bytes: number; frames: number } { return { bytes: this.retained.bytes, frames: this.retained.frameBytes }; }
  derivedPending(): number { return cityContoursPending(this.native) + this.contourWaiters.size + Number(!!this.forestJob) + Number(!!this.programWork); }
  setSuspended(value: boolean): void {
    if (this.suspended === value) return;
    this.suspended = value; this.gpu?.setLivePaused(value || this.preparing);
    if (value) { this.suspendLiveTiles(); clearTimeout(this.liveTimer); clearTimeout(this.groundTimer); this.livePending = this.groundPending = undefined; }
    else this.invalidate();
  }
  private surface = document.createElement('canvas');
  private miniature = document.createElement('canvas');
  /** Live GPU ground and transparent CPU overlays are composed by the browser. */
  readonly element = document.createElement('div');
  private liveGround?: HTMLCanvasElement;
  private groundShown?: { view: View; w: number; h: number; dpr: number };
  private groundTimer?: ReturnType<typeof setTimeout>;
  private groundPending?: { view: View; w: number; h: number; dpr: number };
  private preparing = false;
  private previousFrame?: { element: HTMLDivElement; view: View; w: number; h: number };
  private liveWidth = 0;
  private liveHeight = 0;
  /** The view the live overlay bitmap was last painted at, its paint cost, and the deferred repaint while the view moves. */
  private liveShown?: { view: View; w: number; h: number; dpr: number };
  private liveRequested?: View;
  /** Retain an exact screenshot frame through late invalidations until navigation resumes. */
  private liveCapture = false;
  private unlistenQuality: () => void;
  private liveCost = 0;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private livePending?: { view: View; w: number; h: number; dpr: number };
  private overlay = document.createElement('canvas');
  private gpuCanvas = document.createElement('canvas');
  private gpu?: TerrainRenderer;
  private gpuUnavailable = false;
  private world?: World;
  private scene?: RenderScene;
  private settings?: V2Settings;
  private resolved?: ResolvedAppearance;
  private paper = '#ffffff';
  private native?: TerrainData;
  private city?: ReturnType<typeof createNativeCityMap>;
  private exportCity?: ReturnType<typeof createNativeCityMap>;
  private cartography?: CanvasRenderer;
  private physical?: PhysicalGround;
  private contourRevision = 0;
  private contoursReady = (): void => {
    if (this.disposed) return;
    this.contourRevision++;
    this.invalidate();
  };
  private contourWaiters = new Map<TerrainData, Set<() => void>>();
  private afterContours(ready: () => void): void {
    const terrain = this.native!;
    let callbacks = this.contourWaiters.get(terrain);
    if (callbacks) { callbacks.add(ready); return; }
    callbacks = new Set([ready]); this.contourWaiters.set(terrain, callbacks);
    const poll = (): void => {
      if (this.disposed) { this.contourWaiters.delete(terrain); return; }
      if (cityContoursPending(terrain)) { setTimeout(poll, 32); return; }
      this.contourWaiters.delete(terrain); for (const callback of callbacks!) callback();
    };
    setTimeout(poll, 32);
  }
  private async contoursAt(scale: number, box: Rect): Promise<void> {
    const look = this.contourLook(), terrain = this.native; if (!look || !terrain) return;
    const topographic = this.resolved!.composition.recipe.ground.variant === 'topographic', mode = contourDrawOf(this.resolved!.composition.recipe);
    if (!topographic && mode.detail === 'zoom') cityFineContours(terrain, look.landform, scale, box);
    await cityContourPathsReady(terrain, look.landform, scale, topographic, mode.detail, mode.sparse);
    while (cityContoursPending(terrain)) await new Promise(resolve => setTimeout(resolve, 16));
  }
  /** renderSvg overlay of an export (explicit layers), whole map at EXPORT_OVERLAY_PX: used only where it is not stretched. */
  private exportOverlay?:HTMLCanvasElement;
  /** Physical land use of an export when a rural semantic look is on: drawn under the semantics, the rest of the overlay above. */
  private exportGround?:HTMLCanvasElement;
  /** Terrain raster (CPU relief, sea): natural content, whole map. */
  private base?: HTMLCanvasElement;
  private terrainSvg = '';
  /** Illustrated grounds: washes and stamps painted on canvas over `base` (web/src/ui/fantasyRaster.ts). */
  private fantasy?: FantasyRaster;
  private fantasyImages?: { wash: string; stamps: string };
  /** Vector water, hydrology (waterSvg) and frame (frameSvg): world-coordinate SVG body, rasterized per view (render/viewRaster). */
  private waterSvg = '';
  private landRaster?: { terrain: TerrainData; raster: SettlementRaster };
  private frameSvg = '';
  private vectors = '';
  private vectorsDirty = false;
  private vectorBase?: { image: HTMLCanvasElement; region: ViewRasterRegion };
  private vectorView?: { image: HTMLCanvasElement; region: ViewRasterRegion };
  private vectorRequest?: Promise<void>;
  private backgroundHref?: string;
  private backgroundImage?: HTMLCanvasElement;
  private uploaded?:TerrainData;
  private dpr = 1;
  private gpuActive = false;
  private exportLayers: Partial<ExportLayers> = {};
  private disposed = false;
  private passes = new PassState();
  private shared: SharedPassResources;
  private ownsShared: boolean;
  private input!: () => PassInput;
  readonly stats: Record<string, unknown> = {};
  /** Resource payload provider (StudioClient): fetched lazily, only when a resource diagnostic is shown. */
  resourceSource?: ResourceSource;
  constructor(private invalidate: () => void,rasterOnly=false, private materialContext?: MaterialRasterContext, shared?: SharedPassResources) {
    this.gpuUnavailable=rasterOnly;this.ownsMaterialContext=!materialContext;this.ownsShared=!shared;this.shared=shared??{cache:new ResourceCache()};
    this.element.className = 'viewer-direct';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    const repaint = (): void => {
      this.liveCapture = false;
      this.suspendLiveTiles(); clearTimeout(this.liveTimer); this.livePending = undefined; this.liveShown = undefined;
      if (!this.disposed && this.world) this.invalidate();
    };
    // The vector engine is part of the frame key and of the overlay tile keys: a switch repaints like a quality change.
    const offQuality = onDisplayQualityChange(repaint), offEngine = onVectorEngineChange(repaint);
    this.unlistenQuality = () => { offQuality(); offEngine(); };
  }
  private ownsMaterialContext: boolean;
  /** Resources an export renderer may reuse (read-only for it). */
  sharedResources(): SharedPassResources { return this.shared; }
  rasterContext(): MaterialRasterContext | undefined { return this.materialContext?.gl.isContextLost() ? undefined : this.materialContext; }
  /** The terrain draws on the GPU when it can; the CPU raster otherwise. Evaluated lazily: the terrainData pass may demote it. */
  private mode(): 'gpu' | 'cpu' {
    const r = this.resolved!;
    return this.exportLayers.terrain !== false && r.ground.layers.relief && !isFantasyStyle(r.ground.style) && !this.gpuUnavailable ? 'gpu' : 'cpu';
  }
  async set(world: World, settings: V2Settings, r: ResolvedAppearance, layers: Partial<ExportLayers> = {}, request = new RenderReadiness(r.target === 'export' ? 'capture' : '2d')): Promise<void> {
    this.request = request; this.programError = undefined; this.programWork = undefined; this.forestJob = undefined; this.restoredFrameKey = '';
    // Worker-prepared terrain products (shore ring, distances, mips) before the passes that would build them on the page.
    retainTerrainDisplayPreparation(world);
    if (r.target !== 'export') setDisplayAppearanceQuality(r.quality);
    this.liveCapture = false;
    this.suspendLiveTiles();
    this.retainLiveFrame();
    this.preparing = true; this.gpu?.setLivePaused(true);
    const previous = { world: this.world, scene: this.scene, settings: this.settings, resolved: this.resolved, exportLayers: this.exportLayers, gpuActive: this.gpuActive, native: this.native };
    try {
    this.settings = settings; this.resolved = r; layers = { ...(r.cartography.roads ? {} : { roads: false }), ...layers }; this.exportLayers = layers;
    const scene = renderScene(world, settings);
    this.world = world; this.scene = scene; this.native = scene.terrain;
    const effective = effectiveTerrainSettings(settings, world.mapSize);
    setMapSeason(r.ground.season, effective.climateZone, r.ground.calendar);
    setMapClimateZone(effective.climateZone, effective.climateValues);
    setRoadGround(world.landuse, world.mapSize, roadGroundTones(r.ground.traits.family === 'material', biomePalette(r.palette.mapStyle, world.options.biome)), r.composition.ambience === 'night');
    const effectiveKey = JSON.stringify([effective.relief, effective.refine, effective.detailNoise, effective.climate, effective.climateValues, effective.climateZone, effective.hydrology?.riverMode]);
    const forestKey = JSON.stringify([effective.forest, effective.climateValues]);
    const worldSig = JSON.stringify([world.mapSize, world.seed, world.options.biome, getLanguage(), getDistanceUnit(), settings.naming?.mode,settings.naming?.mapLanguage,settings.naming?.script]);
    this.input = () => ({ r, revisions: scene.revisions, layers, mode: this.mode(), effective: effectiveKey, forestEffective: forestKey, worldSig });
    this.paper = terrainStyle(r.styleId, r.palette.colors).palette.paper;
      const ran = await this.passes.run(() => passKeys(this.input()), {
        terrainData: () => this.prepareStep(() => this.terrainDataPass()), terrainLook: () => this.prepareStep(() => this.terrainLookPass()), forest: () => this.prepareStep(() => this.forestPass()), water: () => this.prepareStep(() => this.waterPass()),
        frame: () => this.prepareStep(() => this.framePass()), cartography: () => this.prepareStep(() => this.cartographyPass()), overlays: () => this.prepareStep(() => this.overlaysPass()), semantic: () => this.prepareStep(() => this.semanticPass()), city: () => this.prepareStep(() => this.cityPass()) });
      this.request.mark('fields-ready');
      const programs = this.preparePrograms();
      // Live ground already has a last/preview variant. Exact consumers explicitly await it.
      if (r.target !== 'view2d') await programs;
      if (this.vectorsDirty) await this.refreshVectors();
      this.presentationKey = JSON.stringify([scene.revisions, world.stats['v2.waterEditRevision'], world.stats['v2.editRevision'], r, effectiveKey, forestKey, layers, getLanguage(), getDistanceUnit(), getDisplayQuality()]);
      this.stats.passes = ran;
    } catch (error) {
      // Restore the previous renderer state; every pass re-runs next time (a partial update must not look current).
      Object.assign(this, { ...previous, gpuActive: previous.gpuActive && !!this.gpu });
      this.passes.reset(); this.vectorsDirty = false;
      throw error;
    } finally {
      this.preparing = false; this.gpu?.setLivePaused(this.suspended);
      this.previousFrame?.element.remove(); this.previousFrame = undefined;
      this.surface.style.visibility = ''; if (this.liveGround) this.liveGround.style.visibility = '';
      this.liveShown = undefined; this.groundShown = undefined;
    }
    this.stats.style = r.ground.style; this.stats.renderer = this.gpuActive ? 'TerrainGl + CityBench' : 'RustBench raster + CityBench';
    this.stats.terrainBackend = this.gpuActive ? terrainRendererBackend(this.gpu!) : 'cpu';
  }
  private preparePrograms(): Promise<void> {
    const request = this.request, gpu = this.gpuActive ? this.gpu : undefined;
    const work = gpu ? gpu.variantReady() : Promise.resolve();
    const pending = this.programWork = work.then(() => {
      if (this.programWork !== pending || this.request !== request) return;
      this.programWork = undefined;
      if (!this.forestJob) request?.mark('programs-ready');
      if (!this.disposed) this.invalidate();
    }, error => {
      if (this.programWork === pending) { this.programWork = undefined; this.programError = error; this.invalidate(); }
      throw error;
    });
    // An exact consumer observes the original rejection; live rendering reports it on its next frame.
    void pending.catch(() => {});
    return pending;
  }
  async exactReady(): Promise<void> {
    while (this.forestJob) await this.forestJob;
    await this.programWork;
    if (this.programError) throw this.programError;
    if (this.gpuActive) await this.gpu!.variantReady();
    this.request?.mark('programs-ready');
  }
  private layers(): any {
    const r = this.resolved!, l = this.exportLayers;
    return { ...r.ground.layers, relief: l.terrain !== false && r.ground.layers.relief, water: l.water !== false && r.ground.layers.water, frame: l.decor !== false && r.ground.layers.frame };
  }
  private async prepareStep(run: () => void | Promise<void>): Promise<void> {
    // Promise continuations alone do not let input handlers or the progress card paint.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await run();
  }
  private retainLiveFrame(): void {
    if (this.suspended) return;
    clearTimeout(this.liveTimer); clearTimeout(this.groundTimer); this.livePending = this.groundPending = undefined;
    const shown = this.groundShown ?? this.liveShown;
    if (!shown || this.surface.parentElement !== this.element) return;
    const frozen = document.createElement('div');
    frozen.style.cssText = `position:absolute;inset:0;z-index:1;background:${this.paper};pointer-events:none`;
    if (this.gpuActive) { this.gpu!.redrawNow(shown.view, shown.w, shown.h, false, Math.min(2, shown.dpr)); this.markGroundDrawn(); }
    for (const source of [this.liveGround, this.surface]) {
      if (!source) continue;
      const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
      copy.style.cssText = source.style.cssText; copy.style.position = 'absolute';
      copy.getContext('2d')!.drawImage(source, 0, 0); frozen.append(copy); source.style.visibility = 'hidden';
    }
    this.element.append(frozen); this.previousFrame = { element: frozen, view: { ...shown.view }, w: shown.w, h: shown.h };
  }
  private waterDisplay(): WaterDisplay {
    const r = this.resolved!, t = this.native!, effective = effectiveTerrainSettings(this.settings!, this.world!.mapSize);
    return { style: r.ground.traits.fantasy && r.composition.networks.water.look === 'natural' ? 'render3d' : r.ground.style, colors: r.palette.colors, showLakes: r.ground.lakes, showOxbows: r.ground.oxbows,
      riverArea: t.water?.riverArea ?? .02, riverMode: effective.hydrology?.riverMode ?? 'vector', overlay: r.diagnostic.startsWith('v-') ? r.diagnostic as VectorOverlay : 'none',
      season: { zone: effective.climateZone, season: r.ground.season, calendar: r.ground.calendar } };
  }
  private dropBackground(): void { this.backgroundHref = undefined; this.backgroundImage = undefined; }
  /** GPU: context, height/cave/water-surface textures (once per terrain product). CPU: nothing. */
  private async terrainDataPass(): Promise<void> {
    this.gpuActive = false; this.dropBackground();
    if (this.mode() !== 'gpu') return;
    const t = this.native!, source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
    try {
      if (!this.gpu) {
        const gl = this.gpuCanvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        const name = extension ? String(gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
        reportDisplayRenderer(name);
        if (!gl) throw new Error('WebGL2 indisponible pour la carte.');
        this.materialContext = { canvas: this.gpuCanvas, gl };
        if (/swiftshader|llvmpipe|software/i.test(name)) {
          this.gpuUnavailable = true; this.stats.gpuFallback = 'Software WebGL material raster on the map context'; return;
        }
        this.gpu = await createTerrainRenderer(this.gpuCanvas, document.createElement('canvas')); this.forestShown = false;
        this.gpu.setLivePaused(this.preparing);
      }
      if (this.uploaded !== t) { this.gpu.setBase({ x: 0, y: 0, width: t.width, n: source.n, data: source.data, cave: source.cave, waterSurface: t.waterSurface }); this.uploaded = t; }
      this.gpuActive = true;
    } catch (error) { this.gpu?.dispose(); this.gpu = undefined; this.uploaded = undefined; this.gpuUnavailable = true; this.stats.gpuFallback = String(error); }
  }
  /** GPU: look uniforms only. CPU: the terrain raster (the only thing re-rasterized). */
  private async terrainLookPass(): Promise<void> {
    this.dropBackground();
    this.vectorsDirty=true;
    const t = this.native!, world = this.world!, settings = this.settings!, r = this.resolved!, style = r.ground.style, colors = r.palette.colors;
    const effective = effectiveTerrainSettings(settings, world.mapSize), layers = this.layers(), lighting = r.ground.lighting;
    if (this.gpuActive) {
      const source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
      this.terrainSvg = ''; this.base = undefined; this.fantasy = undefined; this.fantasyImages = undefined;
      this.gpu!.setLook({ style, colors, lighting, layers, groundCover:r.composition.vegetation.procedural, ambience:r.composition.ambience,waterLook:r.composition.networks.water.look,waterStyle:r.composition.networks.water.look==='ink'?r.palette.mapStyle:undefined, independentCanopy: true, mapWidth: t.width, climate: climateOf(effective as TerrainSettings), climateZone: effective.climateZone, underdark: world.options.biome === 'underdark', townGlow: world.options.biome === 'underdark' ? Float32Array.from((world.settlements ?? []).slice(0, 16).flatMap(s => [s.center.x, s.center.y, Math.max(120, (s.radius ?? 200) * 1.6)])) : undefined, farmBeds: world.options.biome === 'underdark' ? underdarkFarmBeds(world.landuse?.farmsteads, world.settlements) : undefined, v2Season: r.ground.season, v2Calendar: r.ground.calendar,
        globalMin: t.globalMinHeight, globalMax: t.globalMaxHeight, contours: false, contourStep: effective.relief === 'mountains' ? 40 : effective.relief === 'flat' ? 2 : 10,
        flatRelief: effective.relief === 'flat', refine: effective.refine??true, sourceCell: t.width / source.n, seed: seedHash(world.seed), detail: effective.detailNoise ?? DEFAULT_FRACTAL_DETAIL,
        floor: source.floor ?? 0, frame: layers.frame, background: terrainStyle(style,colors).palette.paper });
      return;
    }
    if (isFantasyStyle(style)) { const {fantasyLibraries}=await import('../render/fantasyBrushAssets');registerFantasyBrushes(fantasyLibraries); }
    const key = passKeys(this.input()).terrainLook;
    // The shared material shader also composes SVG/PNG exports, using an OffscreenCanvas or a page canvas according to WebGL2 availability.
    const cacheKey = `terrain:${key}`;
    const pending = this.shared.cache.get<Promise<BaseRaster>>(cacheKey, async () => {
      const settingsForRender = { ...effective, width: world.mapSize, seed: world.seed, v2Season: r.ground.season, v2Calendar: r.ground.calendar, forest: { field: await v2DisplayForestAsync(world, settings, r), occupation: await this.groundOccupation(), parcels: world.landuse?.areas, groundCover:r.composition.vegetation.procedural, waterVisible: layers.water,
        clear: isFantasyStyle(style) ? fantasyClearance({ mapSize: world.mapSize, seed: world.seed, roads: world.roads, rivers: world.terrain.rivers, farmsteads: world.landuse?.farmsteads, settlements: world.settlements }, world) : undefined } };
      let svg = '';
      const waterStyle=r.composition.networks.water.look==='natural'?'render3d':r.palette.mapStyle;
      // Illustrated: the SVG keeps the ground; the stamps are painted on canvas per view.
      const fantasyOptions = { ...r.vegetation.fantasy, svgStamps: false };
      if (layers.relief) svg = renderRustTerrain(t, style, layers.frame, settingsForRender, r.ground.contours, 'v2-render', lighting, layers, fantasyOptions, true, waterStyle, colors, this.rasterContext()).svg;
      const painting = layers.relief && isFantasyStyle(style) && this.exportLayers.terrain !== false ? prepareFantasyTerrain(t, style, settingsForRender, fantasyOptions) : undefined;
      const fantasy = painting ? await prepareFantasyRaster(painting, world.landuse) : undefined;
      if (!layers.relief && layers.water && t.globalMinHeight < 0) {
        const sea = seaMaterialSvg(seaDistanceSurface(t, t.width), t.x, t.y, waterStyle, t.width, colors);
        svg += `<defs><mask id="v2-water-only"><rect width="${t.width}" height="${t.width}" fill="white"/><path d="${terrainLandClip(t)}" fill="black" fill-rule="evenodd"/></mask></defs><g mask="url(#v2-water-only)">${sea}</g>`;
      }
      // Illustrated grounds have no shader to grade: night is one multiply over the raster, kept in the SVG so 2D, 3D and export agree.
      if (r.composition.ambience === 'night' && r.ground.traits.fantasy) svg += `<rect width="${t.width}" height="${t.width}" fill="#26324f" style="mix-blend-mode:multiply"/>`;
      // Relief hidden: no terrain raster carries the vegetation, it lies on the flat palette ground.
      // `crowns` stay out of the 3D background (`svg`), which gets the canopy from its shader; an Illustrated ground has no such shader.
      let crowns = '';
      if (!layers.relief && this.exportLayers.terrain !== false) {
        if (settingsForRender.forest.field) {
          crowns = renderTerrainCanopy(t, style, settingsForRender, lighting, this.rasterContext());
          if (isFantasyStyle(style)) { svg += crowns; crowns = ''; }
        } else if (isFantasyStyle(style) && r.vegetation.fantasy.forests) svg += renderFantasyTerrain(t, style, settingsForRender, { ...r.vegetation.fantasy, forestsOnly: true });
      }
      if(r.composition.ambience==='night'){
        if(r.ground.traits.family==='material')svg=moonlightSvg(svg,'v2-ground-night');
        crowns=moonlightSvg(crowns,'v2-canopy-night');
      }
      return { svg, image: svg + crowns ? await imageOf(svgOf(svg + crowns, wholeMap(t.width))) : undefined, fantasy };
    });
    const raster = await pending.catch(error => { this.shared.cache.delete(cacheKey); throw error; });
    this.terrainSvg = raster.svg; this.base = raster.image; this.fantasy = raster.fantasy; this.fantasyImages = undefined;
    if (this.fantasy) {
      const fantasy = this.fantasy;
      fantasy.onTiles = () => { if (!this.disposed && this.fantasy === fantasy) this.invalidate(); };
    }
  }
  private occupationCache?: { world: World; revision: string; data: Promise<ForestOccupation | undefined> };
  /** Accepted footprints exclude vegetation independently of building visibility. Both rasters run in the
   * occupation worker; concurrent passes share one job. */
  private groundOccupation(): Promise<ForestOccupation | undefined> {
    const world = this.world!, v = this.scene!.revisions;
    const revision = JSON.stringify([v.landuse, v.cities, v.settlements]);
    if (this.occupationCache?.world !== world || this.occupationCache.revision !== revision) {
      // The building merge needs only the occupation raster; the holdings detail joins at the end.
      const parts = v2ForestOccupationParts(world);
      const data = Promise.all([parts.occupation.then(base => {
        const buildings = [...nativeCitiesOf(world).flatMap(city => city.scene?.buildings ?? []), ...(activityScene(world)?.buildings ?? [])];
        return withBuildingOccupationAsync(base, { buildings });
      }), parts.occupation, parts.detail]).then(([occupation, base, detail]) => occupation && { ...occupation, detail: base ? detail : undefined });
      data.catch(() => { if (this.occupationCache?.data === data) this.occupationCache = undefined; });
      this.occupationCache = { world, revision, data };
    }
    return this.occupationCache.data;
  }
  /** Live forest update still running after set() returned (progressive display). */
  private forestJob?: Promise<void>;
  private forestShown = false;
  private async forestPass(): Promise<void> {
    // The natural road painter fades ways under the same canopy as the ground shader (roadStyle.ts setRoadCanopy).
    if (!this.gpuActive) { setRoadCanopy(undefined, undefined); return; }
    this.dropBackground();
    // The Rust forest field and the occupation worker are independent: run them at once.
    const job = Promise.all([v2DisplayForestAsync(this.world!, this.settings!, this.resolved!), this.groundOccupation()]);
    // Progressive display: a live map that already shows woods shows the new town at once, the woods follow when ready.
    if (this.forestShown && this.resolved!.target !== 'export') {
      const gpu = this.gpu!, world = this.world, request = this.request;
      const update: Promise<void> = job.then(([field, occupation]) => {
        if (this.disposed || this.gpu !== gpu || this.world !== world || this.request !== request || !this.gpuActive) return;
        gpu.setForest(field, occupation); setRoadCanopy(field, occupation); this.dropBackground(); void this.preparePrograms(); this.invalidate();
      }, error => { this.programError = error; }).finally(() => { if (this.forestJob === update) { this.forestJob = undefined; this.invalidate(); } });
      this.forestJob = update;
      return;
    }
    const [field, occupation] = await job;
    if (this.gpuActive) { this.gpu!.setForest(field, occupation); setRoadCanopy(field, occupation); this.forestShown = true; this.invalidate(); }
  }
  /** The parchment tints multiply over the lit ground: the overlay gets it as a backdrop, transparent on the water below. */
  private landBackdrop(): HTMLCanvasElement | null {
    const t = this.native, r = this.resolved!;
    if (!t || r.composition.variant !== 'parchment' || !r.ground.layers.relief) return null;
    if (this.landRaster?.terrain !== t) this.landRaster = { terrain: t, raster: settlementRaster(t) };
    // Every course cuts the backdrop, dry beds included: their symbols are drawn in the vector water below.
    const water = { ...this.waterDisplay(), season: undefined }, rivers = !r.composition.networks.water.visible ? undefined : t.water ? riverSegments(t.water, water) : t.hydrology ? hydrologySegments(t.hydrology, hydrologyWaterColour(r.ground.style, r.palette.colors)) : undefined;
    return v1LandCanvas(this.landRaster.raster, 'parchment', this.world!.options.biome, rivers);
  }
  /** GPU water/overlay textures, plus the vector water and hydrology diagnostics (rasterized per view). */
  private async waterPass(): Promise<void> {
    this.dropBackground();
    const t = this.native!, r = this.resolved!, style = r.ground.style, colors = r.palette.colors, layers = this.layers(), water = this.waterDisplay();
    const ink = r.composition.networks.water.look === 'ink', visible = layers.water && r.composition.networks.water.visible;
    const vectorDisplay = { ...water, style: ink ? r.palette.mapStyle : 'render3d' as const };
    if (this.gpuActive) {
      if (t.water) {
        // The painted compositor (natural water) reads the seasonal regime from the segment colour.
        const material = !ink && water.overlay === 'none';
        this.gpu!.setWater(visible ? { lake: water.showLakes ? t.water.lakeField.values : undefined, n: t.water.hydro.n, rivers: riverSegments(t.water, { ...water, material }), regime: material } : undefined);
        this.gpu!.setOverlay(vectorOverlayPixels(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined));
      } else if (t.hydrology) {
        this.gpu!.setWater(visible ? { lake: water.showLakes ? t.hydrology.waterField : undefined, shore: 'exact', n: t.hydrology.resolution, rivers: hydrologySegments(t.hydrology, hydrologyWaterColour(style, colors)) } : undefined);
        this.gpu!.setOverlay(undefined);
      } else this.gpu!.setWater(undefined);
    }
    // Rapids and falls of the satellite ground: vector foam marks over the GL rivers, built once per network (whiteWater.ts).
    const satellite = r.ground.traits.satelliteVariant === 1 && !r.ground.traits.paperMap && this.world!.options.biome !== 'underdark';
    setWhiteWater(this.gpuActive && visible && !ink && satellite && water.overlay === 'none' && t.water ? vectorWhiteWater(t.water, water.riverArea, water.season) : undefined);
    const decor = retainedDecorOf(this.world!.terrain);
    let svg = decor && visible ? decorWaterSvg(decor, ink ? r.palette.mapStyle : 'render3d', water.showLakes, colors) : '';
    if (t.water && visible) {
      if (ink || !this.gpuActive || isFantasyStyle(style)) svg += vectorWaterSvg(t.water, vectorDisplay, !ink);
      if (!this.gpuActive && water.overlay !== 'none') svg += vectorOverlaySvg(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined);
    }
    if (t.hydrology) {
      const diagnostic = r.diagnostic !== 'none' && !r.diagnostic.startsWith('v-') && r.diagnostic !== 'elevation' && !isResourceDiagnostic(r.diagnostic) ? r.diagnostic as HydrologyOverlay : 'none';
      const hydrology = water.showLakes ? t.hydrology : { ...t.hydrology, lakeOffsets: t.hydrology.lakeOffsets.slice(0, 1), lakePoints: t.hydrology.lakePoints.slice(0, 0) };
      svg += renderHydrology(hydrology, diagnostic, (ink || !this.gpuActive) && visible, ink ? r.palette.mapStyle : 'render3d', true, colors);
    }
    if (isResourceDiagnostic(r.diagnostic)) {
      const resources = await resourceOverlayBody(this.world!, r, this.resourceSource);
      svg += resources.svg;
      if (resources.error) this.stats.resourcesError = resources.error; else delete this.stats.resourcesError;
    }
    this.waterSvg = svg; this.vectorsDirty = true;
  }
  /** The map frame when the relief (which draws its own) is hidden. */
  private framePass(): void {
    const r = this.resolved!, t = this.native!, layers = this.layers();
    this.frameSvg = !layers.relief && layers.frame ? `<rect width="${t.width}" height="${t.width}" fill="none" stroke="${terrainStyle(r.ground.style, r.palette.colors).palette.frame}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>` : '';
    this.vectorsDirty = true; this.dropBackground();
  }
  private async refreshVectors(): Promise<void> {
    this.vectorsDirty = false;
    const r=this.resolved!,water=r.composition.ambience==='night' && r.composition.networks.water.look==='natural'?moonlightSvg(this.waterSvg,'v2-water-night'):this.waterSvg;
    const svg = water + this.frameSvg;
    if (svg === this.vectors) return;
    const whole = wholeMap(this.native!.width);
    this.vectors = svg; this.vectorView = undefined; this.vectorRequest = undefined;
    this.vectorBase = svg ? { image: await imageOf(svgOf(svg, whole)), region: whole } : undefined;
    this.waterMaskVersion++;
  }
  private shownWorld(): World {
    const world = this.world!, layers = this.exportLayers, r = this.resolved!;
    // Native city plans and houses are drawn exactly once by CityBench. Natural vegetation, regional roads and names still use the original map renderer.
    const hideUrban = this.scene!.capabilities.nativeCities || layers.city === false;
    const shown = displayWorld(world, { roads: layers.roads, city: hideUrban ? false : undefined }, r.city.visible), seed = displaySeed(world.seed);
    return shown.seed === seed ? shown : { ...shown, seed };
  }
  /** Land classes the vector overlay paints. A material ground draws the physical land use in its shader, so the overlay keeps only the vegetation symbols asked for. */
  private overlayLandKinds(): true | ((kind: LandKind) => boolean) {
    return cityOverlayLandKinds(this.resolved!);
  }
  /** Overlay renderer (names, roads, land use, painted/vegetation symbols); the natural layers it does not own are masked, not faked. */
  private async cartographyPass(): Promise<void> {
    const world = this.world!, r = this.resolved!, layers = this.exportLayers, scene = this.scene!;
    const productKey = JSON.stringify([passKeys(this.input()).cartography, mapSeasonKey(), getLanguage(), getDistanceUnit(), scene.revisions.cities]);
    // Before the dispose: 3D tiles may paint through the current renderer during this wait.
    const brushes = r.cartography.painted ? await paintedBrushes() ?? undefined : undefined;
    const shown = this.shownWorld();
    const landuse = layers.landuse !== false && r.cartography.landuse;
    // The physical land use keeps its own vegetation drawing only where the composition asks for it on the vector overlay; the semantic layer is separate (hook below).
    const cartographic = r.composition.vegetation.cartographic;
    const mask: SceneMask = { water: false, contours: false, landuse: !landuse ? false : this.overlayLandKinds() };
    const v = scene.revisions, sceneKey = JSON.stringify(['scene', mapSeasonKey(), cityOverlayLandKey(r), v.roads, v.landuse, v.settlements, v.terrain, v.cities, layers.roads, layers.city, r.city.visible, landuse, cartographic, world.mapSize, shown.seed, world.options.biome]);
    const built = this.shared.cache.get(sceneKey, () => buildScene(shown, undefined, { mask }));
    // Same overlay configuration on the same map (a town build or edit): keep the renderer and its tiles, repaint only the changed areas.
    const config = JSON.stringify([r.keys.cartography, v.terrain, mapSeasonKey(), cityOverlayLandKey(r), landuse, cartographic, !!brushes, r.palette.colors, r.vegetation.symbols, r.composition.networks.roads.look,
      layers.decor, layers.roads, layers.city, layers.landuse, layers.labels, layers.streets, layers.background, layers.terrain, layers.water, r.city.visible, shown.seed, world.mapSize, world.options.biome]);
    if (this.cartographyKey !== productKey && this.cartographyState?.config !== config) {
      const hit = this.retained.take<CartographyProduct>('product:' + productKey);
      // Move the requested product out first: storing the outgoing style must not
      // evict the very entry this switch is about to use.
      this.storeCartography();
      this.cartographyKey = productKey;
      if (hit) {
        this.cartography = hit.renderer; this.overlay = hit.overlay; this.cartographyState = hit.state; this.physical = hit.physical;
        this.stats.cartographyUpdate = 'retained'; this.passes.reset('overlays'); return;
      }
      this.overlay = document.createElement('canvas');
    }
    this.cartographyKey = productKey;
    const previous = this.cartographyState;
    if (this.cartography && previous && previous.config === config && previous.scene !== built) {
      const started = performance.now();
      const dirty = sceneDirty(previous.scene, built);
      if (dirty) {
        const extra: Rect[] = worldDirty(previous.world, shown, 300);
        changedShapes(clearingBuildings(previous.world), clearingBuildings(shown), b => `${b.id}|${shapeKey(b.footprint[0]?.outer ?? [])}`, b => b.footprint[0]?.outer ?? [], extra);
        const rects = mergeRects([...dirty, ...extra].map(d => ({ minX: d.minX - DERIVED_REACH, minY: d.minY - DERIVED_REACH, maxX: d.maxX + DERIVED_REACH, maxY: d.maxY + DERIVED_REACH })));
        const next: Scene = { ...built, dirty: rects };
        if (this.cartography.update(shown, next)) {
          this.cartographyState = { config, scene: built, world: shown };
          if (this.physical) this.physical.key = productKey;
          this.stats.cartographyUpdate = { dirty: rects.length, area: Math.round(rects.reduce((sum, d) => sum + (d.maxX - d.minX) * (d.maxY - d.minY), 0) / (world.mapSize * world.mapSize) * 1000) / 10, ms: Math.round(performance.now() - started) };
          performance.measure('v2:cartography-dirty', { start: started });
          this.passes.reset('overlays');
          return;
        }
      }
    }
    this.cartography?.dispose();
    this.stats.cartographyUpdate = 'rebuilt';
    const state=this;
    const palette={...biomePalette(r.palette.mapStyle,world.options.biome),frameKind:'none' as const,...(layers.decor===false?{grid:null}:{})};
    this.cartography = createCanvasRenderer(this.overlay, shown, palette, { colors: r.palette.colors, separateText: true, textSources: () => this.city?.scenes(), ...cityCountrysideCanvasOptions(r, world.mapSize), buildingClearings: () => buildingOccupationShapes({ buildings: clearingBuildings(this.world!) } as never)?.map(shape => shape.outer) ?? [], transparentBackground: true, groundCaverns: () => this.gpuActive && this.resolved?.ground.traits.family === 'material', terrain: () => this.landBackdrop(), scene: built, mask, roadLook: r.composition.networks.roads.look, roadStyle: () => { const c = this.resolved!.composition; return { look: c.networks.roads.look, emphasis: c.networks.roads.emphasis, night: c.ambience === 'night', colors: this.resolved!.palette.colors }; },
      // Read per frame: a new look repaints the raster tiles through `key`, never the cartography pass.
      semantic: { key: () => `${this.semantic?.key ?? ''}|c${this.contourLook()?.landform ?? ''}:${JSON.stringify(contourDrawOf(this.resolved?.composition.recipe))}:${this.contourRevision}|w${this.waterAboveLand() ? JSON.stringify([this.resolved!.keys.water, mapSeasonKey(), this.vectorView?.region]) : ''}`, draw: (ctx, rect, mpp, quality) => { this.paintRural(ctx, rect, mpp, quality === 'light'); this.cutWater(ctx, rect); }, legend: () => this.semanticLegend() },
      invalidate: () => this.invalidate(), brushes, vegetation: r.vegetation.symbols, get dpr() { return state.dpr; } });
    const renderer = this.cartography;
    this.cartographyState = { config, scene: built, world: shown };
    // The 3D drape tiles take the physical land use without the semantic hook: their contours are inked here, at the tile's scale.
    this.physical = { key: productKey, ready: (box, pixels) => this.contoursAt(pixels / (box.maxX - box.minX), box), preview: (target, box) => renderer.drawCachedMap(target, box), paint: (target, box, options, defer) => { const ground = renderer.drawGround(target, box, options); return this.drapeContours(target, box, displayQualityFor(!!options?.live) === 'light', defer) || ground; } };
    this.passes.reset('overlays');
  }
  /** Overlay renderer inputs: a matching configuration reuses the renderer through a dirty-region update. */
  private cartographyState?: { config: string; scene: Scene; world: World };
  private storeCartography(): void {
    if (this.cartography && this.cartographyState) {
      const product: CartographyProduct = { renderer: this.cartography, overlay: this.overlay, state: this.cartographyState, physical: this.physical };
      product.renderer.suspendLive();
      this.retained.put('product:' + this.cartographyKey, product,
        product.renderer.retainedBytes() + product.overlay.width * product.overlay.height * 4,
        () => { product.renderer.dispose(); product.overlay.width = product.overlay.height = 0; });
    }
    this.cartography = undefined; this.cartographyState = undefined; this.physical = undefined;
  }
  /** The physical land use of the overlay above (composition mask, painted brushes, path caches) for the 3D ground tiles: no second scene. */
  physicalGround(): PhysicalGround | undefined { return this.physical; }
  /** Labels, legend and cartouche on the overlay renderer; the explicit-layers export raster. */
  private async overlaysPass(): Promise<void> {
    const r = this.resolved!, layers = this.exportLayers;
    this.cartography!.setOverlays({ text: r.composition.text, labels: layers.labels !== false && r.cartography.labels, legend: layers.decor !== false && r.cartography.legend, cartouche: layers.decor !== false && r.cartography.cartouche });
    this.exportOverlay = undefined; this.exportGround = undefined;
    if (Object.keys(layers).length === 0) return;
    const sources=r.cartography.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
    this.semanticPass(true); // the legend reads the semantic state, which may not be computed yet at this point
    const landuseOn=layers.landuse!==false&&r.cartography.landuse;
    // Rural semantics sit above the physical land use but below roads and labels: with a semantic look on, the land use is its own raster (exportGround) under the semantics.
    const split=landuseOn&&this.semantic!.rural!=='off';
    const common={width:EXPORT_OVERLAY_PX,style:r.palette.mapStyle,colors:r.palette.colors,buildings:r.city.visible,contours:false,landuseKinds:((kinds=>kinds===true?undefined:kinds)(this.overlayLandKinds())),text:r.composition.text,labels:false,brushes:sources,vegetation:r.vegetation.symbols,roadGround:roadGroundTones(r.ground.traits.family === 'material', biomePalette(r.palette.mapStyle, this.world!.options.biome)),roadLook:r.composition.networks.roads.look,roadEmphasis:r.composition.networks.roads.emphasis,roadNight:r.composition.ambience==='night'};
    const rasterOf=async(svg:string)=>{const document=new DOMParser().parseFromString(svg,'image/svg+xml');document.querySelectorAll('.layer-decor').forEach(frame=>frame.remove());return imageOf(new XMLSerializer().serializeToString(document.documentElement));};
    this.exportGround=undefined;
    if(split)this.exportGround=await rasterOf(renderSvg(this.shownWorld(),{...common,layers:{background:false,terrain:false,water:false,landuse:true,city:false,streets:false,roads:false,labels:false,decor:false},landuse:true,legend:false,cartouche:false}));
    this.exportOverlay=await rasterOf(renderSvg(this.shownWorld(),{...common,layers:{...layers,background:false,terrain:false,water:false,...(split?{landuse:false}:{})},landuse:landuseOn&&!split,legend:r.cartography.legend,cartouche:r.cartography.cartouche,semanticLegend:this.semanticLegend()}));
  }
  /** Semantic land use state: looks, opacity and classes. Painted per frame from the canonical polygons (cartography hook, export branch of drawInto, city hook), so nothing else re-runs. */
  private semantic?: { rural: SemanticLook; urban: SemanticLook; opacity: number; classes: Readonly<Record<LandKind, boolean>>; key: string };
  private semanticPass(inline = false): void | Promise<void> {
    const c = this.resolved!.composition.landuse, layers = this.exportLayers, shown = layers.landuse !== false, before = this.semantic;
    const rural = shown ? c.rural : 'off', urban = shown ? c.urban : 'off';
    this.semantic = { rural, urban, opacity: c.opacity, classes: c.classes, key: JSON.stringify([rural, urban, c.opacity, Object.entries(c.classes).filter(([, on]) => !on).map(([kind]) => kind)]) };
    // The overlays pass runs before this one and its key ignores the semantic state, yet the exported legend embeds it:
    // redo it now when the state moved (the inline call from the overlays pass is already up to date).
    if (!inline && before && before.key !== this.semantic.key && this.cartography) return this.overlaysPass();
  }
  /** Contours live on the vector overlay, above the land-use tints and the parchment backdrop that would hide a ground-shader line. */
  private contourLook(): { landform: string } | undefined {
    const r = this.resolved, t = this.native, world = this.world;
    if (!r || !t || !world || !r.ground.contours || this.exportLayers.terrain === false || (!this.layers().relief && r.composition.variant !== 'topographic') || t.caveMask.length || isFantasyStyle(r.ground.style)) return undefined;
    const landform = effectiveTerrainSettings(this.settings!, world.mapSize).relief;
    return landform === 'cavern' ? undefined : { landform };
  }
  /** Same screen weight at every zoom; close views split the interval (cityFineContours) instead of losing the lines on flat ground. */
  /** Contours on one 3D drape tile (world square `box` on `target`); heavier than on the flat map, as the tile is seen minified and at a slant. */
  private drapeContours(target: HTMLCanvasElement, box: { minX: number; minY: number; maxX: number; maxY: number }, light = false, defer?: () => () => void): boolean {
    if (!this.contourLook()) return false;
    const ctx = target.getContext('2d'); if (!ctx) return false;
    const k = target.width / (box.maxX - box.minX);
    ctx.save(); ctx.setTransform(k, 0, 0, k, -box.minX * k, -box.minY * k); ctx.globalCompositeOperation = 'source-over';
    const drawn = this.paintContours(ctx, box, 1 / k, DRAPE_CONTOUR_WEIGHT, light, defer);
    ctx.restore(); return drawn;
  }
  /** `defer` (3D drape squares): contours still in the worker repaint only the squares that drew without them, not the 2D map. */
  private paintContours(ctx: CanvasRenderingContext2D, viewport: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number, weight = 1, light = false, defer?: () => () => void): boolean {
    const look = this.contourLook(); if (!look) return false;
    const pal = terrainStyle(this.resolved!.ground.style, this.resolved!.palette.colors).palette, sc = 1 / mpp;
    const farLight = light && sc < 1;
    const topographic = this.resolved!.composition.recipe.ground.variant === 'topographic', mode = contourDrawOf(this.resolved!.composition.recipe);
    // Fixed (V1): the same whole-map set at every zoom, so no zoom repaints its lines; only the stroke weight follows the scale.
    const fine = farLight || topographic || mode.detail === 'fixed' ? undefined : cityFineContours(this.native!, look.landform, sc, viewport);
    let sets = fine?.blocks;
    if (!sets) {
      sets = [cityContourPaths(this.native!, look.landform, sc, topographic, undefined, mode.detail, mode.sparse)].filter(paths => paths.step);
    }
    if (cityContoursPending(this.native)) this.afterContours(defer?.() ?? this.contoursReady);
    if (!sets.length) return false;
    ctx.save(); ctx.strokeStyle = pal.contour; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = pal.contourOpacity * 0.7 * mode.opacity; ctx.lineWidth = mapStrokeWidth(CANVAS_MAP_STROKES.contour, sc, (pal.contourThinW ?? 1) * weight);
    const recording = ctx instanceof RecordingContext;
    if (!farLight) for (const set of sets) if (set.thin) ctx.stroke(contourPath(set, 'thin', recording));
    ctx.globalAlpha = pal.contourOpacity * mode.opacity; ctx.lineWidth = mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, sc, pal.contourIndexW / 1.6 * weight);
    for (const set of sets) if (set.index) ctx.stroke(contourPath(set, 'index', recording));
    ctx.restore(); return true;
  }
  /** Raster of the vector water last used to cut the land use: overlay tiles repaint when a finer one arrives. */
  private waterMaskVersion = 0;
  /** Palettes whose ink water must read above the land-use tints (atlas, topographic). */
  private waterAboveLand(): boolean {
    const r = this.resolved;
    return !!r && cityWaterCutsLand(r);
  }
  /**
   * The vector water raster lies under the overlay: erase the land use, contours and semantics above it (the parchment
   * backdrop does the same with `destination-in`), so rivers and lakes stay crisp in their palette blue. Roads and bridges come later.
   */
  private cutWater(ctx: CanvasRenderingContext2D, rect: { minX: number; minY: number; maxX: number; maxY: number }): void {
    if (!this.waterAboveLand()) return;
    const covers = (v?: { region: ViewRasterRegion }): boolean => !!v && v.region.x <= rect.minX && v.region.y <= rect.minY && v.region.x + v.region.width >= rect.maxX && v.region.y + v.region.height >= rect.maxY;
    const mask = covers(this.vectorView) ? this.vectorView : this.vectorBase;
    if (!mask) return;
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1;
    ctx.drawImage(mask.image, mask.region.x, mask.region.y, mask.region.width, mask.region.height);
    ctx.restore();
  }
  private paintRural(ctx: CanvasRenderingContext2D, viewport: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number, light = false): void {
    this.paintContours(ctx, viewport, mpp, 1, light);
    const s = this.semantic;
    const lineView = this.resolved?.composition.variant === 'topographic';
    if (s && s.rural !== 'off') drawRuralSemantic(ctx, this.world?.landuse, { look: s.rural, opacity: s.opacity, mpp, viewport, classes: s.classes, patterns: !lineView, fieldStrips: lineView });
  }
  private paintUrban(ctx: CanvasRenderingContext2D, scene: CityScene, frame: { viewport: { minX: number; minY: number; maxX: number; maxY: number }; mpp: number }): void {
    const s = this.semantic;
    if (s && s.urban !== 'off') drawUrbanSemantic(ctx, [scene], { look: s.urban, opacity: s.opacity, mpp: frame.mpp, viewport: frame.viewport });
  }
  private semanticLegend(): SemanticLegendEntry[] {
    const s = this.semantic;
    return s ? [...ruralSemanticLegend(this.world?.landuse, s.classes, s.rural), ...urbanSemanticLegend(this.city?.scenes() ?? [], s.urban)] : [];
  }
  private cityHooks: NativeCityHooks = { beforeBuildings: (ctx, scene, frame) => this.paintUrban(ctx, scene, frame) };
  /** Native city plans/houses: rebuilt per city products only; the city appearance is read per frame (draw). */
  private async cityPass(): Promise<void> {
    const v = this.scene!.revisions, key = JSON.stringify([v.cities, v.settlements, v.terrain]), shared = this.shared;
    if (shared.city?.key === key) { this.city = shared.city.map; return; }
    const map = createNativeCityMap(this.world!, () => { this.cityRevision++; this.restoredFrameKey = ''; this.invalidate(); });
    if (this.ownsShared) { shared.city?.map.dispose(); shared.city = { key, map }; } else { this.exportCity?.dispose(); this.exportCity = map; }
    this.city = map;
  }
  /** Capture/export only: combines the layers into a single raster. */
  draw(view: View, w: number, h: number, dpr: number, canvas = this.surface): HTMLCanvasElement {
    return this.drawInto(canvas, view, w, h, dpr, false);
  }
  /** The GPU capture copied to a 2D canvas right after the readback (a WebGPU canvas is blank once its frame is gone). */
  private miniGroundCopy?: { source: HTMLCanvasElement; copy: HTMLCanvasElement };
  private miniGround(): HTMLCanvasElement | undefined {
    const source = this.groundBackground();
    if (!source) return undefined;
    if (this.miniGroundCopy?.source !== source) {
      const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
      copy.getContext('2d')!.drawImage(source, 0, 0);
      this.miniGroundCopy = { source, copy };
    }
    return this.miniGroundCopy.copy;
  }
  /** True when the last miniature had its map content (cached ground/vectors) and no work was pending: otherwise it must be drawn again. */
  miniComplete = false;
  drawMini(size: number): HTMLCanvasElement {
    const width = this.world!.mapSize;
    // A live miniature must not synchronously render the entire map, cancel
    // progressive tile filling or restore the camera through another full draw.
    const canvas = this.miniature; canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = this.paper; ctx.fillRect(0, 0, size, size);
    if (this.base) ctx.drawImage(this.base, 0, 0, size, size);
    // GPU ground: no CPU raster; the cached ground capture (also the 3D background) is the miniature's terrain.
    const gpuGround = this.gpuActive ? this.miniGround() : undefined;
    if (gpuGround) ctx.drawImage(gpuGround, 0, 0, size, size);
    const cached = this.cartography?.drawCachedMap(canvas, { minX: 0, minY: 0, maxX: width, maxY: width }) ?? false;
    const vectors = this.vectorBase;
    this.miniComplete = (cached || !!this.base || !!gpuGround || !!vectors) && this.pendingWork() === 0;
    if (vectors) ctx.drawImage(vectors.image, vectors.region.x * size / width, vectors.region.y * size / width,
      vectors.region.width * size / width, vectors.region.height * size / width);
    return canvas;
  }
  /** No GPU readback, intermediate bitmap or full-frame copy in the live display path. */
  drawLive(view: View, w: number, h: number, dpr: number): void {
    if (this.suspended) return;
    // A failed program is reported by settled()/exactReady() (the appearance status); the live view keeps its stand-in.
    initializeDisplayQuality();
    if (this.preparing) {
      const previous = this.previousFrame;
      if (previous) {
        const k = view.scale / previous.view.scale;
        const tx = (w - previous.w) / 2 + (previous.view.cx - view.cx) * view.scale;
        const ty = (h - previous.h) / 2 + (previous.view.cy - view.cy) * view.scale;
        previous.element.style.transformOrigin = '50% 50%';
        previous.element.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
      }
      return;
    }
    const previousView = this.liveRequested;
    const frameKey = this.frameKey(view, w, h, dpr);
    if (this.restoredFrameKey === frameKey) { this.notePresented(); return; }
    this.restoredFrameKey = '';
    const cached = this.retained.get<HTMLCanvasElement>('frame:' + frameKey);
    if (cached && !this.programWork && !this.forestJob) {
      this.surface.width = cached.width; this.surface.height = cached.height;
      this.surface.style.cssText = `width:${w}px;height:${h}px`;
      this.surface.getContext('2d')!.drawImage(cached, 0, 0);
      this.liveGround?.remove(); this.liveGround = undefined; this.groundShown = undefined;
      this.element.append(this.surface); this.liveShown = { view: { ...view }, w, h, dpr };
      this.restoredFrameKey = frameKey; this.stats.frameCache = 'hit'; this.notePresented(); return;
    }
    this.stats.frameCache = cached ? 'pending' : 'miss';
    if (this.liveCapture) {
      const frame = this.liveShown;
      if (frame && frame.w === w && frame.h === h && frame.dpr === dpr && frame.view.cx === view.cx && frame.view.cy === view.cy && frame.view.scale === view.scale) return;
      this.liveCapture = false;
    }
    const navigating = !!previousView && (previousView.cx !== view.cx || previousView.cy !== view.cy || previousView.scale !== view.scale);
    if (navigating) { noteDisplayNavigation(); this.suspendLiveTiles(); this.movingUntil = performance.now() + LIVE_SETTLE_MS; }
    this.liveRequested = { ...view };
    const ground = this.gpuActive ? terrainRendererCanvas(this.gpu!, this.gpuCanvas) : undefined;
    const groundChanged = ground !== this.liveGround;
    if (groundChanged) {
      this.liveGround?.remove(); this.liveGround = ground;
      if (ground) this.element.prepend(ground);
    }
    if (groundChanged || w !== this.liveWidth || h !== this.liveHeight) {
      this.liveWidth = w; this.liveHeight = h;
      this.surface.style.width = w + 'px'; this.surface.style.height = h + 'px';
      if (ground) { ground.style.width = w + 'px'; ground.style.height = h + 'px'; }
    }
    if (ground) {
      const previous = this.groundShown;
      const moved = !!previous && previous.w === w && previous.h === h && previous.dpr === dpr
        && (previous.view.cx !== view.cx || previous.view.cy !== view.cy || previous.view.scale !== view.scale);
      const pending = { view: { ...view }, w, h, dpr };
      const tg = performance.now();
      this.gpu!.redrawNow(view, w, h, moved || !!this.groundPending, Math.min(2, dpr)); this.markGroundDrawn();
      noteLivePart('ground', tg);
      this.groundShown = pending;
      if (moved) {
        this.groundPending = pending;
        clearTimeout(this.groundTimer);
        this.groundTimer = setTimeout(() => {
          const p = this.groundPending; this.groundPending = undefined;
          if (p && !this.disposed && this.gpuActive) { this.gpu!.redrawNow(p.view, p.w, p.h, false, Math.min(2, p.dpr)); this.markGroundDrawn(); }
          if (p && !this.disposed) this.invalidate();
        }, LIVE_SETTLE_MS);
      }
    }
    if (this.surface.parentElement !== this.element) this.element.append(this.surface);
    // A costly overlay (parchment woods, symbols, contours, Canvas 2D city) follows a moving view as a compositor
    // transform of its last bitmap, and is repainted once the view rests: pan and zoom never wait for a full repaint.
    const shown = this.liveShown;
    // GPU vector engine: the overlay is a retained list replayed with the view matrix, so a moving view repaints every
    // frame (no stretched bitmap, no tiles); the frame cache is only fed once the view rests.
    const gpuLive = !!this.cartography?.liveRetained() && !this.fantasy && this.liveCost <= LIVE_DEFER_MS;
    if (gpuLive && navigating) {
      this.liveMoving = true;
      try { this.paintLive(view, w, h, dpr, false); } finally { this.liveMoving = false; }
      this.liveTimer = setTimeout(() => { if (!this.disposed && this.world) this.paintLive(view, w, h, dpr); }, LIVE_SETTLE_MS);
      return;
    }
    if (shown && !gpuLive && (this.cartography || this.fantasy || this.liveCost > LIVE_DEFER_MS) && shown.w === w && shown.h === h && shown.dpr === dpr
      && (this.livePending || navigating || shown.view.cx !== view.cx || shown.view.cy !== view.cy || shown.view.scale !== view.scale)) {
      this.suspendLiveTiles();
      // Downsample the retained CPU overlay once per gesture; the ground owns its own resolution policy.
      if (getDisplayQuality() === 'light' && dpr > 1 && this.surface.width > Math.round(w)) {
        const reduced = document.createElement('canvas'); reduced.width = Math.round(w); reduced.height = Math.round(h);
        reduced.getContext('2d')!.drawImage(this.surface, 0, 0, reduced.width, reduced.height);
        this.surface.width = reduced.width; this.surface.height = reduced.height;
        this.surface.getContext('2d')!.drawImage(reduced, 0, 0);
      }
      const k = view.scale / shown.view.scale, tx = (shown.view.cx - view.cx) * view.scale, ty = (shown.view.cy - view.cy) * view.scale;
      this.surface.style.transformOrigin = '50% 50%';
      this.surface.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k})`;
      // Resource/tile invalidations during a gesture must neither repaint nor restart the rest timer.
      const restart = navigating || !this.livePending;
      this.livePending = { view: { ...view }, w, h, dpr };
      if (restart) {
        clearTimeout(this.liveTimer);
        this.liveTimer = setTimeout(() => { const p = this.livePending; if (p && !this.disposed && this.world) this.paintLive(p.view, p.w, p.h, p.dpr); }, LIVE_SETTLE_MS);
      }
      return;
    }
    this.paintLive(view, w, h, dpr);
  }
  private paintLive(view: View, w: number, h: number, dpr: number, store = true): void {
    clearTimeout(this.liveTimer); this.livePending = undefined;
    const t = performance.now();
    LiveTileFill.track(this, () => this.drawInto(this.surface, view, w, h, dpr, true));
    noteLivePart('frame', t);
    // A decaying peak: one cheap repaint from warm caches must not make the next zoom step (a cold level) paint inline.
    this.liveCost = Math.max(performance.now() - t, this.liveCost * .8); this.liveShown = { view: { ...view }, w, h, dpr };
    this.surface.style.transform = '';
    this.notePresented();
    if (store) this.storePresentedFrame(view, w, h, dpr);
  }
  private frameKey(view: View, w: number, h: number, dpr: number): string {
    return JSON.stringify([this.presentationKey, view, w, h, dpr, getLanguage(), getDistanceUnit(), getDisplayQuality(), getVectorEngine(), this.contourRevision, this.cityRevision]);
  }
  /** True from a ground redraw to the end of its task (the only window in which the ground canvas can be copied). */
  private groundDrawnThisTask = false;
  private markGroundDrawn(): void {
    if (this.groundDrawnThisTask) return;
    this.groundDrawnThisTask = true; queueMicrotask(() => { this.groundDrawnThisTask = false; });
  }
  private storePresentedFrame(view: View, w: number, h: number, dpr: number): void {
    if (this.pendingWork() || this.resolved?.target !== 'view2d') return;
    const key = this.frameKey(view, w, h, dpr);
    if (this.cachedFrameKey === key && this.retained.get('frame:' + key)) return;
    const bytes = Math.round(w * dpr) * Math.round(h * dpr) * 4;
    if (bytes > this.retained.maxFrameBytes) return;
    const image = document.createElement('canvas'); image.width = Math.round(w * dpr); image.height = Math.round(h * dpr);
    const ctx = image.getContext('2d')!;
    // The GPU ground buffer is not preserved: it can only be copied in the task that drew it. A frame stored from a
    // timer (the rest repaint) redraws it here first, or the cached frame keeps an empty ground and a later restore of
    // this view showed the overlay alone (the map "disappeared" until the next pan or zoom, most visibly on satellite).
    if (this.gpuActive && this.liveGround && !this.groundDrawnThisTask) { this.gpu!.redrawNow(view, w, h, false, Math.min(2, dpr)); this.markGroundDrawn(); }
    if (this.gpuActive && this.liveGround) {
      // The GPU ground is laid out with an overscan around the view (liveGround.ts): copy it where it is displayed.
      // Stretched to the view, the cached frame showed the ground 16% smaller than the overlay (a "zoom-out" after
      // every zoom, doubled rivers on vector styles). A CSS-transformed preview is not this view's frame: no store.
      const style = this.liveGround.style;
      if (style.transform && style.transform !== 'none') return;
      const px = (value: string, fallback: number): number => { const n = parseFloat(value); return Number.isFinite(n) ? n : fallback; };
      ctx.drawImage(this.liveGround, px(style.left, 0) * dpr, px(style.top, 0) * dpr, px(style.width, w) * dpr, px(style.height, h) * dpr);
    }
    ctx.drawImage(this.surface, 0, 0);
    this.retained.put('frame:' + key, image, bytes, () => { image.width = image.height = 0; }, true);
    this.cachedFrameKey = key; this.stats.frameCache = 'stored';
    this.stats.retainedBytes = this.retained.bytes; this.stats.frameBytes = this.retained.frameBytes;
  }
  private notePresented(): void {
    if (this.preparing) return;
    const request = this.request;
    request?.mark('first-useful-frame');
    if (!this.programWork && !this.forestJob && !this.programError) request?.mark('programs-ready');
    if (this.pendingWork() === 0 && !request?.has('visible-complete')) {
      requestAnimationFrame(() => { if (this.request === request && this.pendingWork() === 0) request?.mark('visible-complete'); });
    }
  }
  private suspendLiveTiles(): void {
    this.cartography?.suspendLive();
    if (this.fantasy) suspendFantasyRaster(this.fantasy);
  }
  /** Resolves once the progressive updates (woods after a town build) are on screen. */
  async settled(): Promise<void> {
    await this.exactReady();
    while (!this.disposed && !this.suspended && (this.pendingWork() || !this.request?.has('visible-complete'))) {
      if (this.programError) throw this.programError;
      this.invalidate(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }
  /** Display work still owed to the last live frame (missing overlay tiles); 0 once the map is complete. */
  pendingWork(): number {
    if (this.restoredFrameKey) return 0;
    return Number(this.preparing) + Number(!!this.forestJob) + Number(!!this.programWork) + Number(!!this.programError)
      + Number(!!this.vectorRequest) + Number(!!this.livePending) + Number(!!this.groundPending)
      + Number(!!(this.stats.city as { pending?: boolean } | undefined)?.pending)
      + LiveTileFill.pending(this) + (this.cartography?.lastStats().rasterPending ?? 0) + cityContoursPending(this.native) + this.contourWaiters.size;
  }
  /** Explicit readback for screenshots/illustration; ordinary navigation never calls it. */
  prepareCapture(): void {
    if (this.pendingWork()) throw new Error('HD loading… Wait for the renderer before capturing.');
    if (this.programError) throw this.programError;
    const capture = new RenderReadiness('capture'); capture.mark('programs-ready');
    const frame = this.livePending ?? this.liveShown;
    this.suspendLiveTiles(); clearTimeout(this.liveTimer); this.livePending = undefined;
    if (frame && this.world) {
      this.drawInto(this.surface, frame.view, frame.w, frame.h, frame.dpr, false);
      this.surface.style.transform = ''; this.liveShown = frame; this.liveCapture = true;
    } else if (this.gpuActive) this.gpu!.redrawForCapture();
    capture.mark('capture-complete');
  }
  private drawInto(canvas: HTMLCanvasElement, view: View, w: number, h: number, dpr: number, live: boolean): HTMLCanvasElement {
    const r = this.resolved!, size = this.world!.mapSize;
    this.dpr = dpr; const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);if(canvas.width!==pixelW)canvas.width=pixelW;if(canvas.height!==pixelH)canvas.height=pixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.exportLayers.background !== false && !(live && this.gpuActive)) { ctx.fillStyle = this.paper; ctx.fillRect(0, 0, w, h); }
    if (this.gpuActive && !live) { this.gpu!.setView(view, w, h); this.gpu!.redrawForCapture(); ctx.drawImage(terrainRendererCanvas(this.gpu!, this.gpuCanvas), 0, 0, w, h); }
    ctx.save(); ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale); ctx.scale(view.scale, view.scale);
    if (this.base) ctx.drawImage(this.base, 0, 0, size, size);
    // Only while the active ground is Illustrated: a style switch must never keep the previous painting.
    // Illustrated: water (and the frame) pass behind the brushes; overhanging crowns hide part of a river, corridors keep it readable.
    const fantasy = this.fantasy && isFantasyStyle(r.ground.style) ? this.fantasy : undefined;
    // Wash under the water, stamps over it.
    if (fantasy) drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, KEEP_NONE);
    let t0 = performance.now();
    const vectors = this.vectorRaster(view, w, h, dpr);
    if (live) t0 = noteLivePart('water', t0);
    if (vectors) ctx.drawImage(vectors.image, vectors.region.x, vectors.region.y, vectors.region.width, vectors.region.height);
    // The export overlay is one whole-map raster: only where it is at least as fine as the frame.
    const overlay = this.exportOverlay && view.scale * dpr * size <= this.exportOverlay.width * 1.01 ? this.exportOverlay : undefined;
    // Export order: physical land use, rural semantics, then roads/labels/furniture (as on screen).
    if (overlay) {
      if (this.exportGround) ctx.drawImage(this.exportGround, 0, 0, size, size);
      // The export overlay carries the labels too: there the stamps stay under it.
      if (fantasy) drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, undefined, false, true, live, live);
      this.paintRural(ctx, viewRect(view, w, h), 1 / view.scale); ctx.drawImage(overlay, 0, 0, size, size);
    }
    ctx.restore();
    let t = performance.now();
    if (!overlay && this.cartography) { if (this.overlay.width !== canvas.width) this.overlay.width = canvas.width; if (this.overlay.height !== canvas.height) this.overlay.height = canvas.height; this.cartography.draw(view, { live }); ctx.drawImage(this.overlay, 0, 0, w, h); }
    if (live) t = noteLivePart('cartography', t);
    // Illustrated: stamps above roads, rivers and field edges (anchors stay clear of them, crowns may overhang); towns and labels stay on top.
    if (fantasy && !overlay) {
      ctx.save(); ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale); ctx.scale(view.scale, view.scale);
      drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, undefined, false, true, live, live); ctx.restore();
    }
    if (live) t = noteLivePart('fantasy', t);
    if (this.exportLayers.city !== false||this.exportLayers.streets!==false) this.stats.city = this.city?.draw(ctx, view, w, h, dpr, r, { ...this.exportLayers, labels: false }, this.cityHooks);
    if (live) t = noteLivePart('city', t);
    if (this.cartography) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.cartography.drawText(ctx, view, w, h, this.liveMoving || performance.now() < this.movingUntil); ctx.restore(); }
    if (live) noteLivePart('text', t);
    return canvas;
  }
  /** The vector raster for this frame: the view raster when it fits, else the whole-map one while a
   * view raster at the frame's density is prepared (the frame is redrawn when it is ready). */
  /** True while a moving view repaints every frame (GPU vector engine): costly one-off work waits for the rest frame. */
  private liveMoving = false;
  /** Until then the view counts as moving (a gesture's frames, including redraws between wheel steps): labels follow the map. */
  private movingUntil = 0;
  private vectorRaster(view: View, w: number, h: number, dpr: number): { image: HTMLCanvasElement; region: ViewRasterRegion } | undefined {
    if (!this.vectors) return undefined;
    const size = this.world!.mapSize, rect = viewRect(view, w, h), density = view.scale * dpr;
    if (viewRasterFits(this.vectorView?.region, rect, density, size)) return this.vectorView;
    if (viewRasterFits(this.vectorBase?.region, rect, density, size, Infinity)) return this.vectorBase;
    // A moving GPU view keeps the coarser water raster: the SVG rasterisation of a new region waits for the rest frame.
    if (!this.liveMoving) void this.requestVectors(viewRasterRegion(rect, density, size));
    return this.vectorView && viewRasterFits({ ...this.vectorView.region, density }, rect, density, size) ? this.vectorView : this.vectorBase;
  }
  /** UTF-8 of the vector SVG body, encoded once per body. */
  private vectorBytes?: { text: string; bytes: Uint8Array };
  private requestVectors(region: ViewRasterRegion): Promise<void> {
    if (this.vectorRequest) return this.vectorRequest;
    const vectors = this.vectors;
    if (this.vectorBytes?.text !== vectors) this.vectorBytes = { text: vectors, bytes: new TextEncoder().encode(vectors) };
    const request: Promise<void> = imageOf(svgPartsOf(this.vectorBytes.bytes, region)).then(image => {
      if (this.disposed || this.vectors !== vectors) return;
      this.vectorView = { image, region }; this.waterMaskVersion++; this.invalidate();
    }, () => undefined).finally(() => { if (this.vectorRequest === request) this.vectorRequest = undefined; });
    return this.vectorRequest = request;
  }
  /** Terrain-pass bitmap for 3D; invalidated with the ground, shared without PNG encoding and image decoding. */
  groundBackground(): HTMLCanvasElement | undefined {
    if (this.programWork || this.forestJob || this.programError) return undefined;
    if (this.gpuActive) return this.backgroundImage ??= this.gpu!.captureMap(1024);
    return undefined;
  }
  backgroundUrl(): string | undefined {
    if (!this.backgroundHref) {
      if (this.gpuActive) this.backgroundHref = this.groundBackground()!.toDataURL('image/png');
      else if (this.terrainSvg || this.vectors) {
        // Illustrated: the canvas-painted ground enters the 3D background draped, as in 2D: wash under the water, stamps over it.
        let painted = '', wash = '';
        if (this.fantasy && isFantasyStyle(this.resolved!.ground.style)) {
          const f = this.fantasy, frame = f.painting.frame!, images = this.fantasyImages ??= fantasyRasterImages(f);
          const at = `x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.width}" preserveAspectRatio="none"`;
          wash = `<image class="fantasy-wash" ${at} href="${images.wash}"/>`;
          painted = `<image class="fantasy-stamps" ${at} href="${images.stamps}"/>`;
        }
        this.backgroundHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(this.terrainSvg + wash + this.vectors + painted, wholeMap(this.native!.width)))}`;
      }
    }
    return this.backgroundHref;
  }
  async capture(size: number, layers?: Partial<ExportLayers>): Promise<HTMLCanvasElement> {
    const capture = new RenderReadiness('capture');
    if (layers) await this.set(this.world!, this.settings!, this.resolved!, layers);
    await this.exactReady();
    if (this.gpuActive) await this.gpu!.variantReady();   // draw() is synchronous: it would create a missing pipeline in place
    capture.mark('programs-ready');
    const view = { cx: this.world!.mapSize / 2, cy: this.world!.mapSize / 2, scale: size / this.world!.mapSize };
    await this.contoursAt(view.scale, viewRect(view, size, size));
    // Vectors at the export density before the synchronous draw.
    if (this.vectors && !viewRasterFits(this.vectorView?.region, viewRect(view, size, size), view.scale, this.world!.mapSize)
      && !viewRasterFits(this.vectorBase?.region, viewRect(view, size, size), view.scale, this.world!.mapSize, Infinity)) {
      await this.vectorRequest; await this.requestVectors(viewRasterRegion(viewRect(view, size, size), view.scale, this.world!.mapSize));
    }
    // The city plan on WebGL2 (same engine as the live view) is uploaded before the synchronous draw.
    await this.city?.prepare(this.resolved!, { ...this.exportLayers, labels: false });
    const image = this.draw(view, size, size, 1); capture.mark('capture-complete'); return image;
  }
  dispose(): void { this.disposed = true; this.suspendLiveTiles(); this.unlistenQuality(); this.retained.clear(); clearTimeout(this.liveTimer); clearTimeout(this.groundTimer); this.previousFrame?.element.remove(); this.gpu?.dispose(); this.cartography?.dispose(); this.exportCity?.dispose(); if(this.ownsShared){this.shared.city?.map.dispose();this.shared.cache.clear();} if(this.ownsMaterialContext)this.materialContext?.gl.getExtension('WEBGL_lose_context')?.loseContext();this.materialContext=undefined;this.world = undefined; }
}
