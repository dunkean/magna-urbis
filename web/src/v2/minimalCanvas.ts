/** Minimal map: retained Canvas batches at rest and an optional single-pass GPU contour layer during motion. */
import { buildMinimalGeometry, emptyMinimalGeometry, bakeMinimalRelief, paintMinimalMap, type MinimalHeight, type MinimalFeature, type MinimalGeometry, type MinimalPlace, type MinimalTextLayout } from '../render/minimalMap';
import type { CompositionRecipe, TownPlan } from '../render/composition';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { retainedMinimalContours } from './minimalContourCache';
import type { MinimalContourSet } from '../render/minimalContours';
import { createMinimalContourPainter, type MinimalContourPainter } from '../render/minimalContourPainter';
import type { RenderReadiness } from '../render/renderReadiness';
import type { ExportFrame } from './display/exactFrame';

const LIVE_DEFER_MS = 40,
  LIVE_SETTLE_MS = 160,
  SLICE_MS = 8;
/** A paint whose next animation frame comes later than this was too heavy for the graphics process to show in time,
 * however short its Canvas calls were. The 20 ms bound allows one 60 Hz frame plus submission slack; after `SLOW_PAINTS` of them in a row a moving view follows as a bitmap. */
const SLOW_PAINT_MS = 20,
  SLOW_PAINTS = 2;
export interface MinimalMapContent {
  key: string;
  terrainKey: number;
  size: number;
  features: Iterable<MinimalFeature>;
  places: MinimalPlace[];
  height?: () => MinimalHeight;
}
interface Frame {
  view: View;
  w: number;
  h: number;
  dpr: number;
}
const same = (a: Frame, b: Frame): boolean => a.w === b.w && a.h === b.h && a.dpr === b.dpr && a.view.cx === b.view.cx && a.view.cy === b.view.cy && a.view.scale === b.view.scale;

