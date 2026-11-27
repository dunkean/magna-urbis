import type { Polyline } from '../gen/types';
import type { View } from '../render/view';

/** A light ochre accent identifies regional routes over the iframe's street network. */
export class CityEmbedRoadInk {
  readonly canvas = document.createElement('canvas');
  private path?: Path2D;
  constructor() {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  }
  set(paths: readonly Polyline[]): void {
    this.path = paths.length ? new Path2D() : undefined;
    this.canvas.hidden = !this.path;
    for (const line of paths) {
      this.path!.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) this.path!.lineTo(line[i].x, line[i].y);
    }
  }
  draw(view: View, w: number, h: number, dpr: number): void {
    if (!this.path) return;
    dpr = Math.min(2, dpr);
    const width = Math.max(1, Math.round(w * dpr)),
      height = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const ctx = this.canvas.getContext('2d')!;
    ctx.resetTransform();
    ctx.clearRect(0, 0, width, height);
    this.paint(this.canvas, view, w, h);
  }
  paint(canvas: HTMLCanvasElement, view: View, w: number, h: number): void {
    if (!this.path) return;
    const ctx = canvas.getContext('2d')!;
    const sx = canvas.width / w,
      sy = canvas.height / h;
    ctx.save();
    ctx.setTransform(sx * view.scale, 0, 0, sy * view.scale, sx * (w / 2 - view.cx * view.scale), sy * (h / 2 - view.cy * view.scale));
    ctx.lineCap = ctx.lineJoin = 'round';
    const line = Math.min(1.5, Math.max(1.0, view.scale * 1.8));
    ctx.lineWidth = line / view.scale;
    ctx.strokeStyle = 'rgba(156,112,58,0.63)';
    ctx.stroke(this.path);
    ctx.restore();
  }
}
