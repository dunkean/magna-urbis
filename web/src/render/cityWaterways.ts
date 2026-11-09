/** Retained native lagoon water in public ribbons, with pedestrian crossings. */
import polygonClipping from 'polygon-clipping';
import type { Layout } from '../../../rust/bridge/urban';
const cache = new WeakMap<object, { water: Path2D; bridges: Path2D }>();
export function drawCityWaterways(ctx: CanvasRenderingContext2D, layouts: readonly Layout[], mpp: number): void {
  const path = (shape: { outer: { x: number; y: number }[] }): Path2D => {
    const p = new Path2D(); shape.outer.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)); p.closePath(); return p;
  };
  let paths = cache.get(layouts);
  if (!paths) {
    paths = { water: new Path2D(), bridges: new Path2D() };
    const polygons: polygonClipping.Polygon[] = [];
    for (const layout of layouts) for (const w of layout.structure?.waterways ?? []) {
      polygons.push([w.shape.outer.map(p => [p.x, p.y] as [number, number]), ...w.shape.holes.map(r => r.map(p => [p.x, p.y] as [number, number]))]); for (const s of w.crossings) paths.bridges.addPath(path(s));
    }
    // Union the public ribbons before outlining them: internal segment caps are not banks.
    if (polygons.length) for (const polygon of polygonClipping.union(polygons[0], ...polygons.slice(1))) {
      for (const ring of polygon) paths.water.addPath(path({ outer: ring.map(([x, y]) => ({ x, y })) }));
    }
    cache.set(layouts, paths);
  }
  ctx.save(); ctx.lineWidth = Math.max(0.4, mpp * 0.6);
  ctx.fillStyle = '#8aaeb8'; ctx.strokeStyle = '#546b6c'; ctx.fill(paths.water); ctx.stroke(paths.water);
  ctx.fillStyle = '#e6d9bb'; ctx.strokeStyle = '#6d6554'; ctx.fill(paths.bridges); ctx.stroke(paths.bridges);
  ctx.restore();
}
