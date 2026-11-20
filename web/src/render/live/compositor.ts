/**
 * Live compositor (contract.ts): one visible canvas, one WebGL2 context, the 2D view of the V2, moving and at rest.
 *
 * A frame draws the layers of LIVE_LAYER_ORDER from what is already on the GPU: a layer that is `ready` draws itself
 * (isolated layers through one shared multisampled group, resolved and composited with their opacity), a layer that
 * is not shows its stand-in, the last exact raster of that layer as a quad that follows the view. Nothing here
 * depends on the amount of map content: one reused frame object, no canvas copy, no upload in a frame except a
 * stand-in or water raster whose source changed (once per source). A frame at rest is the same frame: the page
 * (v2/display/composedView.ts) asks each layer whether what it draws is the picture at rest (`restExact`) and hides
 * only the layers it shows by an exact canvas instead.
 *
 * Preparation (`work` of the layers, stand-in uploads) runs after each frame and in idle time, in slices: about
 * WORK_MOVING_MS per frame while the view moves, WORK_REST_MS per slice at rest, ground first.
 *
 * The `water` layer is the compositor's own: the vector water raster of the page (a world-region image).
 *
 * The frame has one camera (render/world/camera.ts): the top view, or the same world tilted. A tilted frame is one
 * scene (contract.ts): the layers that take the camera (`LiveLayer.tilts`) draw it in their order into one target with
 * one depth buffer, the multisampled group when the quality allows, resolved once. The layers that lie flat on the
 * ground are in the terrain of the ground layer: the compositor owns the map drape (render/world/mapDrape.ts), gives
 * it their `DrapeSource` and bakes its tiles in the work slices, in turn with the ground's.
 *
 * This file is one unit: the frame, the layer table with its stand-ins, the work loop with its pacing and the context
 * loss all share the state of one compositor. What stands alone is beside it: rasterQuad.ts (textured quads and
 * raster uploads), isolatedGroup.ts (the multisampled group), gpuTimer.ts (GPU time of a frame), liveStats.ts
 * (`globalThis.__muLive`).
 */
import { reportMachineFrame } from '../../v2/machineTier';
import { LIVE_CONTEXT_ATTRIBUTES, LIVE_LAYER_ORDER, resetLiveState, type LiveFrame, type LiveLayer, type LiveLayerName, type LiveLayerState, type LiveLayerStats } from './contract';
import { createGpuTimer } from './gpuTimer';
import { createIsolatedGroup } from './isolatedGroup';
import { liveStats, noteLiveUnit, pushSample } from './liveStats';
import { groundBudgetBehindPace, PACE_MIN_GAP_MS, paceHolds } from './policy';
import { createRasterQuad, dropRaster, uploadRaster, type Raster, type RasterQuad } from './rasterQuad';
import { SOFTWARE_GL } from '../softwareGl';
import type { View } from '../view';
import { createFrameCamera, frameCamera, isTilted, topViewMapping } from '../world/camera';
import type { DrapeSource, WorldRelief } from '../world/contract';
import { MapDrape } from '../world/mapDrape';

const WORK_MOVING_MS = 3,
  WORK_REST_MS = 8;
/** Share of a work slice the ground may take while another layer still has work (it is first and would starve them). */
const GROUND_SHARE = 0.6;
/** A moving frame newer than this means the per-frame slices own the work: idle callbacks stay out of the gesture. */
const GESTURE_MS = 120;

const WORK_UNIT: Record<LiveLayerName, string> = { ground: 'work:ground', water: 'work:water', overlay: 'work:overlay', city: 'work:city', buildings: 'work:buildings', trees: 'work:trees', text: 'work:text' };
const DRAW_UNIT: Record<LiveLayerName, string> = { ground: 'draw:ground', water: 'draw:water', overlay: 'draw:overlay', city: 'draw:city', buildings: 'draw:buildings', trees: 'draw:trees', text: 'draw:text' };
const stats = liveStats();

