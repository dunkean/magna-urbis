/**
 * The 2D view of the map on screen: one frame per animation frame the page asks for (BenchRenderer.drawLive).
 *
 * It presents each frame through the composed view (composedView.ts, the live compositor) or, when that cannot draw
 * the frame or `?display=fallback` forces it, through the fallback view (fallback/fallbackView.ts): this is the only
 * place that chooses. It holds what is common to both:
 *  - the camera's motion (viewMotion.ts): moving or at rest;
 *  - the frozen picture of a style switch: while the appearance passes run, a copy of the last picture stays on screen
 *    and follows the view;
 *  - the capture frame: an exact frame laid over the view for a screenshot, kept until the camera moves.
 *
 * Only the composed view draws a tilted camera (render/world/): the element says so to the viewer
 * (`data-camera="tilt"`), which then lets the camera tilt; under the fallback view the camera stays the top view.
 */
import { noteFallbackFrame } from '../../render/live/liveStats';
import { fallbackForced } from '../../render/live/policy';
import { initializeDisplayQuality, noteDisplayNavigation, onDisplayQualityChange } from '../../render/displayQuality';
import { onVectorEngineChange } from '../../render/vectorEngine';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { View } from '../../render/view';
import { isTilted } from '../../render/world/camera';
import type { WorldRelief } from '../../render/world/contract';
import { suspendFantasyRaster } from '../../ui/fantasyRaster';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { ComposedView, GROUND_WARMING } from './composedView';
import type { AppearanceListener, DisplayParts, ViewFrame, ViewStatus } from './contract';
import type { ExactFrame } from './exactFrame';
import { FallbackView } from './fallback/fallbackView';
import type { MapState } from './mapState';
import type { DisplayReadiness } from './readiness';
import { sameFrame, ViewMotion } from './viewMotion';

/** Which view presented the last frame. */
type Presenter = 'none' | 'composed' | 'fallback';

