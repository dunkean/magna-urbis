/**
 * The 2D view of the map on screen: one frame per animation frame the page asks for (BenchRenderer.drawLive).
 *
 * It presents each frame through the composed view (composedView.ts, the live compositor) or, when that cannot draw
 * the frame or `?display=fallback` forces it, through the fallback view (fallback/fallbackView.ts): this is the only
 * place that chooses. It holds what is common to both:
 *  - the camera's motion (viewMotion.ts): moving or at rest;
 *  - the frozen picture of a style switch: while the appearance passes run, a copy of the last picture stays on screen
 *    and follows the view;
 *  - the capture frame: an exact frame laid over the view for a screenshot, kept until the camera moves (a tilted
 *    view: the compositor's frame read back, the exact renderers paint the top view only);
 *  - picking: the ground point and the building under a pixel (the 2D mapping in the top view, the camera's ray when
 *    tilted).
 *
 * Only the composed view draws a tilted camera (render/world/): the element says so to the viewer
 * (`data-camera="tilt"`), which then lets the camera tilt; under the fallback view the camera stays the top view.
 *
 * Loading never moves the camera nor changes the view in charge. The fallback view takes over for its own cases only
 * (no hardware WebGL2, an illustrated ground, a lost context, `?display=fallback`); a wait that ends by itself
 * (the ground of a new terrain baking its first tiles) leaves the composed view in charge with its last picture on
 * screen, whole, until it can compose again: the new terrain is never drawn with what the previous one left. Before the
 * first composed picture the fallback shows that wait with its ground alone: the map only ever adds to what it shows.
 */