interface LiveCompositorOptions {
  /** Asks the page for a new animation frame (the viewer's invalidate): the compositor never draws by itself. */
  invalidate(): void;
  quality(): 'full' | 'light';
  /** The relief the camera of a tilted frame stands on; undefined: a flat map. Only asked for a tilted view. */
  relief(): WorldRelief | undefined;
  /** Side of the map in metres (0: no map), for the tiles of the map drape. */
  mapSize(): number;
  /** The page is still making the picture at rest of the view (an exact paint in steps, a layer it waits for): the
   * work of the layers that only prepare a tilt (LiveLayer.tiltOnly) waits for it in a top-view frame. */
  restPending(): boolean;
}
/** World square of a raster, in map metres. */
interface LiveRasterRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LiveCompositor {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  /** False while the context is lost (or after dispose): the caller presents the fallback view. */
  active(): boolean;
  /** Installs, replaces or removes a layer; the layer it replaces is disposed. */
  setLayer(name: LiveLayerName, layer: LiveLayer | undefined): void;
  hasLayer(name: LiveLayerName): boolean;
  /** Preparation still owed by this layer for the current frame, excluding other layers' background work. */
  layerPending(name: LiveLayerName): boolean;
  /** A layer that is not shown is neither drawn nor replaced by its stand-in (an exact canvas covers it); its `work` still runs. */
  setLayerShown(name: LiveLayerName, shown: boolean, preferRaster?: boolean): void;
  invalidateLayer(name: LiveLayerName): void;
  /** The exact raster of a layer, painted for `view` at `cssW` x `cssH`: uploaded once (in idle time, or in the first
   * frame that needs it) and shown, moved with the view, whenever the layer is not ready. Undefined clears it. */
  setStandIn(name: LiveLayerName, source: TexImageSource | undefined, view: View, cssW: number, cssH: number): void;
  clearStandIns(): void;
  /** The map style was switched: no picture of the previous look shows any more (stand-ins, the map drape's tiles,
   * what each layer holds: LiveLayer.lookChanged); the new look shows from its coarsest tiles up. */
  lookChanged(): void;
  /** The vector water raster of the frame (the `water` layer); uploaded when the image object changes. */
  setWater(image: TexImageSource | undefined, region?: LiveRasterRegion): void;
  /** Paper colour behind the layers (CSS colour). */
  setPaper(css: string): void;
  /** True inside a frame or a work slice: a frame request raised meanwhile comes from a live layer, not from new
   * map content (the page then leaves its exact layers as they are). */
  busy(): boolean;
  /** Whether the layer could draw a rest frame of this view now, from what it has on the GPU (nothing is drawn). */
  layerReady(name: LiveLayerName, view: View, cssW: number, cssH: number, dpr: number): boolean;
  /** Whether what the layer would draw for a rest frame of this view is its picture at rest (LiveLayer.restExact). */
  restExact(name: LiveLayerName, view: View, cssW: number, cssH: number, dpr: number): boolean;
  /** One slice of a layer's preparation for the last frame, outside the work loop (which goes on with the rest).
   * True while more is pending. */
  advanceLayer(name: LiveLayerName, budgetMs: number): boolean;
  hasStandIn(name: LiveLayerName): boolean;
  /** Draws one frame. False: nothing was presented (context lost). */
  draw(view: View, cssW: number, cssH: number, dpr: number, moving: boolean): boolean;
  /** A tilted view as a picture: the frame of `view` drawn by the same layers into an offscreen multisampled target of
   * `cssW * dpr` x `cssH * dpr` device pixels (cut to the context's limit), read back over the paper into `out`. A
   * synchronous readback, for a capture only. False in the top view (its exact renderers capture it), with the
   * context lost, or when the target cannot be made. */
  capture(view: View, cssW: number, cssH: number, dpr: number, out: HTMLCanvasElement): boolean;
  requestFrame(): void;
  /** Stops the background work (the page is hidden behind another view). */
  setPaused(paused: boolean): void;
  dispose(): void;
}

