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
 * This file is one unit: the frame, the layer table with its stand-ins, the work loop with its pacing and the context
 * loss all share the state of one compositor. What stands alone is beside it: rasterQuad.ts (textured quads and
 * raster uploads), isolatedGroup.ts (the multisampled group), gpuTimer.ts (GPU time of a frame), liveStats.ts
 * (`globalThis.__muLive`).
 */
import { LIVE_CONTEXT_ATTRIBUTES, LIVE_LAYER_ORDER, resetLiveState, type LiveFrame, type LiveLayer, type LiveLayerName, type LiveLayerState, type LiveLayerStats } from './contract';
import { createGpuTimer } from './gpuTimer';
import { createIsolatedGroup } from './isolatedGroup';
import { liveStats, noteLiveUnit, pushSample } from './liveStats';
import { createRasterQuad, dropRaster, uploadRaster, type Raster, type RasterQuad } from './rasterQuad';
import type { View } from '../view';

/** Same test as render/cityGl.ts: a software rasterizer composes slower than the fallback view it would replace. */
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft warp|software/i;
const WORK_MOVING_MS = 3,
  WORK_REST_MS = 8;
/** Share of a work slice the ground may take while another layer still has work (it is first and would starve them). */
const GROUND_SHARE = 0.6;
/** A moving frame newer than this means the per-frame slices own the work: idle callbacks stay out of the gesture. */
const GESTURE_MS = 120;

const WORK_UNIT: Record<LiveLayerName, string> = { ground: 'work:ground', water: 'work:water', overlay: 'work:overlay', city: 'work:city', text: 'work:text' };
const DRAW_UNIT: Record<LiveLayerName, string> = { ground: 'draw:ground', water: 'draw:water', overlay: 'draw:overlay', city: 'draw:city', text: 'draw:text' };
export { liveStats, noteLiveUnit, noteFallbackFrame } from './liveStats';

const stats = liveStats();

