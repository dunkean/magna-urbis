/**
 * The fallback view: the 2D map on screen when the live compositor cannot draw it.
 *
 * When it runs (mapView.ts takes it whenever the composed view is blocked; the reason is in `__muLive.reason`):
 *  - no hardware WebGL2 for the compositor (none at all, or a software rasterizer);
 *  - a CPU ground (the terrain renderer is unavailable or its context was lost for good) or an illustrated ground
 *    (painted on Canvas 2D): the compositor's ground layer bakes tiles from the GPU terrain renderer only;
 *  - the compositor's context is lost, until it is restored;
 *  - the first frames of a map, while the ground layer has no baked tile and nothing to stand in for it;
 *  - `?display=fallback`, to test it on a machine the compositor serves.
 *
 * Why it exists: on those machines and looks the map must still show and move. It does the simplest correct thing,
 * and everything it does is in this folder. One rule: the exact renderers paint the view at rest into one flattened
 * canvas (exactFrame.ts, stepwise: they paint what they have and ask for the frame again as they progress), and that
 * picture follows the view by a CSS transform until the next paint at rest. A GPU ground keeps its own canvas under
 * the picture and obeys the same rule there (TerrainRenderer.redrawNow, ui/terrain/fallbackGround.ts). Nothing is
 * painted while the view moves, except the first picture of a view size.
 */
import { noteLiveUnit } from '../../../render/live/liveStats';
import { StepwisePaint } from '../../../render/stepwisePaint';
import type { View } from '../../../render/view';
import { terrainRendererCanvas } from '../../../ui/terrainRenderer';
import type { DisplayParts, ViewFrame } from '../contract';
import type { ExactFrame } from '../exactFrame';
import type { MapState } from '../mapState';
import type { DisplayReadiness } from '../readiness';
import { sameFrame, type ViewMotion } from '../viewMotion';

export class FallbackView {
  /** The picture: the overlay, the town and the names flattened; on a CPU or illustrated ground, the ground too. */
  private readonly surface = document.createElement('canvas');
  /** The terrain renderer's canvas in the page, under the picture (GPU ground only). */
  private groundCanvas?: HTMLCanvasElement;
  /** The view the picture was last painted at; undefined: it must be painted. */
  private painted?: ViewFrame;
  /** `MapState.paintRevision` the picture was painted for. */
  private paintedRevision = -1;
  private cssW = 0;
  private cssH = 0;

  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly element: HTMLElement,
    private readonly motion: ViewMotion,
    private readonly exact: ExactFrame,
    private readonly readiness: DisplayReadiness,
  ) {}

  /** One frame of the view. `moved`: the view differs from the previous frame's. */
  draw(view: View, w: number, h: number, dpr: number, moved: boolean, now: number): void {
    const moving = this.motion.phase(now) === 'moving';
    this.attach(w, h);
    // In every frame: the terrain renderer moves its picture or, when something else drew in its canvas since (a
    // tile bake, a whole-map capture), paints it again.
    if (this.groundCanvas) this.parts.ground.gpu!.redrawNow(view, w, h, moving, Math.min(2, dpr));
    const painted = this.painted;
    if (moving && painted && painted.w === w && painted.h === h && painted.dpr === dpr) {
      const k = view.scale / painted.view.scale,
        tx = (painted.view.cx - view.cx) * view.scale,
        ty = (painted.view.cy - view.cy) * view.scale;
      this.surface.style.transformOrigin = '50% 50%';
      this.surface.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k})`;
      this.motion.awaitRest(now, moved, this.viewRested);
      return;
    }
    // At rest with nothing new (the compositor asked for a frame while its ground layer warms up): the picture stands.
    if (!moving && sameFrame(painted, view, w, h, dpr) && this.paintedRevision === this.map.paintRevision) return;
    this.paint(view, w, h, dpr);
    if (moving) this.motion.awaitRest(now, moved, this.viewRested);
    else this.motion.restDone();
  }
  private viewRested = (): void => {
    if (!this.map.disposed && this.map.world) this.map.repaint();
  };
  private paint(view: View, w: number, h: number, dpr: number): void {
    const started = performance.now(),
      water = this.parts.water;
    // Taken before the paint: an invalidation it raises makes the picture due again.
    this.paintedRevision = this.map.paintRevision;
    StepwisePaint.track(this.map, () => this.exact.paint(this.surface, view, w, h, dpr, { stepwise: true, groundBeneath: true }));
    this.painted = { view: { ...view }, w, h, dpr };
    this.surface.style.transform = '';
    // The rivers are on screen: the ground was drawn just before, the vector water is in the picture.
    if (water.waterShownDue) water.noteWaterShown();
    noteLiveUnit('fallback:paint', started);
    this.readiness.notePresented();
  }
  private attach(w: number, h: number): void {
    const { ground } = this.parts;
    const canvas = ground.gpuActive ? terrainRendererCanvas(ground.gpu!, ground.gpuCanvas) : undefined;
    const groundChanged = canvas !== this.groundCanvas;
    if (groundChanged) {
      this.groundCanvas?.remove();
      this.groundCanvas = canvas;
      if (canvas) this.element.prepend(canvas);
    }
    if (groundChanged || w !== this.cssW || h !== this.cssH) {
      this.cssW = w;
      this.cssH = h;
      this.surface.style.width = w + 'px';
      this.surface.style.height = h + 'px';
      if (canvas) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
    }
    if (this.surface.parentElement !== this.element) this.element.append(this.surface);
  }
  /** The terrain renderer's canvas and the picture leave the page (the composed view takes it, or the display ends). */
  leave(): void {
    this.groundCanvas?.remove();
    this.groundCanvas = undefined;
    this.surface.remove();
    this.surface.style.cssText = '';
    this.surface.width = this.surface.height = 0;
    this.painted = undefined;
    this.cssW = this.cssH = 0;
  }
  /** The picture no longer shows the content (another display quality or vector engine): the next frame paints it. */
  forget(): void {
    this.painted = undefined;
  }

  /** Pending work that only concerns the view on screen: the picture at rest, the town paint. */
  pendingViewOnly(): number {
    return Number(this.motion.restOwed) + Number(!!(this.map.stats.city as { pending?: boolean } | undefined)?.pending);
  }
  /** Overlay rasters the last paint of the cartography still waits for. */
  pendingOverlay(): number {
    return this.parts.cartography.renderer?.lastStats().rasterPending ?? 0;
  }
  /** The canvases that hold the picture on screen, for the frozen stand-in of a style switch. The ground buffer is
   * not preserved: it can only be copied in the task that drew it, so the ground is drawn again here. */
  frozenSources(): HTMLCanvasElement[] | undefined {
    const shown = this.motion.frame;
    if (!shown || !this.painted || this.surface.parentElement !== this.element) return undefined;
    const { ground } = this.parts;
    if (this.groundCanvas && ground.gpuActive) ground.gpu!.redrawNow(shown.view, shown.w, shown.h, false, Math.min(2, shown.dpr));
    return this.groundCanvas ? [this.groundCanvas, this.surface] : [this.surface];
  }
  /** After a style switch: the canvases the frozen stand-in hid come back, and the next frame paints the new map. */
  thaw(): void {
    this.surface.style.visibility = '';
    if (this.groundCanvas) this.groundCanvas.style.visibility = '';
    this.painted = undefined;
  }
}
