/**
 * Device loss policy of TerrainGpu: a lost device (driver reset, GPU switch, device.destroy() from outside) is
 * recreated with its pipelines and every GPU resource re-uploaded from the retained CPU inputs; after three failed
 * attempts, or a fourth loss within a minute, the renderer continues as a TerrainGl on a WebGL2 canvas when one can be
 * had, otherwise captures throw `failure`. A lost device is rarely transient on a weak GPU (out of memory, a pipeline
 * too heavy for the driver, the whole GPU process exiting on Mesa/Intel): the rebuilt device draws the light profile.
 */
import { enterMapGpuLight, isMapContextLost } from '../../glContextRecovery';
import { TerrainGl } from '../../terrainGl';
import { sharedGpu, type GpuShared } from './device';
import { replayInputs, type RendererInputs } from './inputs';

export interface GpuRecoveryHooks {
  disposed(): boolean;
  /** Re-creates every GPU resource on `gpu` (throws if it cannot). */
  rebuild(gpu: GpuShared): void;
  /** The device is lost for good: stop drawing, hand over the inputs. */
  giveUp(): { inputs: RendererInputs; canvas: HTMLCanvasElement; glCanvas?: HTMLCanvasElement; livePaused: boolean };
  /** The WebGL2 renderer took over on `canvas`. */
  fellBack(gl: TerrainGl, canvas: HTMLCanvasElement): void;
}

export class GpuRecovery {
  /** Device recovery in progress. */
  recovering?: Promise<void>;
  /** After a definitive loss: the WebGL2 renderer everything is forwarded to, or the error captures throw. */
  fallback?: TerrainGl;
  failure?: Error;
  /** Recent losses (a device lost again and again falls back to WebGL2). */
  private losses: number[] = [];
  constructor(
    private readonly forced: boolean,
    private readonly hooks: GpuRecoveryHooks,
  ) {}
  /** Listener of the shared device's loss. */
  readonly onLost = (): void => {
    if (this.hooks.disposed() || this.recovering) return;
    this.recovering = this.recover().finally(() => {
      this.recovering = undefined;
    });
  };
  /** The error a capture throws while the device is lost or after a failed recovery. */
  unavailable(): Error {
    return this.failure ?? new Error('Le terrain est indisponible.');
  }

  private async recover(): Promise<void> {
    enterMapGpuLight();
    const now = performance.now();
    this.losses = [...this.losses.filter(t => now - t < 60_000), now];
    let error: unknown = new Error('WebGPU : l’appareil est perdu à répétition.');
    for (let attempt = 0; attempt < 3 && this.losses.length <= 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      if (this.hooks.disposed()) return;
      try {
        const gpu = await sharedGpu(this.forced);
        if (!gpu) throw new Error('WebGPU : plus d’adaptateur matériel.');
        if (this.hooks.disposed()) return;
        if (gpu.lost) throw new Error('WebGPU : le nouvel appareil est déjà perdu.');
        this.hooks.rebuild(gpu);
        console.info('WebGPU map: device recreated, resources re-uploaded.');
        return;
      } catch (caught) {
        error = caught;
        console.warn('WebGPU map: device recreation failed:', caught);
      }
    }
    if (!this.hooks.disposed()) this.fallBack(error);
  }
  /** Definitive loss: a TerrainGl on the factory's WebGL2 canvas, or on a fresh canvas put in place of the WebGPU
   * one (a canvas keeps its first context type); otherwise captures throw `failure`. */
  private fallBack(error: unknown): void {
    const { inputs, canvas: gpuCanvas, glCanvas, livePaused } = this.hooks.giveUp(),
      reason = error instanceof Error ? error.message : String(error);
    let canvas = glCanvas;
    if (!canvas && gpuCanvas.isConnected) {
      canvas = gpuCanvas.cloneNode(false) as HTMLCanvasElement;
      gpuCanvas.replaceWith(canvas);
    }
    try {
      if (!canvas) throw new Error('aucun canevas WebGL2 disponible');
      let gl: TerrainGl;
      try {
        gl = new TerrainGl(canvas);
      } catch (lost) {
        // The factory canvas carries a context lost with the device (one GPU process): start from a fresh canvas.
        if (!isMapContextLost(lost)) throw lost;
        canvas = gpuCanvas.cloneNode(false) as HTMLCanvasElement;
        if (gpuCanvas.isConnected) gpuCanvas.replaceWith(canvas);
        gl = new TerrainGl(canvas);
      }
      gl.setLivePaused(livePaused);
      replayInputs(gl, inputs);
      this.fallback = gl;
      this.hooks.fellBack(gl, canvas);
      console.warn(`WebGPU map: device lost for good (${reason}); continuing with WebGL2.`);
    } catch (glError) {
      this.failure = new Error(`WebGPU indisponible pour la carte : appareil perdu (${reason}) et WebGL2 impossible (${glError instanceof Error ? glError.message : glError}).`);
      console.error(this.failure);
    }
  }
}
