/**
 * The stepwise mode of the exact Canvas town: the town layer of a view is kept between frames, and a new view repaints
 * it over several short tasks while the previous layer follows the view.
 *
 * Who: v2/nativeCityMap.ts `draw(…, stepwise)`, for the composed view when the live town layer is not the picture at
 * rest (`restExact` false) and for the fallback display. Why: a large town takes 0.4 to 0.8 s of Canvas calls; painted
 * in one task it would freeze the page at every rest. The final layer holds the same pixels as a repaint at once:
 * only the moment they are produced changes. Captures and exports do not use it. It owns its two layers and its own
 * scheduler (one step per animation frame, paced on what the graphics process keeps up with).
 */
import type { View } from '../../view';

/** Asks `draw` for the stepwise mode. */
export interface NativeCityStepwise {
  /** Changes whenever what the hooks and the shared render state paint may have changed (a new appearance or world). */
  key: number | string;
  /** The view is moving: no long repaint is started, the last painted layer follows the view. */
  moving: boolean;
}
type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
/** A kept town layer: the canvas of one view with the statistics of its paint. */
interface StepwiseLayer<S> {
  canvas: LayerCanvas;
  ctx: CanvasRenderingContext2D;
  key: string;
  look: string;
  view: View;
  dpr: number;
  stats: S;
}
/** What the owner of the towns gives the stepwise mode. */
interface StepwiseTownDeps<F, S> {
  /** Paints every town of a frame in resumable steps (the exact town's own paint, with pauses). */
  paint(ctx: CanvasRenderingContext2D, frame: F, stats: S): Generator<void, void>;
  newStats(): S;
  canvas(width: number, height: number): LayerCanvas | undefined;
  /** Changes when the same frame would paint differently in the same look: content revision, building tier. */
  revision(): string;
  /** Identifies the look of a frame (appearance, water, visibility, render mode). */
  lookKey(frame: F): string;
  /** A layer was completed with content still arriving (house tiles, textures): it must be repainted. */
  contentPending(): void;
  /** The layer of the current view is complete (or the repaint failed): the frame can be composed again. */
  progressed(): void;
}
/** Canvas work run in the frame that asks for a new view before the repaint continues in the
 * background, share of a frame a moving view may spend on it, and Canvas work of one background step (first, least
 * and most: the step follows what the graphics process keeps up with). */
const STEP_INLINE_MS = 8,
  STEP_MOVING_MS = 6,
  STEP_SLICE_MS = 5,
  STEP_SLICE_MIN_MS = 2.5,
  STEP_SLICE_MAX_MS = 14;

