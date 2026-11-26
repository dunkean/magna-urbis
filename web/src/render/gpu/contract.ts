/**
 * Public types of the GPU vector engine (design: web/out/vector-gpu-2026-11-12/DESIGN.md).
 *
 * One map description, two drawing engines. The cartography (render/cartography/vector.ts drawVector and the helpers
 * it calls) issues Canvas 2D calls. The CPU engine sends them to a real CanvasRenderingContext2D; the GPU engine sends
 * them to a RecordingContext (recorder.ts) that builds this display list, which a WebGL2 rasterizer replays: the tile
 * rasterizer (tileRasterizer.ts, GpuRasterizer) for the exact outputs, the live rasterizer (liveRasterizer.ts,
 * LiveRasterizer) for the compositor's overlay layer.
 *
 * Semantics: replaying the ops in order on a transparent canvas of `width` x `height` device pixels, with the Canvas 2D
 * rules, gives the picture. The rasterizer may batch or reorder internally only when the result is identical.
 */

/** Canvas affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (user space -> device pixels). */
export type Mat = readonly [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export type Composite = 'source-over' | 'multiply' | 'destination-in' | 'destination-out';
export type FillRule = 'nonzero' | 'evenodd';
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'round' | 'bevel' | 'miter';
export type Repeat = 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat';

/** Image-like sources the recorder accepts (CanvasImageSource minus video/SVG image elements in practice). */
export type ImageSource = CanvasImageSource;

/** Straight (non-premultiplied) RGBA in 0..1. */
export type Rgba = readonly [number, number, number, number];

/** Draw-time pigment for a contour coverage image (thin in red, index in green). */
export interface ContourTint {
  rgba: Rgba;
}
export const CONTOUR_THIN_OPACITY = 0.7;

/** One named ink of a retained recording. Its buffer survives a season change. */
export class ColorSlot {
  private static nextId = 0;
  readonly id = ++ColorSlot.nextId;
  readonly kind = 'color' as const;
  readonly rgba = new Float32Array(4);
  get slot(): this {
    return this;
  }
  css = '';
  valid = true;
}

type PaintColor = { readonly rgba: Rgba | Float32Array; readonly slot?: ColorSlot };

/** Parallel lines anchored in the user space of the op: unit normal (nx, ny), lines where `nx x + ny y = offset + k period`,
 * each `width` user units wide (plough furrows, render/furrows.ts). */
export interface Stripe {
  readonly nx: number;
  readonly ny: number;
  readonly period: number;
  readonly offset: number;
  readonly width: number;
}

export type Paint =
  | ({ readonly kind: 'color' } & PaintColor)
  /** `transform` maps pattern space (source pixels) to the user space of the op (Canvas `pattern.setTransform`). */
  | { readonly kind: 'pattern'; readonly source: ImageSource; readonly repeat: Repeat; readonly transform: Mat; readonly smoothing: boolean }
  /** The colour inside the stripe lines, transparent between them (`RecordingContext.fillStripes`): the fragment shader
   * draws them from the distance to the nearest line, box-filtered by the pixel footprint, with no texture. */
  | ({ readonly kind: 'stripes'; readonly stripe: Stripe } & PaintColor);

/**
 * Flattened path: polylines only. `points` holds x,y pairs in the path's own coordinates (the op transform applies).
 * Subpath i spans points [starts[i], starts[i+1]) (in vertices, not floats); `closed[i]` = 1 when closePath() ended it.
 */
export interface PathGeometry {
  readonly points: Float32Array;
  readonly starts: Uint32Array;
  readonly closed: Uint8Array;
  /** [minX, minY, maxX, maxY] of the points; empty path: [Infinity, Infinity, -Infinity, -Infinity]. */
  readonly bbox: readonly [number, number, number, number];
}

/**
 * Path object understood by both engines (path.ts implements it as `RecPath2D`, a subclass of the native Path2D when
 * the platform has one, so the CPU canvas draws the very same objects).
 */
export interface RecordedPath {
  /** Bumped on every mutation; geometry caches key on (path, version, tolerance bucket). */
  readonly version: number;
  /** False when the path holds something the recorder cannot read (a native Path2D added with addPath). */
  readonly readable: boolean;
  /** Bounding box in path coordinates, curves included (control-point hull is acceptable). */
  bounds(): readonly [number, number, number, number];
  /** Flatten curves so the chord error stays below `tolerance` path units. Cached per tolerance bucket (power of two). */
  geometry(tolerance: number): PathGeometry;
}

/** Canvas clip region: intersection of the chain from this node to the root. Nodes are immutable and shared. */
export interface ClipNode {
  readonly parent: ClipNode | null;
  readonly path: RecordedPath;
  readonly rule: FillRule;
  readonly transform: Mat;
  /** Unique id across recordings and reused sections (lets the rasterizer detect a changed clip cheaply). */
  readonly id: number;
}

interface OpState {
  /** user -> device transform at the call. */
  readonly transform: Mat;
  /** globalAlpha in 0..1 (already multiplied into nothing else). */
  readonly alpha: number;
  readonly composite: Composite;
  /** Active clip, null = whole canvas. */
  readonly clip: ClipNode | null;
}

/** ctx.fill() for each path in turn, in order, with the same state (consecutive identical-state fills are merged here). */
export interface FillOp extends OpState {
  readonly type: 'fill';
  readonly paths: readonly RecordedPath[];
  readonly rule: FillRule;
  readonly paint: Paint;
}

/** ctx.stroke() for each path in turn, in order, with the same state. Within ONE path a translucent stroke never doubles. */
export interface StrokeOp extends OpState {
  readonly type: 'stroke';
  readonly paths: readonly RecordedPath[];
  readonly paint: Paint;
  /** Line width in user units (the transform scales it, as in Canvas). */
  readonly width: number;
  readonly cap: LineCap;
  readonly join: LineJoin;
  readonly miterLimit: number;
  /** Canvas dash array in user units, already doubled when odd-length; empty = solid. */
  readonly dash: readonly number[];
  readonly dashOffset: number;
}

/** Premultiplied pen-sheet coverage in R (ink) and G (wash). */
export type SpriteTint = readonly [ink: ColorSlot, wash: ColorSlot];

/** The summer sprite supplies premultiplied land and its punched alpha. The second texture
 * encodes altitude / maxHeight as two opaque bytes, most significant first. */
export interface LandTint {
  heights: ImageData;
  maxHeight: number;
  tint: Rgba;
  snow: Rgba;
}

/**
 * drawImage calls with the same source, composite, clip and smoothing, merged in call order.
 * Per instance (SPRITE_STRIDE floats): sx, sy, sw, sh (source pixels), dx, dy, dw, dh (user units),
 * a, b, c, d, e, f (user -> device transform of that call), alpha.
 * For composite 'destination-in' the op affects the whole clip area (outside the images the source is transparent);
 * the recorder never merges destination-in calls (one instance per op).
 */
export interface SpriteOp {
  readonly type: 'sprites';
  readonly landTint?: LandTint;
  /** World-space instances share their storage across bands; only this draw's map-to-device matrix differs. */
  readonly transform?: Mat;
  readonly contourTint?: ContourTint;
  readonly tint?: SpriteTint;
  readonly source: ImageSource;
  readonly smoothing: boolean;
  readonly composite: Composite;
  readonly clip: ClipNode | null;
  readonly instances: Float32Array;
  readonly count: number;
}
export const SPRITE_STRIDE = 15;

/** clearRect: the rectangle (user units, under `transform`) becomes transparent, inside the clip. */
interface ClearOp {
  readonly type: 'clear';
  readonly transform: Mat;
  readonly clip: ClipNode | null;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type DrawOp = FillOp | StrokeOp | SpriteOp | ClearOp;

export interface DisplayList {
  readonly bakedSeason?: boolean;
  /** Device pixel size of the recorded canvas. */
  readonly width: number;
  readonly height: number;
  readonly ops: readonly DrawOp[];
  /** Set when a call could not be recorded faithfully (text, gradients, getImageData, native Path2D...): use the CPU engine. */
  readonly unsupported?: string;
  readonly stats: { calls: number; ops: number; paths: number; sprites: number; recordMs: number };
  /** Section boundaries the producer asked for (`RecordingContext.mark`): `at` is the index of the first op after the
   * mark. No op spans a mark (merging stops there). Absent when none was set. */
  readonly marks?: readonly { readonly name: string; readonly at: number }[];
}

/** Mark between the soft area prefix of a retained map list (land-use tints, washes, furrows: baked once per region
 * by the live overlay) and the layers that stay crisp (lines, water cut, roads, symbols), replayed at every frame. */
export const CRISP_MARK = 'crisp';

/** The tile rasterizer of the exact outputs (gpu/tileRasterizer.ts, reached through vectorEngine.ts). */
export interface GpuRasterizer {
  readonly renderer: string;
  /** True on SwiftShader / llvmpipe / WARP: the engine policy keeps the CPU engine. */
  readonly software: boolean;
  readonly lost: boolean;
  /**
   * Replays `list` on a transparent target of list.width x list.height and returns the picture as an ImageBitmap
   * (premultiplied, GPU-backed: drawImage it onto a 2D canvas). `post` premultiplies every op transform (replay at
   * another view), default identity. Throws GpuRasterError on context loss or an internal failure.
   */
  rasterize(list: DisplayList, options?: { post?: Mat }): ImageBitmap;
  /** A source canvas changed after it was first drawn: drop its texture. */
  invalidateImage(source: ImageSource): void;
  /** GPU bytes owned (geometry, textures). */
  bytes(): number;
  /** Last rasterize: draw calls, triangles, GPU-side ms when measurable (else CPU submit ms). */
  /** `synced`: the replay waited for the graphics process (it read the error flags), so its time includes the GPU's. */
  lastStats(): { drawCalls: number; triangles: number; ms: number; clips?: number; ops?: number; synced?: boolean };
  dispose(): void;
}

export class GpuRasterError extends Error {
  constructor(
    message: string,
    readonly lost = false,
  ) {
    super(message);
    this.name = 'GpuRasterError';
  }
}

/** Counts of the last replay: draw calls, triangles, submission ms, clip rebuilds, ops; `synced`: it waited for the GPU. */
export type ReplayStats = { drawCalls: number; triangles: number; ms: number; clips: number; ops: number; synced: boolean };

/** The area prefix of a retained band (or a whole band: a snapshot), rasterized once into a texture of the live context. */
export interface BakedPrefix {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  /** Recorded device pixels the texture covers (the band and its gutter): [x0, y0, x1, y1]. */
  readonly box: readonly [number, number, number, number];
  readonly bytes: number;
}
/** One band of a live replay: `baked` (if any) is drawn first as one quad, then `list` op by op, inside `scissor`
 * (device pixels of the target, y down). The layer mutates `post` and `scissor` in place between frames. */
export interface LivePart {
  list: DisplayList;
  post: Mat;
  scissor: readonly [number, number, number, number];
  baked?: BakedPrefix;
}

export interface LiveBakeOptions {
  under?: BakedPrefix;
  /** Prepared world symbols above the area texture and below the retained contour pass. */
  symbols?: DisplayList;
  samples?: number;
  /** Retained world ink between the prefix and the list; `post` maps recorded pixels into this bake's target. */
  between?(target: WebGLFramebuffer, width: number, height: number, post: Mat): void;
}

export interface LiveRasterizer {
  readonly lost: boolean;
  /** Largest side of a baked texture in this context. */
  readonly maxBakeSize: number;
  /** Uploads what `list` needs (geometry, stroke instances, sprite instances, textures) without drawing. */
  prepare(list: DisplayList, post?: Mat): void;
  /** Resumable uploads, yielding after each path or sprite batch. */
  prepareSteps(list: DisplayList, post?: Mat): Generator<void>;
  /** Replays `list` once into a transparent multisampled target of `list.width x list.height` recorded pixels times
   * `density` (plus a gutter) and returns it resolved, with mipmaps. Null when the target cannot be made.
   * `under`: an earlier bake of the same band drawn first, under the ops. `samples`: multisample count (default 4). */
  bake(list: DisplayList, density: number, options?: LiveBakeOptions): BakedPrefix | null;
  /** The same multisampled bake across slices; its scratch target stays private until completion or cancellation. */
  bakeSteps(list: DisplayList, density: number, options?: LiveBakeOptions): Generator<void, BakedPrefix | null>;
  releaseBaked(baked: BakedPrefix): void;
  /** A completed fixed sheet needs only its baked textures. Drop paths, source images and instance buffers. */
  releasePreparedLists(): void;
  /** Frees the multisampled scratch target of the bakes (a region is complete). */
  releaseBakeScratch(): void;
  /** Draws the parts into `target` (`width` x `height` device pixels) over what is there: no colour clear. The stencil
   * of the target is used and left cleared to the clip of the last part. GL errors are read by an idle timer only and
   * thrown by the next replay. */
  replayLive(parts: readonly LivePart[], target: WebGLFramebuffer | null, width: number, height: number): void;
  /** The context was lost: every handle is dead, nothing is deleted. */
  dropContext(): void;
  bytes(): number;
  lastStats(): ReplayStats;
  /** Triangles of the last `replayLive` by kind (fans of fills and clips, stroke instances, sprites); the same
   * object at every call. */
  liveTally(): { readonly fan: number; readonly stroke: number; readonly sprite: number; readonly late: number };
  /** Creates what every replay and bake needs besides the data of a list: the vertex array and all the programs,
   * compiled and linked without waiting (KHR_parallel_shader_compile; one program per call without it), their
   * uniform locations read once. Call it from `work` until it answers true, and only then bake or replay: a frame
   * creates nothing. `liveTally().late` counts what a frame still had to create or upload (expected 0). */
  warm(): boolean;
  dispose(): void;
}