export class MapView implements AppearanceListener, ViewStatus {
  /** The page element of the map: the canvases of the view in charge, the frozen picture and the capture frame. */
  readonly element = document.createElement('div');
  private readonly motion = new ViewMotion();
  private readonly composed: ComposedView;
  private readonly fallback: FallbackView;
  private presenter: Presenter = 'none';
  /** The picture kept on screen while the appearance passes run, and the view it shows. */
  private frozen?: { element: HTMLDivElement; view: View; w: number; h: number };
  /** An exact frame covers the view (prepareCapture), through late invalidations, until the camera moves. */
  private captured?: ViewFrame;
  private readonly captureCanvas = document.createElement('canvas');
  private readonly unlisten: () => void;

  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly exact: ExactFrame,
    readiness: DisplayReadiness,
  ) {
    this.element.className = 'viewer-direct';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.composed = new ComposedView(map, parts, this.element, this.motion, readiness);
    this.fallback = new FallbackView(map, parts, this.element, this.motion, exact, readiness);
    // The display quality and the vector engine are part of what every retained picture shows.
    const offQuality = onDisplayQualityChange(this.styleChanged),
      offEngine = onVectorEngineChange(this.styleChanged);
    this.unlisten = () => {
      offQuality();
      offEngine();
    };
  }

  draw(view: View, w: number, h: number, dpr: number): void {
    const map = this.map;
    if (map.suspended) return;
    // A failed program is reported by settled()/exactReady() (the appearance status); the view keeps its picture.
    initializeDisplayQuality();
    if (map.preparing) {
      this.followFrozen(view, w, h);
      return;
    }
    if (this.captured) {
      if (!isTilted(view) && sameFrame(this.captured, view, w, h, dpr)) return;
      this.releaseCapture();
    }
    const now = performance.now(),
      moved = this.motion.note(view, w, h, dpr, now);
    if (moved) {
      noteDisplayNavigation();
      this.suspendStepwisePaints();
    }
    const blocked = fallbackForced() ? 'forced fallback' : this.composed.blocked(view, w, h, dpr);
    map.stats.live = blocked ?? 'compositor';
    if (!blocked) {
      if (this.presenter === 'fallback') this.fallback.leave();
      this.present('composed');
      this.composed.draw(view, w, h, dpr, moved, now);
      return;
    }
    if (this.presenter === 'composed') this.composed.leave();
    this.present('fallback');
    this.composed.standBy(blocked === GROUND_WARMING);
    noteFallbackFrame(blocked);
    this.fallback.draw(view, w, h, dpr, moved, now);
  }
  /** Notes the view in charge, and tells the viewer through the element whether it draws a tilted camera. */
  private present(presenter: Presenter): void {
    if (this.presenter === presenter) return;
    this.presenter = presenter;
    if (presenter === 'composed') this.element.dataset.camera = 'tilt';
    else delete this.element.dataset.camera;
  }
  /** The relief of the map on screen, for the viewer's zoom on the terrain (Viewer.setRelief). */
  relief(): WorldRelief | undefined {
    return this.composed.relief();
  }
  private current(): ComposedView | FallbackView | undefined {
    return this.presenter === 'composed' ? this.composed : this.presenter === 'fallback' ? this.fallback : undefined;
  }
  /** Stops the stepwise paints of the exact renderers (overlay tiles, the kept town layer, illustrated stamps): the
   * view moved, or the renderers are wanted elsewhere. */
  private suspendStepwisePaints(): void {
    const { cartography, town, ground } = this.parts;
    cartography.renderer?.suspendStepwise();
    if (this.map.ownsShared) town.city?.suspendStepwise();
    if (ground.fantasy) suspendFantasyRaster(ground.fantasy);
  }

  // --- what the rest of the display asks or tells the view -----------------------------------------------------------

  busy(): boolean {
    return this.motion.restOwed || this.motion.phase() === 'moving';
  }
  pendingViewOnly(): number {
    return this.current()?.pendingViewOnly() ?? 0;
  }
  pendingOverlay(): number {
    return this.current()?.pendingOverlay() ?? 0;
  }
  /** Inside a compositor frame or work slice (MapState: a frame request raised there is a live layer's). */
  inCompositor(): boolean {
    return this.composed.inCompositor();
  }
  contoursChanged(): void {
    this.composed.contoursChanged();
  }
  groundCaptureDropped(): void {
    this.composed.groundCaptureDropped();
  }
  setSuspended(value: boolean): void {
    const map = this.map;
    if (map.suspended === value) return;
    map.suspended = value;
    this.parts.ground.gpu?.setLivePaused(value || map.preparing);
    this.composed.syncWork();
    if (value) {
      this.suspendStepwisePaints();
      this.motion.restDone();
    } else map.invalidate();
  }

  // --- style switch ---------------------------------------------------------------------------------------------------

  beginAppearanceChange(): void {
    const map = this.map;
    this.releaseCapture();
    this.suspendStepwisePaints();
    if (!map.suspended) {
      this.motion.restDone();
      const at = this.motion.frame,
        sources = this.current()?.frozenSources();
      if (at && sources) this.frozen = { element: this.freeze(sources), view: { ...at.view }, w: at.w, h: at.h };
    }
    // The terrain renderer draws nothing by itself, and no tile is baked, while the passes change its state.
    map.preparing = true;
    this.parts.ground.gpu?.setLivePaused(true);
    this.composed.syncWork();
  }
  endAppearanceChange(): void {
    const map = this.map;
    map.preparing = false;
    this.parts.ground.gpu?.setLivePaused(map.suspended);
    this.frozen?.element.remove();
    this.frozen = undefined;
    this.fallback.thaw();
    this.composed.thaw();
  }
  contentChanged(ran: readonly string[], before: { resolved?: ResolvedAppearance; native?: TerrainData }): void {
    this.composed.contentChanged(ran, before);
  }
  /** Copies of the canvases on screen in one element above them; the canvases are hidden until `thaw`. */
  private freeze(sources: readonly HTMLCanvasElement[]): HTMLDivElement {
    const frozen = document.createElement('div');
    frozen.style.cssText = `position:absolute;inset:0;z-index:1;background:${this.map.paper};pointer-events:none`;
    for (const source of sources) {
      if (!source.width || !source.height) continue;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      copy.style.cssText = source.style.cssText;
      copy.style.position = 'absolute';
      copy.style.visibility = 'visible';
      copy.getContext('2d')!.drawImage(source, 0, 0);
      frozen.append(copy);
      source.style.visibility = 'hidden';
    }
    this.element.append(frozen);
    return frozen;
  }
  private followFrozen(view: View, w: number, h: number): void {
    const previous = this.frozen;
    if (!previous) return;
    const k = view.scale / previous.view.scale,
      tx = (w - previous.w) / 2 + (previous.view.cx - view.cx) * view.scale,
      ty = (h - previous.h) / 2 + (previous.view.cy - view.cy) * view.scale;
    previous.element.style.transformOrigin = '50% 50%';
    previous.element.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
  }
  private styleChanged = (): void => {
    const map = this.map;
    this.releaseCapture();
    map.townContent++;
    this.suspendStepwisePaints();
    this.motion.restDone();
    this.fallback.forget();
    this.composed.invalidateLayers();
    if (!map.disposed && map.world) map.invalidate();
  };

  // --- capture --------------------------------------------------------------------------------------------------------

  /** Lays an exact frame of the view on screen over it (an explicit readback of the ground; ordinary navigation
   * never does this). The caller has checked that no display work is pending. */
  prepareCapture(): void {
    const map = this.map,
      frame = this.motion.frame;
    this.suspendStepwisePaints();
    this.motion.restDone();
    // A tilted view is the compositor's frame as it is: the exact renderers paint the top view only.
    if (this.presenter === 'composed' && this.composed.tilted) return;
    if (!frame || !map.world) {
      if (this.parts.ground.gpuActive) this.parts.ground.gpu!.redrawForCapture();
      return;
    }
    const canvas = this.captureCanvas;
    this.exact.paint(canvas, frame.view, frame.w, frame.h, frame.dpr, { stepwise: false, groundBeneath: false });
    canvas.style.cssText = `position:absolute;left:0;top:0;z-index:1;width:${frame.w}px;height:${frame.h}px`;
    this.element.append(canvas);
    this.captured = { view: { ...frame.view }, w: frame.w, h: frame.h, dpr: frame.dpr };
  }
  private releaseCapture(): void {
    if (!this.captured) return;
    this.captured = undefined;
    this.captureCanvas.remove();
    this.captureCanvas.width = this.captureCanvas.height = 0;
  }

  dispose(): void {
    this.suspendStepwisePaints();
    this.unlisten();
    this.motion.restDone();
    this.releaseCapture();
    this.frozen?.element.remove();
    this.frozen = undefined;
    this.fallback.leave();
    this.composed.leave();
    this.composed.dispose();
    this.present('none');
  }
}
