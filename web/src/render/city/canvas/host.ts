/**
 * A viewport-sized Canvas 2D for the town inside an SVG map (City Bench, the terrain bench): sizing, clearing and one
 * paint per animation frame.
 */
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { Box } from '../model/contract';

/** Empties a whole Canvas 2D bitmap, in two strips. One clearRect (or a 'copy' fill) over
 * the whole canvas takes Chrome's "overwrite" fast path, which discards the pending
 * recording without flushing; on an accelerated canvas whose next frames draw nothing
 * else (the City Bench overlay once WebGL draws the plan), the last flushed bitmap stays:
 * the first full Canvas 2D frame of the plan then showed at its own scale and screen
 * position at every later zoom (a town « emprise » at 1/45 scale), and old landmark glyphs
 * stayed pinned to the screen. Two partial clears are ordinary draw operations. */
export function clearCanvas2d(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const top = Math.max(1, h >> 1);
  ctx.clearRect(0, 0, w, top);
  if (h > top) ctx.clearRect(0, top, w, h - top);
}
export interface CityCanvasFrame {
  viewport: Box;
  mpp: number;
  dpr: number;
}
/** A viewport-sized canvas inside the map SVG (foreignObject), so it keeps the
 * SVG stacking order: under roads and markers, above the map background. */
export class CityCanvasLayer {
  readonly canvas = document.createElement('canvas');
  private host: SVGForeignObjectElement;
  private frame = 0;
  constructor(
    private readonly map: SVGSVGElement,
    parent: Element,
    private readonly paint: (ctx: CanvasRenderingContext2D, frame: CityCanvasFrame) => boolean,
  ) {
    this.host = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    this.host.addEventListener('illustration:capture', () => this.draw());
    this.host.dataset.cityCanvas = '';
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'none';
    this.host.append(this.canvas);
    this.attach(parent);
  }
  attach(parent: Element): void {
    if (this.host.parentNode !== parent) parent.append(this.host);
  }
  request(): void {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
  }
  draw(): void {
    const box = this.map.viewBox.baseVal,
      rect = this.map.getBoundingClientRect(),
      ctx = this.canvas.getContext('2d');
    if (!ctx || !box || !(box.width > 0) || !(rect.width > 0) || !(rect.height > 0)) return;
    const dpr = window.devicePixelRatio || 1,
      w = Math.max(1, Math.round(rect.width * dpr)),
      h = Math.max(1, Math.round(rect.height * dpr));
    for (const [key, value] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) this.host.setAttribute(key, String(value));
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    clearCanvas2d(ctx, w, h);
    const k = w / box.width;
    ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
    const more = this.paint(ctx, { viewport: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, mpp: box.width / rect.width, dpr });
    if (more) this.request();
  }
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.host.remove();
  }
}
