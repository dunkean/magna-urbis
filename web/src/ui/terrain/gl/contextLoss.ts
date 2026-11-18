/**
 * Context loss policy of the WebGL2 ground (GlContextRecovery, glContextRecovery.ts): on a loss, wait for the
 * browser's restore and rebuild every GL object from the retained inputs; a second loss enters the light profile; a
 * loss in the light profile, or no restore in time, gives up: MAP_GPU_FAILED_EVENT tells the page, and variantReady()
 * throws MapContextLostError so the owner drops the renderer.
 */
import { GlContextRecovery, MAP_GPU_FAILED_EVENT, RESTORE_TIMEOUT_MS, enterMapGpuLight, mapGpuLight } from '../../glContextRecovery';

export interface GlLossHooks {
  disposed(): boolean;
  /** The context is lost: stop scheduling draws. */
  stop(): void;
  /** The context is restored: recreate every GL object (throws if it cannot). */
  rebuild(): void;
}

export class GlContextLoss {
  readonly recovery = new GlContextRecovery(mapGpuLight());
  private restoreTimer?: ReturnType<typeof setTimeout>;
  private readonly onLost = (event: Event): void => {
    if (this.hooks.disposed()) return;
    this.hooks.stop();
    if (this.recovery.lost()) {
      event.preventDefault(); // without it the browser never restores the context
      clearTimeout(this.restoreTimer);
      this.restoreTimer = setTimeout(() => {
        this.recovery.expired();
        if (this.recovery.failed) this.reportFailed();
      }, RESTORE_TIMEOUT_MS);
      console.warn(`Map WebGL context lost (loss ${this.recovery.losses}, ${this.recovery.stage}); waiting for a restore.`);
    } else {
      console.warn('Map WebGL context lost again in the light profile: the GPU map gives up.');
      this.reportFailed();
    }
  };
  private readonly onRestored = (): void => {
    clearTimeout(this.restoreTimer);
    if (this.hooks.disposed() || this.recovery.failed) return;
    if (this.recovery.restored()) enterMapGpuLight();
    try {
      this.hooks.rebuild();
      console.info(`Map WebGL context restored (${this.recovery.stage}).`);
    } catch (error) {
      console.error('Map WebGL context restore failed:', error);
      this.recovery.stage = 'failed';
    }
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: GlLossHooks,
  ) {
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }
  /** The page re-renders: variantReady() then throws MapContextLostError and the owner drops this renderer. */
  private reportFailed(): void {
    if (!this.hooks.disposed() && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MAP_GPU_FAILED_EVENT));
  }
  dispose(): void {
    clearTimeout(this.restoreTimer);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
  }
}