export interface LiveCompositorOptions {
  /** Asks the page for a new animation frame (the viewer's invalidate): the compositor never draws by itself. */
  invalidate(): void;
  quality(): 'full' | 'light';
}
/** World square of a raster, in map metres. */
export interface LiveRasterRegion {
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
  /** A layer that is not shown is neither drawn nor replaced by its stand-in (an exact canvas covers it); its `work` still runs. */
  setLayerShown(name: LiveLayerName, shown: boolean): void;
  invalidateLayer(name: LiveLayerName): void;
  /** The exact raster of a layer, painted for `view` at `cssW` x `cssH`: uploaded once (in idle time, or in the first
   * frame that needs it) and shown, moved with the view, whenever the layer is not ready. Undefined clears it. */
  setStandIn(name: LiveLayerName, source: TexImageSource | undefined, view: View, cssW: number, cssH: number): void;
  clearStandIns(): void;
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
  const shown: Record<LiveLayerName, boolean> = { ground: true, water: true, overlay: true, city: true, text: true };
  const standIns: Partial<Record<LiveLayerName, Raster>> = {};
  const states = {} as Record<LiveLayerName, LiveLayerState>;
  for (const name of LIVE_LAYER_ORDER) {
    states[name] = stats.layers[name] = { drawCalls: 0, triangles: 0, ms: 0, ready: false, standIn: false };
    stats.layerMs![name] ??= [];
    stats.pending[name] = false;
  }
  delete stats.errors;

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
    target: null,
    now: 0,
    moving: false,
    quality: 'full',
  };
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
    const s = view.scale * dpr,
      tx = width / 2 - view.cx * s,
      ty = height / 2 - view.cy * s,
      hw = cssW / (2 * view.scale),
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
    const m = frame.worldToClip,
      p = frame.worldToPixel;
    m[0] = (2 * s) / width;
    m[1] = 0;
    m[2] = 0;
    m[3] = 0;
    m[4] = (-2 * s) / height;
    m[5] = 0;
    m[6] = (2 * tx) / width - 1;
    m[7] = 1 - (2 * ty) / height;
    m[8] = 1;
    p[0] = s;
    p[1] = s;
    p[2] = tx;
    p[3] = ty;
    frame.target = null;
    frame.now = now;
    frame.moving = moving;
    frame.quality = options.quality();
    frameValid = true;
  };

  // --- own GL resources (rebuilt after a context loss) ---------------------------------------------------------------
  let quad: RasterQuad | undefined;
  const group = createIsolatedGroup(gl);
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
  const waterStats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0 };
  const waterLayer: LiveLayer = {
    name: 'water',
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
  const runWork = (budgetMs: number, refine = true): boolean => {
    if (lost || disposed) return false;
    // Still behind: the slice is due, later (the caller schedules it again).
    if (gpuBehind()) return true;
    busy++;
    try {
      const started = performance.now(),
        pending = workSlice(budgetMs, refine);
      // A slice that did something (the layers' own measure is their time): fenced, and flushed so the fence leaves now.
      if (performance.now() - started > 0.3 && !lost) {
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
      }
      return pending;
    } finally {
      busy--;
    }
  };
  /** One slice of preparation, ground first. True while more is pending. */
  /** `refine` false (a moving view behind the display's pace): the ground, whose work only sharpens what is already
   * shown, waits; the other layers' work is what keeps their frames cheap (a snapshot, a baked prefix) and goes on. */
  const workSlice = (budgetMs: number, refine: boolean): boolean => {
    if (lost || disposed || !init()) return false;
    const started = performance.now(),
      last = frameValid ? frame : undefined;
    // The group of the next frame with an isolated layer, allocated here rather than in that frame.
    if (last && !group.failed && !group.target) group.ensure(last.width, last.height, last.quality === 'light' ? 0 : Math.min(4, maxSamples));
    let pending = false,
      othersPending = false;
    for (let i = 1; i < LIVE_LAYER_ORDER.length; i++) othersPending ||= !!stats.pending[LIVE_LAYER_ORDER[i]];
    for (let i = 0; i < LIVE_LAYER_ORDER.length; i++) {
      const name = LIVE_LAYER_ORDER[i],
        layer = layers[name];
      if (!layer?.work) {
        stats.pending[name] = false;
        continue;
      }
      if (!refine && name === 'ground') {
        pending ||= !!stats.pending[name];
        continue;
      }
      const left = (i === 0 && othersPending ? budgetMs * GROUND_SHARE : budgetMs) - (performance.now() - started);
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
        if (last && shown[name] && !states[name].ready && layer.ready(last)) {
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
    timer.contextLost();
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
    setLayerShown(name, value) {
      shown[name] = value;
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
      busy++;
      let more = false;
      try {
        resetLiveState(gl, null, frame.width, frame.height);
        const unit = performance.now();
        more = layer.work(budgetMs, frameValid ? frame : undefined);
        noteLiveUnit(WORK_UNIT[name], unit);
        resetLiveState(gl, null, frame.width, frame.height);
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
        group.drop();
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

  function drawFrame(view: View, cssW: number, cssH: number, dpr: number, moving: boolean): boolean {
    const started = performance.now();
    fillFrame(view, cssW, cssH, dpr, moving, started);
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
        layer = layers[name];
      let ready = false,
        standIn = false;
      frame.target = null;
      resetLiveState(gl, null, width, height);
      if (layer) {
        try {
          ready = layer.ready(frame);
          if (ready) {
            if (!layer.isolated) layer.draw(frame);
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
      if (!ready) {
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
    resetLiveState(gl, null, width, height);
    timer.end();
    stats.active = true;
    delete stats.reason;
    stats.frames++;
    pushSample(stats.frameMs, performance.now() - started);
    if (moving && wasMoving) {
      const gap = started - lastFrameAt;
      // A gap longer than a gesture's pause is not a frame interval (the view rested in between).
      if (gap < GESTURE_MS) {
        paceGap = paceGap ? paceGap * 0.8 + gap * 0.2 : gap;
        // The best interval creeps up so a display that slows down (another refresh rate, throttling) is followed.
        paceBest = Math.min(paceBest * 1.002, gap);
        paceOk = paceGap <= Math.max(paceBest, 4) * 1.4 + 1;
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
