/**
 * Live compositor contract.
 *
 * The 2D view of the V2, moving and at rest, is composed in ONE WebGL2 context on ONE visible canvas, from retained
 * GPU resources. The cost of a frame must not depend on the amount of map content: no Canvas 2D drawing, no
 * canvas-to-canvas copy, no per-frame upload proportional to the data, no per-frame allocation proportional to it.
 *
 *   ground  : baked world-space tiles of the terrain material (render/live/groundLayer.ts)
 *   overlay : the cartography overlay, retained display lists replayed in this context (CanvasRenderer.createLiveLayer)
 *   city    : town meshes (NativeCityMap.createLiveLayer)
 *   text    : names and symbols from a glyph atlas (render/live/textLayer.ts)
 *
 * The compositor (render/live/compositor.ts) owns the canvas, the context, the frame, the isolated group target and
 * the stand-ins. Each layer is written by one owner against this file only; the compositor never reaches into a layer.
 *
 * The exact renderers (tiles, Canvas 2D town, placed text) paint what must be exact by definition (captures, exports,
 * sheets, the miniature, the 3D drape) and, in the view at rest, a layer whose live layer does not answer `restExact`.
 * A layer that is not `ready` is shown by its stand-in: the last exact raster of that layer, uploaded once and moved
 * with the view.
 *
 * GL rules for every layer:
 *  - The context is shared. On entry of `draw` and `work` the state is the one `resetLiveState` sets; a layer sets
 *    everything else it relies on and must not assume state left by an earlier call of its own.
 *  - A layer that binds its own framebuffer binds `frame.target` back and restores the viewport before it returns.
 *  - Colours are premultiplied alpha. A layer draws with blending it chooses; `isolated` layers draw into a cleared
 *    transparent multisampled group (RGBA8 + depth24/stencil8), composited afterwards with source-over and `opacity`.
 *    A layer that is not isolated draws straight over what is below it: it may only use source-over.
 *  - No `readPixels`, `finish`, `getError` or other synchronous query in `draw`.
 *  - Resources are created in this context only; `contextLost` drops every handle, the next `work`/`draw` rebuilds.
 *
 * One camera (render/world/contract.ts): a frame is the top view of the map, or the same world seen tilted
 * (`frame.camera.tilted`). The 2D mapping of a frame (`rect`, `worldToClip`, `worldToPixel`) describes the top view of
 * its centre and scale; a layer that only knows it is not drawn in a tilted frame (the page hides it). The ground
 * draws both.
 */
import type { Rect4, View } from '../view';
import type { FrameCamera } from '../world/contract';
import type { TerrainHeights } from '../world/heights';

/** Context attributes of the compositor canvas. `getContext('webgl2', ...)` on that canvas returns this context. */
export const LIVE_CONTEXT_ATTRIBUTES: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: true, stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };

export type LiveLayerName = 'ground' | 'water' | 'overlay' | 'city' | 'text';
/** Bottom to top. */
export const LIVE_LAYER_ORDER: readonly LiveLayerName[] = ['ground', 'water', 'overlay', 'city', 'text'];

export interface LiveFrame {
  readonly gl: WebGL2RenderingContext;
  /** Clamped view of this frame; `scale` is CSS pixels per metre. */
  readonly view: View;
  readonly cssW: number;
  readonly cssH: number;
  readonly dpr: number;
  /** Size of the target in device pixels (`round(cssW * dpr)`, `round(cssH * dpr)`). */
  readonly width: number;
  readonly height: number;
  /** World square shown by the frame, in map metres. */
  readonly rect: Rect4;
  /** Map metres -> clip space, a column-major 3x3 for `uniformMatrix3fv` (y down on screen, as the 2D canvas). */
  readonly worldToClip: Float32Array;
  /** Map metres -> device pixels of the target (origin top left, y down): `[sx, sy, tx, ty]`, px = x * sx + tx. */
  readonly worldToPixel: readonly [number, number, number, number];
  /** The camera of the frame: the top view, where the 2D mapping above is the whole projection, or a tilted
   * perspective with its 4x4 view-projection. */
  readonly camera: FrameCamera;
  /** Framebuffer the layer draws into: null (the canvas) or the isolated group. */
  readonly target: WebGLFramebuffer | null;
  /** `performance.now()` of the frame. */
  readonly now: number;
  /** The view changed since the previous frame, or did so less than the settle delay ago. */
  readonly moving: boolean;
  /** 'light' on slow hardware (displayQuality.ts): layers drop optional detail. */
  readonly quality: 'full' | 'light';
}

