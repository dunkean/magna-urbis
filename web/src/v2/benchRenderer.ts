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
import { roadGroundTones, setRoadGround } from '../render/roadStyle';
import { displayWorld } from '../render/displayWorld';
import { v2DisplayForest, v2ForestOccupation } from './displayForest';
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
import { lakeField } from '../ui/lakeGeometry';
import { riverSegments, vectorWaterSvg, vectorOverlaySvg, vectorOverlayPixels, type WaterDisplay, type VectorOverlay } from '../ui/vectorWaterRender';
import { renderHydrology, hydrologySegments, hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import type { HydrologyOverlay } from '../../../rust/bridge/hydrology';
import { registerFantasyBrushes, isFantasyStyle, renderFantasyTerrain } from '../../../rust/bridge/fantasyTerrain';
import { decodeBrushes, type BrushImages } from '../render/brushes';
import { renderScene, type RenderScene } from './renderScene';
import { PassState, ResourceCache, passKeys, type PassInput } from './passes/pass';
import { buildScene, type SceneMask } from '../render/scene';
import { createNativeCityMap, type NativeCityHooks } from './nativeCityMap';
import { drawRuralSemantic, drawUrbanSemantic, ruralSemanticLegend, urbanSemanticLegend } from '../render/semanticLayer';
import type { SemanticLook } from '../render/composition';
import type { SemanticLegendEntry } from '../render/legend';
import type { CityScene } from '../render/cityCanvas';
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
/** `svg`: the terrain of the 3D background; `image`: the 2D base, with the crowns of a hidden relief. */
type BaseRaster = { svg: string; image?: HTMLImageElement };
export class BenchRenderer {
  private surface = document.createElement('canvas');
  private miniature = document.createElement('canvas');
  /** Live GPU ground and transparent CPU overlays are composed by the browser. */
  readonly element = document.createElement('div');
  private liveGround?: HTMLCanvasElement;
  private liveWidth = 0;
  private liveHeight = 0;
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
  /** renderSvg overlay of an export (explicit layers), whole map at EXPORT_OVERLAY_PX: used only where it is not stretched. */
  private exportOverlay?:HTMLImageElement;
  /** Physical land use of an export when a rural semantic look is on: drawn under the semantics, the rest of the overlay above. */
  private exportGround?:HTMLImageElement;
  /** Terrain raster (CPU relief, sea): natural content, whole map. */
  private base?: HTMLImageElement;
  private terrainSvg = '';
  /** Vector water, hydrology (waterSvg) and frame (frameSvg): world-coordinate SVG body, rasterized per view (render/viewRaster). */
  private waterSvg = '';
  private landRaster?: { terrain: TerrainData; raster: SettlementRaster };
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
    this.element.className = 'viewer-direct';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
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
    setRoadGround(world.landuse, world.mapSize, roadGroundTones(r.ground.traits.family === 'material', biomePalette(r.palette.mapStyle, world.options.biome)), r.composition.ambience === 'night');
    const effective = effectiveTerrainSettings(settings, world.mapSize);
    const effectiveKey = JSON.stringify([effective.relief, effective.refine, effective.detailNoise, effective.climate, effective.climateValues, effective.climateZone, effective.hydrology?.riverMode]);
    const forestKey = JSON.stringify([effective.forest, effective.climateValues]);
    const worldSig = JSON.stringify([world.mapSize, world.seed, world.options.biome]);
    this.input = () => ({ r, revisions: scene.revisions, layers, mode: this.mode(), effective: effectiveKey, forestEffective: forestKey, worldSig });
    this.paper = terrainStyle(r.styleId, r.palette.colors).palette.paper;
    try {
      const ran = await this.passes.run(() => passKeys(this.input()), {
        terrainData: () => this.terrainDataPass(), terrainLook: () => this.terrainLookPass(), forest: () => this.forestPass(), water: () => this.waterPass(),
        frame: () => this.framePass(), cartography: () => this.cartographyPass(), overlays: () => this.overlaysPass(), semantic: () => this.semanticPass(), city: () => this.cityPass() });
      if (this.gpuActive) await this.gpu!.variantReady();
      if (this.vectorsDirty) await this.refreshVectors();
      this.stats.passes = ran;
    } catch (error) {
      // Restore the previous renderer state; every pass re-runs next time (a partial update must not look current).
      Object.assign(this, { ...previous, gpuActive: previous.gpuActive && !!this.gpu });
      this.passes.reset(); this.vectorsDirty = false;
      throw error;
    }
    this.stats.style = r.ground.style; this.stats.renderer = this.gpuActive ? 'TerrainGl + CityBench' : 'RustBench raster + CityBench';
    this.stats.terrainBackend = this.gpuActive ? terrainRendererBackend(this.gpu!) : 'cpu';
  }
  private layers(): any {
    const r = this.resolved!, l = this.exportLayers;
    return { ...r.ground.layers, relief: l.terrain !== false && r.ground.layers.relief, water: l.water !== false && r.ground.layers.water, frame: l.decor !== false && r.ground.layers.frame };
  }
  private waterDisplay(): WaterDisplay {
    const r = this.resolved!, t = this.native!, effective = effectiveTerrainSettings(this.settings!, this.world!.mapSize);
    return { style: r.ground.traits.fantasy && r.composition.networks.water.look === 'natural' ? 'render3d' : r.ground.style, colors: r.palette.colors, showLakes: r.ground.lakes, showOxbows: r.ground.oxbows,
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
    this.vectorsDirty=true;
    const t = this.native!, world = this.world!, settings = this.settings!, r = this.resolved!, style = r.ground.style, colors = r.palette.colors;
    const effective = effectiveTerrainSettings(settings, world.mapSize), layers = this.layers(), lighting = r.ground.lighting;
    if (this.gpuActive) {
      const source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
      this.terrainSvg = ''; this.base = undefined;
      this.gpu!.setLook({ style, colors, lighting, layers, groundCover:r.composition.vegetation.procedural, ambience:r.composition.ambience,waterLook:r.composition.networks.water.look,waterStyle:r.composition.networks.water.look==='ink'?r.palette.mapStyle:undefined, independentCanopy: true, mapWidth: t.width, climate: climateOf(effective as TerrainSettings), climateZone: effective.climateZone, v2Season: r.ground.season,
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
      const settingsForRender = { ...effective, width: world.mapSize, seed: world.seed, v2Season: r.ground.season, forest: { field: v2DisplayForest(world, settings, r), occupation: v2ForestOccupation(world), groundCover:r.composition.vegetation.procedural, waterVisible: layers.water } };
      let svg = '';
      const waterStyle=r.composition.networks.water.look==='natural'?'render3d':r.palette.mapStyle;
      if (layers.relief) svg = renderRustTerrain(t, style, layers.frame, settingsForRender, r.ground.contours, 'v2-render', lighting, layers, r.vegetation.fantasy, true, waterStyle, colors, this.rasterContext()).svg;
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
      return { svg, image: svg + crowns ? await imageOf(svgOf(svg + crowns, wholeMap(t.width))) : undefined };
    });
    const raster = await pending.catch(error => { this.shared.cache.delete(cacheKey); throw error; });
    this.terrainSvg = raster.svg; this.base = raster.image;
  }
  private forestPass(): void {
    if (!this.gpuActive) return;
    this.dropBackground(); this.gpu!.setForest(v2DisplayForest(this.world!, this.settings!, this.resolved!), v2ForestOccupation(this.world!));
  }
  /** The parchment tints multiply over the lit ground: the overlay gets it as a backdrop, transparent on the water below. */
  private landBackdrop(): HTMLCanvasElement | null {
    const t = this.native, r = this.resolved!;
    if (!t || r.composition.variant !== 'parchment' || !r.ground.layers.relief) return null;
    if (this.landRaster?.terrain !== t) this.landRaster = { terrain: t, raster: settlementRaster(t) };
    const water = this.waterDisplay(), rivers = !r.composition.networks.water.visible ? undefined : t.water ? riverSegments(t.water, water) : t.hydrology ? hydrologySegments(t.hydrology, hydrologyWaterColour(r.ground.style, r.palette.colors)) : undefined;
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
        this.gpu!.setWater(visible ? { lake: water.showLakes ? lakeField(t.water.lake, t.water.hydro.n).values : undefined, n: t.water.hydro.n, rivers: riverSegments(t.water, water) } : undefined);
        this.gpu!.setOverlay(vectorOverlayPixels(t.water, water.overlay, t.conditioning?.delta ? { values: t.conditioning.delta, n: t.conditioning.n } : undefined));
      } else if (t.hydrology) {
        this.gpu!.setWater(visible ? { lake: water.showLakes ? t.hydrology.waterField : undefined, shore: 'exact', n: t.hydrology.resolution, rivers: hydrologySegments(t.hydrology, hydrologyWaterColour(style, colors)) } : undefined);
        this.gpu!.setOverlay(undefined);
      } else this.gpu!.setWater(undefined);
    }
    let svg = '';
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
  }
  private shownWorld(): World {
    const world = this.world!, layers = this.exportLayers, r = this.resolved!;
    // Native city plans and houses are drawn exactly once by CityBench. Natural vegetation, regional roads and names still use the original map renderer.
    const hideUrban = this.scene!.capabilities.nativeCities || layers.city === false;
    return displayWorld(world, { roads: layers.roads, city: hideUrban ? false : undefined }, r.city.visible);
  }
  /** Land classes the vector overlay paints. A material ground draws the physical land use in its shader, so the overlay keeps only the vegetation symbols asked for. */
  private overlayLandKinds(): true | ((kind: LandKind) => boolean) {
    const r = this.resolved!, symbols = r.composition.vegetation.cartographic;
    if (r.ground.traits.family === 'material') return kind => symbols && CARTOGRAPHIC_ONLY_VEGETATION.includes(kind);
    return symbols ? true : kind => !CARTOGRAPHIC_ONLY_VEGETATION.includes(kind);
  }
  /** Overlay renderer (names, roads, land use, painted/vegetation symbols); the natural layers it does not own are masked, not faked. */
  private async cartographyPass(): Promise<void> {
    const world = this.world!, r = this.resolved!, layers = this.exportLayers, scene = this.scene!;
    // Before the dispose: 3D tiles may paint through the current renderer during this wait.
    const brushes = r.cartography.painted ? await paintedBrushes() ?? undefined : undefined;
    this.cartography?.dispose();
    const shown = this.shownWorld();
    const landuse = layers.landuse !== false && r.cartography.landuse;
    // The physical land use keeps its own vegetation drawing only where the composition asks for it on the vector overlay; the semantic layer is separate (hook below).
    const cartographic = r.composition.vegetation.cartographic;
    const mask: SceneMask = { water: false, contours: false, landuse: !landuse ? false : this.overlayLandKinds() };
    const v = scene.revisions, sceneKey = JSON.stringify(['scene', r.ground.traits.family, v.roads, v.landuse, v.settlements, v.terrain, v.cities, shown === world, layers.roads, layers.city, r.city.visible, landuse, cartographic, world.mapSize, world.seed, world.options.biome]);
    const built = this.shared.cache.get(sceneKey, () => buildScene(shown, undefined, { mask }));
    const state=this;
    const palette={...biomePalette(r.palette.mapStyle,world.options.biome),frameKind:'none' as const,...(layers.decor===false?{grid:null}:{})};
    this.cartography = createCanvasRenderer(this.overlay, shown, palette, { colors: r.palette.colors, separateText: true, textSources: () => this.city?.scenes(), transparentBackground: true, terrain: () => this.landBackdrop(), scene: built, mask, roadLook: r.composition.networks.roads.look, roadStyle: () => { const c = this.resolved!.composition; return { look: c.networks.roads.look, emphasis: c.networks.roads.emphasis, night: c.ambience === 'night', colors: this.resolved!.palette.colors }; },
      // Read per frame: a new look repaints the raster tiles through `key`, never the cartography pass.
      semantic: { key: () => this.semantic?.key ?? '', draw: (ctx, rect, mpp) => this.paintRural(ctx, rect, mpp), legend: () => this.semanticLegend() },
      brushes, vegetation: r.vegetation.symbols, get dpr() { return state.dpr; } });
    const renderer = this.cartography;
    this.physical = { key: passKeys(this.input()).cartography, paint: (target, box) => renderer.drawGround(target, box) };
    this.passes.reset('overlays');
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
  private paintRural(ctx: CanvasRenderingContext2D, viewport: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number): void {
    const s = this.semantic;
    if (s && s.rural !== 'off') drawRuralSemantic(ctx, this.world?.landuse, { look: s.rural, opacity: s.opacity, mpp, viewport, classes: s.classes });
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
  private cityPass(): void {
    const v = this.scene!.revisions, key = JSON.stringify([v.cities, v.settlements, v.terrain]), shared = this.shared;
    if (shared.city?.key === key) { this.city = shared.city.map; return; }
    const map = createNativeCityMap(this.world!, this.invalidate);
    if (this.ownsShared) { shared.city?.map.dispose(); shared.city = { key, map }; } else { this.exportCity?.dispose(); this.exportCity = map; }
    this.city = map;
  }
  /** Capture/export only: combines the layers into a single raster. */
  draw(view: View, w: number, h: number, dpr: number, canvas = this.surface): HTMLCanvasElement {
    return this.drawInto(canvas, view, w, h, dpr, false);
  }
  drawMini(size: number): HTMLCanvasElement {
    const width = this.world!.mapSize;
    return this.draw({ cx: width / 2, cy: width / 2, scale: size / width }, size, size, 1, this.miniature);
  }
  /** No GPU readback, intermediate bitmap or full-frame copy in the live display path. */
  drawLive(view: View, w: number, h: number, dpr: number): void {
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
    if (ground) this.gpu!.redrawNow(view, w, h);
    if (this.surface.parentElement !== this.element) this.element.append(this.surface);
    this.drawInto(this.surface, view, w, h, dpr, true);
  }
  /** Explicit readback for screenshots/illustration; ordinary navigation never calls it. */
  prepareCapture(): void { if (this.gpuActive) this.gpu!.redrawForCapture(); }
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
    const vectors = this.vectorRaster(view, w, h, dpr);
    if (vectors) ctx.drawImage(vectors.image, vectors.region.x, vectors.region.y, vectors.region.width, vectors.region.height);
    // The export overlay is one whole-map raster: only where it is at least as fine as the frame.
    const overlay = this.exportOverlay && view.scale * dpr * size <= this.exportOverlay.naturalWidth * 1.01 ? this.exportOverlay : undefined;
    // Export order: physical land use, rural semantics, then roads/labels/furniture (as on screen).
    if (overlay) {
      if (this.exportGround) ctx.drawImage(this.exportGround, 0, 0, size, size);
      this.paintRural(ctx, viewRect(view, w, h), 1 / view.scale); ctx.drawImage(overlay, 0, 0, size, size);
    }
    ctx.restore();
    if (!overlay && this.cartography) { if (this.overlay.width !== canvas.width) this.overlay.width = canvas.width; if (this.overlay.height !== canvas.height) this.overlay.height = canvas.height; this.cartography.draw(view); ctx.drawImage(this.overlay, 0, 0, w, h); }
    if (this.exportLayers.city !== false||this.exportLayers.streets!==false) this.stats.city = this.city?.draw(ctx, view, w, h, dpr, r, { ...this.exportLayers, labels: false }, this.cityHooks);
    if (this.cartography) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.cartography.drawText(ctx, view, w, h); ctx.restore(); }
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
