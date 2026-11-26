/**
 * World-space captures of the WebGPU ground for the 3D views and exports (as gl/captures.ts): drawn on the capture
 * canvas (its own WebGPU context, opaque for the colour tile, premultiplied for the water-only ground overlay) and
 * copied through drawImage in the same task, no asynchronous readback. Synchronous: a pipeline still missing is created
 * synchronously and the copy waits for its compilation (3-4 s for Render v2 on D3D12); callers that can wait await
 * variantReady() first. Owns the capture canvas.
 */
import { captureLook, captureViewState, displayPixelRatio, settled, settledDetails } from '../redraw';
import type { GpuShared } from './device';
import type { GpuInputs } from './inputs';
import type { GpuRedraw } from './redraw';
import { GpuViewTargets, releaseGpuLayer, type Surface } from './resources';
import type { HeightLayer, TerrainLook } from '../contract';

export class GpuCaptures {
  private canvas?: { canvas: HTMLCanvasElement; context: GPUCanvasContext; opaque?: boolean };
  private patchTargets?: GpuViewTargets;
  constructor(
    private readonly gpu: GpuShared,
    private readonly redraw: GpuRedraw,
    private readonly inputs: GpuInputs,
  ) {}
  /** The capture canvas, configured for opaque or premultiplied output. */
  surface(opaque: boolean): Surface {
    if (!this.canvas) {
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('webgpu');
      if (!context) throw new Error('Impossible de préparer la capture WebGPU.');
      this.canvas = { canvas, context };
    }
    if (this.canvas.opaque !== opaque) {
      this.canvas.context.configure({ device: this.gpu.device, format: this.gpu.canvasFormat, alphaMode: opaque ? 'opaque' : 'premultiplied' });
      this.canvas.opaque = opaque;
    }
    return { canvas: this.canvas.canvas, context: this.canvas.context, opaque };
  }
  /** A world-space LOD tile with the same material and detail as the map; `restore` redraws the display after. */
  region(look: TerrainLook, region: { x: number; y: number; width: number }, size: number, includeDetails: boolean, restore: (() => void) | undefined, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array, isolated = false): HTMLCanvasElement {
    const inputs = this.inputs;
    const capturedHeight = height ? inputs.upload(height, false) : undefined;
    const output = document.createElement('canvas');
    output.width = output.height = size;
    const context = output.getContext('2d', alphaOnly ? { willReadFrequently: true } : undefined);
    if (!context) throw new Error('Impossible de préparer le style 3D.');
    try {
      // The ground overlay keeps premultiplied coverage (TerrainGl reads it back from its own target, waiting
      // for the link); the colour capture is opaque, like the WebGL2 canvas it is copied from.
      const surface = this.surface(!groundOverlay);
      // Every capture needs the requested look, including the opaque whole-map background.
      // A stand-in copied here would otherwise remain cached by the 3D view after compilation.
      this.redraw.draw({
        look: captureLook(look, groundOverlay),
        view: captureViewState(region, size),
        details: !groundOverlay && includeDetails ? settledDetails(inputs.details) : [],
        enhanced: capturedHeight ? [settled(capturedHeight)] : [],
        pixelRatio: 1,
        stylePixelRatio: includeDetails ? displayPixelRatio() : 1,
        surface,
        offscreen: true,
        targets: isolated ? (this.patchTargets ??= new GpuViewTargets()) : this.redraw.liveTargets,
        wait: true,
        capturing: false,
        tile: false,
      });
      context.drawImage(surface.canvas, 0, 0);
      if (alphaOnly) {
        const rgba = context.getImageData(0, 0, size, size).data;
        for (let i = 0; i < size * size; i++) alphaOnly[i] = rgba[i * 4 + 3];
      }
    } finally {
      releaseGpuLayer(capturedHeight);
      restore?.();
    }
    return output;
  }
  dispose(): void {
    this.canvas?.context.unconfigure();
    this.patchTargets?.dispose();
  }
}
