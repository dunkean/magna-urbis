import type { Shape, Point } from '../../../rust/bridge/urban';
import { polygonArea } from '../gen/core/geom';
import { ringProblem, projectOnSegment } from '../ui/cityShapeEditor';
import { pointInRing } from '../gen/geo/poly';

export type ContourSelection = { kind: 'line' } | { kind: 'point'; ring: number; index: number } | { kind: 'segment'; ring: number; index: number };
export const contourRings = (shape: Shape): Point[][] => [shape.outer, ...shape.holes];
export const copyContour = (shape: Shape): Shape => ({ outer: shape.outer.map(p => ({ ...p })), holes: shape.holes.map(r => r.map(p => ({ ...p }))) });
export function contourProblem(shape: Shape): string | undefined {
  const outerError = ringProblem(shape.outer);
  if (outerError) return outerError;
  // Native boolean operations retain sub-square-metre holes. These inherited
  // details have no editable handles and must not invalidate a valid outer ring.
  for (const hole of shape.holes) {
    if (hole.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'Coordonnée invalide';
    if (Math.abs(polygonArea(hole)) < 1) continue;
    const error = ringProblem(hole);
    if (error) return error;
    if (!hole.every(p => pointInRing(shape.outer, p))) return 'A courtyard must stay inside its outline.';
  }
  return undefined;
}
export function nearestContour(shape: Shape, p: Point): { ring: number; index: number; point: Point; distance: number } {
  let hit = { ring: 0, index: 0, point: shape.outer[0], distance: Infinity };
  contourRings(shape).forEach((ring, r) =>
    ring.forEach((a, i) => {
      const h = projectOnSegment(p, a, ring[(i + 1) % ring.length]);
      if (h.dist < hit.distance) hit = { ring: r, index: i, point: h.point, distance: h.dist };
    }),
  );
  return hit;
}
export function contourPointAt(shape: Shape, p: Point, tolerance: number): { ring: number; index: number } | undefined {
  let best: { ring: number; index: number } | undefined,
    distance = tolerance;
  contourRings(shape).forEach((ring, r) =>
    ring.forEach((a, i) => {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d <= distance) {
        distance = d;
        best = { ring: r, index: i };
      }
    }),
  );
  return best;
}
export function insertContourPoint(shape: Shape, p: Point): { shape: Shape; selection: ContourSelection } {
  const same = contourPointAt(shape, p, 1e-5);
  if (same) return { shape, selection: { kind: 'point', ...same } };
  const hit = nearestContour(shape, p),
    next = copyContour(shape);
  contourRings(next)[hit.ring].splice(hit.index + 1, 0, hit.point);
  return { shape: next, selection: { kind: 'point', ring: hit.ring, index: hit.index + 1 } };
}
export function translateContour(shape: Shape, selection: ContourSelection, dx: number, dy: number): Shape {
  const next = copyContour(shape);
  contourRings(next).forEach((ring, r) =>
    ring.forEach((p, i) => {
      if (selection.kind === 'line' || (r === selection.ring && (i === selection.index || (selection.kind === 'segment' && i === (selection.index + 1) % ring.length)))) {
        p.x += dx;
        p.y += dy;
      }
    }),
  );
  return next;
}
/** Removing a point retensions the ring. Removing a segment removes its two ends. */
export function removeContourSelection(shape: Shape, selection: ContourSelection): Shape | undefined {
  if (selection.kind === 'line') return undefined;
  const next = copyContour(shape),
    rings = contourRings(next),
    ring = rings[selection.ring],
    deleted = new Set([selection.index]);
  if (selection.kind === 'segment') deleted.add((selection.index + 1) % ring.length);
  const kept = ring.filter((_, i) => !deleted.has(i));
  if (kept.length < 3) {
    if (selection.ring === 0) return undefined;
    next.holes.splice(selection.ring - 1, 1);
    return next;
  }
  if (selection.ring === 0) next.outer = kept;
  else next.holes[selection.ring - 1] = kept;
  return next;
}
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0 && Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x) && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y);
}
/** Two boundary points make two closed surfaces; never an invalid pair of open outlines. */
export function splitContour(shape: Shape, first: number, second: number): [Shape, Shape] {
  const ring = shape.outer,
    n = ring.length;
  if (first === second || (first + 1) % n === second || (second + 1) % n === first) throw new Error('Choose a non-adjacent point on the outer boundary.');
  const arc = (a: number, b: number) => {
    const out: Point[] = [];
    for (let i = a; ; i = (i + 1) % n) {
      out.push({ ...ring[i] });
      if (i === b) break;
    }
    return out;
  };
  const a: Shape = { outer: arc(first, second), holes: [] },
    b: Shape = { outer: arc(second, first), holes: [] };
  if (ringProblem(a.outer) || ringProblem(b.outer) || Math.abs(Math.abs(polygonArea(a.outer)) + Math.abs(polygonArea(b.outer)) - Math.abs(polygonArea(ring))) > 0.01) throw new Error('The cut must stay inside the selected area.');
  for (const hole of shape.holes) {
    if (hole.some((p, i) => crosses(ring[first], ring[second], p, hole[(i + 1) % hole.length]))) throw new Error('The cut crosses a courtyard. Choose another boundary point.');
    const target = pointInRing(a.outer, hole[0]) ? a : b;
    if (!hole.every(p => pointInRing(target.outer, p))) throw new Error('The cut crosses a courtyard. Choose another boundary point.');
    target.holes.push(hole.map(p => ({ ...p })));
  }
  return [a, b];
}
