/**
 * The live town layer (the `city` layer of the live compositor, render/live/contract.ts), made by v2/nativeCityMap.ts:
 * the towns drawn from retained meshes by a GPU town renderer bound to the compositor's shared WebGL2 context, for
 * every look the layer covers (liveCityBlock), while the view moves and, where `restExact` allows, at rest.
 *
 * The meshes are the GPU town's (gl/renderer.ts, cityGlBuild: plan fills, canals, street, wall and tower instances,
 * building surfaces, roof pans and cast shadows in 512 m chunks), plus the lot enclosures (cityGlYards). All
 * preparation is sliced to a few milliseconds per `work` call: the scene merge, the polygon packing (renderer `step`),
 * the colour tables of each level of detail (renderer `prepareSteps`); triangulation runs on the workers; uploads go one
 * buffer set per call. Nothing heavy starts while the view moves, and a frame whose level of detail has no prepared
 * tables shows the stand-in instead of computing them. A frame sets uniforms and issues one draw per visible run of
 * chunks per layer. Nothing per building runs in `draw`.
 *
 * Buildings drawn by the native house renderer (house-plan towns, activity sites) are held as their city volumes. On
 * satellite grounds each town's far raster (cityFarRaster.ts) is a texture drawn over the buildings with the Canvas
 * fade (farRasters.ts); the town canopy is instanced discs above everything (canopyDiscs.ts), as finishCityFrame
 * draws it last.
 *
 * Every colour, width and threshold is the town's look (render/city/look.ts), the rules the Canvas town paints with.
 * `restExact` says whether a frame of this layer is the picture of the town at rest: only where the look's
 * townRestGaps finds nothing the Canvas town would paint differently (render/city/restCoverage.ts lists what is left).
 * Otherwise the exact Canvas 2D town (cityCanvas drawCitySteps) repaints the view at rest, as it does captures and exports.
 *
 * A tilted frame (render/world/contract.ts) shows the town plan on the terrain: the layer gives the map drape a
 * `DrapeSource` that draws the town of a tile's square with the same renderer, buildings included as the top view draws
 * them (roofs in the town's look), without the far rasters and the canopy: the far town reads as the map draped on the
 * relief, and near the camera the buildings stand on it as volumes (render/world/buildingsLayer.ts), each covering
 * its own roof on the drape; where the volumes' budget or size drops them, the drape's roofs remain. The drape's state
 * of the renderer has its colour tables computed in slices by `work` before a tile is drawn, like those of the top view. While the camera is tilted the layer prepares nothing that only the top view shows (building tiers
 * of a large town, the tables and the warm-up of its levels of detail, far rasters, canopy).
 */
import type { LiveCityEnv, LiveFrame, LiveLayer, LiveLayerStats } from '../../live/contract';
import type { DrapeCanvas, DrapeSource } from '../../world/contract';
import type { ResolvedAppearance } from '../../appearanceRecipe';
import type { ExportLayers } from '../../exportLayers';
import type { Box, CityBuildings, CityLayers, CityLod, CityPalette, CityScene } from '../model/contract';
import { selectCityLod } from '../levels';
import { planFrame, planLineWidthPx } from '../planLook';
import { buildingsShown, roofPansShown } from '../buildingLook';
import { FAR_TOWN_FADE, farTownAlpha } from '../farTown';
import { townRestGaps, type RestState, type TownContent } from '../restCoverage';
import { townOpacity } from '../look';
import { groundRoadLook } from '../../composition';
import { mapGroundSnow } from '../../seasonPalette';
import type { CityGlDrawOptions, CityGlSharedRenderer } from '../gl/contract';
import { createCityGlRendererOn } from '../gl/renderer';
import { cityBuildingAppearance } from '../../cityDrawOptions';
import { townWaterColour } from '../../townWater';
import { grainMeansReady, grainMeansStep } from '../../cityGlGrain';
import { CoverGrainTexture } from '../../world/buildingsGrain';
import type { YardBoundary } from '../../cityLotEnclosures';
import { CanopyDiscs } from './canopyDiscs';
import { FarRasters } from './farRasters';
import { liveCityBlock, type LiveCityTowns } from './contract';
import { countWork } from '../../workCount';

