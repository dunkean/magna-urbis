/**
 * Live compositor (contract.ts): one visible canvas, one WebGL2 context, the moving 2D view of the V2.
 *
 * A frame draws the layers of LIVE_LAYER_ORDER from what is already on the GPU: a layer that is `ready` draws itself
 * (isolated layers through one shared multisampled group, resolved and composited with their opacity), a layer that
 * is not shows its stand-in, the last exact raster of that layer as a quad that follows the view. Nothing here
 * depends on the amount of map content: one reused frame object, no canvas copy, no upload in a frame except a
 * stand-in or water raster whose source changed (once per source).
 *
 * Preparation (`work` of the layers, stand-in uploads) runs after each frame and in idle time, in slices: about
 * WORK_MOVING_MS per frame while the view moves, WORK_REST_MS per slice at rest, ground first.
 *
 * The `water` layer is the compositor's own: the vector water raster of the page (a world-region image).
 * Stats: `globalThis.__muLive` (LiveStats), defined when this module loads.
 */
import { LIVE_CONTEXT_ATTRIBUTES, LIVE_LAYER_ORDER, resetLiveState, type LiveFrame, type LiveLayer, type LiveLayerName, type LiveLayerState, type LiveLayerStats, type LiveStats } from './contract';
import { getLiveMode } from './policy';
import type { View } from '../view';

/** Same test as render/cityGl.ts: a software rasterizer composes slower than the classic path it would replace. */
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft warp|software/i;
const WORK_MOVING_MS = 3, WORK_REST_MS = 8;
/** Share of a work slice the ground may take while another layer still has work (it is first and would starve them). */
const GROUND_SHARE = 0.6;
/** A moving frame newer than this means the per-frame slices own the work: idle callbacks stay out of the gesture. */
const GESTURE_MS = 120;
const SERIES = 4000;
const TIMER_QUERIES = 4;

const WORK_UNIT: Record<LiveLayerName, string> = { ground: 'work:ground', water: 'work:water', overlay: 'work:overlay', city: 'work:city', text: 'work:text' };
const DRAW_UNIT: Record<LiveLayerName, string> = { ground: 'draw:ground', water: 'draw:water', overlay: 'draw:overlay', city: 'draw:city', text: 'draw:text' };
const push = (list: number[], value: number): void => { list.push(value); if (list.length > SERIES) list.shift(); };

const stats: LiveStats = {
  mode: getLiveMode(), active: false, reason: 'no frame yet', frames: 0, frameMs: [], gpuMs: [], layers: {}, pending: {}, layerMs: {},
  slow: [],
  reset() {
    stats.frames = 0; stats.frameMs.length = 0; stats.gpuMs.length = 0; stats.slow!.length = 0;
    for (const name of LIVE_LAYER_ORDER) { const series = stats.layerMs![name]; if (series) series.length = 0; }
  },
};
if (typeof document !== 'undefined') (globalThis as unknown as Record<string, unknown>).__muLive = stats;
export const liveStats = (): LiveStats => stats;
/** A unit of work that held the main thread for SLOW_MS or more since `since` goes to the journal (LiveStats.slow). */
const SLOW_MS = 20;
export function noteLiveUnit(what: string, since: number): void {
  const now = performance.now(), ms = now - since;
  if (ms < SLOW_MS) return;
  const slow = stats.slow!; slow.push([what, Math.round(ms * 10) / 10, Math.round(since)]); if (slow.length > 64) slow.shift();
}
/** The classic path presented the frame of the 2D view. */
export function noteClassicFrame(reason: string): void { stats.mode = getLiveMode(); stats.active = false; stats.reason = reason; }

export interface LiveCompositorOptions {
  /** Asks the page for a new animation frame (the viewer's invalidate): the compositor never draws by itself. */
  invalidate(): void;
  quality(): 'full' | 'light';
}
/** World square of a raster, in map metres. */
export interface LiveRasterRegion { x: number; y: number; width: number; height: number }
export interface LiveCompositor {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  /** False while the context is lost (or after dispose): the caller presents the classic path. */
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
  /** Draws one frame. False: nothing was presented (context lost). */
  draw(view: View, cssW: number, cssH: number, dpr: number, moving: boolean): boolean;
  requestFrame(): void;
  /** Stops the background work (the page is hidden behind another view). */
  setPaused(paused: boolean): void;
  dispose(): void;
}

