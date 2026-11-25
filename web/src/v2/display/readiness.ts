/**
 * Readiness of the display: what is still owed to the map on screen, and the marks of the render request.
 *
 * The page's spinner, the sheets and the render board wait on `pendingWork() === 0` and on `settled()` before they
 * capture; the marks (`first-useful-frame`, `programs-ready`, `visible-complete`) go to the RenderReadiness of the
 * last `set()`.
 */
import { StepwisePaint } from '../../render/stepwisePaint';
import type { DisplayParts, ViewStatus } from './contract';
import type { MapState } from './mapState';

export class DisplayReadiness {
  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly view: () => ViewStatus,
  ) {}

  /** Display work still owed to the map on screen; 0 once it is complete. */
  pendingWork(): number {
    const { ground, water, contours } = this.parts,
      view = this.view();
    return Number(this.map.preparing) + Number(!!ground.forestJob) + Number(!!ground.programWork) + Number(!!ground.programError) + Number(water.vectorPending) + view.pendingViewOnly() + StepwisePaint.pending(this.map) + view.pendingOverlay() + contours.pending();
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
    const ground = this.parts.ground;
    await ground.exactReady();
    while (!this.map.disposed && (this.pendingWork() || !this.map.request?.has('visible-complete'))) {
      if (ground.programError) throw ground.programError;
      this.map.repaint();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }
}
