/** Display adapters for the retained RustBench terrain and CityBench geometry.
 * No generation entry point is imported here. The original Canvas renderer remains available. */
import type { MaterialRasterContext } from '../../../rust/bridge/terrainMaterialContext';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import { displayWorld } from '../render/displayWorld';
import { v2DisplayForest } from './displayForest';
import { biomePalette } from '../render/biomes';
import { terrainStyle } from '../render/terrainStyle';
import { renderRustTerrain, terrainLandClip } from '../../../rust/bridge/terrainRender';
import { seaDistanceSurface, seaMaterialSvg } from '../render/terrainWater';
import { renderSvg } from '../render/svg';
import { DEFAULT_FRACTAL_DETAIL, seedHash } from '../../../rust/bridge/terrainAdjust';
import { climateOf, type TerrainData, type TerrainSettings } from '../../../rust/bridge/terrain';
import { effectiveTerrainSettings } from './terrainSettings';
import { createTerrainRenderer, terrainRendererCanvas, type TerrainRenderer } from '../ui/terrainRenderer';
import { lakeField } from '../ui/lakeGeometry';
import { riverSegments, vectorWaterSvg, vectorOverlaySvg, vectorOverlayPixels, type WaterDisplay, type VectorOverlay } from '../ui/vectorWaterRender';
import { renderHydrology, hydrologySegments, hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import type { HydrologyOverlay } from '../../../rust/bridge/hydrology';
import { registerFantasyBrushes, isFantasyStyle } from '../../../rust/bridge/fantasyTerrain';
import { decodeBrushes, type BrushImages } from '../render/brushes';
import { renderScene, type RenderScene } from './renderScene';
import { PassState, ResourceCache, passKeys, type PassInput } from './passes/pass';
import { buildScene, type SceneMask } from '../render/scene';
import { createNativeCityMap } from './nativeCityMap';
import { viewRect } from '../render/view';
import { viewRasterFits, viewRasterRegion, type ViewRasterRegion } from '../render/viewRaster';
import { isResourceDiagnostic } from '../render/displayDiagnostics';
import { resourceOverlayBody, type ResourceSource } from './resourceLayer';

const imageOf = async (svg: string): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { const image = new Image(); image.src = url; await image.decode(); return image; }
  finally { URL.revokeObjectURL(url); }
};
let brushes: Promise<BrushImages | null> | undefined;
export async function paintedBrushes(): Promise<BrushImages | null> {
  return brushes ??= import('../render/assets/brushAssets').then(({ BRUSH_SOURCES }) => decodeBrushes(BRUSH_SOURCES));
}
/** A world-coordinate SVG body as a document rasterizing `region` at its density. */
const svgOf = (body: string, region: ViewRasterRegion): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(region.width * region.density))}" height="${Math.max(1, Math.round(region.height * region.density))}" viewBox="${region.x} ${region.y} ${region.width} ${region.height}" preserveAspectRatio="none">${body}</svg>`;
/** Pixel width of the whole-map renderSvg overlay of exports. */
const EXPORT_OVERLAY_PX = 4096;
const wholeMap = (width: number): ViewRasterRegion => ({ x: 0, y: 0, width, height: width, density: 2048 / width });
/** Resources a live renderer shares with its exports: derived products keyed by revisions, and the native city map. */
export interface SharedPassResources { cache: ResourceCache; city?: { key: string; map: ReturnType<typeof createNativeCityMap> } }
const CARTOGRAPHIC_ONLY_VEGETATION = ['forest', 'meadow', 'marsh', 'commons'];
type BaseRaster = { svg: string; image?: HTMLImageElement };
export class BenchRenderer {
  private surface = document.createElement('canvas');
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
  /** renderSvg overlay of an export (explicit layers), whole map at EXPORT_OVERLAY_PX: used only where it is not stretched. */
  private exportOverlay?:HTMLImageElement;
  /** Terrain raster (CPU relief, sea): natural content, whole map. */
  private base?: HTMLImageElement;
  private terrainSvg = '';
  /** Vector water, hydrology (waterSvg) and frame (frameSvg): world-coordinate SVG body, rasterized per view (render/viewRaster). */
  private waterSvg = '';
  private frameSvg = '';
  private vectors = '';
  private vectorsDirty = false;
  private vectorBase?: { image: HTMLImageElement; region: ViewRasterRegion };
  private vectorView?: { image: HTMLImageElement; region: ViewRasterRegion };
  private vectorRequest?: Promise<void>;
  private backgroundHref?: string;
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
  async set(world: World, settings: V2Settings, r: ResolvedAppearance, layers: Partial<ExportLayers> = {}): Promise<void> {
    const previous = { world: this.world, scene: this.scene, settings: this.settings, resolved: this.resolved, exportLayers: this.exportLayers, gpuActive: this.gpuActive, native: this.native };
    this.settings = settings; this.resolved = r; layers = { ...(r.cartography.roads ? {} : { roads: false }), ...layers }; this.exportLayers = layers;
    const scene = renderScene(world, settings);
    this.world = world; this.scene = scene; this.native = scene.terrain;
    const effective = effectiveTerrainSettings(settings, world.mapSize);
    const effectiveKey = JSON.stringify([effective.relief, effective.refine, effective.detailNoise, effective.climate, effective.climateValues, effective.climateZone, effective.hydrology?.riverMode]);
    const forestKey = JSON.stringify([effective.forest, effective.climateValues]);
    const worldSig = JSON.stringify([world.mapSize, world.seed, world.options.biome]);
    this.input = () => ({ r, revisions: scene.revisions, layers, mode: this.mode(), effective: effectiveKey, forestEffective: forestKey, worldSig });
    this.paper = terrainStyle(r.styleId, r.palette.colors).palette.paper;
    try {
      const ran = await this.passes.run(() => passKeys(this.input()), {
        terrainData: () => this.terrainDataPass(), terrainLook: () => this.terrainLookPass(), forest: () => this.forestPass(), water: () => this.waterPass(),
        frame: () => this.framePass(), cartography: () => this.cartographyPass(), overlays: () => this.overlaysPass(), city: () => this.cityPass() });
      if (this.vectorsDirty) await this.refreshVectors();
      this.stats.passes = ran;
    } catch (error) {
      // Restore the previous renderer state; every pass re-runs next time (a partial update must not look current).
      Object.assign(this, { ...previous, gpuActive: previous.gpuActive && !!this.gpu });
      this.passes.reset(); this.vectorsDirty = false;
      throw error;
    }
    this.stats.style = r.ground.style; this.stats.renderer = this.gpuActive ? 'TerrainGl + CityBench' : 'RustBench raster + CityBench';
  }
  private layers(): any {
    const r = this.resolved!, l = this.exportLayers;
    return { ...r.ground.layers, relief: l.terrain !== false && r.ground.layers.relief, water: l.water !== false && r.ground.layers.water, frame: l.decor !== false && r.ground.layers.frame };
  }
  private waterDisplay(): WaterDisplay {
    const r = this.resolved!, t = this.native!, effective = effectiveTerrainSettings(this.settings!, this.world!.mapSize);
    return { style: r.ground.style, colors: r.palette.colors, showLakes: r.ground.lakes, showOxbows: r.ground.oxbows,
      riverArea: t.water?.riverArea ?? .02, riverMode: effective.hydrology?.riverMode ?? 'vector', overlay: r.diagnostic.startsWith('v-') ? r.diagnostic as VectorOverlay : 'none' };
  }
  private dropBackground(): void { this.backgroundHref = undefined; }
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
        if (!gl) throw new Error('WebGL2 indisponible pour la carte.');
        this.materialContext = { canvas: this.gpuCanvas, gl };
        if (/swiftshader|llvmpipe|software/i.test(name)) {
          this.gpuUnavailable = true; this.stats.gpuFallback = 'Software WebGL material raster on the map context'; return;
        }
        this.gpu = await createTerrainRenderer(this.gpuCanvas, document.createElement('canvas'));
      }
      if (this.uploaded !== t) { this.gpu.setBase({ x: 0, y: 0, width: t.width, n: source.n, data: source.data, cave: source.cave, waterSurface: t.waterSurface }); this.uploaded = t; }
      this.gpuActive = true;
    } catch (error) { this.gpu?.dispose(); this.gpu = undefined; this.uploaded = undefined; this.gpuUnavailable = true; this.stats.gpuFallback = String(error); }
  }
  /** GPU: look uniforms only. CPU: the terrain raster (the only thing re-rasterized). */
  private async terrainLookPass(): Promise<void> {
    this.dropBackground();
    const t = this.native!, world = this.world!, settings = this.settings!, r = this.resolved!, style = r.ground.style, colors = r.palette.colors;
    const effective = effectiveTerrainSettings(settings, world.mapSize), layers = this.layers(), lighting = r.ground.lighting;
    if (this.gpuActive) {
      const source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
      this.terrainSvg = ''; this.base = undefined;
      this.gpu!.setLook({ style, colors, lighting, layers, mapWidth: t.width, climate: climateOf(effective as TerrainSettings), climateZone: effective.climateZone, v2Season: r.ground.season,
        globalMin: t.globalMinHeight, globalMax: t.globalMaxHeight, contours: r.ground.contours && layers.relief, contourStep: effective.relief === 'mountains' ? 40 : effective.relief === 'flat' ? 2 : 10,
        flatRelief: effective.relief === 'flat', refine: effective.refine??true, sourceCell: t.width / source.n, seed: seedHash(world.seed), detail: effective.detailNoise ?? DEFAULT_FRACTAL_DETAIL,
        floor: source.floor ?? 0, frame: layers.frame, background: terrainStyle(style,colors).palette.paper });
      return;
    }
    if (isFantasyStyle(style)) { const {fantasyLibraries}=await import('../render/fantasyBrushAssets');registerFantasyBrushes(fantasyLibraries); }
    const key = passKeys(this.input()).terrainLook;
    // The shared material shader also composes SVG/PNG exports, using an OffscreenCanvas or a page canvas according to WebGL2 availability.
    const cacheKey = `terrain:${key}`;
    const pending = this.shared.cache.get<Promise<BaseRaster>>(cacheKey, async () => {
      const settingsForRender = { ...effective, width: world.mapSize, seed: world.seed, v2Season: r.ground.season, forest: { field: v2DisplayForest(world, settings, r), waterVisible: layers.water } };
      let svg = '';
      if (layers.relief) svg = renderRustTerrain(t, style, layers.frame, settingsForRender, r.ground.contours, 'v2-render', lighting, layers, r.vegetation.fantasy, true, style, colors, this.rasterContext()).svg;
      if (!layers.relief && layers.water && t.globalMinHeight < 0) {
        const sea = seaMaterialSvg(seaDistanceSurface(t, t.width), t.x, t.y, style, t.width, colors);
        svg += `<defs><mask id="v2-water-only"><rect width="${t.width}" height="${t.width}" fill="white"/><path d="${terrainLandClip(t)}" fill="black" fill-rule="evenodd"/></mask></defs><g mask="url(#v2-water-only)">${sea}</g>`;
      }
      return { svg, image: svg ? await imageOf(svgOf(svg, wholeMap(t.width))) : undefined };
    });
    const raster = await pending.catch(error => { this.shared.cache.delete(cacheKey); throw error; });
    this.terrainSvg = raster.svg; this.base = raster.image;
  }
  private forestPass(): void {
    if (!this.gpuActive) return;
    this.dropBackground(); this.gpu!.setForest(v2DisplayForest(this.world!, this.settings!, this.resolved!));
  }
  /** GPU water/overlay textures, plus the vector water and hydrology diagnostics (rasterized per view). */
  private async waterPass(): Promise<void> {
    this.dropBackground();
    const t = this.native!, r = this.resolved!, style = r.ground.style, colors = r.palette.colors, layers = this.layers(), water = this.waterDisplay();
    if (this.gpuActive) {
      if (t.water) {
        this.gpu!.setWater(layers.water ? { lake: water.showLakes ? lakeField(t.water.lake, t.water.hydro.n).values : undefined, n: t.water.hydro.n, rivers: riverSegments(t.water, water) } : undefined);
        this.gpu!.setOverlay(vectorOverlayPixels(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined));
      } else if (t.hydrology) {
        this.gpu!.setWater(layers.water ? { lake: water.showLakes ? t.hydrology.waterField : undefined, shore: 'exact', n: t.hydrology.resolution, rivers: hydrologySegments(t.hydrology, hydrologyWaterColour(style, colors)) } : undefined);
        this.gpu!.setOverlay(undefined);
      } else this.gpu!.setWater(undefined);
    }
    let svg = '';
    if (t.water && layers.water) {
      if (!this.gpuActive || isFantasyStyle(style)) svg += vectorWaterSvg(t.water, water);
      if (!this.gpuActive && water.overlay !== 'none') svg += vectorOverlaySvg(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined);
    }
    if (t.hydrology) {
      const diagnostic = r.diagnostic !== 'none' && !r.diagnostic.startsWith('v-') && r.diagnostic !== 'elevation' && !isResourceDiagnostic(r.diagnostic) ? r.diagnostic as HydrologyOverlay : 'none';
      const hydrology = water.showLakes ? t.hydrology : { ...t.hydrology, lakeOffsets: t.hydrology.lakeOffsets.slice(0, 1), lakePoints: t.hydrology.lakePoints.slice(0, 0) };
      svg += renderHydrology(hydrology, diagnostic, !this.gpuActive && layers.water, style, true, colors);
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
    const svg = this.waterSvg + this.frameSvg;
    if (svg === this.vectors) return;
    const whole = wholeMap(this.native!.width);
    this.vectors = svg; this.vectorView = undefined; this.vectorRequest = undefined;
    this.vectorBase = svg ? { image: await imageOf(svgOf(svg, whole)), region: whole } : undefined;
  }
  private shownWorld(): World {
    const world = this.world!, layers = this.exportLayers, r = this.resolved!;
    // Native city plans and houses are drawn exactly once by CityBench. Natural vegetation, regional roads and names still use the original map renderer.
    const hideUrban = this.scene!.capabilities.nativeCities || layers.city === false;
    return displayWorld(world, { roads: layers.roads, city: hideUrban ? false : undefined }, r.city.visible);
  }
  /** Overlay renderer (names, roads, land use, painted/vegetation symbols); the natural layers it does not own are masked, not faked. */
  private async cartographyPass(): Promise<void> {
    const world = this.world!, r = this.resolved!, layers = this.exportLayers, scene = this.scene!;
    this.cartography?.dispose();
    const shown = this.shownWorld();
    const landuse = layers.landuse !== false && r.cartography.landuse;
    const mask: SceneMask = { water: false, contours: false, landuse: !landuse ? false : r.traits.cartographicVegetation ? true : kind => !CARTOGRAPHIC_ONLY_VEGETATION.includes(kind) };
    const v = scene.revisions, sceneKey = JSON.stringify(['scene', v.roads, v.landuse, v.settlements, v.terrain, v.cities, shown === world, layers.roads, layers.city, r.city.visible, landuse, r.traits.cartographicVegetation, world.mapSize, world.seed, world.options.biome]);
    const built = this.shared.cache.get(sceneKey, () => buildScene(shown, undefined, { mask }));
    const state=this;
    const palette={...biomePalette(r.palette.mapStyle,world.options.biome),frameKind:'none' as const,...(layers.decor===false?{grid:null}:{})};
    this.cartography = createCanvasRenderer(this.overlay, shown, palette, { colors: r.palette.colors, transparentBackground: true, terrain: () => null, scene: built, mask,
      brushes: r.cartography.painted ? await paintedBrushes() ?? undefined : undefined, vegetation: r.vegetation.symbols, get dpr() { return state.dpr; } });
    this.passes.reset('overlays');
  }
  /** Labels, legend and cartouche on the overlay renderer; the explicit-layers export raster. */
  private async overlaysPass(): Promise<void> {
    const r = this.resolved!, layers = this.exportLayers;
    this.cartography!.setOverlays({ labels: layers.labels !== false && r.cartography.labels, legend: layers.decor !== false && r.cartography.legend, cartouche: layers.decor !== false && r.cartography.cartouche });
    this.exportOverlay = undefined;
    if (Object.keys(layers).length === 0) return;
    const sources=r.cartography.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
    const svg=renderSvg(this.shownWorld(),{width:EXPORT_OVERLAY_PX,style:r.palette.mapStyle,colors:r.palette.colors,buildings:r.city.visible,layers:{...layers,background:false,terrain:false,water:false},contours:false,landuse:layers.landuse!==false&&r.cartography.landuse,landuseKinds:r.traits.cartographicVegetation?undefined:kind=>!CARTOGRAPHIC_ONLY_VEGETATION.includes(kind),labels:r.cartography.labels,legend:r.cartography.legend,cartouche:r.cartography.cartouche,brushes:sources,vegetation:r.vegetation.symbols});
    const document=new DOMParser().parseFromString(svg,'image/svg+xml');document.querySelectorAll('.layer-decor').forEach(frame=>frame.remove());
    this.exportOverlay=await imageOf(new XMLSerializer().serializeToString(document.documentElement));
  }
  /** Native city plans/houses: rebuilt per city products only; the city appearance is read per frame (draw). */
  private cityPass(): void {
    const v = this.scene!.revisions, key = JSON.stringify([v.cities, v.settlements, v.terrain]), shared = this.shared;
    if (shared.city?.key === key) { this.city = shared.city.map; return; }
    const map = createNativeCityMap(this.world!, this.invalidate);
    if (this.ownsShared) { shared.city?.map.dispose(); shared.city = { key, map }; } else { this.exportCity?.dispose(); this.exportCity = map; }
    this.city = map;
  }
  draw(view: View, w: number, h: number, dpr: number): HTMLCanvasElement {
    const canvas = this.surface, r = this.resolved!, size = this.world!.mapSize;
    this.dpr = dpr; const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);if(canvas.width!==pixelW)canvas.width=pixelW;if(canvas.height!==pixelH)canvas.height=pixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.exportLayers.background !== false) { ctx.fillStyle = this.paper; ctx.fillRect(0, 0, w, h); }
    if (this.gpuActive) { this.gpu!.setView(view, w, h); this.gpu!.redrawForCapture(); ctx.drawImage(terrainRendererCanvas(this.gpu!, this.gpuCanvas), 0, 0, w, h); }
    ctx.save(); ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale); ctx.scale(view.scale, view.scale);
    if (this.base) ctx.drawImage(this.base, 0, 0, size, size);
    const vectors = this.vectorRaster(view, w, h, dpr);
    if (vectors) ctx.drawImage(vectors.image, vectors.region.x, vectors.region.y, vectors.region.width, vectors.region.height);
    // The export overlay is one whole-map raster: only where it is at least as fine as the frame.
    const overlay = this.exportOverlay && view.scale * dpr * size <= this.exportOverlay.naturalWidth * 1.01 ? this.exportOverlay : undefined;
    if (overlay) ctx.drawImage(overlay, 0, 0, size, size);
    ctx.restore();
    if (!overlay && this.cartography) { this.overlay.width = canvas.width; this.overlay.height = canvas.height; this.cartography.draw(view); ctx.drawImage(this.overlay, 0, 0, w, h); }
    if (this.exportLayers.city !== false||this.exportLayers.streets!==false) this.stats.city = this.city?.draw(ctx, view, w, h, dpr, r, this.exportLayers);
    return canvas;
  }
  /** The vector raster for this frame: the view raster when it fits, else the whole-map one while a
   * view raster at the frame's density is prepared (the frame is redrawn when it is ready). */
  private vectorRaster(view: View, w: number, h: number, dpr: number): { image: HTMLImageElement; region: ViewRasterRegion } | undefined {
    if (!this.vectors) return undefined;
    const size = this.world!.mapSize, rect = viewRect(view, w, h), density = view.scale * dpr;
    if (viewRasterFits(this.vectorView?.region, rect, density, size)) return this.vectorView;
    if (viewRasterFits(this.vectorBase?.region, rect, density, size, Infinity)) return this.vectorBase;
    void this.requestVectors(viewRasterRegion(rect, density, size));
    return this.vectorView && viewRasterFits({ ...this.vectorView.region, density }, rect, density, size) ? this.vectorView : this.vectorBase;
  }
  private requestVectors(region: ViewRasterRegion): Promise<void> {
    if (this.vectorRequest) return this.vectorRequest;
    const vectors = this.vectors;
    const request: Promise<void> = imageOf(svgOf(vectors, region)).then(image => {
      if (this.disposed || this.vectors !== vectors) return;
      this.vectorView = { image, region }; this.invalidate();
    }, () => undefined).finally(() => { if (this.vectorRequest === request) this.vectorRequest = undefined; });
    return this.vectorRequest = request;
  }
  /** The terrain-pass capture for the 3D ground; rebuilt only after a terrain/water/frame pass ran. */
  backgroundUrl(): string | undefined {
    if (!this.backgroundHref) {
      if (this.gpuActive) this.backgroundHref = this.gpu!.captureMap(1024).toDataURL('image/png');
      else if (this.terrainSvg || this.vectors) this.backgroundHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(this.terrainSvg + this.vectors, wholeMap(this.native!.width)))}`;
    }
    return this.backgroundHref;
  }
  async capture(size: number, layers?: Partial<ExportLayers>): Promise<HTMLCanvasElement> {
    if (layers) await this.set(this.world!, this.settings!, this.resolved!, layers);
    if (this.gpuActive) await this.gpu!.variantReady();   // draw() is synchronous: it would create a missing pipeline in place
    const view = { cx: this.world!.mapSize / 2, cy: this.world!.mapSize / 2, scale: size / this.world!.mapSize };
    // Vectors at the export density before the synchronous draw.
    if (this.vectors && !viewRasterFits(this.vectorView?.region, viewRect(view, size, size), view.scale, this.world!.mapSize)
      && !viewRasterFits(this.vectorBase?.region, viewRect(view, size, size), view.scale, this.world!.mapSize, Infinity)) {
      await this.vectorRequest; await this.requestVectors(viewRasterRegion(viewRect(view, size, size), view.scale, this.world!.mapSize));
    }
    return this.draw(view, size, size, 1);
  }
  dispose(): void { this.disposed = true; this.gpu?.dispose(); this.cartography?.dispose(); this.exportCity?.dispose(); if(this.ownsShared){this.shared.city?.map.dispose();this.shared.cache.clear();} if(this.ownsMaterialContext)this.materialContext?.gl.getExtension('WEBGL_lose_context')?.loseContext();this.materialContext=undefined;this.world = undefined; }
}
