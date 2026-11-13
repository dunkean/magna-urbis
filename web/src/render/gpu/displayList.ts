/**
 * GPU vector engine — shared contract (design: web/out/vector-gpu-2026-11-12/DESIGN.md).
 *
 * One map description, two drawing engines. The vector renderer (canvas.ts drawVector and the helpers it calls)
 * issues Canvas 2D calls. The CPU engine sends them to a real CanvasRenderingContext2D; the GPU engine sends them
 * to a RecordingContext (recorder.ts) that builds this display list, then a WebGL2 rasterizer (glRaster.ts) replays it.
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

export type Paint =
  | { readonly kind: 'color'; readonly rgba: Rgba }
  /** `transform` maps pattern space (source pixels) to the user space of the op (Canvas `pattern.setTransform`). */
  | { readonly kind: 'pattern'; readonly source: ImageSource; readonly repeat: Repeat; readonly transform: Mat; readonly smoothing: boolean };

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
  /** Unique, increasing id within a recording (lets the rasterizer detect a changed clip cheaply). */
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

/**
 * drawImage calls with the same source, composite, clip and smoothing, merged in call order.
 * Per instance (SPRITE_STRIDE floats): sx, sy, sw, sh (source pixels), dx, dy, dw, dh (user units),
 * a, b, c, d, e, f (user -> device transform of that call), alpha.
 * For composite 'destination-in' the op affects the whole clip area (outside the images the source is transparent);
 * the recorder never merges destination-in calls (one instance per op).
 */
export interface SpriteOp {
  readonly type: 'sprites';
  readonly source: ImageSource;
  readonly smoothing: boolean;
  readonly composite: Composite;
  readonly clip: ClipNode | null;
  readonly instances: Float32Array;
  readonly count: number;
}
export const SPRITE_STRIDE = 15;

/** clearRect: the rectangle (user units, under `transform`) becomes transparent, inside the clip. */
export interface ClearOp {
  readonly type: 'clear';
  readonly transform: Mat;
  readonly clip: ClipNode | null;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
}

export type DrawOp = FillOp | StrokeOp | SpriteOp | ClearOp;

export interface DisplayList {
  /** Device pixel size of the recorded canvas. */
  readonly width: number;
  readonly height: number;
  readonly ops: readonly DrawOp[];
  /** Set when a call could not be recorded faithfully (text, gradients, getImageData, native Path2D...): use the CPU engine. */
  readonly unsupported?: string;
  readonly stats: { calls: number; ops: number; paths: number; sprites: number; recordMs: number };
}

/** Rasterizer entry point implemented by glRaster.ts. */
export interface GpuRasterizer {
  readonly renderer: string;
  /** True on SwiftShader / llvmpipe / WARP: the engine policy keeps the CPU engine. */
  readonly software: boolean;
  readonly lost: boolean;
  /**
   * Replays `list` on a transparent target of list.width x list.height and returns the picture as an ImageBitmap
   * (premultiplied, GPU-backed: drawImage it onto a 2D canvas). `post` premultiplies every op transform (replay at
   * another view), default identity. Throws GpuRasterError on context loss or an internal failure.
   * `size` (rasterizeInto): target pixel size when it differs from the recorded list (a retained list replayed on a view).
   */
  rasterize(list: DisplayList, options?: { post?: Mat }): ImageBitmap;
  /** Same, drawn onto `target` (a 2D canvas) at device pixel (x, y): avoids an ImageBitmap when the caller composites at once. */
  rasterizeInto(list: DisplayList, target: CanvasRenderingContext2D, x: number, y: number, options?: { post?: Mat; size?: readonly [number, number] }): void;
  /** Several lists on one target, each limited to its `scissor` (target device px, y down): a retained region recorded in bands. */
  rasterizeParts(parts: readonly { list: DisplayList; post: Mat; scissor?: readonly [number, number, number, number] }[], target: CanvasRenderingContext2D, x: number, y: number, size: readonly [number, number]): void;
  /** Upload what `list` needs without drawing (a recording spread over idle steps leaves no upload to its first replay). */
  prepare(list: DisplayList, post?: Mat): void;
  /** A source canvas changed after it was first drawn: drop its texture. */
  invalidateImage(source: ImageSource): void;
  /** GPU bytes owned (geometry, textures). */
  bytes(): number;
  /** Last rasterize: draw calls, triangles, GPU-side ms when measurable (else CPU submit ms). */
  lastStats(): { drawCalls: number; triangles: number; ms: number; clips?: number; ops?: number };
  dispose(): void;
}

export class GpuRasterError extends Error {
  constructor(message: string, readonly lost = false) { super(message); this.name = 'GpuRasterError'; }
}

/** Vector engine policy (vectorEngine.ts). */
export type VectorEngineChoice = 'auto' | 'gpu' | 'cpu';
export type VectorEngine = 'gpu' | 'cpu';
