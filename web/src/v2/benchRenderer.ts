/** Display adapters for the retained RustBench terrain and CityBench geometry.
 * No generation entry point is imported here. The original Canvas renderer remains available. */
import type { MaterialRasterContext } from '../../../rust/bridge/terrainMaterialContext';
import type { World } from '../gen/types';
import type { V2Settings, V2Appearance } from './contracts';
import type { V2TerrainLayer } from './terrainProjection';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import { isMapStyle } from '../render/styles';
import { displayWorld } from '../render/displayWorld';
import { v2DisplayForest } from './displayForest';
import { biomePalette } from '../render/biomes';
import { terrainStyle, type TerrainStyle } from '../render/terrainStyle';
import { DEFAULT_TERRAIN_LIGHTING, DEFAULT_TERRAIN_LAYERS } from '../render/terrainLighting';
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
import { registerFantasyBrushes, DEFAULT_FANTASY_OPTIONS, isFantasyStyle } from '../../../rust/bridge/fantasyTerrain';
import { decodeBrushes, type BrushImages } from '../render/brushes';
import { terrainFromDecor } from '../ui/benchTerrainTransfer';
import { v2WorldDecor } from './urban3d';
import { createNativeCityMap } from './nativeCityMap';
import { viewRect } from '../render/view';
import { viewRasterFits, viewRasterRegion, type ViewRasterRegion } from '../render/viewRaster';

