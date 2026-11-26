/**
 * World tiles of the live compositor on WebGPU (as gl/worldTiles.ts): the live redraw's passes for a world square at
 * `px`² device pixels, live display quality, on the tiles' own opaque WebGPU canvas (configured once per device, kept at the
 * tile size), with the tiles' own intermediate targets. The display canvas, its fallback presentation and the live
 * view's caches are untouched. The canvas must be copied in the same task (the current texture of a WebGPU canvas
 * expires with it). Never a stand-in pipeline, never a synchronous one.
 */
import type { Rect4 } from '../../../render/view';
import { liveStyleRatio, settled, settledDetails, tileViewState } from '../redraw';
import { GpuViewTargets, type Surface } from './resources';
import type { GpuShared } from './device';
import type { GpuInputs } from './inputs';
import type { GpuRedraw } from './redraw';
import type { TerrainLook } from '../contract';

export class GpuWorldTiles {
  private readonly targets = new GpuViewTargets();
  private surface?: Surface;
  constructor(
    private readonly gpu: GpuShared,
    private readonly redraw: GpuRedraw,
    private readonly inputs: GpuInputs,
  ) {}
  /** The tile, or undefined while a pipeline of the look is being created (`created` false). */
  render(look: TerrainLook | undefined, box: Rect4, px: number, created: (look: TerrainLook) => boolean): TexImageSource | undefined {
    const size = box.maxX - box.minX,
      inputs = this.inputs;
    if (this.gpu.lost || !look || !inputs.base || !(size > 0) || px < 1 || !created(look)) return undefined;
    const surface = this.tileSurface();
    const ratio = liveStyleRatio();
    // A tile is drawn again only when its content changed: never reuse the previous tile's auxiliary pass or water raster.
    // The companion planes immediately follow their colour tile and share its exact aux/water inputs.
    if (!look.treePlane) {
      this.targets.auxKey.invalidate();
      this.targets.retained.invalidate();
    }
    const drawn = this.redraw.draw({
      look,
      view: tileViewState(box, px, ratio),
      details: settledDetails(inputs.details),
      enhanced: inputs.enhanced.map(settled),
      pixelRatio: ratio,
      stylePixelRatio: ratio,
      surface,
      offscreen: true,
      targets: this.targets,
      wait: false,
      capturing: false,
      tile: true,
    });
    return drawn ? surface.canvas : undefined;
  }
  private tileSurface(): Surface {
    if (!this.surface) {
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('webgpu');
      if (!context) throw new Error('WebGPU map: no context for the world tiles.');
      context.configure({ device: this.gpu.device, format: this.gpu.canvasFormat, alphaMode: 'opaque' });
      this.surface = { canvas, context, opaque: true };
    }
    return this.surface;
  }
  dispose(): void {
    this.targets.dispose();
    this.surface?.context.unconfigure();
  }
}
