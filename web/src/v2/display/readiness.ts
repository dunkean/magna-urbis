/**
 * Readiness of the display: what is still owed to the map on screen, and the marks of the render request.
 *
 * The page's spinner, the sheets and the render board wait on `pendingWork() === 0` and on `settled()` before they
 * capture; the marks (`first-useful-frame`, `programs-ready`, `visible-complete`) go to the RenderReadiness of the
 * last `set()`.
 */
import { RenderReadiness } from '../../render/renderReadiness';
import { LiveTileFill } from '../../render/liveTileFill';
import { cityContoursPending } from '../../render/cityContours';
import type { MapState } from './mapState';
import type { DisplayParts } from './parts';

/** What the readiness needs to know of the view on screen. */
export interface ReadinessView {
  /** Pending work that only concerns the view on screen (the picture at rest, the town layer, names being prepared). */
  pendingViewOnly(): number;
  /** Overlay rasters the last exact paint of the cartography still waits for. */
  pendingOverlay(): number;
}

export class DisplayReadiness {
  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly view: () => ReadinessView,
  ) {}

  /** Display work still owed to the map on screen; 0 once it is complete. */
  pendingWork(): number {
    const { ground, water, contours } = this.parts,
      view = this.view();
    return (
      Number(this.map.preparing) +
      Number(!!ground.forestJob) +
      Number(!!ground.programWork) +
      Number(!!ground.programError) +
      Number(!!water.vectorRequest) +
      view.pendingViewOnly() +
      LiveTileFill.pending(this.map) +
      view.pendingOverlay() +
      cityContoursPending(this.map.native) +
      contours.contourWaiters.size
    );
  }
  /** A picture of the view at rest was presented. */
  notePresented(): void {
    if (this.map.preparing) return;
    const request = this.map.request,
      ground = this.parts.ground;
    request?.mark('first-useful-frame');
    if (!ground.programWork && !ground.forestJob && !ground.programError) request?.mark('programs-ready');
    if (this.pendingWork() === 0 && !request?.has('visible-complete')) {
      requestAnimationFrame(() => {
        if (this.map.request === request && this.pendingWork() === 0) request?.mark('visible-complete');
      });
    }
  }
  /** Resolves once the progressive updates (woods after a town build) are on screen. */
  async settled(): Promise<void> {
    await this.parts.ground.exactReady();
    while (!this.map.disposed && !this.map.suspended && (this.pendingWork() || !this.map.request?.has('visible-complete'))) {
      if (this.parts.ground.programError) throw this.parts.ground.programError;
      this.map.repaint();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }
  /** Work still deriving products after `set()` returned (contours in the worker, the woods, the look's programs). */
  derivedPending(): number {
    return cityContoursPending(this.map.native) + this.parts.contours.contourWaiters.size + Number(!!this.parts.ground.forestJob) + Number(!!this.parts.ground.programWork);
  }
}