/** The V2's independent Canvas 2D path. Only a full paint visits the retained cell batches. */
export class MinimalCanvasRenderer {
  readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private geometry?: MinimalGeometry;
  private key = '';
  private terrainKey = -1;
  private relief?: HTMLCanvasElement;
  /** Contour lines of the current terrain: traced once, when first asked for. */
  private contours?: MinimalContourSet;
  private contourPainter?: MinimalContourPainter | null;
  private recipe?: CompositionRecipe;
  private plan?: TownPlan;
  private places: MinimalPlace[] = [];
  private textLayout: MinimalTextLayout = { labels: [] };
  private layers: Partial<ExportLayers> = {};
  private work: Promise<void> = Promise.resolve();
  private serial = 0;
  private disposed = false;
  private dirty = true;
  private requested?: Frame;
  private painted?: Frame;
  private timer?: ReturnType<typeof setTimeout>;
  private lastMove = 0;
  /** Recent paints shown late (0 to SLOW_PAINTS), and whether a moving view therefore follows as a transformed bitmap. */
  private slowPaints = 0;
  private slowLive = false;
  /** Scale at which the view started to follow as a bitmap: it paints live again a factor of two away (a far view
   * shows fewer, simpler features) or on new content. */
  private slowScale = 0;
  private readiness?: RenderReadiness;
  readonly stats = { renderer: 'minimal', frameMs: 0, geometryBuildMs: 0, features: 0 };
  constructor(private invalidate: () => void) {
    this.element.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#f4f1ea';
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0';
    this.element.append(this.canvas);
  }
  async setContent(content: MinimalMapContent, recipe: CompositionRecipe, plan: TownPlan, layers: Partial<ExportLayers> = {}, readiness?: RenderReadiness): Promise<void> {
    this.recipe = recipe;
    this.plan = plan;
    this.layers = layers;
    this.readiness = readiness;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    const { key, terrainKey, size } = content;
    const serial = ++this.serial;
    this.work = (async () => {
      if (key !== this.key) {
        const geometry = emptyMinimalGeometry(size);
        const steps = buildMinimalGeometry(size, content.features, geometry);
        const ms = await this.slices(steps, serial);
        if (serial !== this.serial || this.disposed) return;
        geometry.buildMs = ms;
        this.geometry = geometry;
        this.key = key;
        this.stats.geometryBuildMs = ms;
        this.stats.features = geometry.features;
      }
      if (this.terrainKey !== terrainKey) {
        this.relief = undefined;
        this.contours = undefined;
        this.terrainKey = terrainKey;
      }
      if (content.height && layers.terrain !== false && recipe.ground.contours && !this.contours) {
        const terrain = content.height();
        if (this.contourPainter === undefined) this.contourPainter = createMinimalContourPainter() ?? null;
        const contours = await retainedMinimalContours({ ...terrain, width: size }, !!this.contourPainter);
        if (serial !== this.serial || this.disposed) return;
        this.contours = contours;
        this.contourPainter?.set(contours);
      }
      if (content.height && layers.terrain !== false && recipe.effects.relief && !this.relief) {
        const terrain = content.height(),
          canvas = document.createElement('canvas');
        await this.slices(bakeMinimalRelief(terrain, canvas), serial);
        if (serial !== this.serial || this.disposed) return;
        this.relief = canvas;
      }
      this.places = content.places;
      this.textLayout.labels = [];
      readiness?.mark('fields-ready');
    })();
    await this.work;
  }
  private async slices(steps: Generator<void>, serial: number): Promise<number> {
    let total = 0,
      done = false;
    while (!done && !this.disposed && serial === this.serial) {
      const start = performance.now();
      do {
        done = !!steps.next().done;
      } while (!done && performance.now() - start < SLICE_MS);
      total += performance.now() - start;
      if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (!done) steps.return(undefined);
    return total;
  }
  drawLive(view: View, w: number, h: number, dpr: number): void {
    const frame = { view: { ...view }, w, h, dpr: Math.min(dpr, 1.5) },
      now = performance.now();
    const moving = !!this.requested && !same(frame, this.requested);
    if (moving) this.lastMove = now;
    this.requested = frame;
    if (!this.dirty && this.painted && same(frame, this.painted)) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.slowLive && (this.dirty || view.scale > this.slowScale * 2 || view.scale < this.slowScale / 2)) {
      this.slowLive = false;
      this.slowPaints = 0;
    }
    if (!this.dirty && moving && this.painted && this.painted.w === w && this.painted.h === h && (this.slowLive || this.stats.frameMs > 1000 / 60)) {
      const old = this.painted.view,
        ratio = view.scale / old.scale;
      const x = w / 2 + (old.cx - view.cx) * view.scale - (w / 2) * ratio;
      const y = h / 2 + (old.cy - view.cy) * view.scale - (h / 2) * ratio;
      this.canvas.style.transform = `translate(${x}px,${y}px) scale(${ratio})`;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.paint(frame, true);
        this.invalidate();
      }, LIVE_SETTLE_MS);
      return;
    }
    const resting = this.dirty || now - this.lastMove >= LIVE_SETTLE_MS;
    this.paint(frame, resting);
    if (!resting)
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          this.paint(frame, true);
          this.invalidate();
        },
        Math.max(LIVE_DEFER_MS, LIVE_SETTLE_MS - (now - this.lastMove)),
      );
  }
  private paint(frame: Frame, layoutText: boolean): void {
    if (!this.geometry || !this.recipe || this.disposed) return;
    const { w, h, dpr, view } = frame,
      width = Math.max(1, Math.round(w * dpr)),
      height = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.style.transform = '';
    this.stats.frameMs = paintMinimalMap(this.canvas.getContext('2d')!, this.geometry, {
      view,
      width: w,
      height: h,
      dpr,
      recipe: this.recipe,
      plan: this.plan,
      places: this.places,
      textLayout: this.textLayout,
      layoutText,
      relief: this.relief,
      contours: this.contours?.exact,
      contourRaster: !layoutText && this.recipe.ground.contours && this.layers.terrain !== false ? this.contourPainter?.draw(view, w, h, dpr) : undefined,
      layers: this.layers,
    });
    this.painted = frame;
    this.dirty = false;
    // The Canvas calls return before the graphics process has drawn them: on a large map each takes several display
    // frames to show although `frameMs` stays short. The delay of the next animation frame tells.
    if (typeof requestAnimationFrame === 'function') {
      const started = performance.now();
      requestAnimationFrame(() => {
        this.slowPaints = performance.now() - started > SLOW_PAINT_MS ? this.slowPaints + 1 : 0;
        if (this.slowPaints >= SLOW_PAINTS && !this.slowLive) {
          this.slowLive = true;
          this.slowScale = frame.view.scale;
        }
      });
    }
    this.readiness?.mark('first-useful-frame');
    this.readiness?.mark('first-covered-frame');
    this.readiness?.mark('visible-complete');
  }
  drawMini(size: number): HTMLCanvasElement {
    return this.captureCanvas(size);
  }
  private captureCanvas(size: number, frame?: ExportFrame): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = frame?.width ?? size;
    canvas.height = frame?.height ?? size;
    if (this.geometry && this.recipe)
      paintMinimalMap(canvas.getContext('2d')!, this.geometry, {
        view: frame?.view ?? { cx: this.geometry.size / 2, cy: this.geometry.size / 2, scale: size / this.geometry.size },
        width: canvas.width,
        height: canvas.height,
        dpr: 1,
        recipe: this.recipe,
        plan: this.plan,
        places: this.places,
        textLayout: { labels: [] },
        relief: this.relief,
        contours: this.contours?.exact,
        layers: this.layers,
      });
    return canvas;
  }
  async capture(size: number, frame?: ExportFrame): Promise<HTMLCanvasElement> {
    await this.work;
    return this.captureCanvas(size, frame);
  }
  async settled(): Promise<void> {
    await this.work;
    this.prepareCapture();
  }
  prepareCapture(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.requested) {
      this.paint(this.requested, true);
      this.invalidate();
    }
  }
  dispose(): void {
    this.disposed = true;
    this.serial++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.geometry = undefined;
    this.relief = undefined;
    this.contours = undefined;
    this.contourPainter?.dispose();
    this.canvas.width = this.canvas.height = 0;
    this.element.remove();
  }
}