/** The one frame object, refilled in place every frame (layers receive it as a LiveFrame). */
type Frame = { -readonly [K in keyof Omit<LiveFrame, 'worldToPixel'>]: LiveFrame[K] } & { worldToPixel: [number, number, number, number] };
interface Raster { texture?: WebGLTexture; source?: TexImageSource; pending: boolean; mipmaps: boolean; minX: number; minY: number; maxX: number; maxY: number }
interface Quad { program: WebGLProgram; vao: WebGLVertexArrayObject; rect: WebGLUniformLocation | null; opacity: WebGLUniformLocation | null }
interface Group { fbo: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; resolve: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number; samples: number }
interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

const QUAD_VS = `#version 300 es
uniform vec4 uRect;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = c;
  gl_Position = vec4(mix(uRect.xy, uRect.zw, c), 0.0, 1.0);
}`;
const QUAD_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 color;
void main() { color = texture(uTex, vUv) * uOpacity; }`;

function sourceSize(source: TexImageSource): { width: number; height: number } {
  const s = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
  return { width: s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0, height: s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0 };
}

/** Undefined without WebGL2 or on a software renderer: the caller keeps the classic path. */
export function createLiveCompositor(options: LiveCompositorOptions): LiveCompositor | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  let context: WebGL2RenderingContext | null = null;
  try { context = canvas.getContext('webgl2', LIVE_CONTEXT_ATTRIBUTES); } catch { context = null; }
  if (!context) return undefined;
  const gl = context;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = String((info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : undefined) || gl.getParameter(gl.RENDERER) || '');
  if (SOFTWARE_GL.test(rendererName)) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return undefined; }
  canvas.className = 'viewer-live';
  canvas.style.cssText = 'position:absolute;left:0;top:0;display:block';

  let disposed = false, lost = gl.isContextLost(), paused = false, paper = '';
  const layers: Partial<Record<LiveLayerName, LiveLayer>> = {};
  const shown: Record<LiveLayerName, boolean> = { ground: true, water: true, overlay: true, city: true, text: true };
  const standIns: Partial<Record<LiveLayerName, Raster>> = {};
  const states = {} as Record<LiveLayerName, LiveLayerState>;
  for (const name of LIVE_LAYER_ORDER) {
    states[name] = stats.layers[name] = { drawCalls: 0, triangles: 0, ms: 0, ready: false, standIn: false };
    stats.layerMs![name] ??= []; stats.pending[name] = false;
  }
  delete stats.errors;

  const frame: Frame = {
    gl, view: { cx: 0, cy: 0, scale: 1 }, cssW: 1, cssH: 1, dpr: 1, width: 1, height: 1, rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    worldToClip: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), worldToPixel: [1, 1, 0, 0], target: null, now: 0, moving: false, quality: 'full',
  };
  /** A frame was drawn since the context was (re)created: `frame` describes it. */
  let frameValid = false, lastFrameAt = 0, wasMoving = false, styleW = 0, styleH = 0;
  /** Pace of a moving view: the smoothed interval between its frames, and the best one seen (about the display's).
   * Preparation shares the task of a moving frame, and its units are indivisible (a ground tile, a recorded band): it
   * only runs while the frames keep the display's pace. A slower machine prepares at rest. */
  let paceGap = 0, paceBest = Infinity, paceOk = true;
  /** Sample counts whose isolated group was found complete (ensureGroup). */
  const groupChecked = new Set<number>();
  /** Refills the one frame object for a view. `frame.rect` is `viewRect(view, cssW, cssH)` (render/view.ts). */
  const fillFrame = (view: View, cssW: number, cssH: number, dpr: number, moving: boolean, now: number): void => {
    const width = Math.max(1, Math.round(cssW * dpr)), height = Math.max(1, Math.round(cssH * dpr));
    const s = view.scale * dpr, tx = width / 2 - view.cx * s, ty = height / 2 - view.cy * s, hw = cssW / (2 * view.scale), hh = cssH / (2 * view.scale);
    frame.view.cx = view.cx; frame.view.cy = view.cy; frame.view.scale = view.scale;
    frame.cssW = cssW; frame.cssH = cssH; frame.dpr = dpr; frame.width = width; frame.height = height;
    frame.rect.minX = view.cx - hw; frame.rect.minY = view.cy - hh; frame.rect.maxX = view.cx + hw; frame.rect.maxY = view.cy + hh;
    const m = frame.worldToClip, p = frame.worldToPixel;
    m[0] = 2 * s / width; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = -2 * s / height; m[5] = 0; m[6] = 2 * tx / width - 1; m[7] = 1 - 2 * ty / height; m[8] = 1;
    p[0] = s; p[1] = s; p[2] = tx; p[3] = ty;
    frame.target = null; frame.now = now; frame.moving = moving; frame.quality = options.quality();
    frameValid = true;
  };

  // --- own GL resources (rebuilt after a context loss) ---------------------------------------------------------------
  let quad: Quad | undefined, group: Group | undefined, groupFailed = false;
  let maxTexture = 4096, maxSamples = 0;
  let timer: TimerExtension | null = null;
  const queries: (WebGLQuery | null)[] = [], queryBusy: boolean[] = [];
  for (let i = 0; i < TIMER_QUERIES; i++) { queries.push(null); queryBusy.push(false); }
  let openQuery = -1;

  const shader = (type: number, source: string): WebGLShader | null => {
    const s = gl.createShader(type); if (!s) return null;
    gl.shaderSource(s, source); gl.compileShader(s); return s;
  };
  /** Program, limits and extensions; false when the context cannot build them (it is then treated as lost). */
  const init = (): boolean => {
    if (quad) return true;
    const vs = shader(gl.VERTEX_SHADER, QUAD_VS), fs = shader(gl.FRAGMENT_SHADER, QUAD_FS), program = gl.createProgram(), vao = gl.createVertexArray();
    if (!vs || !fs || !program || !vao) return false;
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    // Once per context, never in a frame: a broken link would otherwise draw nothing without a word.
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.warn('Live compositor: quad program', gl.getProgramInfoLog(program)); gl.deleteProgram(program); gl.deleteVertexArray(vao); return false; }
    gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0); gl.useProgram(null);
    quad = { program, vao, rect: gl.getUniformLocation(program, 'uRect'), opacity: gl.getUniformLocation(program, 'uOpacity') };
    maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096; maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
    timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
    // The completeness of the isolated group is a synchronous query: asked here, on a 4 x 4 group, for the two
    // sample counts a frame can ask for, while the graphics queue is still short. A frame never asks again.
    for (const samples of [Math.min(4, maxSamples), 0]) if (!groupFailed && !groupChecked.has(samples)) ensureGroup(4, 4, samples);
    dropGroup();
    return true;
  };
  const dropGroup = (): void => {
    if (!group) return;
    gl.deleteFramebuffer(group.fbo); gl.deleteFramebuffer(group.resolve); gl.deleteRenderbuffer(group.color); gl.deleteRenderbuffer(group.depth); gl.deleteTexture(group.texture);
    group = undefined;
  };
  /** The shared isolated group at the size of the frame: multisampled colour + depth/stencil, and its resolve texture. */
  const ensureGroup = (width: number, height: number, samples: number): boolean => {
    if (group && group.width === width && group.height === height && group.samples === samples) return true;
    if (groupFailed) return false;
    dropGroup();
    const fbo = gl.createFramebuffer(), resolve = gl.createFramebuffer(), color = gl.createRenderbuffer(), depth = gl.createRenderbuffer(), texture = gl.createTexture();
    if (!fbo || !resolve || !color || !depth || !texture) return false;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
    // A synchronous query (the page waits for the graphics process to drain its queue): asked once per sample count,
    // since completeness depends on the formats and the samples, not on the size (a resize rebuilds the group).
    const checked = groupChecked.has(samples);
    let complete = checked || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    complete &&= checked || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (complete) groupChecked.add(samples);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    group = { fbo, color, depth, resolve, texture, width, height, samples };
    if (!complete && !gl.isContextLost()) {
      // Isolated layers then show their stand-in: drawn straight on the canvas their blending would be wrong.
      console.warn('Live compositor: the isolated group is incomplete; isolated layers fall back to their stand-in.');
      dropGroup(); groupFailed = true; return false;
    }
    return true;
  };

  /** Premultiplied source-over quad; corners in clip space, (x0, y0) is the texel (0, 0). */
  const drawQuad = (texture: WebGLTexture, x0: number, y0: number, x1: number, y1: number, opacity: number): void => {
    const q = quad!;
    gl.useProgram(q.program); gl.bindVertexArray(q.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(q.rect, x0, y0, x1, y1); gl.uniform1f(q.opacity, opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null); gl.bindVertexArray(null); gl.useProgram(null);
  };
  /** A raster whose first row is its north edge, placed on its world square. */
  const drawRaster = (raster: Raster): void => {
    const m = frame.worldToPixel, kx = 2 / frame.width, ky = 2 / frame.height;
    drawQuad(raster.texture!, (raster.minX * m[0] + m[2]) * kx - 1, 1 - (raster.minY * m[1] + m[3]) * ky, (raster.maxX * m[0] + m[2]) * kx - 1, 1 - (raster.maxY * m[1] + m[3]) * ky, 1);
  };
  const dropRaster = (raster: Raster): void => { if (raster.texture) gl.deleteTexture(raster.texture); raster.texture = undefined; raster.pending = false; };
  /** One upload per source: a 2D canvas goes up premultiplied, as the blending of every layer expects. */
  const upload = (raster: Raster): void => {
    raster.pending = false;
    const source = raster.source;
    if (!source || lost) return;
    const size = sourceSize(source);
    if (!(size.width > 0) || !(size.height > 0) || size.width > maxTexture || size.height > maxTexture) { dropRaster(raster); return; }
    raster.texture ??= gl.createTexture() ?? undefined;
    if (!raster.texture) return;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, raster.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    let failed = false;
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch { failed = true; }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    if (!failed) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, raster.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (raster.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (failed) dropRaster(raster);
  };

  // --- the water layer: the page's vector water raster ---------------------------------------------------------------
  const water: Raster = { pending: false, mipmaps: true, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const waterStats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0 };
  const waterLayer: LiveLayer = {
    name: 'water',
    // No water raster (the GPU ground draws natural water itself): ready, and nothing to draw.
    ready: () => !water.source || !!water.texture,
    draw: () => { waterStats.drawCalls = waterStats.triangles = 0; if (water.texture) { drawRaster(water); waterStats.drawCalls = 1; waterStats.triangles = 2; } },
    contextLost: () => { water.texture = undefined; water.pending = !!water.source; },
    stats: () => waterStats,
    dispose: () => { dropRaster(water); water.source = undefined; },
  };
  layers.water = waterLayer;

  const fail = (name: LiveLayerName, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Live compositor: the ${name} layer failed and is dropped (${message}).`);
    (stats.errors ??= {})[name] = message;
    const layer = layers[name]; layers[name] = undefined; stats.pending[name] = false;
    try { layer?.dispose(); } catch { /* It already failed. */ }
  };

  // --- GPU time of a frame --------------------------------------------------------------------------------------------
  /** Results of earlier frames that have arrived; a query is never waited for. */
  const pollQueries = (): void => {
    if (!timer) return;
    for (let i = 0; i < TIMER_QUERIES; i++) {
      const query = queries[i];
      if (!queryBusy[i] || !query || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      queryBusy[i] = false;
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) push(stats.gpuMs, Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
    }
  };
  const beginQuery = (): void => {
    openQuery = -1;
    if (!timer) return;
    for (let i = 0; i < TIMER_QUERIES; i++) {
      if (queryBusy[i]) continue;
      const query = queries[i] ??= gl.createQuery();
      if (query) { gl.beginQuery(timer.TIME_ELAPSED_EXT, query); openQuery = i; }
      return;
    }
  };
  const endQuery = (): void => {
    if (openQuery < 0 || !timer) return;
    gl.endQuery(timer.TIME_ELAPSED_EXT); queryBusy[openQuery] = true; openQuery = -1;
  };

  // --- work ----------------------------------------------------------------------------------------------------------
  let idleId: number | undefined, timerId: ReturnType<typeof setTimeout> | undefined;
  const cancelIdle = (): void => {
    if (idleId !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
    clearTimeout(timerId); idleId = undefined; timerId = undefined;
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
    gl.deleteSync(fence); fence = null;
    return false;
  };
  const runWork = (budgetMs: number, refine = true): boolean => {
    if (lost || disposed) return false;
    // Still behind: the slice is due, later (the caller schedules it again).
    if (gpuBehind()) return true;
    busy++;
    try {
      const started = performance.now(), pending = workSlice(budgetMs, refine);
      // A slice that did something (the layers' own measure is their time): fenced, and flushed so the fence leaves now.
      if (performance.now() - started > 0.3 && !lost) { fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); }
      return pending;
    } finally { busy--; }
  };
  /** One slice of preparation, ground first. True while more is pending. */
  /** `refine` false (a moving view behind the display's pace): the ground, whose work only sharpens what is already
   * shown, waits; the other layers' work is what keeps their frames cheap (a snapshot, a baked prefix) and goes on. */
  const workSlice = (budgetMs: number, refine: boolean): boolean => {
    if (lost || disposed || !init()) return false;
    const started = performance.now(), last = frameValid ? frame : undefined;
    // The group of the next moving frame, allocated here rather than in the first frame of a gesture (at rest the
    // exact canvases cover the isolated layers, so no frame has needed it yet).
    if (last && !groupFailed && !group) ensureGroup(last.width, last.height, last.quality === 'light' ? 0 : Math.min(4, maxSamples));
    let pending = false, othersPending = false;
    for (let i = 1; i < LIVE_LAYER_ORDER.length; i++) othersPending ||= !!stats.pending[LIVE_LAYER_ORDER[i]];
    for (let i = 0; i < LIVE_LAYER_ORDER.length; i++) {
      const name = LIVE_LAYER_ORDER[i], layer = layers[name];
      if (!layer?.work) { stats.pending[name] = false; continue; }
      if (!refine && name === 'ground') { pending ||= !!stats.pending[name]; continue; }
      const left = (i === 0 && othersPending ? budgetMs * GROUND_SHARE : budgetMs) - (performance.now() - started);
      // Out of time: its answer is unknown, so the loop comes back for it.
      if (left <= 0.2) { stats.pending[name] = true; pending = true; continue; }
      let more = false;
      try {
        resetLiveState(gl, null, frame.width, frame.height);
        const unit = performance.now();
        more = layer.work(left, last);
        noteLiveUnit(WORK_UNIT[name], unit);
        // A layer that was not ready for the last frame and now is: the frame is due (its `invalidate` may say so too).
        if (last && shown[name] && !states[name].ready && layer.ready(last)) { states[name].ready = true; options.invalidate(); }
      } catch (error) { fail(name, error); more = false; }
      stats.pending[name] = more; pending ||= more;
    }
    // Stand-ins go up between frames, one per slice, so the first frame of a gesture finds them on the GPU.
    let uploaded = false;
    for (const name of LIVE_LAYER_ORDER) {
      const raster = standIns[name];
      if (!raster?.pending) continue;
      if (uploaded || performance.now() - started > budgetMs) { pending = true; continue; }
      upload(raster); raster.source = undefined; uploaded = true;
    }
    resetLiveState(gl, null, frame.width, frame.height);
    return pending;
  };
  const onIdle = (): void => {
    idleId = undefined; timerId = undefined;
    if (lost || disposed || paused) return;
    // During a gesture the slice after each frame is the whole budget.
    if (wasMoving && performance.now() - lastFrameAt < GESTURE_MS) { timerId = setTimeout(onIdle, GESTURE_MS); return; }
    if (runWork(WORK_REST_MS)) schedule();
  };
  const schedule = (): void => {
    if (idleId !== undefined || timerId !== undefined || lost || disposed || paused) return;
    if (typeof requestIdleCallback === 'function') idleId = requestIdleCallback(onIdle, { timeout: 200 });
    else timerId = setTimeout(onIdle, 16);
  };

  // --- context loss ----------------------------------------------------------------------------------------------------
  const onLost = (event: Event): void => {
    event.preventDefault();   // without it the context is never restored
    lost = true; frameValid = false; cancelIdle(); fence = null;
    quad = undefined; group = undefined; groupFailed = false; timer = null; openQuery = -1;
    for (let i = 0; i < TIMER_QUERIES; i++) { queries[i] = null; queryBusy[i] = false; }
    for (const name of LIVE_LAYER_ORDER) {
      try { layers[name]?.contextLost?.(); } catch (error) { fail(name, error); }
      // Their sources are the page's exact canvases, repainted since: the next rest frame gives new ones.
      delete standIns[name];
      states[name].ready = false; states[name].standIn = false;
    }
    stats.active = false; stats.reason = 'context lost';
    if (!disposed) options.invalidate();   // the page presents the classic path meanwhile
  };
  const onRestored = (): void => {
    lost = gl.isContextLost();
    if (!lost && !disposed) options.invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  if (!lost) init();

  const drawIsolated = (layer: LiveLayer, width: number, height: number): void => {
    const g = group!;
    frame.target = g.fbo;
    resetLiveState(gl, g.fbo, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    try { layer.draw(frame); } finally { frame.target = null; }
    // The blit obeys the scissor and the colour mask the layer may have left.
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, g.resolve);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    resetLiveState(gl, null, width, height);
    const opacity = layer.opacity ? layer.opacity() : 1;
    drawQuad(g.texture, -1, -1, 1, 1, opacity >= 1 ? 1 : opacity > 0 ? opacity : 0);
  };

  return {
    canvas, gl,
    active: () => !lost && !disposed,
    setLayer(name, layer) {
      const previous = layers[name];
      if (previous === layer) return;
      layers[name] = layer; states[name].ready = false; stats.pending[name] = !!layer?.work;
      if (stats.errors) delete stats.errors[name];
      try { previous?.dispose(); } catch { /* A layer on its way out. */ }
      if (layer?.work) schedule();
    },
    hasLayer: name => !!layers[name],
    setLayerShown(name, value) { shown[name] = value; },
    invalidateLayer(name) {
      const layer = layers[name];
      if (!layer?.invalidate) return;
      try { layer.invalidate(); } catch (error) { fail(name, error); }
      stats.pending[name] = !!layer.work; schedule();
    },
    setStandIn(name, source, view, cssW, cssH) {
      let raster = standIns[name];
      if (!source) { if (raster) { dropRaster(raster); delete standIns[name]; } return; }
      raster ??= standIns[name] = { pending: false, mipmaps: false, minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const hw = cssW / (2 * view.scale), hh = cssH / (2 * view.scale);
      // Same square (a repaint of the same view): the previous texture shows until the new pixels are uploaded.
      // Another square: the old pixels would be laid on the new square, so they go now.
      if (raster.texture && (raster.minX !== view.cx - hw || raster.minY !== view.cy - hh || raster.maxX !== view.cx + hw || raster.maxY !== view.cy + hh)) dropRaster(raster);
      raster.minX = view.cx - hw; raster.minY = view.cy - hh; raster.maxX = view.cx + hw; raster.maxY = view.cy + hh;
      raster.source = source; raster.pending = true;
      schedule();
    },
    clearStandIns() {
      for (const name of LIVE_LAYER_ORDER) { const raster = standIns[name]; if (raster) { dropRaster(raster); delete standIns[name]; } }
    },
    setWater(image, region) {
      if (region) { water.minX = region.x; water.minY = region.y; water.maxX = region.x + region.width; water.maxY = region.y + region.height; }
      if (image === water.source && !water.pending) return;
      water.source = image;
      if (!image) { dropRaster(water); return; }
      if (lost || !init()) { water.pending = true; return; }
      upload(water);
    },
    setPaper(css) { if (paper !== css) { paper = css; canvas.style.backgroundColor = css; } },
    busy: () => busy > 0,
    layerReady(name, view, cssW, cssH, dpr) {
      const layer = layers[name];
      if (!layer || lost || disposed || !init()) return false;
      fillFrame(view, cssW, cssH, dpr, false, performance.now());
      busy++;
      try { resetLiveState(gl, null, frame.width, frame.height); return layer.ready(frame) && !(layer.isolated && groupFailed); }
      catch (error) { fail(name, error); return false; }
      finally { busy--; }
    },
    draw(view, cssW, cssH, dpr, moving) {
      if (lost || disposed || !init()) return false;
      busy++;
      try { return drawFrame(view, cssW, cssH, dpr, moving); } finally { busy--; }
    },
    requestFrame() { if (!disposed) options.invalidate(); },
    setPaused(value) { paused = value; if (paused) cancelIdle(); else schedule(); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelIdle();
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const name of LIVE_LAYER_ORDER) {
        try { layers[name]?.dispose(); } catch { /* Disposal goes on. */ }
        layers[name] = undefined;
        const raster = standIns[name]; if (raster && !lost) dropRaster(raster);
        delete standIns[name]; stats.pending[name] = false;
      }
      if (!lost) {
        dropGroup();
        if (quad) { gl.deleteProgram(quad.program); gl.deleteVertexArray(quad.vao); }
        for (const query of queries) if (query) gl.deleteQuery(query);
      }
      quad = undefined; canvas.remove();
      stats.active = false; stats.reason = 'disposed';
      // Frees the GPU memory now rather than at the next collection of the canvas.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };

  function drawFrame(view: View, cssW: number, cssH: number, dpr: number, moving: boolean): boolean {
      const started = performance.now();
      fillFrame(view, cssW, cssH, dpr, moving, started);
      const width = frame.width, height = frame.height;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (styleW !== cssW || styleH !== cssH) { styleW = cssW; styleH = cssH; canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'; }
      // Light quality drops the multisampling of a moving view only: a live layer may also be the picture at rest
      // (the overlay, when it is ready), where the edges are looked at and the fill cost is paid once.
      const samples = frame.quality === 'light' && moving ? 0 : Math.min(4, maxSamples);

      pollQueries(); beginQuery();
      // A gesture begins: the exact canvases behind the pending stand-ins are repainted when it ends, so they go up now
      // (idle time has normally done it already).
      if (moving && !wasMoving) for (const name of LIVE_LAYER_ORDER) { const raster = standIns[name]; if (raster?.pending) { upload(raster); raster.source = undefined; } }
      if (water.pending) upload(water);
      resetLiveState(gl, null, width, height);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      for (let i = 0; i < LIVE_LAYER_ORDER.length; i++) {
        const name = LIVE_LAYER_ORDER[i], state = states[name];
        if (!shown[name]) { state.ready = false; state.standIn = false; state.ms = 0; state.drawCalls = 0; state.triangles = 0; continue; }
        const t = performance.now(), layer = layers[name];
        let ready = false, standIn = false;
        frame.target = null;
        resetLiveState(gl, null, width, height);
        if (layer) {
          try {
            ready = layer.ready(frame);
            if (ready) {
              if (!layer.isolated) layer.draw(frame);
              else if (ensureGroup(width, height, samples)) { noteLiveUnit('group', t); drawIsolated(layer, width, height); }
              else ready = false;
            }
          } catch (error) { fail(name, error); ready = false; }
        }
        if (!ready) {
          const raster = standIns[name];
          if (raster) {
            if (raster.pending) { upload(raster); raster.source = undefined; }
            if (raster.texture) { resetLiveState(gl, null, width, height); drawRaster(raster); standIn = true; }
          }
        }
        state.drawCalls = standIn ? 1 : 0; state.triangles = standIn ? 2 : 0;
        if (ready && layer?.stats) {
          try { const own = layer.stats(); for (const key in own) state[key] = own[key]; } catch (error) { fail(name, error); }
        }
        state.ready = ready; state.standIn = standIn; state.ms = performance.now() - t;
        push(stats.layerMs![name]!, state.ms); noteLiveUnit(DRAW_UNIT[name], t);
      }
      resetLiveState(gl, null, width, height);
      endQuery();
      stats.mode = getLiveMode(); stats.active = true; delete stats.reason;
      stats.frames++; push(stats.frameMs, performance.now() - started);
      if (moving && wasMoving) {
        const gap = started - lastFrameAt;
        // A gap longer than a gesture's pause is not a frame interval (the view rested in between).
        if (gap < GESTURE_MS) {
          paceGap = paceGap ? paceGap * .8 + gap * .2 : gap;
          // The best interval creeps up so a display that slows down (another refresh rate, throttling) is followed.
          paceBest = Math.min(paceBest * 1.002, gap);
          paceOk = paceGap <= Math.max(paceBest, 4) * 1.4 + 1;
        }
      } else if (!moving) { paceGap = 0; paceOk = true; }
      lastFrameAt = started; wasMoving = moving;
      // After the frame is submitted: the slice of preparation this frame can afford.
      if (paused) return !lost;
      // Behind the display's pace: the ground's refinement waits for the pace to come back or for the view to rest.
      if (runWork(moving ? WORK_MOVING_MS : WORK_REST_MS, !moving || paceOk)) schedule();
      return !lost;
  }
}
