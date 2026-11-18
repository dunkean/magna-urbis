/**
 * The ground of the map: the terrain renderer on the GPU (TerrainGl or TerrainGpu, its own canvas and context), or the
 * CPU raster of the terrain with the washes and stamps of an illustrated ground.
 *
 * Holds the three ground passes of `set()` (terrain data, look, forest), the compilation of the look's programs, the
 * recovery from a lost map context, and the whole-map capture of the GPU ground that the miniature, the 3D background
 * and the first composed frames use.
 */
import { rasterizeSvg as imageOf } from '../../render/svgRaster';
import type { MaterialRasterContext } from '../../../../rust/bridge/terrainMaterialContext';
import type { World } from '../../gen/types';
import { setRoadCanopy } from '../../render/roadStyle';
import { v2DisplayForestAsync, v2ForestOccupationParts, withBuildingOccupationAsync } from '../displayForest';
import type { ForestOccupation } from '../../../../rust/bridge/terrainForest';
import { activityScene } from '../activitySites';
import { terrainStyle } from '../../render/terrainStyle';
import { moonlightSvg } from '../../render/materialLook';
import { renderRustTerrain, renderTerrainCanopy, terrainLandClip } from '../../../../rust/bridge/terrainRender';
import { seaDistanceSurface, seaMaterialSvg } from '../../render/terrainWater';
import { DEFAULT_FRACTAL_DETAIL, seedHash } from '../../../../rust/bridge/terrainAdjust';
import { climateOf, type TerrainData, type TerrainSettings } from '../../../../rust/bridge/terrain';
import { effectiveTerrainSettings } from '../terrainSettings';
import { createTerrainRenderer, type TerrainRenderer } from '../../ui/terrainRenderer';
import { MAP_GPU_FAILED_MESSAGE, MAP_GPU_LIGHTER_MESSAGE, MapContextLostError, enterMapGpuLight, isMapContextLost, noteMapRenderer } from '../../ui/glContextRecovery';
import { registerFantasyBrushes, isFantasyStyle, renderFantasyTerrain, prepareFantasyTerrain } from '../../../../rust/bridge/fantasyTerrain';
import { fantasyClearance, prepareFantasyRaster, type FantasyRaster } from '../../ui/fantasyRaster';
import { BackgroundJob, passKeys } from '../passes/pass';
import { reportDisplayRenderer } from '../../render/displayQuality';
import type { GroundTileRenderer } from '../../render/live/contract';
import { underdarkSceneLook } from '../../render/underdarkLighting';
import { nativeCitiesOf } from '../nativeProducts';
import { SOFTWARE_GL } from '../../render/softwareGl';
import { fantasyRasterImages } from '../../ui/fantasyRaster';
import type { Ground } from './contract';
import type { MapState } from './mapState';
import { svgOf, wholeMap } from './mapSvg';

/** `svg`: the terrain of the 3D background; `image`: the 2D base, with the crowns of a hidden relief. */
type BaseRaster = { svg: string; image?: HTMLCanvasElement; fantasy?: FantasyRaster };

export class GroundProducts implements Ground {
  gpuCanvas = document.createElement('canvas');
  gpu?: TerrainRenderer;
  /** The terrain renderer holds the current terrain and can draw it. */
  gpuActive = false;
  private gpuUnavailable: boolean;
  private uploaded?: TerrainData;
  /** Terrain raster (CPU relief, sea): natural content, whole map. */
  base?: HTMLCanvasElement;
  private terrainSvg = '';
  /** Illustrated grounds: washes and stamps painted on canvas over `base` (web/src/ui/fantasyRaster.ts). */
  fantasy?: FantasyRaster;
  private fantasyImages?: { wash: string; stamps: string };
  /** The whole-map capture of the ground as a URL and as a bitmap; dropped with the ground they show. */
  private backgroundHref?: string;
  private backgroundImage?: HTMLCanvasElement;
  /** The compilation of the look's programs, and its failure: reported by exactReady() and settled(). */
  programWork?: Promise<void>;
  programError?: unknown;
  private ownsMaterialContext: boolean;

  constructor(
    private readonly map: MapState,
    /** The whole-map capture was dropped: whoever shows it (it may stand in for the live ground tiles) is told. */
    private readonly onCaptureDropped: () => void,
    rasterOnly: boolean,
    private materialContext?: MaterialRasterContext,
  ) {
    this.gpuUnavailable = rasterOnly;
    this.ownsMaterialContext = !materialContext;
  }