export interface LiveLayerStats {
  drawCalls: number;
  triangles: number;
  /** CPU submission time of the last draw. */ ms: number;
  [key: string]: number;
}

export interface LiveLayer {
  readonly name: LiveLayerName;
  /** Drawn in the isolated multisampled group and composited with `opacity()`. Required for any blending other than
   * source-over, for stencil use, and for a group opacity. */
  readonly isolated?: boolean;
  /** The layer draws the frames of a tilted camera (`frame.camera.tilted`) as well as the top view, with
   * `frame.camera`. A layer without it only knows the 2D mapping: the compositor leaves it out of a tilted frame. */
  readonly tilts?: boolean;
  /** Group opacity 0..1 of an isolated layer (default 1). Read per frame. */
  opacity?(): number;
  /** True when `draw` can show the layer for this frame from data already on the GPU. False: the compositor shows the
   * layer's stand-in and keeps calling `work`. Must be cheap (no allocation). */
  ready(frame: LiveFrame): boolean;
  /** Draws the layer. Only called when `ready(frame)` returned true for the same frame. */
  draw(frame: LiveFrame): void;
  /** True when what `draw` shows for this frame is the picture of that layer at rest: nothing finer or more exact will
   * replace it, so the page paints no exact canvas for it. Only asked when `ready(frame)` is true, for a frame at rest.
   * A layer without this method is never the picture at rest. Must be cheap (no allocation). */
  restExact?(frame: LiveFrame): boolean;
  /** Preparation between frames: bake a tile, upload a mesh, record a list. Does at most about `budgetMs` of work for
   * the view of `frame` (the last frame; undefined before the first) and returns true while more is pending. Called
   * after each frame and from idle callbacks; never from `draw`. */
  work?(budgetMs: number, frame: LiveFrame | undefined): boolean;
  /** What the layer shows changed (new world, appearance, revision): retained GPU data is stale. */
  invalidate?(): void;
  /** The context was lost: every GL handle is dead. */
  contextLost?(): void;
  stats?(): LiveLayerStats;
  dispose(): void;
}

