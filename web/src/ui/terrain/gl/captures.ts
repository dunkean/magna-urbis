/**
 * World-space captures of the WebGL2 ground for the 3D views and exports: a colour tile of the map material with 3D
 * ground constants (read from the canvas), or the premultiplied water-only ground overlay read back from its own
 * render target (as straight colour, or its alpha only for the water mask). Captures wait for the look's programs.
 * Owns the capture target.
 */
import { captureLook, captureViewState, displayPixelRatio, settled, settledDetails } from '../redraw';
import { deleteTarget, GlViewTargets, rgbaTarget, type GlTarget } from './resources';
import type { GlInputs } from './inputs';
import type { GlRedraw } from './redraw';
import type { HeightLayer, TerrainLook } from '../contract';

export class GlCaptures {
  private target?: GlTarget;
  private patchTargets?: GlViewTargets;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly redraw: GlRedraw,
    private readonly inputs: GlInputs,
  ) {}
  /** A world-space LOD tile with the same material and detail as the map; `restore` redraws the display after. */
  region(look: TerrainLook, region: { x: number; y: number; width: number }, size: number, includeDetails: boolean, restore: (() => void) | undefined, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array, isolated = false): HTMLCanvasElement {
    const gl = this.gl,
      inputs = this.inputs;
    const capturedHeight = height ? inputs.upload(height, false) : undefined;
    const output = document.createElement('canvas');
    output.width = output.height = size;
    const context = output.getContext('2d');
    if (!context) throw new Error('Impossible de préparer le style 3D.');
    try {
      const request = {
        look: captureLook(look, groundOverlay),
        view: captureViewState(region, size),
        // The current regional detail at its final opacity: reproducible tiles.
        details: !groundOverlay && includeDetails ? settledDetails(inputs.details) : [],
        enhanced: capturedHeight ? [settled(capturedHeight)] : [],
        pixelRatio: 1,
        stylePixelRatio: includeDetails ? displayPixelRatio() : 1,
        targets: isolated ? (this.patchTargets ??= new GlViewTargets()) : this.redraw.liveTargets,
        capturing: false,
        tile: false,
      };
      if (groundOverlay || isolated) {
        this.target = rgbaTarget(gl, size, size, this.target);
        this.redraw.draw({ ...request, framebuffer: this.target.framebuffer });
        const rgba = new Uint8Array(size * size * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        // The framebuffer and river compositor store premultiplied radiance.
        // The centre mask needs alpha only, avoiding RGB conversion and another
        // Canvas readback for its larger world-space bank halo.
        if (alphaOnly) {
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) alphaOnly[y * size + x] = rgba[((size - 1 - y) * size + x) * 4 + 3];
        } else {
          const image = context.createImageData(size, size);
          for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
              const a = (y * size + x) * 4,
                b = ((size - 1 - y) * size + x) * 4,
                alpha = rgba[b + 3];
              for (let c = 0; c < 3; c++) image.data[a + c] = groundOverlay ? (alpha ? Math.min(255, Math.round((rgba[b + c] * 255) / alpha)) : 0) : rgba[b + c];
              image.data[a + 3] = groundOverlay ? alpha : 255;
            }
          context.putImageData(image, 0, 0);
        }
      } else {
        this.redraw.draw({ ...request, framebuffer: null });
        context.drawImage(this.canvas, 0, 0);
      }
    } finally {
      inputs.release(capturedHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      restore?.();
    }
    return output;
  }
  dispose(): void {
    deleteTarget(this.gl, this.target);
    this.patchTargets?.dispose(this.gl);
  }
}
