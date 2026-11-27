import { sameFrame } from './display/viewMotion';
import type { ViewFrame } from './display/contract';
import type { BenchRenderer } from './benchRenderer';
import type { View } from '../render/view';

type Picture = ViewFrame & { canvas: HTMLCanvasElement };

/** Positions an existing picture in the new view without asking its painter to redraw. */
export function positionCityPicture(element: HTMLElement, picture: ViewFrame, frame: ViewFrame): void {
  const scale = frame.view.scale / picture.view.scale,
    x = (frame.w - picture.w * scale) / 2 + (picture.view.cx - frame.view.cx) * frame.view.scale,
    y = (frame.h - picture.h * scale) / 2 + (picture.view.cy - frame.view.cy) * frame.view.scale;
  element.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
}

function covers(picture: ViewFrame, frame: ViewFrame): boolean {
  const scale = frame.view.scale / picture.view.scale;
  return scale <= 1.3 &&
    Math.abs(frame.view.cx - picture.view.cx) * frame.view.scale + frame.w / 2 <= picture.w * scale / 2 &&
    Math.abs(frame.view.cy - picture.view.cy) * frame.view.scale + frame.h / 2 <= picture.h * scale / 2;
}

const pictureStyle = 'position:absolute;inset:0 auto auto 0;transform-origin:0 0;pointer-events:none';

/** Firefox can spend seconds painting a detailed 2D map. Keep a padded, complete picture on screen while the same
 * studio renderer prepares a replacement at rest. Keep the wider picture for edges exposed by zooming or panning. */
export class CityEmbedFrame {
  readonly element = document.createElement('div');
  private destination?: ViewFrame;
  private current?: Picture;
  private overview?: Picture;
  private painting?: ViewFrame;
  private timer?: ReturnType<typeof setTimeout>;
  private stale = true;
  private error?: unknown;

  constructor(private readonly source: BenchRenderer, private readonly invalidate: () => void) {
    this.element.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    this.source.element.style.cssText = pictureStyle + ';overflow:hidden';
    this.element.append(source.element);
  }

  refresh(): void {
    this.stale = true;
    this.error = undefined;
    this.painting = undefined;
    this.cancelTimer();
  }

  drawLive(view: View, w: number, h: number, dpr: number): void {
    const changed = !sameFrame(this.destination, view, w, h, dpr);
    if (changed) {
      this.destination = { view, w, h, dpr };
      this.position();
    }
    if (this.stale) this.startPaint();
    else {
      if (changed) this.deferPaint();
      if (this.painting) {
        const f = this.painting;
        this.source.drawLive(f.view, f.w, f.h, f.dpr);
      }
    }
  }

  private position(): void {
    const frame = this.destination;
    if (!frame) return;
    if (this.overview) positionCityPicture(this.overview.canvas, this.overview, frame);
    if (this.current) positionCityPicture(this.current.canvas, this.current, frame);
    else if (this.painting) positionCityPicture(this.source.element, this.painting, frame);
  }

  private cancelTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private deferPaint(): void {
    this.cancelTimer();
    const picture = this.painting ?? this.current;
    if (picture && this.destination && !covers(picture, this.destination)) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (!this.painting) this.startPaint();
      }, 200);
    }
  }

  private startPaint(): void {
    const frame = this.destination;
    if (!frame) return;
    const replaceStyle = this.stale,
      // Bound both pixel cost and memory when the iframe is expanded.
      w = Math.ceil(frame.w * 1.65), h = Math.ceil(frame.h * 1.65),
      dpr = Math.min(frame.dpr, 1.5, Math.sqrt(1_350_000 / (w * h))),
      paint = { view: frame.view, w, h, dpr };
    this.stale = false;
    this.error = undefined;
    this.painting = paint;
    this.source.element.style.width = w + 'px';
    this.source.element.style.height = h + 'px';
    this.position();
    this.source.drawLive(paint.view, w, h, dpr);
    void this.source.settled().then(() => {
      if (this.painting !== paint) return;
      const canvas = this.source.snapshot();
      if (!canvas) throw new Error('The city preview has no complete frame.');
      canvas.style.cssText = pictureStyle + `;width:${w}px;height:${h}px`;
      canvas.className = 'city-preview-picture';
      const previous = this.current;
      this.current = { ...paint, canvas };
      if (replaceStyle) {
        this.overview?.canvas.remove();
        this.overview = undefined;
      }
      if (previous) {
        if (!replaceStyle && (!this.overview || previous.view.scale < this.overview.view.scale)) {
          this.overview?.canvas.remove();
          this.overview = previous;
        } else previous.canvas.remove();
      }
      this.source.element.style.visibility = 'hidden';
      this.element.append(canvas);
      this.painting = undefined;
      this.position();
      if (!this.timer) this.deferPaint();
    }).catch(error => {
      if (this.painting !== paint) return;
      this.painting = undefined;
      this.error = error;
    });
  }

  async settled(): Promise<void> {
    while (this.painting || this.timer || (this.stale && this.destination)) {
      this.invalidate();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    if (this.error) throw this.error;
  }

  snapshot(): HTMLCanvasElement | undefined {
    const frame = this.destination, picture = this.current;
    if (!frame || !picture) return undefined;
    const canvas = document.createElement('canvas');
    const dpr = Math.min(frame.dpr, picture.dpr);
    canvas.width = Math.max(1, Math.round(frame.w * dpr));
    canvas.height = Math.max(1, Math.round(frame.h * dpr));
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const image of this.overview ? [this.overview, picture] : [picture]) {
      const scale = frame.view.scale / image.view.scale, w = image.w * scale, h = image.h * scale;
      ctx.drawImage(image.canvas, (frame.w - w) / 2 + (image.view.cx - frame.view.cx) * frame.view.scale,
        (frame.h - h) / 2 + (image.view.cy - frame.view.cy) * frame.view.scale, w, h);
    }
    return canvas;
  }

  dispose(): void {
    this.cancelTimer();
    this.painting = this.destination = undefined;
    this.source.dispose();
    this.element.replaceChildren();
    this.element.remove();
  }
}
