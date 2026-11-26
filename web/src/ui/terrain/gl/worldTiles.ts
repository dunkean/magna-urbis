/**
 * World tiles of the live compositor (contract GroundTileRenderer, render/live/groundLayer.ts) on WebGL2: every pass
 * of the live redraw for a world square at `px`² device pixels, live display quality, into the renderer's canvas, uploaded by
 * the ground layer in the same task. The material's detail follows the tile density (uPx = metres per tile pixel);
 * details and refinements are drawn at their final opacity. Owns the tiles' intermediate targets, so the live view's
 * auxiliary pass and retained-water raster stay cached, and tiles of one size never reallocate a target.
 */
import type { Rect4 } from '../../../render/view';
import { liveStyleRatio, settled, settledDetails, tileViewState } from '../redraw';
import { GlViewTargets } from './resources';
import type { GlInputs } from './inputs';
import type { GlRedraw } from './redraw';
import type { TerrainLook } from '../contract';

export class GlWorldTiles {
  private readonly targets = new GlViewTargets();
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly redraw: GlRedraw,
    private readonly inputs: GlInputs,
  ) {}
  /** The tile, or undefined while a program of the look is still linking (`linked` false): a tile never shows a
   * stand-in variant and never waits for a link. The canvas then holds the tile until the next draw. */
  render(look: TerrainLook | undefined, box: Rect4, px: number, linked: (look: TerrainLook) => boolean): TexImageSource | undefined {
    const size = box.maxX - box.minX,
      inputs = this.inputs;
    if (!look || !inputs.base || this.gl.isContextLost() || !(size > 0) || px < 1 || !linked(look)) return undefined;
    const ratio = liveStyleRatio();
    // A tile is drawn again only when its content changed: never reuse the previous tile's auxiliary pass or water raster.
    // The companion planes immediately follow their colour tile and share its exact aux/water inputs.
    if (!look.treePlane) {
      this.targets.auxKey.invalidate();
      this.targets.retained.invalidate();
    }
    const drawn = this.redraw.draw({ look, view: tileViewState(box, px, ratio), details: settledDetails(inputs.details), enhanced: inputs.enhanced.map(settled), pixelRatio: ratio, stylePixelRatio: ratio, framebuffer: null, targets: this.targets, capturing: false, tile: true });
    return drawn ? this.canvas : undefined;
  }
  dispose(): void {
    this.targets.dispose(this.gl);
  }
}
