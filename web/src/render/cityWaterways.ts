/** Retained native lagoon water in public ribbons, with pedestrian crossings. */
import type { Layout, Shape } from '../../../rust/bridge/urban';
const cache = new WeakMap<object, { water: Path2D; bridges: Path2D }>();
export function cityWaterwayPaths(layouts: readonly Layout[]): { water: Path2D; bridges: Path2D } {
  const path = (shape: Shape): Path2D => {
    const p = new Path2D();
    for (const [index, source] of [shape.outer, ...shape.holes].entries()) {
      const area = source.reduce((sum, q, i) => { const r = source[(i + 1) % source.length]; return sum + q.x * r.y - r.x * q.y; }, 0);
      const ring = (area > 0) === (index === 0) ? source : [...source].reverse();
      ring.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)); p.closePath();
    }
    return p;
  };
  let paths = cache.get(layouts);
  if (!paths) {
    paths = { water: new Path2D(), bridges: new Path2D() };
    for (const layout of layouts) for (const w of layout.structure?.waterways ?? []) {
      paths.water.addPath(path(w.shape)); for (const s of w.crossings) paths.bridges.addPath(path(s));
    }
    // Nonzero fill unions overlapping ribbons without a floating-point boolean
    // that can abort the whole town frame. No outlines on internal segment caps.
    cache.set(layouts, paths);
  }
  return paths;
}
export function drawCityWaterways(ctx: CanvasRenderingContext2D, layouts: readonly Layout[], mpp: number, color = '#8aaeb8'): void {
  const paths = cityWaterwayPaths(layouts);
  ctx.save(); ctx.lineWidth = Math.max(0.4, mpp * 0.6);
  ctx.fillStyle = color; ctx.fill(paths.water);
  ctx.fillStyle = '#e6d9bb'; ctx.strokeStyle = '#6d6554'; ctx.fill(paths.bridges); ctx.stroke(paths.bridges);
  ctx.restore();
}
