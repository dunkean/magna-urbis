/**
 * Presentation of the ground renderer's own canvas, for the fallback display only (TerrainGl/TerrainGpu.redrawNow,
 * called by the V2 map when the live compositor does not serve the view). The compositor draws baked world tiles
 * (renderWorldTile) and never shows this canvas.
 *
 * While the view moves, the last frame is moved by a CSS transform as long as its 8 % overscan covers the view; past
 * that, the ground is redrawn at a reduced pixel ratio (0.55) with the overscan. At rest it is redrawn at full ratio.
 * Captures bypass it and invalidate it when they draw.
 */
import type { View } from '../../render/view';

export class FallbackGround {
  private shown?: { view: View; width: number; height: number; ratio: number };
  private layout?: { width: number; height: number };
  invalidate(canvas: HTMLCanvasElement): void {
    this.shown = undefined;
    canvas.style.transform = '';
    if (this.layout) {
      canvas.style.width = this.layout.width + 'px';
      canvas.style.height = this.layout.height + 'px';
      canvas.style.left = canvas.style.top = '0px';
      this.layout = undefined;
    }
  }

  present(canvas: HTMLCanvasElement, view: View, width: number, height: number, ratio: number, interacting: boolean, render: (ratio: number, width: number, height: number) => boolean): void {
    const shown = this.shown;
    if (interacting && shown && shown.width === width && shown.height === height && shown.ratio === ratio) {
      const k = view.scale / shown.view.scale;
      const tx = (shown.view.cx - view.cx) * view.scale,
        ty = (shown.view.cy - view.cy) * view.scale;
      // Eight percent overscan on each side covers ordinary pans without empty borders.
      // Refresh before exposing a border; between refreshes navigation is a compositor operation.
      const covered = k * 1.16;
      if (k <= 2 && (width * covered) / 2 >= width / 2 + Math.abs(tx) && (height * covered) / 2 >= height / 2 + Math.abs(ty)) {
        canvas.style.transformOrigin = '50% 50%';
        canvas.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
        return;
      }
    }
    this.invalidate(canvas);
    // Keep the material's style density unchanged; only the framebuffer has fewer pixels.
    const renderWidth = width * 1.16,
      renderHeight = height * 1.16;
    if (render(interacting ? ratio * 0.55 : ratio, renderWidth, renderHeight)) {
      this.shown = { view: { ...view }, width, height, ratio };
      this.layout = { width, height };
      canvas.style.position = 'absolute';
      canvas.style.width = renderWidth + 'px';
      canvas.style.height = renderHeight + 'px';
      canvas.style.left = (width - renderWidth) / 2 + 'px';
      canvas.style.top = (height - renderHeight) / 2 + 'px';
    }
  }
}
