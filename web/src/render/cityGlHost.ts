/** City GPU renderer — drop-in host for the City Bench map, mirroring CityCanvasLayer
 * (cityCanvas.ts): one foreignObject in the map SVG holding a WebGL2 canvas (the plan)
 * under a Canvas 2D canvas (labels, glyphs, diagnostics, native detailed buildings).
 * The paint callback receives both; when WebGL2 is unavailable `gl` is undefined and
 * the callback paints everything with drawCity as before. */
import { clearCanvas2d, type Box } from './cityCanvas';
import { createCityGlRenderer, type CityGlDrawOptions, type CityGlFrame, type CityGlRenderer } from './cityGl';
/** `?cityGl=software`: accept a software WebGL2 (headless SwiftShader checks of the GPU look). */
const SOFTWARE_CHECKS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('cityGl') === 'software';

export interface CityGlHostFrame {
  viewport: Box; mpp: number; dpr: number;
  /** Draw and present the GPU layer for this frame. An unused layer stays hidden. */
  drawGl?: (options: CityGlDrawOptions) => CityGlFrame | undefined;
}
export class CityGlCanvasLayer {
  readonly canvas = document.createElement('canvas');
  readonly glCanvas = document.createElement('canvas');
  readonly gl?: CityGlRenderer;
  private host: SVGForeignObjectElement;
  private frame = 0;
  private disposed = false;
  constructor(private readonly map: SVGSVGElement, parent: Element, private readonly paint: (ctx: CanvasRenderingContext2D, frame: CityGlHostFrame) => boolean) {
    this.host = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    this.host.dataset.cityCanvas = ''; this.host.dataset.cityGl = '';
    const stack = document.createElement('div');
    stack.style.position = 'relative';
    for (const c of [this.glCanvas, this.canvas]) { c.style.display = 'block'; c.style.pointerEvents = 'none'; c.style.position = 'absolute'; c.style.left = c.style.top = '0'; stack.append(c); }
    this.glCanvas.style.visibility = 'hidden';
    this.host.append(stack); this.attach(parent);
    try { this.gl = createCityGlRenderer(this.glCanvas, { allowSoftware: SOFTWARE_CHECKS, onInvalidate: () => { this.glCanvas.style.visibility = 'hidden'; this.request(); } }); }
    catch (error) { console.warn('Rendu WebGL2 de la ville indisponible, Canvas 2D utilisé', error); this.glCanvas.remove(); }
  }
  attach(parent: Element): void { if (this.host.parentNode !== parent) parent.append(this.host); }
  request(): void { if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }
  draw(): void {
    const box = this.map.viewBox.baseVal, rect = this.map.getBoundingClientRect(), ctx = this.canvas.getContext('2d');
    if (!ctx || !box || !(box.width > 0) || !(rect.width > 0) || !(rect.height > 0)) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    for (const [key, value] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) this.host.setAttribute(key, String(value));
    for (const c of [this.canvas, this.glCanvas]) {
      c.style.width = `${box.width}px`; c.style.height = `${box.height}px`;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    }
    clearCanvas2d(ctx, w, h); // never one full-canvas clearRect (see clearCanvas2d)
    const k = w / box.width; ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
    // A GPU canvas retains its composited image even with preserveDrawingBuffer=false.
    // Hide it unless the callback redraws it at this camera (Canvas fallback, comparison,
    // pending scene upload and empty/disabled scenes must not expose the previous frame).
    let presented = false, more = false;
    try {
      more = this.paint(ctx, { viewport: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, mpp: box.width / rect.width, dpr,
        drawGl: this.gl?.ready ? options => {
          // The driver can lose its context between the frame gate and draw.
          if (!this.gl?.ready) return undefined;
          const result = this.gl.draw(options); presented = this.gl.ready;
          return presented ? result : undefined;
        } : undefined });
    } finally { this.glCanvas.style.visibility = presented ? 'visible' : 'hidden'; }
    if (more) this.request();
  }
  dispose(): void { this.disposed = true; cancelAnimationFrame(this.frame); this.frame = 0; this.gl?.dispose(); this.host.remove(); }
}