  rasterContext(): MaterialRasterContext | undefined {
    return this.materialContext?.gl.isContextLost() ? undefined : this.materialContext;
  }
  /** The terrain draws on the GPU when it can; the CPU raster otherwise. Evaluated lazily: the terrainData pass may demote it. */
  mode(): 'gpu' | 'cpu' {
    const r = this.map.resolved!;
    return this.map.exportLayers.terrain !== false && r.ground.layers.relief && !isFantasyStyle(r.ground.style) && !this.gpuUnavailable ? 'gpu' : 'cpu';
  }
  preparePrograms(): Promise<void> {
    const request = this.map.request,
      gpu = this.gpuActive ? this.gpu : undefined;
    const work = gpu ? gpu.variantReady() : Promise.resolve();
    const pending = (this.programWork = work.then(
      () => {
        if (this.programWork !== pending || this.map.request !== request) return;
        this.programWork = undefined;
        if (!this.forestJob) request?.mark('programs-ready');
        if (!this.map.disposed) this.map.invalidate();
      },
      error => {
        // The map context is lost for good: drop it so the next appearance starts from a fresh canvas (light profile),
        // or, after a second such loss, from the CPU raster. The page reports it and re-renders (main.ts).
        if (isMapContextLost(error)) error = this.dropLostGpu();
        if (this.programWork === pending) {
          this.programWork = undefined;
          this.programError = error;
          this.map.invalidate();
        }
        throw error;
      },
    ));
    // An exact consumer observes the original rejection; the view on screen reports it on its next frame.
    void pending.catch(() => {});
    return pending;
  }
  /** Map GPU contexts lost for good on this renderer. */
  private gpuLosses = 0;
  /** Forgets a lost map renderer and its canvas (a canvas keeps its lost context); the next set() re-runs every pass. */
  private dropLostGpu(): MapContextLostError {
    const lostCanvas = this.gpuCanvas;
    this.gpu?.dispose();
    this.gpu = undefined;
    this.uploaded = undefined;
    this.gpuActive = false;
    if (this.materialContext?.canvas === lostCanvas) this.materialContext = undefined;
    this.gpuCanvas = document.createElement('canvas');
    this.map.passes.reset();
    enterMapGpuLight();
    const final = ++this.gpuLosses > 1;
    if (final) this.gpuUnavailable = true;
    this.map.stats.gpuFallback = final ? 'Map GPU context lost twice: CPU raster' : 'Map GPU context lost: fresh context, light profile';
    return new MapContextLostError(final ? MAP_GPU_FAILED_MESSAGE : MAP_GPU_LIGHTER_MESSAGE, final);
  }
  async exactReady(): Promise<void> {
    while (this.forestJob) await this.forestJob;
    await this.programWork;
    if (this.programError) throw this.programError;
    if (this.gpuActive) await this.gpu!.variantReady();
    this.map.request?.mark('programs-ready');
  }
  dropBackground(): void {
    this.backgroundHref = undefined;
    this.backgroundImage = undefined;
    this.onCaptureDropped();
  }
  /** A new set(): the program state of the previous one is forgotten. */
  beginAppearance(): void {
    this.programError = undefined;
    this.programWork = undefined;
  }
  /** set() failed: the renderer is as usable as it was before (`gpuWasActive`), and no forest update stays wanted. */
  rollback(gpuWasActive: boolean): void {
    this.gpuActive = gpuWasActive && !!this.gpu;
    this.forestUpdate.cancel();
  }
  /** GPU: context, height/cave/water-surface textures (once per terrain product). CPU: nothing. */
  async terrainDataPass(): Promise<void> {
    this.gpuActive = false;
    this.dropBackground();
    if (this.mode() !== 'gpu') return;
    const t = this.map.native!,
      source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
    try {
      if (!this.gpu) {
        const attributes: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
        let gl = this.gpuCanvas.getContext('webgl2', attributes);
        // A canvas keeps its context even once lost (a GPU process exit loses every context): take a fresh one.
        if (gl?.isContextLost()) {
          this.gpuCanvas = document.createElement('canvas');
          gl = this.gpuCanvas.getContext('webgl2', attributes);
        }
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        const name = extension ? String(gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
        reportDisplayRenderer(name);
        noteMapRenderer(name);
        if (!gl) throw new Error('WebGL2 indisponible pour la carte.');
        this.materialContext = { canvas: this.gpuCanvas, gl };
        if (SOFTWARE_GL.test(name)) {
          this.gpuUnavailable = true;
          this.map.stats.gpuFallback = 'Software WebGL material raster on the map context';
          return;
        }
        this.gpu = await createTerrainRenderer(this.gpuCanvas, document.createElement('canvas'));
        this.forestShown = false;
        this.gpu.setLivePaused(this.map.preparing);
      }
      if (this.uploaded !== t) {
        this.gpu.setBase({ x: 0, y: 0, width: t.width, n: source.n, data: source.data, cave: source.cave, waterSurface: t.waterSurface });
        this.uploaded = t;
      }
      this.gpuActive = true;
    } catch (error) {
      this.gpu?.dispose();
      this.gpu = undefined;
      this.uploaded = undefined;
      this.gpuUnavailable = true;
      this.map.stats.gpuFallback = String(error);
    }
  }
  /** GPU: look uniforms only. CPU: the terrain raster (the only thing re-rasterized). */
  async terrainLookPass(): Promise<void> {
    this.dropBackground();
    const t = this.map.native!,
      world = this.map.world!,
      settings = this.map.settings!,
      r = this.map.resolved!,
      style = r.ground.style,
      colors = r.palette.colors;
    const effective = effectiveTerrainSettings(settings, world.mapSize),
      layers = this.map.layers(),
      lighting = r.ground.lighting;
    if (this.gpuActive) {
      const source = t.field ?? { n: t.resolution, data: t.height, floor: 0, cave: t.caveMask };
      this.terrainSvg = '';
      this.base = undefined;
      this.fantasy = undefined;
      this.fantasyImages = undefined;
      this.gpu!.setLook({
        style,
        colors,
        lighting,
        layers,
        groundCover: r.composition.vegetation.procedural,
        ambience: r.composition.ambience,
        waterLook: r.composition.networks.water.look,
        coastWaves: r.composition.networks.water.waves,
        crownDetail: r.composition.vegetation.crownDetail,
        waterStyle: r.composition.networks.water.look === 'ink' ? r.palette.mapStyle : undefined,
        independentCanopy: true,
        mapWidth: t.width,
        climate: climateOf(effective as TerrainSettings),
        climateZone: effective.climateZone,
        ...underdarkSceneLook(world.options.biome, r.composition.ambience, world.settlements, world.landuse?.farmsteads),
        v2Season: r.ground.season,
        v2Calendar: r.ground.calendar,
        globalMin: t.globalMinHeight,
        globalMax: t.globalMaxHeight,
        contours: false,
        contourStep: effective.relief === 'mountains' ? 40 : effective.relief === 'flat' ? 2 : 10,
        flatRelief: effective.relief === 'flat',
        refine: effective.refine ?? true,
        sourceCell: t.width / source.n,
        seed: seedHash(world.seed),
        detail: effective.detailNoise ?? DEFAULT_FRACTAL_DETAIL,
        floor: source.floor ?? 0,
        frame: layers.frame,
        background: terrainStyle(style, colors).palette.paper,
      });
      return;
    }
    if (isFantasyStyle(style)) {
      const { fantasyLibraries } = await import('../../render/fantasyBrushAssets');
      registerFantasyBrushes(fantasyLibraries);
    }
    const key = passKeys(this.map.input()).terrainLook;
    // The shared material shader also composes SVG/PNG exports, using an OffscreenCanvas or a page canvas according to WebGL2 availability.
    const cacheKey = `terrain:${key}`;
    const pending = this.map.shared.cache.get<Promise<BaseRaster>>(cacheKey, async () => {
      const settingsForRender = {
        ...effective,
        width: world.mapSize,
        seed: world.seed,
        v2Season: r.ground.season,
        v2Calendar: r.ground.calendar,
        forest: {
          field: await v2DisplayForestAsync(world, settings, r),
          occupation: await this.groundOccupation(),
          parcels: world.landuse?.areas,
          groundCover: r.composition.vegetation.procedural,
          waterVisible: layers.water,
          clear: isFantasyStyle(style) ? fantasyClearance({ mapSize: world.mapSize, seed: world.seed, roads: world.roads, rivers: world.terrain.rivers, farmsteads: world.landuse?.farmsteads, settlements: world.settlements }, world) : undefined,
        },
      };
      let svg = '';
      const waterStyle = r.composition.networks.water.look === 'natural' ? 'render3d' : r.palette.mapStyle;
      // Illustrated: the SVG keeps the ground; the stamps are painted on canvas per view.
      const fantasyOptions = { ...r.vegetation.fantasy, svgStamps: false };
      if (layers.relief) svg = renderRustTerrain(t, style, layers.frame, settingsForRender, r.ground.contours, 'v2-render', lighting, layers, fantasyOptions, true, waterStyle, colors, this.rasterContext()).svg;
      const painting = layers.relief && isFantasyStyle(style) && this.map.exportLayers.terrain !== false ? prepareFantasyTerrain(t, style, settingsForRender, fantasyOptions) : undefined;
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
      if (!layers.relief && this.map.exportLayers.terrain !== false) {
        if (settingsForRender.forest.field) {
          crowns = renderTerrainCanopy(t, style, settingsForRender, lighting, this.rasterContext());
          if (isFantasyStyle(style)) {
            svg += crowns;
            crowns = '';
          }
        } else if (isFantasyStyle(style) && r.vegetation.fantasy.forests) svg += renderFantasyTerrain(t, style, settingsForRender, { ...r.vegetation.fantasy, forestsOnly: true });
      }
      if (r.composition.ambience === 'night') {
        if (r.ground.traits.family === 'material') svg = moonlightSvg(svg, 'v2-ground-night');
        crowns = moonlightSvg(crowns, 'v2-canopy-night');
      }
      return { svg, image: svg + crowns ? await imageOf(svgOf(svg + crowns, wholeMap(t.width))) : undefined, fantasy };
    });
    const raster = await pending.catch(error => {
      this.map.shared.cache.delete(cacheKey);
      throw error;
    });
    this.terrainSvg = raster.svg;
    this.base = raster.image;
    this.fantasy = raster.fantasy;
    this.fantasyImages = undefined;
    if (this.fantasy) {
      const fantasy = this.fantasy;
      fantasy.onTiles = () => {
        if (!this.map.disposed && this.fantasy === fantasy) this.map.invalidate();
      };
    }
  }
  private occupationCache?: { world: World; revision: string; data: Promise<ForestOccupation | undefined> };
  /** Accepted footprints exclude vegetation independently of building visibility. Both rasters run in the
   * occupation worker; concurrent passes share one job. */
  private groundOccupation(): Promise<ForestOccupation | undefined> {
    const world = this.map.world!,
      v = this.map.scene!.revisions;
    const revision = JSON.stringify([v.landuse, v.cities, v.settlements]);
    if (this.occupationCache?.world !== world || this.occupationCache.revision !== revision) {
      // The building merge needs only the occupation raster; the holdings detail joins at the end.
      const parts = v2ForestOccupationParts(world);
      const data = Promise.all([
        parts.occupation.then(base => {
          const buildings = [...nativeCitiesOf(world).flatMap(city => city.scene?.buildings ?? []), ...(activityScene(world)?.buildings ?? [])];
          return withBuildingOccupationAsync(base, { buildings });
        }),
        parts.occupation,
        parts.detail,
      ]).then(([occupation, base, detail]) => occupation && { ...occupation, detail: base ? detail : undefined });
      data.catch(() => {
        if (this.occupationCache?.data === data) this.occupationCache = undefined;
      });
      this.occupationCache = { world, revision, data };
    }
    return this.occupationCache.data;
  }
  /** Forest update still running after set() returned (progressive display). */
  private forestUpdate = new BackgroundJob();
  get forestJob(): Promise<void> | undefined {
    return this.forestUpdate.running;
  }
  private forestShown = false;
  async forestPass(): Promise<void> {
    // The pass runs again: its key moved, an update still in flight is for an older key.
    this.forestUpdate.cancel();
    // The natural road painter fades ways under the same canopy as the ground shader (roadStyle.ts setRoadCanopy).
    if (!this.gpuActive) {
      // Raster and Illustrated grounds carry the same forest product as the GPU ground.
      const world = this.map.world!,
        request = this.map.request;
      const [field, occupation] = await Promise.all([v2DisplayForestAsync(world, this.map.settings!, this.map.resolved!), this.groundOccupation()]);
      if (!this.map.disposed && this.map.world === world && this.map.request === request) setRoadCanopy(field, occupation);
      return;
    }
    this.dropBackground();
    // The Rust forest field and the occupation worker are independent: run them at once.
    const job = Promise.all([v2DisplayForestAsync(this.map.world!, this.map.settings!, this.map.resolved!), this.groundOccupation()]);
    // Progressive display: a map on screen that already shows woods shows the new town at once, the woods follow when ready.
    if (this.forestShown && this.map.resolved!.target !== 'export') {
      // Applied for any later request that keeps this forest key (a newer world with the same revisions included):
      // the pass will not run again for it. A moved key reruns the pass, which supersedes this job.
      const gpu = this.gpu!;
      this.forestUpdate.start(
        job,
        ([field, occupation]) => {
          if (this.map.disposed || this.gpu !== gpu || !this.gpuActive) return;
          gpu.setForest(field, occupation);
          setRoadCanopy(field, occupation);
          this.dropBackground();
          void this.preparePrograms();
          this.map.invalidate();
        },
        error => {
          this.programError = error;
          this.map.passes.reset('forest');
        },
        () => this.map.invalidate(),
      );
      return;
    }
    const [field, occupation] = await job;
    if (this.gpuActive) {
      this.gpu!.setForest(field, occupation);
      setRoadCanopy(field, occupation);
      this.forestShown = true;
      this.map.invalidate();
    }
  }
  /** The GPU capture copied to a 2D canvas right after the readback (a WebGPU canvas is blank once its frame is gone). */
  private miniGroundCopy?: { source: HTMLCanvasElement; copy: HTMLCanvasElement };
  miniGround(): HTMLCanvasElement | undefined {
    const source = this.groundBackground();
    if (!source) return undefined;
    if (this.miniGroundCopy?.source !== source) {
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      copy.getContext('2d')!.drawImage(source, 0, 0);
      this.miniGroundCopy = { source, copy };
    }
    return this.miniGroundCopy.copy;
  }
  /** The terrain renderer as the ground layer bakes from it, or the CPU raster of a look without relief (topographic,
   * minimal: paper, sea and crowns), so that such a map is composed, and tilts, like the others; undefined while
   * neither can draw the map (passes running, an illustrated ground). */
  groundTiles(): GroundTileRenderer | undefined {
    const ground = this.gpu as Partial<GroundTileRenderer> | undefined;
    if (this.gpuActive) return ground?.renderWorldTile && ground.contentRevision ? (ground as GroundTileRenderer) : undefined;
    const r = this.map.resolved;
    return r && this.map.world && this.map.native && this.mode() === 'cpu' && !isFantasyStyle(r.ground.style) ? this.rasterTiles : undefined;
  }
  /** The tiles of the CPU raster: paper, then `base` over the map's square, as the exact frame paints them. */
  private readonly rasterTiles: GroundTileRenderer = (() => {
    const canvas = document.createElement('canvas');
    let base: HTMLCanvasElement | undefined,
      paper = '',
      revision = 0;
    return {
      renderWorldTile: (box, px) => {
        const size = this.map.world?.mapSize;
        if (!size) return undefined;
        if (canvas.width !== px) canvas.width = px;
        if (canvas.height !== px) canvas.height = px;
        const ctx = canvas.getContext('2d')!,
          scale = px / (box.maxX - box.minX);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = this.map.paper;
        ctx.fillRect(0, 0, px, px);
        if (this.base) {
          ctx.setTransform(scale, 0, 0, scale, -box.minX * scale, -box.minY * scale);
          ctx.drawImage(this.base, 0, 0, size, size);
        }
        return canvas;
      },
      contentRevision: () => {
        if (this.base !== base || this.map.paper !== paper) {
          base = this.base;
          paper = this.map.paper;
          revision++;
        }
        return revision;
      },
    };
  })();
  /** Terrain-pass bitmap for 3D; invalidated with the ground, shared without PNG encoding and image decoding. */
  groundBackground(): HTMLCanvasElement | undefined {
    if (this.programWork || this.forestJob || this.programError) return undefined;
    if (this.gpuActive) return (this.backgroundImage ??= this.gpu!.captureMap(1024));
    return undefined;
  }
  /** The ground of the 3D view as one whole-map image URL, with the vector water body of the map (`vectors`) when
   * the ground is not the GPU's. */
  backgroundUrl(vectors: string): string | undefined {
    if (!this.backgroundHref) {
      // The open 3D view also polls while a new world prepares its GPU look.
      // Keep the background pending until the bitmap is ready; never cache a preview.
      if (this.gpuActive) this.backgroundHref = this.groundBackground()?.toDataURL('image/png');
      else if (this.terrainSvg || vectors) {
        // Illustrated: the canvas-painted ground enters the 3D background draped, as in 2D: wash under the water, stamps over it.
        let painted = '',
          wash = '';
        if (this.fantasy && isFantasyStyle(this.map.resolved!.ground.style)) {
          const f = this.fantasy,
            frame = f.painting.frame!,
            images = (this.fantasyImages ??= fantasyRasterImages(f));
          const at = `x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.width}" preserveAspectRatio="none"`;
          wash = `<image class="fantasy-wash" ${at} href="${images.wash}"/>`;
          painted = `<image class="fantasy-stamps" ${at} href="${images.stamps}"/>`;
        }
        this.backgroundHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(this.terrainSvg + wash + vectors + painted, wholeMap(this.map.native!.width)))}`;
      }
    }
    return this.backgroundHref;
  }
  dispose(): void {
    this.gpu?.dispose();
    if (this.ownsMaterialContext) this.materialContext?.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.materialContext = undefined;
  }
}