/** The one frame object, refilled in place every frame (layers receive it as a LiveFrame). */
type Frame = { -readonly [K in keyof Omit<LiveFrame, 'worldToPixel'>]: LiveFrame[K] } & { worldToPixel: [number, number, number, number] };
/** Undefined without WebGL2 or on a software renderer: the caller keeps the fallback view. */
export function createLiveCompositor(options: LiveCompositorOptions): LiveCompositor | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext('webgl2', LIVE_CONTEXT_ATTRIBUTES);
  } catch {
    context = null;
  }
  if (!context) return undefined;
  const gl = context;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = String((info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : undefined) || gl.getParameter(gl.RENDERER) || '');
  if (SOFTWARE_GL.test(rendererName)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return undefined;
  }
  canvas.className = 'viewer-live';
  canvas.style.cssText = 'position:absolute;left:0;top:0;display:block';

  let disposed = false,
    lost = gl.isContextLost(),
    paused = false,
    paper = '';
  const layers: Partial<Record<LiveLayerName, LiveLayer>> = {};
  const shown: Record<LiveLayerName, boolean> = { ground: true, water: true, overlay: true, city: true, buildings: true, trees: true, text: true };
  const standIns: Partial<Record<LiveLayerName, Raster>> = {};
  const preferRaster: Partial<Record<LiveLayerName, boolean>> = {};
  const states = {} as Record<LiveLayerName, LiveLayerState>;
  for (const name of LIVE_LAYER_ORDER) {
    states[name] = stats.layers[name] = { drawCalls: 0, triangles: 0, ms: 0, ready: false, standIn: false };
    stats.layerMs![name] ??= [];
    stats.pending[name] = false;
  }
  delete stats.errors;

  const camera = createFrameCamera();
  const frame: Frame = {
    gl,
    view: { cx: 0, cy: 0, scale: 1 },
    cssW: 1,
    cssH: 1,
    dpr: 1,
    width: 1,
    height: 1,
    rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    worldToClip: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    worldToPixel: [1, 1, 0, 0],
    camera,
    drape: undefined,
    target: null,
    now: 0,
    moving: false,
    quality: 'full',
  };
  /** The whole view of the last frame drawn (`frame.view` holds its centre and scale only). */
  const screenView: View = { cx: 0, cy: 0, scale: 1 };
  /** A frame was drawn since the context was (re)created: `frame` describes it. */
  let frameValid = false,
    lastFrameAt = 0,
    wasMoving = false,
    styleW = 0,
    styleH = 0;
  /** Pace of a moving view: the smoothed interval between its frames, and the best one seen (about the display's).
   * Preparation shares the task of a moving frame, and its units are indivisible (a ground tile, a recorded band): it
   * only runs while the frames keep the display's pace. A slower machine prepares at rest. */
  let paceGap = 0,
    paceBest = Infinity,
    paceOk = true;
  /** Refills the one frame object for a view. `frame.rect` is `viewRect(view, cssW, cssH)` (render/view.ts). */
  const fillFrame = (view: View, cssW: number, cssH: number, dpr: number, moving: boolean, now: number): void => {
    const width = Math.max(1, Math.round(cssW * dpr)),
      height = Math.max(1, Math.round(cssH * dpr));
    const hw = cssW / (2 * view.scale),
      hh = cssH / (2 * view.scale);
    frame.view.cx = view.cx;
    frame.view.cy = view.cy;
    frame.view.scale = view.scale;
    frame.cssW = cssW;
    frame.cssH = cssH;
    frame.dpr = dpr;
    frame.width = width;
    frame.height = height;
    frame.rect.minX = view.cx - hw;
    frame.rect.minY = view.cy - hh;
    frame.rect.maxX = view.cx + hw;
    frame.rect.maxY = view.cy + hh;
    topViewMapping(view, width, height, dpr, frame.worldToClip, frame.worldToPixel);
    frameCamera(camera, view, cssW, cssH, width, height, dpr, isTilted(view) ? options.relief() : undefined);
    frame.drape = camera.tilted ? drape.tiles : undefined;
    frame.target = null;
    frame.now = now;
    frame.moving = moving;
    frame.quality = options.quality();
    frameValid = true;
  };

  // --- own GL resources (rebuilt after a context loss) ---------------------------------------------------------------
  let quad: RasterQuad | undefined;
  const group = createIsolatedGroup(gl);
  /** The offscreen target of a capture: made for it, dropped after it. */
  const captureGroup = createIsolatedGroup(gl);
  const timer = createGpuTimer(gl, ms => pushSample(stats.gpuMs, ms));
  let maxTexture = 4096,
    maxSamples = 0;
  /** Program, limits and extensions; false when the context cannot build them (it is then treated as lost). */
  const init = (): boolean => {
    if (quad) return true;
    quad = createRasterQuad(gl);
    if (!quad) return false;
    maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
    timer.init();
    // The two sample counts a frame can ask for.
    group.probe([Math.min(4, maxSamples), 0]);
    return true;
  };
  /** A raster whose first row is its north edge, placed on its world square. */
  const drawRaster = (raster: Raster): void => {
    const m = frame.worldToPixel,
      kx = 2 / frame.width,
      ky = 2 / frame.height;
    quad!.draw(raster.texture!, (raster.minX * m[0] + m[2]) * kx - 1, 1 - (raster.minY * m[1] + m[3]) * ky, (raster.maxX * m[0] + m[2]) * kx - 1, 1 - (raster.maxY * m[1] + m[3]) * ky, 1);
  };
  const upload = (raster: Raster): void => {
    if (lost) raster.pending = false;
    else uploadRaster(gl, raster, maxTexture);
  };

  // --- the water layer: the page's vector water raster ---------------------------------------------------------------
  const water: Raster = { pending: false, mipmaps: true, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  /** The raster and the square the tiles of the map drape were last baked with, and their revision. The top view
   * changes its raster with the zoom; only the one a tilted frame has counts. */
  let waterRevision = 0,
    drapedWater: TexImageSource | undefined,
    drapedSquare = '';
  const waterStats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0 };
  const waterLayer: LiveLayer = {
    name: 'water',
    // In a tilted frame the raster lies on the terrain: the part of it over each tile of the map drape.
    drape: {
      revision: () => {
        const square = `${water.minX},${water.minY},${water.maxX},${water.maxY}`;
        if (water.source !== drapedWater || square !== drapedSquare) {
          drapedWater = water.source;
          drapedSquare = square;
          waterRevision++;
        }
        return waterRevision;
      },
      ready: () => !water.pending,
      paint: tile => {
        const w = water.maxX - water.minX,
          h = water.maxY - water.minY;
        if (water.texture && w > 0 && h > 0) tile.put(water.texture, (tile.rect.minX - water.minX) / w, (tile.rect.minY - water.minY) / h, (tile.rect.maxX - water.minX) / w, (tile.rect.maxY - water.minY) / h, 1);
      },
    },
    // No water raster (the GPU ground draws natural water itself): ready, and nothing to draw.
    ready: () => !water.source || !!water.texture,
    draw: () => {
      waterStats.drawCalls = waterStats.triangles = 0;
      if (water.texture) {
        drawRaster(water);
        waterStats.drawCalls = 1;
        waterStats.triangles = 2;
      }
    },
    contextLost: () => {
      water.texture = undefined;
      water.pending = !!water.source;
      waterRevision++;
    },
    stats: () => waterStats,
    dispose: () => {
      dropRaster(gl, water);
      water.source = undefined;
    },
  };
  layers.water = waterLayer;

  const fail = (name: LiveLayerName, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Live compositor: the ${name} layer failed and is dropped (${message}).`);
    (stats.errors ??= {})[name] = message;
    const layer = layers[name];
    layers[name] = undefined;
    stats.pending[name] = false;
    try {
      layer?.dispose();
    } catch {
      /* It already failed. */
    }
  };

  // --- work ----------------------------------------------------------------------------------------------------------
  let idleId: number | undefined, timerId: ReturnType<typeof setTimeout> | undefined;
  const cancelIdle = (): void => {
    if (idleId !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
    clearTimeout(timerId);
    idleId = undefined;
    timerId = undefined;
  };
  /** Inside a frame or a work slice: a frame request raised now comes from a live layer (LiveCompositor.busy). */
  let busy = 0;
  /** Back-pressure of the preparation. A slice queues work for the graphics process (tile bakes with the terrain
   * shader, mesh and texture uploads, overlay bakes) in a few milliseconds of main-thread time, but that work takes
   * the graphics process far longer: slices following each other at rest piled up hundreds of milliseconds of it, and
   * the first frame of the next gesture waited behind the pile (measured 100 to 580 ms on a large town). A fence
   * closes each slice; the next one starts only once the graphics process has reached it. The poll never waits. */
  let fence: WebGLSync | null = null;
  const gpuBehind = (): boolean => {
    if (!fence) return false;
    const status = gl.clientWaitSync(fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return true;
    gl.deleteSync(fence);
    fence = null;
    return false;
  };
  /** Both the work loop and the rest planner submit preparation to the same GPU queue. */
  const fenceWork = (started: number): void => {
    if (performance.now() - started > 0.3 && !lost) {
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
  };
  // --- the map drape of the tilted frames ----------------------------------------------------------------------------
  const drape = new MapDrape(gl, { mapSize: options.mapSize, invalidate: options.invalidate });
  stats.drape = drape.stats;
  /** The sources of the flat layers shown, bottom first: refilled at each slice. */
  const drapeSources: DrapeSource[] = [];
  /** Tiles of the drape are still to bake; the drape got no time in the last slice (the layers took it all). */
  let drapePending = false,
    drapeWaited = false;
  /** One slice of the drape's baking for the last frame, with what is `left` of the slice. True while tiles are
   * pending. The drape comes after the layers in a slice; when they left it nothing it comes first in the next one:
   * layers with long preparation (a large town, the volumes) would otherwise keep it waiting for as long as it lasts. */
  const drapeWork = (left: number, last: LiveFrame | undefined, refine: boolean): boolean => {
    const tilted = !!last?.camera.tilted;
    drapeSources.length = 0;
    if (tilted)
      for (const name of LIVE_LAYER_ORDER) {
        const source = layers[name]?.drape;
        if (source && shown[name]) drapeSources.push(source);
      }
    // Behind the display's pace, as the ground: the tiles wait. Out of time: the drape goes first next time.
    if (tilted && (!refine || left <= 0.2)) {
      drapeWaited = refine;
      return (drapePending = true);
    }
    drapeWaited = false;
    try {
      resetLiveState(gl, null, frame.width, frame.height);
      const unit = performance.now();
      drapePending = drape.work(left, last, drapeSources);
      if (tilted) noteLiveUnit('work:drape', unit);
    } catch (error) {
      console.warn('Live compositor: the map drape failed.', error);
      drapePending = false;
    }
    return drapePending;
  };

  const runWork = (budgetMs: number, refine = true): boolean => {
    if (lost || disposed) return false;
    // Still behind: the slice is due, later (the caller schedules it again).
    if (gpuBehind()) return true;
    busy++;
    try {
      const started = performance.now(),
        pending = workSlice(budgetMs, refine);
      // A slice that did something (the layers' own measure is their time): fenced, and flushed so the fence leaves now.
      fenceWork(started);
      return pending;
    } finally {
      busy--;
    }
  };
  /** One slice of preparation, ground first. True while more is pending. */
  /** `refine` false (a moving view behind the display's pace): the ground, whose work only sharpens what is already
   * shown, gets the budget of policy.ts (one tile, or none on light quality); the other layers' work is what keeps
   * their frames cheap (a snapshot, a baked prefix) and goes on. */
  const workSlice = (budgetMs: number, refine: boolean): boolean => {
    if (lost || disposed || !init()) return false;
    const started = performance.now(),
      last = frameValid ? frame : undefined;
    // The group of the next frame with an isolated layer, allocated here rather than in that frame.
    if (last && !group.failed && !group.target) group.ensure(last.width, last.height, last.quality === 'light' ? 0 : Math.min(4, maxSamples));
    let pending = false,
      othersPending = false;
    const drapeFirst = drapeWaited;
    if (drapeFirst && drapeWork(budgetMs, last, refine)) pending = true;
    for (let i = 1; i < LIVE_LAYER_ORDER.length; i++) othersPending ||= !!stats.pending[LIVE_LAYER_ORDER[i]];
    // In the top view the volumes only prepare a later tilt: they take what the picture on screen leaves.
    let shownPending = !!last && !last.camera.tilted && options.restPending();
    if (last && !last.camera.tilted) for (const name of LIVE_LAYER_ORDER) shownPending ||= !layers[name]?.tiltOnly && !!stats.pending[name];
    for (let i = 0; i < LIVE_LAYER_ORDER.length; i++) {
      const name = LIVE_LAYER_ORDER[i],
        layer = layers[name];
      if (!layer?.work) {
        stats.pending[name] = false;
        continue;
      }
      const behind = !refine && name === 'ground' ? groundBudgetBehindPace(last?.quality ?? 'light') : -1;
      if (behind === 0 || (shownPending && layer.tiltOnly)) {
        pending ||= !!stats.pending[name];
        continue;
      }
      const left = (behind > 0 ? behind : i === 0 && (othersPending || drapePending) ? budgetMs * GROUND_SHARE : budgetMs) - (performance.now() - started);
      // Out of time: its answer is unknown, so the loop comes back for it.
      if (left <= 0.2) {
        stats.pending[name] = true;
        pending = true;
        continue;
      }
      let more = false;
      try {
        resetLiveState(gl, null, frame.width, frame.height);
        const unit = performance.now();
        more = layer.work(left, last);
        noteLiveUnit(WORK_UNIT[name], unit);
        // A layer that was not ready for the last frame and now is: the frame is due (its `invalidate` may say so too).
        if (last && shown[name] && !preferRaster[name] && !states[name].ready && (!last.camera.tilted || layer.tilts) && layer.ready(last)) {
          states[name].ready = true;
          options.invalidate();
        }
        // Its preparation ended: what it draws may now be its picture at rest, which the page asks at a frame.
        else if (last && stats.pending[name] && !more) options.invalidate();
      } catch (error) {
        fail(name, error);
        more = false;
      }
      stats.pending[name] = more;
      pending ||= more;
    }
    if (!drapeFirst && drapeWork(budgetMs - (performance.now() - started), last, refine)) pending = true;
    // Stand-ins go up between frames, one per slice, so the first frame of a gesture finds them on the GPU.
    let uploaded = false;
    for (const name of LIVE_LAYER_ORDER) {
      const raster = standIns[name];
      if (!raster?.pending) continue;
      if (uploaded || performance.now() - started > budgetMs) {
        pending = true;
        continue;
      }
      upload(raster);
      raster.source = undefined;
      uploaded = true;
    }
    resetLiveState(gl, null, frame.width, frame.height);
    return pending;
  };
  const onIdle = (): void => {
    idleId = undefined;
    timerId = undefined;
    if (lost || disposed || paused) return;
    // During a gesture the slice after each frame is the whole budget.
    if (wasMoving && performance.now() - lastFrameAt < GESTURE_MS) {
      timerId = setTimeout(onIdle, GESTURE_MS);
      return;
    }
    if (runWork(WORK_REST_MS)) schedule();
  };
  const schedule = (): void => {
    if (idleId !== undefined || timerId !== undefined || lost || disposed || paused) return;
    if (typeof requestIdleCallback === 'function') idleId = requestIdleCallback(onIdle, { timeout: 200 });
    else timerId = setTimeout(onIdle, 16);
  };

  // --- context loss ----------------------------------------------------------------------------------------------------
  const onLost = (event: Event): void => {
    event.preventDefault(); // without it the context is never restored
    lost = true;
    frameValid = false;
    cancelIdle();
    fence = null;
    quad = undefined;
    group.contextLost();
    captureGroup.contextLost();
    timer.contextLost();
    drape.contextLost();
    drapePending = drapeWaited = false;
    for (const name of LIVE_LAYER_ORDER) {
      try {
        layers[name]?.contextLost?.();
      } catch (error) {
        fail(name, error);
      }
      // Their sources are the page's exact canvases, repainted since: their next complete paint gives new ones.
      delete standIns[name];
      states[name].ready = false;
      states[name].standIn = false;
    }
    stats.active = false;
    stats.reason = 'context lost';
    if (!disposed) options.invalidate(); // the page presents the fallback view meanwhile
  };
  const onRestored = (): void => {
    lost = gl.isContextLost();
    if (!lost && !disposed) options.invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  if (!lost) init();

  const drawIsolated = (layer: LiveLayer, width: number, height: number): void => {
    const g = group.target!;
    frame.target = g.fbo;
    resetLiveState(gl, g.fbo, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    try {
      layer.draw(frame);
    } finally {
      frame.target = null;
    }
    // The blit obeys the scissor and the colour mask the layer may have left.
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, g.resolve);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    resetLiveState(gl, null, width, height);
    const opacity = layer.opacity ? layer.opacity() : 1;
    quad!.draw(g.texture, -1, -1, 1, 1, opacity >= 1 ? 1 : opacity > 0 ? opacity : 0);
  };

  return {
    canvas,
    gl,
    active: () => !lost && !disposed,
    setLayer(name, layer) {
      const previous = layers[name];
      if (previous === layer) return;
      layers[name] = layer;
      states[name].ready = false;
      // A new ground layer is the ground of another terrain (composedView.ts contentChanged): the map drape's tiles
      // were baked over the previous one.
      if (name === 'ground') drape.forget();
      stats.pending[name] = !!layer?.work;
      if (stats.errors) delete stats.errors[name];
      try {
        previous?.dispose();
      } catch {
        /* A layer on its way out. */
      }
      if (layer?.work) schedule();
    },
    hasLayer: name => !!layers[name],
    layerPending: name => !!stats.pending[name],
    setLayerShown(name, value, raster) {
      shown[name] = value;
      preferRaster[name] = raster;
    },
    invalidateLayer(name) {
      const layer = layers[name];
      if (!layer?.invalidate) return;
      try {
        layer.invalidate();
      } catch (error) {
        fail(name, error);
      }
      stats.pending[name] = !!layer.work;
      schedule();
    },
    setStandIn(name, source, view, cssW, cssH) {
      let raster = standIns[name];
      if (!source) {
        if (raster) {
          dropRaster(gl, raster);
          delete standIns[name];
        }
        return;
      }
      raster ??= standIns[name] = { pending: false, mipmaps: false, minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const hw = cssW / (2 * view.scale),
        hh = cssH / (2 * view.scale);
      // Same square (a repaint of the same view): the previous texture shows until the new pixels are uploaded.
      // Another square: the old pixels would be laid on the new square, so they go now.
      if (raster.texture && (raster.minX !== view.cx - hw || raster.minY !== view.cy - hh || raster.maxX !== view.cx + hw || raster.maxY !== view.cy + hh)) dropRaster(gl, raster);
      raster.minX = view.cx - hw;
      raster.minY = view.cy - hh;
      raster.maxX = view.cx + hw;
      raster.maxY = view.cy + hh;
      raster.source = source;
      raster.pending = true;
      schedule();
    },
    clearStandIns() {
      for (const name of LIVE_LAYER_ORDER) {
        const raster = standIns[name];
        if (raster) {
          dropRaster(gl, raster);
          delete standIns[name];
        }
      }
    },
    lookChanged() {
      this.clearStandIns();
      drape.forget();
      for (const name of LIVE_LAYER_ORDER) {
        const layer = layers[name];
        if (!layer?.lookChanged) continue;
        try {
          layer.lookChanged();
        } catch (error) {
          fail(name, error);
        }
        stats.pending[name] = !!layer.work;
      }
      schedule();
    },
    setWater(image, region) {
      if (region) {
        water.minX = region.x;
        water.minY = region.y;
        water.maxX = region.x + region.width;
        water.maxY = region.y + region.height;
      }
      if (image === water.source && !water.pending) return;
      water.source = image;
      if (!image) {
        dropRaster(gl, water);
        return;
      }
      if (lost || !init()) {
        water.pending = true;
        return;
      }
      upload(water);
    },
    setPaper(css) {
      if (paper !== css) {
        paper = css;
        canvas.style.backgroundColor = css;
      }
    },
    busy: () => busy > 0,
    layerReady(name, view, cssW, cssH, dpr) {
      const layer = layers[name];
      if (!layer || lost || disposed || !init()) return false;
      fillFrame(view, cssW, cssH, dpr, false, performance.now());
      busy++;
      try {
        resetLiveState(gl, null, frame.width, frame.height);
        return layer.ready(frame) && !(layer.isolated && group.failed);
      } catch (error) {
        fail(name, error);
        return false;
      } finally {
        busy--;
      }
    },
    restExact(name, view, cssW, cssH, dpr) {
      const layer = layers[name];
      if (!layer?.restExact || lost || disposed || !init()) return false;
      fillFrame(view, cssW, cssH, dpr, false, performance.now());
      busy++;
      try {
        resetLiveState(gl, null, frame.width, frame.height);
        return layer.ready(frame) && !(layer.isolated && group.failed) && layer.restExact(frame);
      } catch (error) {
        fail(name, error);
        return false;
      } finally {
        busy--;
      }
    },
    advanceLayer(name, budgetMs) {
      const layer = layers[name];
      if (!layer?.work || lost || disposed || !init()) return false;
      if (gpuBehind()) {
        stats.pending[name] = true;
        schedule();
        return true;
      }
      busy++;
      let more = false;
      try {
        resetLiveState(gl, null, frame.width, frame.height);
        const unit = performance.now();
        more = layer.work(budgetMs, frameValid ? frame : undefined);
        noteLiveUnit(WORK_UNIT[name], unit);
        resetLiveState(gl, null, frame.width, frame.height);
        fenceWork(unit);
      } catch (error) {
        fail(name, error);
      } finally {
        busy--;
      }
      stats.pending[name] = more;
      if (more) schedule();
      return more;
    },
    hasStandIn: name => !!standIns[name]?.texture || !!standIns[name]?.pending,
    draw(view, cssW, cssH, dpr, moving) {
      if (lost || disposed || !init()) return false;
      busy++;
      try {
        return drawFrame(view, cssW, cssH, dpr, moving);
      } finally {
        busy--;
      }
    },
    capture(view, cssW, cssH, dpr, out) {
      if (lost || disposed || !init() || !isTilted(view)) return false;
      busy++;
      try {
        return captureFrame(view, cssW, cssH, dpr, out);
      } finally {
        busy--;
      }
    },
    requestFrame() {
      if (!disposed) options.invalidate();
    },
    setPaused(value) {
      paused = value;
      if (paused) cancelIdle();
      else schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelIdle();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const name of LIVE_LAYER_ORDER) {
        try {
          layers[name]?.dispose();
        } catch {
          /* Disposal goes on. */
        }
        layers[name] = undefined;
        const raster = standIns[name];
        if (raster && !lost) dropRaster(gl, raster);
        delete standIns[name];
        stats.pending[name] = false;
      }
      if (!lost) {
        drape.dispose();
        group.drop();
        captureGroup.drop();
        quad?.dispose();
        timer.dispose();
      }
      quad = undefined;
      canvas.remove();
      stats.active = false;
      stats.reason = 'disposed';
      // Frees the GPU memory now rather than at the next collection of the canvas.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };

  /** LiveCompositor.capture: the layers that take the camera draw the tilted frame into the capture target, as
   * drawFrame draws it on screen (no stand-in, no statistics); the frame object is then refilled for the view on
   * screen, which the work slices go on preparing. */
  function captureFrame(view: View, cssW: number, cssH: number, dpr: number, out: HTMLCanvasElement): boolean {
    const onScreen = frameValid ? { view: { ...screenView }, cssW: frame.cssW, cssH: frame.cssH, dpr: frame.dpr, moving: frame.moving } : undefined;
    const limit = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 4096;
    fillFrame(view, cssW, cssH, Math.min(dpr, limit / Math.max(cssW, cssH)), false, performance.now());
    const width = frame.width,
      height = frame.height,
      samples = frame.quality === 'light' ? 0 : Math.min(4, maxSamples);
    let pixels: Uint8Array | undefined;
    if (captureGroup.ensure(width, height, samples) || (samples > 0 && captureGroup.ensure(width, height, 0))) {
      const scene = captureGroup.target!;
      resetLiveState(gl, scene.fbo, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      for (const name of LIVE_LAYER_ORDER) {
        const layer = layers[name];
        if (!shown[name] || !layer?.tilts) continue;
        frame.target = scene.fbo;
        resetLiveState(gl, scene.fbo, width, height);
        try {
          if (layer.ready(frame)) layer.draw(frame);
        } catch (error) {
          fail(name, error);
        }
      }
      frame.target = null;
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.resolve);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.resolve);
      pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    captureGroup.drop();
    resetLiveState(gl, null, width, height);
    if (onScreen) fillFrame(onScreen.view, onScreen.cssW, onScreen.cssH, onScreen.dpr, onScreen.moving, performance.now());
    else frameValid = false;
    if (!pixels) return false;
    composeOverPaper(pixels, width, height, paper, out);
    return true;
  }

  function drawFrame(view: View, cssW: number, cssH: number, dpr: number, moving: boolean): boolean {
    const started = performance.now();
    fillFrame(view, cssW, cssH, dpr, moving, started);
    screenView.cx = view.cx;
    screenView.cy = view.cy;
    screenView.scale = view.scale;
    screenView.pitch = view.pitch;
    screenView.yaw = view.yaw;
    screenView.eye = view.eye;
    const width = frame.width,
      height = frame.height;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (styleW !== cssW || styleH !== cssH) {
      styleW = cssW;
      styleH = cssH;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
    // Light quality drops the multisampling of a moving view only: a live layer is also the picture at rest, where
    // the edges are looked at and the fill cost is paid once.
    const samples = frame.quality === 'light' && moving ? 0 : Math.min(4, maxSamples);

    timer.poll();
    timer.begin();
    // A gesture begins: the exact canvases behind the pending stand-ins are repainted when it ends, so they go up now
    // (idle time has normally done it already).
    if (moving && !wasMoving)
      for (const name of LIVE_LAYER_ORDER) {
        const raster = standIns[name];
        if (raster?.pending) {
          upload(raster);
          raster.source = undefined;
        }
      }
    if (water.pending) upload(water);
    resetLiveState(gl, null, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    // A tilted frame is one scene: its layers draw into one target and share its depth. The multisampled group when
    // the frame has samples (the terrain's silhouettes and the volumes are then antialiased), else the canvas.
    const tilted = camera.tilted,
      scene = tilted && samples > 0 && group.ensure(width, height, samples) ? group.target! : undefined;
    if (scene) {
      resetLiveState(gl, scene.fbo, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    }
    for (let i = 0; i < LIVE_LAYER_ORDER.length; i++) {
      const name = LIVE_LAYER_ORDER[i],
        state = states[name];
      if (!shown[name]) {
        state.ready = false;
        state.standIn = false;
        state.ms = 0;
        state.drawCalls = 0;
        state.triangles = 0;
        continue;
      }
      const t = performance.now(),
        // A tilted frame is drawn by the layers that take its camera; the others are in the map drape of the terrain
        // or left out, as is every stand-in (a flat raster of the top view).
        layer = !tilted || layers[name]?.tilts ? layers[name] : undefined,
        target = scene ? scene.fbo : null;
      let ready = false,
        standIn = false;
      frame.target = target;
      resetLiveState(gl, target, width, height);
      if (layer && (tilted || !preferRaster[name] || !standIns[name])) {
        try {
          ready = layer.ready(frame);
          if (ready) {
            if (tilted || !layer.isolated) layer.draw(frame);
            else if (group.ensure(width, height, samples)) {
              noteLiveUnit('group', t);
              drawIsolated(layer, width, height);
            } else ready = false;
          }
        } catch (error) {
          fail(name, error);
          ready = false;
        }
      }
      if (!ready && !tilted) {
        const raster = standIns[name];
        if (raster) {
          if (raster.pending) {
            upload(raster);
            raster.source = undefined;
          }
          if (raster.texture) {
            resetLiveState(gl, null, width, height);
            drawRaster(raster);
            standIn = true;
          }
        }
      }
      state.drawCalls = standIn ? 1 : 0;
      state.triangles = standIn ? 2 : 0;
      if (ready && layer?.stats) {
        try {
          const own = layer.stats();
          for (const key in own) state[key] = own[key];
        } catch (error) {
          fail(name, error);
        }
      }
      state.ready = ready;
      state.standIn = standIn;
      state.ms = performance.now() - t;
      pushSample(stats.layerMs![name]!, state.ms);
      noteLiveUnit(DRAW_UNIT[name], t);
    }
    frame.target = null;
    if (scene) {
      // The blit obeys the scissor and the colour mask a layer may have left.
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.resolve);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      resetLiveState(gl, null, width, height);
      quad!.draw(scene.texture, -1, -1, 1, 1, 1);
    }
    resetLiveState(gl, null, width, height);
    timer.end();
    stats.active = true;
    delete stats.reason;
    stats.frames++;
    pushSample(stats.frameMs, performance.now() - started);
    if (moving && wasMoving) {
      const gap = started - lastFrameAt;
      // A gap longer than a gesture's pause is not a frame interval (the view rested in between), nor one shorter than
      // any display's (policy.ts).
      if (gap < GESTURE_MS && gap >= PACE_MIN_GAP_MS) {
        reportMachineFrame(gap);
        paceGap = paceGap ? paceGap * 0.8 + gap * 0.2 : gap;
        // The best interval creeps up so a display that slows down (another refresh rate, throttling) is followed.
        paceBest = Math.min(paceBest * 1.002, gap);
        paceOk = paceHolds(paceGap, paceBest);
      }
    } else if (!moving) {
      paceGap = 0;
      paceOk = true;
    }
    lastFrameAt = started;
    wasMoving = moving;
    // After the frame is submitted: the slice of preparation this frame can afford.
    if (paused) return !lost;
    // Behind the display's pace: the ground's refinement waits for the pace to come back or for the view to rest.
    if (runWork(moving ? WORK_MOVING_MS : WORK_REST_MS, !moving || paceOk)) schedule();
    return !lost;
  }
}

/** Premultiplied pixels read back from GL (first row at the bottom) laid over the paper colour, into `out`: an opaque
 * picture, north at the top. */
function composeOverPaper(pixels: Uint8Array, width: number, height: number, paper: string, out: HTMLCanvasElement): void {
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = paper || '#fff';
  ctx.fillRect(0, 0, 1, 1);
  const [pr, pg, pb] = ctx.getImageData(0, 0, 1, 1).data,
    image = ctx.createImageData(width, height),
    data = image.data;
  for (let y = 0; y < height; y++) {
    let from = (height - 1 - y) * width * 4,
      to = y * width * 4;
    for (let x = 0; x < width; x++, from += 4, to += 4) {
      const keep = (255 - pixels[from + 3]) / 255;
      data[to] = pixels[from] + pr * keep;
      data[to + 1] = pixels[from + 1] + pg * keep;
      data[to + 2] = pixels[from + 2] + pb * keep;
      data[to + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