/** The stepwise mode of one town map: built and released by its owner. */
export function createStepwiseTown<F extends { view: View; w: number; h: number; dpr: number; lod: string }, S extends { pending: boolean; lod?: string }>(deps: StepwiseTownDeps<F, S>) {
  type TownLayer = StepwiseLayer<S>;
  let released = false;
  // The isolated layer of the last painted view is kept: a frame of the same view composes it again
  // (a redraw for a ground, water or label update costs the town nothing), and a new view repaints a second layer in
  // short tasks while the kept one follows the view, scaled. The final frame composes the same layer pixels as a
  // repaint at once: only the moment they are produced changes.
  type Job = { layer: TownLayer; steps: Generator<void, void>; ms: number };
  let shownLayer: TownLayer | undefined, spareLayer: TownLayer | undefined, job: Job | undefined;
  let scheduled = false,
    broken = false,
    lastPaintMs = 0;
  // One step per animation frame. The graphics process spends two to three times a step's Canvas time rasterizing
  // it, and what is queued cannot be withdrawn: steps run back to back left it most of a second behind, and the first
  // frames of the next gesture waited for that. A frame that comes on time means it kept up (the next step may be
  // longer); a late one, that it is behind (shorter).
  let sliceBudget = STEP_SLICE_MS,
    sliceAt = 0,
    frameFloor = Infinity;
  const framePaced = typeof requestAnimationFrame === 'function';
  const freeLayer = (held: TownLayer | undefined): void => {
    if (held) held.canvas.width = held.canvas.height = 1;
  };
  const recycleLayer = (held: TownLayer): void => {
    if (!spareLayer) spareLayer = held;
    else freeLayer(held);
  };
  function stop(): void {
    const running = job;
    if (!running) return;
    job = undefined;
    try {
      running.steps.return();
    } catch {
      /* The layer is discarded either way. */
    }
    recycleLayer(running.layer);
  }
  // Chrome records the Canvas calls and rasterizes them when the canvas is read. A layer painted over a second would be
  // rasterized in one go by the frame that composes it, and the display would stop for that long although the page
  // stays free. Reading the layer into a scratch pixel after every step sends that step's calls to the graphics
  // process, which then has a few milliseconds of work at a time, between its own frames.
  const flushSurface = deps.canvas(1, 1),
    flushContext = flushSurface?.getContext('2d') as CanvasRenderingContext2D | undefined;
  function flushLayer(held: TownLayer): void {
    if (!flushSurface || !flushContext) return;
    try {
      flushContext.drawImage(held.canvas, 0, 0, 1, 1);
      flushSurface.width = 1;
    } catch {
      /* Only a hint. */
    }
  }
  /** Runs the job for about `budget` ms of Canvas work; true once the layer is complete. */
  function run(job: Job, budget: number): boolean {
    if (!(budget > 0)) return false;
    const t = performance.now();
    let done = false;
    try {
      do {
        done = !!job.steps.next().done;
      } while (!done && performance.now() - t < budget);
    } finally {
      job.ms += performance.now() - t;
    }
    if (budget !== Infinity) flushLayer(job.layer);
    return done;
  }
  function show(job: Job): TownLayer {
    const previous = shownLayer;
    shownLayer = job.layer;
    lastPaintMs = job.ms;
    if (previous) recycleLayer(previous);
    // Content still arriving (house tiles, textures): the layer is repainted, as a frame painted at once would be.
    if (job.layer.stats.pending) deps.contentPending();
    return job.layer;
  }
  function slice(): void {
    scheduled = false;
    const running = job;
    if (!running || released) return;
    const now = performance.now(),
      gap = now - sliceAt;
    sliceAt = now;
    if (gap < 250) {
      frameFloor = Math.min(frameFloor * 1.01, gap);
      sliceBudget = gap > frameFloor * 1.4 + 2 ? Math.max(STEP_SLICE_MIN_MS, sliceBudget * 0.6) : Math.min(STEP_SLICE_MAX_MS, sliceBudget * 1.25);
    } else sliceBudget = STEP_SLICE_MS;
    let done = false;
    // A failed step: the next frame paints at once and reports the error as before.
    try {
      done = run(running, sliceBudget);
    } catch {
      broken = true;
      stop();
      deps.progressed();
      return;
    }
    if (!done) {
      schedule();
      return;
    }
    job = undefined;
    show(running);
    deps.progressed();
  }
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    if (framePaced) requestAnimationFrame(slice);
    else setTimeout(slice, 0);
  }
  /** The town layer to compose for a stepwise frame: `exact` when it is this frame's, else the last painted layer (another
   * view, drawn scaled) while this frame's is painted. Undefined: no layer can be kept, the frame paints at once. */
  function layerFor(f: F, stepwise: NativeCityStepwise, pixelsW: number, pixelsH: number): { layer?: TownLayer; exact: boolean } | undefined {
    if (broken) return undefined;
    const look = `${stepwise.key}|${deps.lookKey(f)}`;
    const key = `${deps.revision()}|${look}|${f.view.cx}|${f.view.cy}|${f.view.scale}|${f.w}|${f.h}|${f.dpr}|${f.lod}`;
    if (shownLayer?.key === key) {
      stop();
      return { layer: shownLayer, exact: true };
    }
    // The same towns in the same look stand in while this frame is painted: seen from another view, or from this one
    // before a texture or a mesh arrived.
    const standIn = shownLayer?.look === look ? shownLayer : undefined;
    if (job && job.layer.key !== key) stop();
    if (job) return { layer: standIn, exact: false };
    if (stepwise.moving && standIn && lastPaintMs > STEP_MOVING_MS) return { layer: standIn, exact: false };
    let layer = spareLayer;
    spareLayer = undefined;
    if (!layer) {
      const surface = deps.canvas(pixelsW, pixelsH),
        ctx = surface?.getContext('2d') as CanvasRenderingContext2D | undefined;
      if (!surface || !ctx) return undefined;
      layer = { canvas: surface, ctx, key: '', look: '', view: f.view, dpr: f.dpr, stats: deps.newStats() };
    }
    if (layer.canvas.width !== pixelsW) layer.canvas.width = pixelsW;
    if (layer.canvas.height !== pixelsH) layer.canvas.height = pixelsH;
    // A stopped repaint may have left drawing state behind: start from a clean context.
    (layer.ctx as { reset?: () => void }).reset?.();
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    layer.ctx.clearRect(0, 0, pixelsW, pixelsH);
    Object.assign(layer, { key, look, view: { ...f.view }, dpr: f.dpr, stats: { ...deps.newStats(), lod: f.lod } });
    const started: Job = { layer, steps: deps.paint(layer.ctx, f, layer.stats), ms: 0 };
    // Nothing to show meanwhile (first frame, new appearance): paint at once, as before. Otherwise a short share of
    // this frame when the last repaint was short (small towns and far views complete in place); a long one starts
    // after the frame, so the frame a view rests on never waits for the town.
    let done = false;
    try {
      done = run(started, !standIn ? Infinity : stepwise.moving ? STEP_MOVING_MS : lastPaintMs > STEP_INLINE_MS ? 0 : STEP_INLINE_MS);
    } catch (error) {
      recycleLayer(layer);
      throw error;
    }
    if (done) return { layer: show(started), exact: true };
    if (stepwise.moving) {
      // Too long for a moving frame: the kept layer follows the view until it rests.
      try {
        started.steps.return();
      } catch {
        /* Discarded. */
      }
      recycleLayer(layer);
      lastPaintMs = Math.max(lastPaintMs, 4 * STEP_MOVING_MS);
      return { layer: standIn, exact: false };
    }
    job = started;
    schedule();
    return { layer: standIn, exact: false };
  }
  return {
    layerFor,
    stop,
    /** Canvas work of the last complete repaint (0 before the first one). */
    get paintMs(): number {
      return lastPaintMs;
    },
    /** Stops the repaint in progress and frees the kept layers. */
    release(): void {
      released = true;
      stop();
      freeLayer(shownLayer);
      freeLayer(spareLayer);
      shownLayer = spareLayer = undefined;
    },
  };
}
