/**
 * Presentation of the ground renderer's own canvas in the fallback display (TerrainGl/TerrainGpu.redrawNow, called
 * by v2/display/fallbackView.ts when the live compositor does not serve the view); the compositor draws baked world
 * tiles and never shows this canvas. One rule, the fallback's: the picture painted at rest follows the view by a CSS
 * transform until the next paint at rest. While the view moves the ground is not drawn, so the edges the moved
 * picture no longer covers show what lies under the canvas until the view rests. Any draw into the canvas (an input
 * change, a world tile on WebGL2, a capture) invalidates the picture: the next call paints again.
 */
import type { View } from '../../render/view';

export class FallbackGround {
  /** The view the picture on the canvas was painted for. */
  private shown?: { view: View; width: number; height: number; ratio: number };
  invalidate(canvas: HTMLCanvasElement): void {
    this.shown = undefined;
    canvas.style.transform = '';
  }
  /** Moves the shown picture to `view` while `moving`; otherwise (or with no picture of that size) paints it with
   * `paint`, which draws the view at `ratio`. */
  present(canvas: HTMLCanvasElement, view: View, width: number, height: number, ratio: number, moving: boolean, paint: () => boolean): void {
    const shown = this.shown;
    if (moving && shown && shown.width === width && shown.height === height && shown.ratio === ratio) {
      const k = view.scale / shown.view.scale,
        tx = (shown.view.cx - view.cx) * view.scale,
        ty = (shown.view.cy - view.cy) * view.scale;
      canvas.style.transformOrigin = '50% 50%';
      canvas.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
      return;
    }
    this.invalidate(canvas);
    if (paint()) {
      this.shown = { view: { ...view }, width, height, ratio };
      canvas.style.position = 'absolute';
      canvas.style.left = canvas.style.top = '0px';
    }
  }
}