/** Puts the shared context in the state every `draw` and `work` starts from. */
export function resetLiveState(gl: WebGL2RenderingContext, target: WebGLFramebuffer | null, width: number, height: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.viewport(0, 0, width, height);
  gl.bindVertexArray(null);
  gl.useProgram(null);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(true);
  gl.colorMask(true, true, true, true);
  gl.stencilMask(0xff);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Ground: baked tiles (owner: the ground stream; ui/terrainGl.ts, ui/terrainGpu.ts, render/live/groundLayer.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** What the terrain renderers (TerrainGl, TerrainGpu) add for the live ground. */
export interface GroundTileRenderer {
  /** Renders the complete ground of the world square `box` (map metres; it may reach past the map) at `px` x `px`
   * device pixels, with the look, water, forest and season of the live 2D map and the detail level of that density
   * (`px / (box.maxX - box.minX)` device pixels per metre), into a surface that can be uploaded with `texImage2D` in
   * the same task. Undefined when the renderer cannot draw now (programs compiling, device lost). Never shows on screen. */
  renderWorldTile(box: Rect4, px: number): TexImageSource | undefined;
  /** Changes whenever the pixels `renderWorldTile` would produce change (base, detail, look, season, water, forest, overlay). */
  contentRevision(): number;
}

export interface LiveGroundOptions {
  /** The current terrain renderer; undefined while none is ready (the layer is then not `ready`). */
  renderer(): GroundTileRenderer | undefined;
  /** Side of the map in metres. */
  mapSize(): number;
  /** Paper colour under and around the map (CSS colour). */
  paper(): string;
  /** The relief of the map, for the frames of a tilted camera; undefined: such a frame drapes the ground flat. */
  terrain(): TerrainHeights | undefined;
  /** GPU memory the tile cache may use, in bytes. */
  budgetBytes?: number;
  /** Asks for a new frame (a finer tile arrived). */
  invalidate(): void;
}
// export function createLiveGroundLayer(gl: WebGL2RenderingContext, options: LiveGroundOptions): LiveLayer   (render/live/groundLayer.ts)

// ---------------------------------------------------------------------------------------------------------------------
// Text (owner: the text stream; render/live/textLayer.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** The last exact placement of the names, as `CanvasRenderer.liveText()` returns it. `placed` positions are CSS pixels
 * of a `w` x `h` view at `view`. `revision` changes with every new placement; `style` with palette, family or text settings. */
export interface LiveTextPlacement {
  readonly placed: readonly import('../mapLabels').PlacedMapLabel[];
  readonly view: View;
  readonly w: number;
  readonly h: number;
  readonly palette: import('../styles').Palette;
  readonly family: string;
  readonly revision: number;
}
export interface LiveTextOptions {
  /** Undefined: no names to show (the layer is ready and draws nothing). */
  placement(): LiveTextPlacement | undefined;
  invalidate(): void;
}
// export function createLiveTextLayer(gl: WebGL2RenderingContext, options: LiveTextOptions): LiveLayer        (render/live/textLayer.ts)

// ---------------------------------------------------------------------------------------------------------------------
// Overlay and city: the layer is made by the object that owns the data.
//   CanvasRenderer.createLiveLayer(gl: WebGL2RenderingContext): LiveLayer | undefined          (render/canvas.ts)
//   CanvasRenderer.drawFurniture(target: CanvasRenderingContext2D, view: View, cssW: number, cssH: number): void
//       frame, cartouche, legend and scale bar alone (screen space), for the 2D canvas the compositor keeps on top.
//   NativeCityMap.createLiveLayer(gl: WebGL2RenderingContext, env: LiveCityEnv): LiveLayer | undefined   (v2/nativeCityMap.ts)
// ---------------------------------------------------------------------------------------------------------------------

export interface LiveCityEnv {
  /** The appearance an exact frame would be drawn with now. */
  appearance(): import('../appearanceRecipe').ResolvedAppearance;
  /** Layers switched off by the page (same object the exact town renderer receives). */
  visibility(): Partial<import('../exportLayers').ExportLayers> | undefined;
  /** The rivers the map draws under the towns (`riverSegments` layout), as NativeCityHooks.water. */
  water?(): Float32Array | undefined;
  invalidate(): void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Measurement (owner: the compositor; read by scripts/nav_fps_probe.mjs)
// ---------------------------------------------------------------------------------------------------------------------

/** LiveLayerStats of the last frame plus what the compositor did with the layer. Not `extends LiveLayerStats`: its
 * numeric index signature refuses the two flags (TS2411). */
export interface LiveLayerState {
  drawCalls: number;
  triangles: number;
  /** CPU time of the layer in the last frame (draw or stand-in), measured by the compositor. */ ms: number;
  /** `ready` answered true for the last frame. */ ready: boolean;
  /** The stand-in was drawn instead. */ standIn: boolean;
  [key: string]: number | boolean;
}
/** `globalThis.__muLive`, always defined by the V2 page once a renderer exists. */
export interface LiveStats {
  /** The compositor presented the last frame of the 2D view (false: the fallback view did, with `reason`). */
  active: boolean;
  reason?: string;
  /** Compositor frames since `reset()`. */
  frames: number;
  /** CPU time of the last frames, oldest first (at most 4000): whole frame, then per layer. */
  frameMs: number[];
  /** GPU time of the last frames in ms when EXT_disjoint_timer_query_webgl2 is available, else empty. */
  gpuMs: number[];
  layers: Partial<Record<LiveLayerName, LiveLayerState>>;
  /** Background work still pending per layer (tiles to bake, meshes to upload). */
  pending: Partial<Record<LiveLayerName, boolean>>;
  /** CPU time of each layer in the last frames it was shown in (live draw or stand-in), oldest first (at most 4000). */
  layerMs?: Partial<Record<LiveLayerName, number[]>>;
  /** A layer whose `ready`, `draw` or `work` threw: the compositor dropped it (its stand-in shows instead). */
  errors?: Partial<Record<LiveLayerName, string>>;
  /** Units of work that held the main thread longer than a frame can afford, oldest first (at most 64): what ran
   * (`work:ground`, `draw:city`, `exact:city`...), for how long (ms), and when (`performance.now()`). */
  slow?: [what: string, ms: number, at: number][];
  reset(): void;
}
