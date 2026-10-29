import type { Point, Shape } from '../../../rust/bridge/urban';
import { polygonContains, polygonCentroid } from '../gen/core/geom';

/** A kitchen garden's path enters through its house-side fence; short beds flank it. */
function buildGardenDetails(shape: Shape, house: Point) {
  const ring = shape.outer, center = polygonCentroid(ring);
  let entry = ring[0], edge = 0, distance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(.1, Math.min(.9, ((house.x - a.x) * dx + (house.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const p = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(p.x - house.x, p.y - house.y);
    if (d < distance) { distance = d; entry = p; edge = i; }
  }
  const length = Math.hypot(center.x - entry.x, center.y - entry.y) || 1;
  const v = { x: (center.x - entry.x) / length, y: (center.y - entry.y) / length }, u = { x: v.y, y: -v.x };
  const at = (x: number, y: number): Point => ({ x: entry.x + u.x * x + v.x * y, y: entry.y + u.y * x + v.y * y });
  const inside = (p: Point): boolean => polygonContains(ring, p) && !(shape.holes ?? []).some(h => polygonContains(h, p));
  const span = Math.max(...ring.map(p => Math.hypot(p.x - entry.x, p.y - entry.y)));
  const beds: Point[][] = [], paths: Point[][] = [[entry, at(0, span)]];
  // Bounded work on unusually large garden reserves; normal beds stay 1.5 × 3 m.
  const step = Math.max(4.2, span / 45);
  for (let y = 2; y < span; y += step) for (let x = -span; x < span; x += Math.max(2.6, span / 45)) {
    if (Math.abs(x + .75) < 1.8) continue;
    const bed = [at(x, y), at(x + 1.5, y), at(x + 1.5, y + 3), at(x, y + 3)];
    if (bed.every(inside) && inside(at(x + .75, y + 1.5))) beds.push(bed);
  }
  const fences: Point[][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (i !== edge) { fences.push([a, b]); continue; }
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / l, dy = (b.y - a.y) / l;
    const gap = Math.min(.8, Math.hypot(entry.x - a.x, entry.y - a.y), Math.hypot(entry.x - b.x, entry.y - b.y));
    fences.push([a, { x: entry.x - dx * gap, y: entry.y - dy * gap }], [{ x: entry.x + dx * gap, y: entry.y + dy * gap }, b]);
  }
  return { beds, paths, fences, entry };
}

const cache = new WeakMap<Shape, { x: number; y: number; details: ReturnType<typeof buildGardenDetails> }>();
export function gardenDetails(shape: Shape, house: Point): ReturnType<typeof buildGardenDetails> {
  const saved = cache.get(shape);
  if (saved?.x === house.x && saved.y === house.y) return saved.details;
  const details = buildGardenDetails(shape, house); cache.set(shape, { x: house.x, y: house.y, details }); return details;
}

export function drawGardenDetails(ctx: CanvasRenderingContext2D, shape: Shape, house: Point, mpp: number): void {
  const details = gardenDetails(shape, house), path = (points: Point[], close = false): void => {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (close) ctx.closePath();
  };
  ctx.save();
  ctx.strokeStyle = '#e4d6af'; ctx.lineWidth = 1.1; path([house, details.entry]); ctx.stroke();
  ctx.beginPath();
  for (const ring of [shape.outer, ...(shape.holes ?? [])]) { ring.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
  ctx.clip('evenodd'); ctx.fillStyle = '#b7bd8a'; ctx.fillRect(-1e6, -1e6, 2e6, 2e6);
  ctx.strokeStyle = '#e4d6af'; ctx.lineWidth = 1.1;
  for (const p of details.paths) { path(p); ctx.stroke(); }
  ctx.fillStyle = '#7c9259'; ctx.strokeStyle = '#68694b'; ctx.lineWidth = Math.max(.15, .3 * mpp);
  for (const p of details.beds) { path(p, true); ctx.fill(); ctx.stroke(); }
  ctx.strokeStyle = '#69664b'; ctx.lineWidth = Math.max(.35, .65 * mpp);
  for (const p of details.fences) { path(p); ctx.stroke(); }
  ctx.restore();
}
