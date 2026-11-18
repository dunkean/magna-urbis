/**
 * Canvas means of the exact town: paths of shapes and lines, the parchment hatching as a pattern, and style batches
 * (one fill or stroke call per style, in first-use order, so overlapping items of one style unite). Used by town.ts
 * and roofs.ts.
 */
import type { Point, Shape } from '../../../../../rust/bridge/urban';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { PARCHMENT_HATCH } from '../look';
import { ringArea } from '../model/geometry';

/** Ink hatching in screen pixels (one tile per context, rescaled to the frame): the look's PARCHMENT_HATCH as a pattern. */
const hatches = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
export function hatchPattern(ctx: CanvasRenderingContext2D, mpp: number): CanvasPattern | undefined {
  let pattern = hatches.get(ctx);
  if (!pattern) {
    const tile = document.createElement('canvas'),
      p = PARCHMENT_HATCH.periodPx;
    tile.width = tile.height = p;
    const t = tile.getContext('2d');
    if (!t) return undefined;
    t.strokeStyle = PARCHMENT_HATCH.color;
    t.globalAlpha = PARCHMENT_HATCH.alpha;
    t.lineWidth = PARCHMENT_HATCH.widthPx;
    t.beginPath();
    t.moveTo(-1, p + 1);
    t.lineTo(p + 1, -1);
    t.moveTo(-1, 1);
    t.lineTo(1, -1);
    t.moveTo(p - 1, p + 1);
    t.lineTo(p + 1, p - 1);
    t.stroke();
    pattern = ctx.createPattern(tile, 'repeat') ?? undefined;
    if (!pattern) return undefined;
    hatches.set(ctx, pattern);
  }
  pattern.setTransform(new DOMMatrix().scale(mpp));
  return pattern;
}
/** Outer rings counter-clockwise, holes clockwise: batches fill with the nonzero
 * rule, so overlapping items of one style unite while courts stay open. */
export function shapePath(shape: Shape, Path: new () => Path2D = Path2D): Path2D {
  const path = new Path();
  const ring = (points: readonly Point[], hole: boolean): void => {
    if (points.length < 3) return;
    const reverse = ringArea(points) < 0 !== hole,
      n = points.length,
      at = (i: number): Point => points[reverse ? n - 1 - i : i];
    path.moveTo(at(0).x, at(0).y);
    for (let i = 1; i < n; i++) path.lineTo(at(i).x, at(i).y);
    path.closePath();
  };
  ring(shape.outer, false);
  for (const hole of shape.holes ?? []) ring(hole, true);
  return path;
}
export function linePath(points: readonly Point[]): Path2D {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  return path;
}
export interface Style {
  fill?: string | CanvasPattern;
  stroke?: string | CanvasPattern;
  width?: number;
  alpha?: number;
  dash?: number[];
  cap?: CanvasLineCap;
}
const patternIds = new WeakMap<CanvasPattern, number>();
let patternSeq = 0;
const patternKey = (v: string | CanvasPattern | undefined): string | undefined => {
  if (!v || typeof v === 'string') return v;
  let id = patternIds.get(v);
  if (!id) patternIds.set(v, (id = ++patternSeq));
  return `pattern${id}`;
};
/** Style batches: one fill or stroke call per style, in first-use order. */
export class Batches {
  private groups = new Map<string, { style: Style; path: Path2D }>();
  add(style: Style, path: Path2D): void {
    const key = `${patternKey(style.fill)}|${patternKey(style.stroke)}|${style.width}|${style.alpha}|${style.dash}|${style.cap}`;
    let group = this.groups.get(key);
    if (!group) {
      group = { style, path: new Path2D() };
      this.groups.set(key, group);
    }
    group.path.addPath(path);
  }
  flush(ctx: CanvasRenderingContext2D): void {
    for (const { style, path } of this.groups.values()) {
      ctx.globalAlpha = style.alpha ?? 1;
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill(path, 'nonzero');
      }
      if (style.stroke && style.width) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.width;
        ctx.setLineDash(style.dash ?? []);
        ctx.lineCap = style.cap ?? 'round';
        ctx.stroke(path);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    this.groups.clear();
  }
  /** `flush` with a pause after each style: the same calls in the same order (resumable painting, drawCitySteps). */
  *flushSteps(ctx: CanvasRenderingContext2D): Generator<void, void> {
    for (const { style, path } of this.groups.values()) {
      ctx.globalAlpha = style.alpha ?? 1;
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill(path, 'nonzero');
      }
      if (style.stroke && style.width) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.width;
        ctx.setLineDash(style.dash ?? []);
        ctx.lineCap = style.cap ?? 'round';
        ctx.stroke(path);
      }
      yield;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    this.groups.clear();
  }
}
