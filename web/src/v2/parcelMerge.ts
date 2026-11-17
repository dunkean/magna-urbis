import polygonClipping from 'polygon-clipping';

type Pt = { x: number; y: number };
export interface LotShape { outer: Pt[]; holes?: Pt[][] }

/** Widest gap between two lots of a block that a merge bridges: cut lots can sit a few decimetres apart
 * (offset fronts, rounded corners), never a lane (lanes are not part of the block). */
export const MERGE_SNAP = 0.5;

function closest(p: Pt, a: Pt, b: Pt): { d: number; q: Pt } {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
}
/** `shape` with each vertex within `tolerance` of a side of `onto` moved onto that side. */
function snapOnto(shape: LotShape, onto: LotShape, tolerance: number): LotShape {
  const sides = [onto.outer, ...onto.holes ?? []].flatMap(r => r.map((p, i) => [p, r[(i + 1) % r.length]] as const));
  const snap = (p: Pt): Pt => {
    let best: { d: number; q: Pt } | undefined;
    for (const [a, b] of sides) { const c = closest(p, a, b); if (c.d <= tolerance && (!best || c.d < best.d)) best = c; }
    return best ? best.q : p;
  };
  return { outer: shape.outer.map(snap), holes: (shape.holes ?? []).map(r => r.map(snap)) };
}
const toPolygon = (s: LotShape): [number, number][][] => [s.outer, ...s.holes ?? []].map(r => r.map(p => [p.x, p.y] as [number, number]));
function single(parts: LotShape[]): LotShape | undefined {
  const [first, ...rest] = parts.map(toPolygon);
  const union = polygonClipping.union(first, ...rest);
  if (union.length !== 1) return undefined;
  // polygon-clipping closes its rings; lots keep open rings.
  const ring = (r: [number, number][]) => r.slice(0, r.length > 1 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? -1 : undefined).map(([x, y]) => ({ x, y }));
  const [outer, ...holes] = union[0];
  return { outer: ring(outer), holes: holes.map(ring) };
}
/** Outline of `lot` grown over its neighbour `other`, as one polygon: the shared side as drawn, else the
 * selected lot's vertices snapped onto the neighbour (the neighbour keeps its outline, so the engine sees it
 * wholly covered and absorbs it), else both snapped. `undefined` when the two lots do not touch. */
export function mergedOutline(lot: LotShape, other: LotShape): LotShape | undefined {
  const grown = snapOnto(lot, other, MERGE_SNAP);
  return single([lot, other]) ?? single([grown, other]) ?? single([grown, snapOnto(other, grown, MERGE_SNAP)]);
}