export function usesBenchRenderer(world: World | undefined, settings: V2Settings): boolean {
  if (settings.appearance?.renderer === 'classic') return false;
  return settings.appearance?.renderer === 'bench' || !!settings.appearance?.terrainStyle
    || !!world?.debug?.v2RustCities;
}
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
export class BenchRenderer {
  private surface = document.createElement('canvas');
  private overlay = document.createElement('canvas');
  private gpuCanvas = document.createElement('canvas');
  private gpu?: TerrainRenderer;
  private gpuUnavailable = false;
  private world?: World;
  private settings?: V2Settings;
  private native?: TerrainData;
  private city?: ReturnType<typeof createNativeCityMap>;
  private cartography?: CanvasRenderer;
  /** renderSvg overlay of an export (explicit layers), whole map at EXPORT_OVERLAY_PX: used only where it is not stretched. */
  private exportOverlay?:HTMLImageElement;
  /** Terrain raster (CPU relief, sea): natural content, whole map. */
  private base?: HTMLImageElement;
  /** Vector water, hydrology and frame (world-coordinate SVG body), rasterized per view (render/viewRaster). */
  private vectors = '';
  private vectorBase?: { image: HTMLImageElement; region: ViewRasterRegion };
  private vectorView?: { image: HTMLImageElement; region: ViewRasterRegion };
  private vectorRequest?: Promise<void>;
  private backgroundHref?: string;
  private uploaded?:TerrainData;
  private baseKey = '';
  private overlayKey = '';
  private dpr = 1;
  private gpuActive = false;
  private exportLayers: Partial<ExportLayers> = {};
  private disposed = false;
  readonly stats: Record<string, unknown> = {};
  constructor(private invalidate: () => void,rasterOnly=false, private materialContext?: MaterialRasterContext) {this.gpuUnavailable=rasterOnly;this.ownsMaterialContext=!materialContext;}
  private ownsMaterialContext: boolean;
  rasterContext(): MaterialRasterContext | undefined { return this.materialContext?.gl.isContextLost() ? undefined : this.materialContext; }
  async set(world: World, settings: V2Settings, layers: Partial<ExportLayers> = {}): Promise<void> {
    const changed = this.world !== world, exporting = Object.keys(layers).length > 0;
    const previous = { settings: this.settings, layers: this.exportLayers, gpuActive: this.gpuActive };
    this.settings = settings; layers = { ...(settings.appearance?.roads === false ? { roads: false } : {}), ...layers }; this.exportLayers = layers;
    if (changed) {
      this.world = world;
      this.native = (world.terrain as V2TerrainLayer).v2NativeTerrain ?? terrainFromDecor(v2WorldDecor(world, settings));
      this.city?.dispose(); this.city = createNativeCityMap(world, this.invalidate);
      this.baseKey = ''; this.overlayKey = '';
    }
    const a = settings.appearance ?? { style: settings.options.style }, style = a.diagnostic === 'elevation' ? 'copernicus' : a.terrainStyle ?? a.style;
    const terrainColors = a.colors && Object.fromEntries(['paper', 'groundLow', 'groundHigh', 'contour', 'waterShore', 'waterDeep', 'river'].map(key => [key, a.colors![key as keyof NonNullable<V2Appearance['colors']>]]));
    const baseKey = JSON.stringify([style, terrainColors, a.forest, a.contours, a.lighting, a.terrainLayers, a.season, a.fantasy, a.diagnostic, a.lakes, a.oxbows, layers.background, layers.terrain, layers.water,layers.decor]);
    if (baseKey !== this.baseKey) {
      try { await this.prepareBase(style, a); this.baseKey = baseKey; }
      catch (error) {
        if (!changed) { this.settings = previous.settings; this.exportLayers = previous.layers; this.gpuActive = previous.gpuActive && !!this.gpu; }
        throw error;
      }
    }
    const overlayKey = JSON.stringify([style,a.style, a.colors, a.roads, a.buildings, a.landuse, a.labels, a.legend, a.cartouche, a.painted, a.vegetation, layers]);
    if (overlayKey !== this.overlayKey) {
      this.cartography?.dispose();
      const nativeCities = !!world.debug?.v2RustCities;
      // Native city plans and houses are drawn exactly once by CityBench. Natural
      // vegetation, regional roads and names still use the original map renderer.
      const displayed = displayWorld(world, undefined, a.buildings);
      const urban = nativeCities || layers.city === false ? undefined : displayed.urban;
      const noWater = new Uint8Array(world.terrain.water.length);
      const shown: World = { ...world, options: { ...world.options, contours: false, landuse: layers.landuse !== false && (a.landuse ?? true), labels: layers.labels !== false && (a.labels ?? true) },
        terrain: { ...world.terrain, coastline: [], islands: [], lakes: [], rivers: [], water: noWater, seaFraction: 0, seaSide: null },
        roads: layers.roads === false ? undefined : world.roads, urban,
        settlements: displayed.settlements?.map(place => nativeCities || layers.city === false ? { ...place, urban: undefined } : place) };
      if(!isMapStyle(style)&&shown.landuse)shown.landuse={...shown.landuse,areas:shown.landuse.areas.filter(area=>!['forest','meadow','marsh','commons'].includes(area.kind))};
      const state=this;
      const palette={...biomePalette(a.style,world.options.biome),frameKind:'none' as const,...(layers.decor===false?{grid:null}:{})};
      this.cartography = createCanvasRenderer(this.overlay, shown, palette, { colors: a.colors, transparentBackground: true, terrain: () => null,
        brushes: a.painted ? await paintedBrushes() ?? undefined : undefined, vegetation: a.vegetation ?? 'canopy', get dpr() { return state.dpr; } });
      this.cartography.setOverlays({ labels: layers.labels !== false && (a.labels ?? true), legend: layers.decor !== false && (a.legend ?? false), cartouche: layers.decor !== false && (a.cartouche ?? false) });
      this.exportOverlay=undefined;
      if(exporting){
        const sources=a.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
        const svg=renderSvg({...shown,terrain:world.terrain},{width:EXPORT_OVERLAY_PX,style:a.style,colors:a.colors,buildings:a.buildings,layers:{...layers,background:false,terrain:false,water:false},contours:false,landuse:a.landuse??true,labels:a.labels??true,legend:a.legend??false,cartouche:a.cartouche??false,brushes:sources,vegetation:a.vegetation});
        const document=new DOMParser().parseFromString(svg,'image/svg+xml');document.querySelectorAll('.layer-decor').forEach(frame=>frame.remove());
        this.exportOverlay=await imageOf(new XMLSerializer().serializeToString(document.documentElement));
      }
      this.overlayKey = overlayKey;
    }
    this.stats.style = style; this.stats.renderer = this.gpuActive ? 'TerrainGl + CityBench' : 'RustBench raster + CityBench';
  }
  private async prepareBase(style: TerrainStyle, a: V2Appearance): Promise<void> {
    const t = this.native!, world = this.world!, settings = this.settings!;
    const effective = effectiveTerrainSettings(settings, world.mapSize);
    const lighting = { ...DEFAULT_TERRAIN_LIGHTING, ...a.lighting };
    const layers = { ...DEFAULT_TERRAIN_LAYERS, ...a.terrainLayers,
      relief: this.exportLayers.terrain !== false && (a.terrainLayers?.relief ?? true), water: this.exportLayers.water !== false && (a.terrainLayers?.water ?? true),frame:this.exportLayers.decor!==false&&(a.terrainLayers?.frame??true) };
    const water: WaterDisplay = { style, colors: a.colors, showLakes: a.lakes ?? true, showOxbows: a.oxbows ?? true,
      riverArea: t.water?.riverArea ?? .02, riverMode: effective.hydrology?.riverMode ?? 'vector', overlay: a.diagnostic?.startsWith('v-') ? a.diagnostic as VectorOverlay : 'none' };
    const source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
    const settingsForRender = { ...effective, width: world.mapSize, seed: world.seed, v2Season: a.season ?? .5,
      forest: { field: v2DisplayForest(world, settings),waterVisible:layers.water } };
    this.gpuActive = false;
    if (layers.relief&&!isFantasyStyle(style) && !this.gpuUnavailable) {
      try {
        if (!this.gpu) {
          const gl = this.gpuCanvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
          const extension = gl?.getExtension('WEBGL_debug_renderer_info');
          const name = extension ? String(gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
          if (!gl) throw new Error('WebGL2 indisponible pour la carte.');
          this.materialContext = { canvas: this.gpuCanvas, gl };
          if (/swiftshader|llvmpipe|software/i.test(name)) {
            this.gpuUnavailable = true; this.stats.gpuFallback = 'Software WebGL material raster on the map context';
          } else this.gpu = await createTerrainRenderer(this.gpuCanvas, document.createElement('canvas'));
        }
        if (this.gpu) {
        if(this.uploaded!==t){this.gpu.setBase({ x: 0, y: 0, width: t.width, n: source.n, data: source.data, cave: source.cave, waterSurface: t.waterSurface });this.uploaded=t;}
        this.gpu.setLook({ style, colors: a.colors, lighting, layers, mapWidth: t.width, climate: climateOf(effective as TerrainSettings), climateZone: effective.climateZone, v2Season: a.season ?? .5,
          globalMin: t.globalMinHeight, globalMax: t.globalMaxHeight, contours: (a.contours ?? true) && layers.relief, contourStep: effective.relief === 'mountains' ? 40 : effective.relief === 'flat' ? 2 : 10,
          flatRelief: effective.relief === 'flat', refine: effective.refine??true, sourceCell: t.width / source.n, seed: seedHash(world.seed), detail: effective.detailNoise ?? DEFAULT_FRACTAL_DETAIL,
          floor: source.floor ?? 0, frame: layers.frame, background: terrainStyle(style,a.colors).palette.paper });
        this.gpu.setForest(v2DisplayForest(world, settings));
        if (t.water) {
          this.gpu.setWater(layers.water ? { lake: water.showLakes ? lakeField(t.water.lake, t.water.hydro.n).values : undefined, n: t.water.hydro.n, rivers: riverSegments(t.water, water) } : undefined);
          this.gpu.setOverlay(vectorOverlayPixels(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined));
        } else if (t.hydrology) {
          this.gpu.setWater(layers.water ? { lake: water.showLakes ? t.hydrology.waterField : undefined, shore: 'exact', n: t.hydrology.resolution, rivers: hydrologySegments(t.hydrology, hydrologyWaterColour(style, a.colors)) } : undefined);
          this.gpu.setOverlay(undefined);
        } else this.gpu.setWater(undefined);
        this.gpuActive = true;
        }
      } catch (error) { this.gpu?.dispose(); this.gpu = undefined; this.gpuUnavailable = true; this.stats.gpuFallback = String(error); }
    }
    if(isFantasyStyle(style)){const {fantasyLibraries}=await import('../render/fantasyBrushAssets');registerFantasyBrushes(fantasyLibraries);}
    // The shared material shader also composes SVG/PNG exports, using an
    // OffscreenCanvas or a page canvas according to WebGL2 availability.
    let svg = '';
    if (!this.gpuActive&&layers.relief) svg = renderRustTerrain(t, style, layers.frame, settingsForRender, a.contours ?? true, 'v2-render', lighting, layers, { ...DEFAULT_FANTASY_OPTIONS, ...a.fantasy }, true, style, a.colors, this.rasterContext()).svg;
    if(!layers.relief&&layers.water&&t.globalMinHeight<0){
      const sea=seaMaterialSvg(seaDistanceSurface(t,t.width),t.x,t.y,style,t.width,a.colors);
      svg+=`<defs><mask id="v2-water-only"><rect width="${t.width}" height="${t.width}" fill="white"/><path d="${terrainLandClip(t)}" fill="black" fill-rule="evenodd"/></mask></defs><g mask="url(#v2-water-only)">${sea}</g>`;
    }
    // Everything below is vector content: it is rasterized for the view, never stretched from one map raster.
    const terrain = svg; svg = '';
    if (t.water && layers.water) {
      if (!this.gpuActive || isFantasyStyle(style)) svg += vectorWaterSvg(t.water, water);
      if (!this.gpuActive&&water.overlay !== 'none') svg += vectorOverlaySvg(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined);
    }
    if (t.hydrology) {
      const diagnostic = a.diagnostic && !a.diagnostic.startsWith('v-') && a.diagnostic !== 'elevation' ? a.diagnostic as HydrologyOverlay : 'none';
      const hydrology=water.showLakes?t.hydrology:{...t.hydrology,lakeOffsets:t.hydrology.lakeOffsets.slice(0,1),lakePoints:t.hydrology.lakePoints.slice(0,0)};
      svg += renderHydrology(hydrology, diagnostic, !this.gpuActive && layers.water, style, true, a.colors);
    }
    if(!layers.relief&&layers.frame)svg+=`<rect width="${t.width}" height="${t.width}" fill="none" stroke="${terrainStyle(style,a.colors).palette.frame}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
    const whole:ViewRasterRegion={x:0,y:0,width:t.width,height:t.width,density:2048/t.width};
    this.base = terrain ? await imageOf(svgOf(terrain,whole)) : undefined;
    this.vectors = svg; this.vectorView = undefined; this.vectorRequest = undefined;
    this.vectorBase = svg ? { image: await imageOf(svgOf(svg,whole)), region: whole } : undefined;
    const documentSvg=svgOf(terrain+svg,whole);
    this.backgroundHref=!this.gpuActive&&(terrain||svg)?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(documentSvg)}`:undefined;
  }
  draw(view: View, w: number, h: number, dpr: number): HTMLCanvasElement {
    const canvas = this.surface, a = this.settings!.appearance ?? { style: this.settings!.options.style }, size = this.world!.mapSize;
    this.dpr = dpr; const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);if(canvas.width!==pixelW)canvas.width=pixelW;if(canvas.height!==pixelH)canvas.height=pixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.exportLayers.background !== false) { ctx.fillStyle = terrainStyle(a.terrainStyle ?? a.style,a.colors).palette.paper; ctx.fillRect(0, 0, w, h); }
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
    if (this.exportLayers.city !== false||this.exportLayers.streets!==false) this.stats.city = this.city?.draw(ctx, view, w, h, dpr, a,this.exportLayers);
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
  backgroundUrl(): string | undefined { if(!this.backgroundHref&&this.gpuActive)this.backgroundHref=this.gpu!.captureMap(1024).toDataURL('image/png');return this.backgroundHref; }
  async capture(size: number, layers?: Partial<ExportLayers>): Promise<HTMLCanvasElement> {
    if (layers) await this.set(this.world!, this.settings!, layers);
    if (this.gpuActive) await this.gpu!.variantReady();   // draw() is synchronous: it would create a missing pipeline in place
    const view = { cx: this.world!.mapSize / 2, cy: this.world!.mapSize / 2, scale: size / this.world!.mapSize };
    // Vectors at the export density before the synchronous draw.
    if (this.vectors && !viewRasterFits(this.vectorView?.region, viewRect(view, size, size), view.scale, this.world!.mapSize)
      && !viewRasterFits(this.vectorBase?.region, viewRect(view, size, size), view.scale, this.world!.mapSize, Infinity)) {
      await this.vectorRequest; await this.requestVectors(viewRasterRegion(viewRect(view, size, size), view.scale, this.world!.mapSize));
    }
    return this.draw(view, size, size, 1);
  }
  dispose(): void { this.disposed = true; this.gpu?.dispose(); this.cartography?.dispose(); this.city?.dispose(); if(this.ownsMaterialContext)this.materialContext?.gl.getExtension('WEBGL_lose_context')?.loseContext();this.materialContext=undefined;this.world = undefined; }
}