interface Look {
  appearance: ResolvedAppearance;
  visibility: Partial<ExportLayers> | undefined;
  reason: string | null;
  opacity: number;
  /** Satellite grounds: the Canvas town fades into its far raster from FAR_TOWN_FADE[0] m/px (cityFarRaster.ts). */
  farTown: boolean;
  /** drawFarTown's palette and building ink for this look. */
  far: { palette: CityPalette; night: boolean; custom?: string };
  /** finishCityFrame draws the canopy (buildings view, no diagnostic, town shown). */
  canopy: boolean;
  /** Options of every frame of this look but the view, the level of detail, the water and the target. */
  base: Omit<CityGlDrawOptions, 'viewport' | 'metresPerPixel'>;
}
const LODS: readonly CityLod[] = ['far', 'mid', 'near', 'close'];
const finite = (value: number | undefined, fallback: number, min: number, max: number): number => (value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);

/** Metres per pixel of each level of detail for the warm-up draw (inside each band of CITY_LOD_LIMITS). */
const LEVEL_MPP: Record<CityLod, number> = { close: 0.4, near: 1.2, mid: 4, far: 16 };

export function createLiveCityLayer(gl: WebGL2RenderingContext, env: LiveCityEnv, towns: LiveCityTowns): LiveLayer {
  countWork('town.liveLayer');
  let renderer: CityGlSharedRenderer | undefined,
    broken = false,
    disposed = false;
  /** The merge in progress, the scene handed to the renderer, the buildings last handed to it, builds still running. */
  const planOnly = !!env.volumeBuildings?.();
  let merging: Generator<void, { plan: CityScene; buildings?: CityBuildings }> | undefined;
  let requested: CityScene | undefined,
    built: CityBuildings | undefined,
    building = 0;
  let lod: CityLod | undefined,
    look: Look | undefined,
    generation = 0;
  /** Levels of detail whose colour tables are on the GPU for the current look and water; the preparation running. */
  const preparedLods = new Set<CityLod>();
  let preparing: { level: CityLod; steps: Generator<void, void> } | undefined, preparedWater: Float32Array | undefined;
  /** Levels of detail drawn once into the warm-up target with the current look and resources: the driver has built
   * every shader variant their frames use (ANGLE builds them on a program's first draw, not at link). */
  const warmedLods = new Set<CityLod>();
  let warm: { framebuffer: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer } | undefined;
  /** The far rasters and the canopy own their program and GPU data; their links are polled like the renderer's. */
  const parallelLink = !!gl.getExtension('KHR_parallel_shader_compile'),
    far = new FarRasters(gl),
    canopy = new CanopyDiscs(gl);
  /** Natural roofs: the Canvas grain tiles on the GPU (one family per `work` call) for the pans' grain marks, and the
   * mean tone of the snow mantle (cityGlGrain.ts); a frame waits for both, as for its colour tables. */
  const grainTiles = new CoverGrainTexture(gl);
  let grainTilesDone = false;
  const naturalGrain = (l: Look): boolean => l.base.palette === 'terrain' && !!l.base.live?.grain;
  const grainReady = (l: Look): boolean => !naturalGrain(l) || (grainMeansReady() && grainTilesDone);
  /** The live look of a frame: the grain tiles handed over. */
  const liveOf = (l: Look): CityGlDrawOptions['live'] => (grainTilesDone && naturalGrain(l) ? { ...l.base.live!, grainMarks: grainTiles.texture } : l.base.live);
  let meshBytes = 0;
  /** Lot enclosure lists handed to the renderer. */
  let yardsFor: readonly (readonly YardBoundary[] | undefined)[] | undefined;
  /** What the towns hold that decides whether a frame is the picture at rest (counted once per scene and extras, in
   * `work`), and the last answer of `restExact` with the state it was given for. */
  let content: TownContent | undefined;
  let rest: { look: Look; level: CityLod; dpr: number; farRaster: boolean; snow: number; content: TownContent; gaps: readonly string[] } | undefined;
  /** The options `ready` checked for a frame, reused by its `draw`. */
  let checked: { frame: LiveFrame; options: CityGlDrawOptions; level: CityLod } | undefined;
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, instances: 0, gpuBytes: 0, uploadMs: 0, buildMs: 0, packMs: 0, prepareMs: 0, warmMs: 0, farTextures: 0 };

  /** One pass over the scene, at rest: what the look's townRestGaps needs to know of the towns. */
  function townContent(plan: CityScene, buildings: CityBuildings | undefined): TownContent {
    const streetRoles = new Set<string>();
    for (const s of plan.streets) streetRoles.add(s.role);
    return {
      waterways: plan.layouts.some(layout => !!layout.structure?.waterways?.length),
      streetRoles,
      enclosures: towns.enclosures().some(list => !!list?.length),
      canopy: towns.canopies().some(c => c.trees.length > 0 || c.dwellings.length > 0 || c.walkways.length > 0),
      sites: towns.sites(),
      housePlans: towns.housePlans(),
      millMarks: !!buildings?.items.some(b => !!b.marks?.length),
      reserves: plan.blocks.some(b => b.kind.startsWith('reserve')) || plan.parcels.some(p => p.use === 'reserve'),
    };
  }
  /** What the Canvas town would paint differently from this layer for a frame (the look's townRestGaps); kept while
   * the look, the level of detail and the towns' content do not change. */
  function restGaps(frame: LiveFrame, l: Look, level: CityLod, held: TownContent): readonly string[] {
    const mpp = 1 / frame.view.scale,
      farRaster = l.farTown && mpp > FAR_TOWN_FADE[0],
      snow = mapGroundSnow();
    if (rest && rest.look === l && rest.level === level && rest.dpr === frame.dpr && rest.farRaster === farRaster && rest.snow === snow && rest.content === held) return rest.gaps;
    const o = l.base,
      a = l.appearance,
      layers = o.layers as CityLayers,
      live = o.live!;
    const footprint = o.buildingStyle === 'silhouette',
      shown = { view: o.view, lod: level, mpp, footprint, diagnostic: o.diagnostic ?? 'none', buildingsVisible: !!o.buildingsVisible, farTown: l.farTown };
    const state: RestState = {
      palette: o.palette ?? 'parchment',
      view: o.view,
      lod: level,
      mpp,
      dpr: frame.dpr,
      // A street takes the tone of the ground wherever the map gives one, unless the roads are ink.
      streets: groundRoadLook(live.roadLook) ? 'natural' : live.roadLook === 'ink' ? 'ink' : 'soft',
      streetsShown: layers.streets,
      blend: planFrame({ view: o.view, lod: level, palette: o.palette ?? 'parchment', layers, width: live.lineWidth ?? 0.6, groundBlend: o.groundBlend, roadLook: live.roadLook }).blend,
      textured: !!a.city.textured,
      emphasis: live.emphasis,
      snow,
      lineWidthPx: planLineWidthPx(live.lineWidth ?? 0.6),
      buildings: buildingsShown(shown) && (footprint || roofPansShown(shown) || o.view === 'roles'),
      farRaster,
      canopyClearing: !!a.composition.vegetation.procedural,
      urbanLanduse: a.composition.landuse.urban !== 'off',
      diagnostics: !!(layers.fronts || layers.axes || layers.access || layers.reserve || layers.allocated || layers.quarters || layers.centers || o.refusedParcels?.size),
      // The canals of the Canvas town are painted again at full strength over the composited town; this layer has no
      // pass over its group (contract.ts).
      overPass: false,
      content: held,
    };
    rest = { look: l, level, dpr: frame.dpr, farRaster, snow, content: held, gaps: townRestGaps(state) };
    return rest.gaps;
  }
  /** The map drape's tiles hold the town of this revision: bumped whenever what a tile shows changes (the look, the plan
   * of a new scene, a building tier uploaded, the lot enclosures, the water). */
  let drapeRevision = 0;
  /** The colour tables of the plan as the drape draws it at a level of detail, being computed in slices by `work`. */
  let drapePreparing: { level: CityLod; steps: Generator<void, void> } | undefined;
  const unprepare = (): void => {
    drapePreparing?.steps.return();
    drapePreparing = undefined;
    preparedLods.clear();
    warmedLods.clear();
    preparing?.steps.return();
    preparing = undefined;
  };
  /** The look of the current appearance and visibility, rebuilt when either object changes. */
  function lookNow(): Look {
    const appearance = env.appearance(),
      visibility = env.visibility();
    if (look && look.appearance === appearance && look.visibility === visibility) return look;
    const city = appearance.city,
      buildingAppearance = cityBuildingAppearance(appearance),
      vis = visibility ?? {};
    const roads = appearance.composition.networks.roads,
      buildingsVisible = vis.city !== false && city.visible;
    // As drawCitySteps decides it (the look's farTownShown), for the towns of city volumes.
    const farTown = !planOnly && !!appearance.traits?.satelliteVariant && buildingsVisible && city.view === 'buildings' && buildingAppearance.style !== 'silhouette' && buildingAppearance.diagnostic === 'none';
    look = {
      appearance,
      visibility,
      reason: liveCityBlock(appearance, visibility),
      opacity: townOpacity(city.opacity),
      farTown,
      // As cityDrawOptions hands them to drawFarTown by day: the city palette, the building ink of the appearance.
      far: { palette: city.palette, night: false, custom: buildingAppearance.colors?.building },
      canopy: buildingsVisible && city.view === 'buildings' && buildingAppearance.diagnostic === 'none',
      base: {
        view: city.view,
        palette: city.palette,
        layers: towns.layers(appearance, vis),
        buildingStyle: buildingAppearance.style,
        smoothRoofs: buildingAppearance.smoothRoofs,
        roof: buildingAppearance.roof,
        // The Canvas town ignores `painted` for city volumes, and the live look omits textures (flat colours).
        paintedBuildings: false,
        textured: false,
        buildingsVisible: buildingsVisible && !planOnly,
        diagnostic: buildingAppearance.diagnostic,
        refusedParcels: buildingAppearance.diagnostic === 'access' ? towns.refused() : undefined,
        colors: appearance.palette.colors,
        groundBlend: city.groundBlend === 'blended',
        live: {
          roadLook: roads.look,
          emphasis: roads.emphasis ?? 1,
          waterColor: townWaterColour(appearance),
          // Natural grounds: the Canvas town lays its procedural grain unless textured materials replace it.
          grain: !planOnly && !city.textured,
          lineWidth: finite(city.width, 0.6, 0, 5),
          farTown,
        },
      },
    };
    unprepare();
    drapeRevision++;
    far.ready = false;
    checked = undefined;
    return look;
  }
  /** The frame's world box exactly as the target maps it (device pixels). */
  const viewportOf = (frame: LiveFrame): Box => {
    const [sx, sy, tx, ty] = frame.worldToPixel;
    return { minX: -tx / sx, minY: -ty / sy, maxX: (frame.width - tx) / sx, maxY: (frame.height - ty) / sy };
  };
  const optionsFor = (frame: LiveFrame, l: Look, frameLod: CityLod): CityGlDrawOptions => ({
    ...l.base,
    viewport: viewportOf(frame),
    metresPerPixel: 1 / frame.view.scale,
    lod: frameLod,
    live: liveOf(l),
    water: env.water?.(),
    target: { framebuffer: frame.target, width: frame.width, height: frame.height },
  });
  function dropExtras(deleteHandles: boolean): void {
    far.drop(deleteHandles);
    canopy.drop(deleteHandles);
    if (deleteHandles) grainTiles.dispose();
    else grainTiles.lost();
    grainTilesDone = false;
    if (deleteHandles && warm) {
      gl.deleteFramebuffer(warm.framebuffer);
      gl.deleteRenderbuffer(warm.color);
      gl.deleteRenderbuffer(warm.depth);
    }
    warm = undefined;
  }
  function drop(deleteHandles: boolean): void {
    try {
      renderer?.dispose();
    } catch {
      /* A lost context: the handles are dead anyway. */
    }
    try {
      dropExtras(deleteHandles);
    } catch {
      dropExtras(false);
    }
    merging?.return(undefined as never);
    merging = undefined;
    checked = undefined;
    content = undefined;
    rest = undefined;
    renderer = undefined;
    requested = built = undefined;
    yardsFor = undefined;
    unprepare();
    drapeRevision++;
    generation++;
    building = 0;
    meshBytes = 0;
  }
  const track = <T>(job: Promise<T>): void => {
    const gen = generation;
    building++;
    job.then(
      () => {
        if (gen === generation) {
          building--;
          env.invalidate();
        }
      },
      error => {
        if (gen !== generation) return;
        building--;
        broken = true;
        console.warn('Live town meshes unavailable', error);
      },
    );
  };
  const bytes = (): number => meshBytes + far.bytes + canopy.bytes;
  /** Advances a generator for about `budget` ms from `start`; true once it is done. */
  const advance = <T>(steps: Generator<void, T>, start: number, budget: number, done: (value: T) => void): boolean => {
    do {
      const r = steps.next();
      if (r.done) {
        done(r.value);
        return true;
      }
    } while (performance.now() - start < budget);
    return false;
  };
  /** The programs of the far rasters and of the canopy: issued together, finished when linked (one per call without
   * parallel compile). True while one remains. */
  function programsStep(): boolean {
    const farLinked = far.linked;
    if (!farLinked) far.link(parallelLink);
    if (parallelLink || farLinked) canopy.link(parallelLink);
    return !(far.linked && canopy.linked);
  }
  /** The whole layer into `frame.target`: the town, the far rasters, the canopy. Creates nothing (`check` and the
   * warm-up saw to it). `warmup`: every draw kind of the level at least once, into the warm-up target. */
  function paint(frame: LiveFrame, l: Look, options: CityGlDrawOptions, mpp: number, warmup: boolean): void {
    const f = renderer!.draw(options);
    stats.drawCalls = f.drawCalls;
    stats.triangles = f.triangles;
    stats.instances = f.instances;
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame.target);
    gl.viewport(0, 0, frame.width, frame.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Satellite: the far raster over the buildings, faded in from FAR_TOWN_FADE[0] (drawCitySteps `farTown`).
    far.draw(frame, l.farTown ? (warmup ? 1 : farTownAlpha(mpp)) : 0, warmup, stats);
    // The canopy over the roofs (finishCityFrame draws it after the town).
    if (l.canopy) canopy.draw(frame, l.base.palette ?? 'parchment', mpp, stats);
  }
  /** One level of detail drawn into a small offscreen target of the group's format (RGBA8 + depth24/stencil8,
   * multisampled), over the whole town so every chunk kind is drawn: the driver builds the shader variants now, in
   * work, instead of in the first real frame of that level. */
  function warmLevel(frame: LiveFrame, l: Look, level: CityLod): void {
    if (!warm) {
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number),
        framebuffer = gl.createFramebuffer()!,
        color = gl.createRenderbuffer()!,
        depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, 4, 4);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, 4, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      warm = { framebuffer, color, depth };
    }
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const e = requested?.extent,
      whole = e && Number.isFinite(e.minX) && e.maxX > e.minX ? e : viewportOf(frame);
    const shadow: LiveFrame = { ...frame, target: warm.framebuffer, width: 4, height: 4 };
    gl.bindFramebuffer(gl.FRAMEBUFFER, warm.framebuffer);
    gl.viewport(0, 0, 4, 4);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    paint(shadow, l, { ...optionsFor(shadow, l, level), viewport: whole, metresPerPixel: LEVEL_MPP[level] }, LEVEL_MPP[level], true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, frame.width, frame.height);
  }

  /** How the drape draws the town of a tile: the look's options for the tile's square. */
  const drapeOptions = (l: Look, tile: DrapeCanvas, target?: WebGLFramebuffer): CityGlDrawOptions => {
    const mpp = 1 / tile.scale;
    return { ...l.base, live: liveOf(l), viewport: tile.rect, metresPerPixel: mpp, lod: selectCityLod(mpp), water: env.water?.(), target: target && { framebuffer: target, width: tile.pixels, height: tile.pixels } };
  };
  /** The town of a tilted frame, for the map drape: the plan and the buildings as the top view draws them. */
  const drape: DrapeSource = {
    revision(): number {
      // A new appearance is a new look, which drops the tables.
      lookNow();
      return drapeRevision;
    },
    ready(tile: DrapeCanvas): boolean {
      // Nothing to paint (a failed layer, a look the layer does not cover, a hidden town) is ready.
      if (disposed || broken) return true;
      const l = lookNow();
      if (l.reason || l.opacity <= 0) return true;
      // The plan is all the drape draws: a building tier being packed or uploaded does not hold it back.
      if (!renderer || !renderer.programsLinked || !requested || !renderer.ready) return false;
      if (!grainReady(l)) return false;
      const options = drapeOptions(l, tile);
      if (!renderer.check(options)) return true;
      // Its tables at this level are not kept: `work` computes them in slices, one state of the renderer at a time.
      const level = options.lod!;
      if (!preparing && drapePreparing?.level !== level) {
        drapePreparing?.steps.return();
        drapePreparing = { level, steps: renderer.prepareSteps(options) };
      }
      return false;
    },
    paint(tile: DrapeCanvas): void {
      const l = lookNow();
      if (disposed || broken || !renderer || l.reason || l.opacity <= 0) return;
      const target = tile.group();
      if (!target) return;
      const options = drapeOptions(l, tile, target);
      // `ready` saw the tables kept; a state that changed since is completed here, once.
      if (renderer.check(options)) renderer.prepare(options);
      renderer.draw(options);
      tile.putGroup(l.opacity);
    },
  };

  /** Why `draw` cannot show the towns of this frame ('' when it can). Checks that the draw will create nothing. */
  const notReady = (frame: LiveFrame): string => {
    if (disposed) return 'disposed';
    if (broken) return 'broken';
    if (!renderer) return 'no renderer';
    if (!renderer.programsLinked || !far.linked || !canopy.linked) return 'linking programs';
    if (!requested) return merging ? 'merging' : 'no scene requested';
    // A later building tier packing or uploading keeps the uploaded one drawable; only the first scene waits.
    if (!renderer.ready) return renderer.packing ? 'packing' : 'scene not uploaded';
    if (renderer.pendingUpload) return 'upload pending';
    const l = lookNow();
    if (l.reason) return l.reason;
    // Natural roofs take the grain marks and the snow's mean tone: the tiles are uploaded and measured in work first.
    if (!grainReady(l)) return 'roof grain';
    const level = selectCityLod(1 / frame.view.scale, lod);
    // The colour tables of the frame's level of detail are prepared in `work`; a draw never computes them.
    if (!preparedLods.has(level)) return 'tables not prepared';
    if (!warmedLods.has(level)) return 'warming up';
    // Satellite: from the fade start the Canvas town shows its far raster.
    if (l.farTown && 1 / frame.view.scale > FAR_TOWN_FADE[0] && !far.ready) return 'far-town raster';
    const options = optionsFor(frame, l, level),
      missing = renderer.check(options);
    // Something changed under a prepared level (ground tones, season, water): prepare and warm it again.
    if (missing) {
      preparedLods.delete(level);
      warmedLods.delete(level);
      return missing;
    }
    checked = { frame, options, level };
    return '';
  };
  return {
    name: 'city',
    isolated: true,
    drape,
    opacity: () => lookNow().opacity,
    ready(frame) {
      const why = notReady(frame);
      // Read by the probes (nav_fps_probe.mjs, smoke tests): why the stand-in shows instead of the meshes.
      (globalThis as { __muLiveCityWhy?: string }).__muLiveCityWhy = why;
      return !why;
    },
    restExact(frame) {
      // The volume scene uses this GPU street and parcel plan in both cameras. Its drawn plan is authoritative.
      if (planOnly) return !!content && !notReady(frame);
      // Strict: any element the Canvas town would paint differently keeps its repaint at rest. Read by the probes:
      // what is still missing for this frame.
      const held = content,
        l = lookNow(),
        gaps = held && !notReady(frame) ? restGaps(frame, l, selectCityLod(1 / frame.view.scale, lod), held) : undefined;
      (globalThis as { __muLiveCityGaps?: readonly string[] }).__muLiveCityGaps = gaps;
      return !!gaps && gaps.length === 0;
    },
    draw(frame) {
      const start = performance.now(),
        l = lookNow();
      stats.drawCalls = stats.triangles = stats.instances = 0;
      // Only after `ready` answered true for this frame: its checked options, nothing to create.
      const c = checked?.frame === frame ? checked : undefined;
      stats.opacity = l.opacity;
      // The target is the frame's at draw time: `ready` runs before the compositor binds the isolated group, so the
      // options it checked still name the canvas (drawing there skipped the group and its opacity: an opaque town).
      if (renderer && c && l.opacity > 0) {
        lod = c.level;
        paint(frame, l, { ...c.options, target: { framebuffer: frame.target, width: frame.width, height: frame.height } }, 1 / frame.view.scale, false);
      }
      checked = undefined;
      stats.ms = performance.now() - start;
    },
    work(budgetMs, frame) {
      // A lost context compiles nothing: wait for the restore (contextLost dropped the renderer).
      if (disposed || broken || gl.isContextLost()) return false;
      const start = performance.now(),
        moving = !!frame?.moving;
      try {
        if (!renderer) renderer = createCityGlRendererOn(gl, { onInvalidate: () => env.invalidate() });
        // Programs: issued at once and polled (parallel compile), never linked by a draw.
        const linkingRenderer = renderer.programsStep(),
          linkingOwn = programsStep();
        if (linkingRenderer || linkingOwn) return true;
      } catch (error) {
        broken = true;
        console.warn('Live town programs unavailable', error);
        return false;
      }
      if (!requested) {
        // The scene is merged and requested at rest only (slices); its polygons are then packed a slice per call.
        if (moving && !merging) return true;
        merging ??= towns.sceneSteps(planOnly);
        const r = renderer;
        advance(merging, start, budgetMs, scene => {
          countWork('town.sceneMerge');
          merging = undefined;
          requested = scene.plan;
          built = scene.buildings;
          track(r.setScene(scene.plan, scene.buildings));
        });
        stats.buildMs = (stats.buildMs ?? 0) + performance.now() - start;
        return true;
      }
      if (renderer.packing) {
        const t = performance.now();
        const more = renderer.step(Math.max(1, budgetMs - (t - start)));
        stats.packMs = (stats.packMs ?? 0) + performance.now() - t;
        return more || building > 0;
      }
      if (renderer.pendingUpload) {
        // One buffer set per call, at rest.
        if (moving) return true;
        const t = performance.now();
        renderer.upload();
        stats.uploadMs = performance.now() - t;
        meshBytes = renderer.stats().gpuBytes;
        stats.gpuBytes = bytes();
        unprepare();
        // The plan or a building tier: the drape shows both.
        drapeRevision++;
        yardsFor = undefined;
        content = undefined;
        return true;
      }
      if (!renderer.ready) return building > 0;
      // What only the top view shows waits for it: a tilted frame has the plan in the map drape and the buildings as volumes.
      const tilted = !!frame?.camera.tilted;
      // Large towns: the tier of a resting view (base items, or the detail of the visible tiles), as the exact town
      // swaps it. A moving view keeps the uploaded tier.
      if (frame && !planOnly && towns.buildingsFor && !moving && !building && !tilted) {
        const next = towns.buildingsFor(viewportOf(frame), 1 / frame.view.scale);
        if (next && next !== built) {
          built = next;
          track(renderer.setBuildings(next));
          return true;
        }
      }
      if (!frame) return building > 0;
      const l = lookNow(),
        water = env.water?.();
      if (l.reason) return building > 0;
      // The snow tile means (one kind per call, a few ms), shared by every town layer; then the grain tiles, one family per call.
      if (naturalGrain(l) && grainMeansStep()) return true;
      if (naturalGrain(l) && !grainTilesDone) {
        grainTilesDone = grainTiles.step();
        if (grainTilesDone) env.invalidate();
        return true;
      }
      if (preparedWater !== water) {
        unprepare();
        drapeRevision++;
        preparedWater = water;
      }
      // The tables the map drape waits for, in slices (never while the layer's own are half computed).
      if (drapePreparing && !preparing) {
        const job = drapePreparing,
          t = performance.now();
        advance(job.steps, start, budgetMs, () => {
          if (drapePreparing === job) drapePreparing = undefined;
        });
        stats.prepareMs = performance.now() - t;
        return true;
      }
      const own = selectCityLod(1 / frame.view.scale, lod);
      // Colour tables, one level of detail at a time in slices: the view's level first, then the others, so a zoom
      // across a level finds its tables kept.
      if (preparing || (preparedLods.size < LODS.length && !tilted)) {
        if (!preparing) {
          const level = preparedLods.has(own) ? LODS.find(x => !preparedLods.has(x))! : own;
          preparing = { level, steps: renderer.prepareSteps(optionsFor(frame, l, level)) };
        }
        const job = preparing,
          t = performance.now();
        advance(job.steps, start, budgetMs, () => {
          preparedLods.add(job.level);
          preparing = undefined;
        });
        stats.prepareMs = performance.now() - t;
        return true;
      }
      // Warm-up, one level per call (own level first), at rest or for the level the moving view needs.
      const cold = tilted ? undefined : !warmedLods.has(own) ? own : moving ? undefined : LODS.find(x => !warmedLods.has(x));
      if (cold) {
        const t = performance.now();
        try {
          warmLevel(frame, l, cold);
        } catch (error) {
          broken = true;
          console.warn('Live town warm-up failed', error);
          return false;
        }
        warmedLods.add(cold);
        stats.warmMs = performance.now() - t;
        return true;
      }
      // Retained extras, at rest: lot enclosures, canopy, far rasters (one item per call). Each change draws differently:
      // the levels are warmed up again.
      if (moving) return building > 0;
      try {
        const lists = towns.enclosures();
        if (!yardsFor || yardsFor.length !== lists.length || yardsFor.some((x, i) => x !== lists[i])) {
          renderer.setYards(lists);
          yardsFor = lists;
          content = undefined;
          meshBytes = renderer.stats().gpuBytes;
          stats.gpuBytes = bytes();
          // New enclosure colour tables: prepared again (a few texels), then warmed.
          unprepare();
          drapeRevision++;
          return true;
        }
        if (tilted) return building > 0;
        if (canopy.set(towns.canopies())) {
          stats.gpuBytes = bytes();
          warmedLods.clear();
          content = undefined;
          return true;
        }
        if (l.farTown && far.work(towns.farTowns(), l.far, moving)) {
          stats.farTextures = far.count;
          stats.gpuBytes = bytes();
          warmedLods.clear();
          return true;
        }
        // Last: what the towns hold, for `restExact` (one pass over the scene).
        if (!content && requested && !building) {
          content = townContent(requested, built);
          env.invalidate();
          return true;
        }
      } catch (error) {
        broken = true;
        console.warn('Live town extras unavailable', error);
        return false;
      }
      return building > 0;
    },
    invalidate() {
      look = undefined;
      rest = undefined;
      unprepare();
      far.ready = false;
      checked = undefined;
    },
    contextLost() {
      drop(false);
    },
    stats: () => stats,
    dispose() {
      disposed = true;
      drop(true);
    },
  };
}