import { noteFallbackFrame } from '../../render/live/liveStats';
import { fallbackForced } from '../../render/live/policy';
import { initializeDisplayQuality, noteDisplayNavigation, onDisplayQualityChange } from '../../render/displayQuality';
import { onVectorEngineChange } from '../../render/vectorEngine';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import { screenToWorld, type View } from '../../render/view';
import { isTilted } from '../../render/world/camera';
import type { WorldRelief } from '../../render/world/contract';
import type { Terrain3dCollisions } from '../../render/world/terrain3dCollisions';
import { suspendFantasyRaster } from '../../ui/fantasyRaster';
import { handheldDevice } from '../../../../rust/bridge/deviceClass';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { ComposedView, GROUND_WARMING, type MapPick } from './composedView';
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
  /** The composed view has presented a picture: the start-up is over. */
  private started = false;
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
    if (handheldDevice()) document.addEventListener('visibilitychange', this.visibilityChanged);
    this.unlisten = () => {
      offQuality();
      offEngine();
      document.removeEventListener('visibilitychange', this.visibilityChanged);
    };
  }

  private visibilityChanged = (): void => {
    this.composed.syncWork();
    this.parts.ground.gpu?.setLivePaused(this.map.preparing || document.hidden);
    if (document.hidden) {
      this.motion.restDone();
      this.suspendStepwisePaints();
    } else if (this.map.world) {
      this.composed.retryOnForeground();
      this.map.repaint();
    }
  };

  draw(view: View, w: number, h: number, dpr: number): void {
    if (handheldDevice() && document.hidden) return;
    const map = this.map;
    // A failed program is reported by settled()/exactReady() (the appearance status); the view keeps its picture.
    initializeDisplayQuality();
    if (map.preparing) {
      this.followFrozen(view, w, h);
      return;
    }
    if (this.captured) {
      if (sameFrame(this.captured, view, w, h, dpr)) return;
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
      this.started = true;
      if (this.presenter === 'fallback') this.fallback.leave();
      this.present('composed');
      this.composed.draw(view, w, h, dpr, moved, now);
      return;
    }
    // The composed view is on screen and only waits for the first tiles of a new ground: its last picture stays (the
    // compositor's canvas keeps what it presented), the camera keeps its pose, and its preparation goes on; the
    // frame is asked again when the tiles are there.
    if (blocked === GROUND_WARMING && this.presenter === 'composed') {
      map.stats.live = `holding: ${blocked}`;
      this.composed.syncWork();
      return;
    }
    if (this.presenter === 'composed') this.composed.leave();
    this.present('fallback');
    this.composed.standBy(blocked === GROUND_WARMING);
    noteFallbackFrame(blocked);
    // Before the first composed picture (the first map of the page, a reload) a warming ground is shown by the
    // fallback's ground alone: its picture of the overlay, the town and the names would leave the screen when the
    // compositor takes over, and the map must only ever add to what it shows (paper, ground, water, overlay, town, names).
    this.fallback.draw(view, w, h, dpr, moved, now, blocked === GROUND_WARMING && !this.started);
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
  walkCollisions(): Terrain3dCollisions | undefined {
    return this.presenter === 'composed' ? this.composed.walkCollisions() : undefined;
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

  // --- style switch ---------------------------------------------------------------------------------------------------

  beginAppearanceChange(): void {
    const map = this.map;
    this.releaseCapture();
    this.suspendStepwisePaints();
    this.motion.restDone();
    const at = this.motion.frame,
      sources = this.current()?.frozenSources();
    if (at && sources) this.frozen = { element: this.freeze(sources), view: { ...at.view }, w: at.w, h: at.h };
    // The terrain renderer draws nothing by itself, and no tile is baked, while the passes change its state.
    map.preparing = true;
    this.parts.ground.gpu?.setLivePaused(true);
    this.composed.syncWork();
  }
  endAppearanceChange(): void {
    const map = this.map;
    map.preparing = false;
    this.parts.ground.gpu?.setLivePaused(handheldDevice() && document.hidden);
    this.frozen?.element.remove();
    this.frozen = undefined;
    this.fallback.thaw();
    this.composed.thaw();
    // Products can finish while preparing hides the frame. Publish the completed state even when no worker or
    // program has another callback left to wake the view (notably a regenerated town on an unchanged terrain).
    if (!map.disposed && map.world) map.repaint();
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
    // A tilted picture stays where it is: a 2D transform cannot follow a perspective.
    if (!previous || isTilted(previous.view) || isTilted(view)) return;
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
    if (!frame || !map.world) {
      if (this.parts.ground.gpuActive) this.parts.ground.gpu!.redrawForCapture();
      return;
    }
    // The settled compositor already presents the overhead volumes and labels. An exact Canvas
    // repaint here would replace those roofs with the fallback plan in V2 review shots.
    if (!isTilted(frame.view) && map.volumeBuildings && this.presenter === 'composed') {
      this.releaseCapture();
      return;
    }
    const canvas = this.captureCanvas;
    // A tilted view is the compositor's frame read back: the exact renderers paint the top view only.
    if (isTilted(frame.view)) {
      if (this.presenter !== 'composed' || !this.composed.capture(frame.view, frame.w, frame.h, frame.dpr, canvas)) return;
    } else this.exact.paint(canvas, frame.view, frame.w, frame.h, frame.dpr, { stepwise: false, groundBeneath: false });
    canvas.style.cssText = `position:absolute;left:0;top:0;z-index:1;width:${frame.w}px;height:${frame.h}px`;
    this.element.append(canvas);
    this.captured = { view: { ...frame.view }, w: frame.w, h: frame.h, dpr: frame.dpr };
  }
  /** The tilted view on screen as a picture at its pixel ratio (the PNG of the view); undefined in the top view. */
  captureView(): HTMLCanvasElement | undefined {
    const frame = this.motion.frame,
      canvas = document.createElement('canvas');
    if (!frame || !isTilted(frame.view) || this.presenter !== 'composed') return undefined;
    return this.composed.capture(frame.view, frame.w, frame.h, frame.dpr, canvas) ? canvas : undefined;
  }
  /** The ground point under the CSS pixel (sx, sy) of `view`, and in a tilted view the building volume in front of it;
   * undefined when the pixel shows no ground (the sky of a tilted view). */
  pick(view: View, w: number, h: number, sx: number, sy: number): MapPick | undefined {
    if (isTilted(view) && this.presenter === 'composed') return this.composed.pick(view, w, h, sx, sy);
    const [x, y] = screenToWorld(view, w, h, sx, sy);
    return { x, y, metresPerPixel: 1 / view.scale };
  }
  /** Tints the volume of the selected building in the tilted view (its volume id; undefined: none). */
  highlightBuilding(id: string | undefined): void {
    this.composed.highlightBuilding(id);
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
