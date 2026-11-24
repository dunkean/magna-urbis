import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import { surfaceTriangles } from './urbanBuildingGeometry';

/** Moats (fortification ditches) in the 3D view. The ground itself is dug: the terrain lowers its tiles inside every ditch
 * piece by the ditch depth, with a sloped scarp and counterscarp (ui/urbanGroundCuts.ts). Here, built once with the other wall
 * meshes (no per-frame work):
 * - a wet moat's water sheet, at its water level inside the dug ditch (the banks above it hide its edges: it follows the shore);
 * - at each land gate whose street crosses the moat, a bridge deck with parapets at the undug ground level, spanning the ditch.
 * `g` is the placement height: the undug ground on which walls, bridges and quays stand. `height_m` of a ditch is its depth. */
const MOAT_WATER_DEFAULT = '#6f8f98';
/** Drop from the rim of a wet moat to its water: a third of its depth, so the banks show and the water fills the ditch. */
const freeboard = (depth: number): number => Math.min(1.2, Math.max(0.5, depth / 3));
type Shape = { outer: Point[]; holes: Point[][] };
type Face = (points: Vertex3[], material: string) => void;
type Prism = (shape: Shape, bottom: (p: Point) => number, top: (p: Point) => number, side: string, cap: string | undefined, under?: boolean) => void;
const MAX_EDGE = 6;

export const moatDepth = (d: { kind: string; height_m: number }): number => (d.height_m > 0 ? d.height_m : d.kind === 'wet' ? 2.5 : 3);

function densify(ring: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  return out;
}

/** Split a triangle on its longest edge until every edge is short enough to follow the relief. */
function fine(t: readonly [Point, Point, Point], out: [Point, Point, Point][], depth = 0): void {
  const e = [0, 1, 2].map(i => Math.hypot(t[(i + 1) % 3].x - t[i].x, t[(i + 1) % 3].y - t[i].y)),
    m = Math.max(...e);
  if (m <= MAX_EDGE || depth > 6) {
    out.push([t[0], t[1], t[2]]);
    return;
  }
  const i = e.indexOf(m),
    a = t[i],
    b = t[(i + 1) % 3],
    c = t[(i + 2) % 3],
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  fine([a, mid, c], out, depth + 1);
  fine([mid, b, c], out, depth + 1);
}

/** The water of a wet moat piece (nothing for a dry one: the dug ground and the plan texture show it). */
export function moatFaces(ditch: { kind: string; shape: Shape; height_m: number }, g: (p: Point) => number, face: Face, waterColor = MOAT_WATER_DEFAULT): void {
  const outer = ditch.shape?.outer;
  if (ditch.kind !== 'wet' || !outer || outer.length < 3) return;
  const holes = (ditch.shape.holes ?? []).filter(r => r.length >= 3),
    level = freeboard(moatDepth(ditch)),
    tris: [Point, Point, Point][] = [];
  for (const t of surfaceTriangles([{ outer: densify(outer, MAX_EDGE), holes: holes.map(h => densify(h, MAX_EDGE)) }])) fine(t, tris);
  const sheet = `city3d:water@${waterColor.replace('#', '')}`;
  for (const t of tris)
    face(
      t.map(p => ({ x: p.x, y: p.y, z: g(p) - level })),
      sheet,
    );
}

/** The edges of a ring (x, y of both ends) that can decide whether a point within `reach` of `c` is inside it: an edge off
 * the y band of those points, or wholly on their left, never toggles the crossing parity. A moat ring runs round the whole
 * town and a gate probes thousands of points next to itself: the test then reads a few edges instead of the ring. */
const nearEdges = (r: readonly Point[], c: Point, reach: number): number[] => {
  const out: number[] = [];
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i],
      q = r[j];
    if (Math.min(a.y, q.y) > c.y + reach || Math.max(a.y, q.y) < c.y - reach || Math.max(a.x, q.x) < c.x - reach) continue;
    out.push(a.x, a.y, q.x, q.y);
  }
  return out;
};
/** Even-odd test over the kept edges: the predicate and arithmetic of the whole-ring test. */
const inEdges = (e: readonly number[], p: Point): boolean => {
  let c = false;
  for (let k = 0; k < e.length; k += 4) if (e[k + 1] > p.y !== e[k + 3] > p.y && p.x < ((e[k + 2] - e[k]) * (p.y - e[k + 1])) / (e[k + 3] - e[k + 1]) + e[k]) c = !c;
  return c;
};

type Gatehouse = { kind: string; passage: Point[]; passage_width_m: number };
type Ditch = { kind: string; shape: Shape; height_m: number };
/** Where a land gate's street crosses the moat: from the middle `b` of the gate passage, along the causeway axis `s` (`n` across),
 * the moat lies between `first` and `last` (m along `s`), over the causeway half width `half`; `depth` of the piece met. */
export interface MoatSpan {
  b: Point;
  s: Point;
  n: Point;
  first: number;
  last: number;
  half: number;
  depth: number;
  wet: boolean;
}
/** The 2D walls, the 3D ground cuts and the 3D bridges all ask for the spans of the same circuit: computed once per ditch list. */
const spanCache = new WeakMap<readonly Ditch[], { gatehouses: readonly Gatehouse[]; spans: MoatSpan[] }>();
export function moatSpans(gatehouses: readonly Gatehouse[], ditch: readonly Ditch[]): MoatSpan[] {
  const cached = spanCache.get(ditch);
  if (cached?.gatehouses === gatehouses) return cached.spans;
  const pieces = ditch.filter(d => (d.shape?.outer?.length ?? 0) >= 3),
    out: MoatSpan[] = [];
  spanCache.set(ditch, { gatehouses, spans: out });
  if (!pieces.length) return out;
  for (const gh of gatehouses) {
    if (['water', 'shore', 'ravelin'].includes(gh.kind) || gh.passage?.length !== 2) continue;
    const [a, p] = gh.passage,
      l = Math.hypot(p.x - a.x, p.y - a.y);
    if (l < 0.5) continue;
    const passage = Math.max(2, gh.passage_width_m / 2),
      b = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 },
      axis = { x: (p.x - a.x) / l, y: (p.y - a.y) / l };
    // Every point probed below lies within 60 m along and passage + 10 m across of the gate.
    const reach = 72 + passage,
      near = pieces.map(d => ({ d, outer: nearEdges(d.shape.outer, b, reach), holes: (d.shape.holes ?? []).map(h => nearEdges(h, b, reach)) }));
    const pieceAt = (p: Point): Ditch | undefined => near.find(piece => inEdges(piece.outer, p) && !piece.holes.some(h => inEdges(h, p)))?.d;
    // The causeway's own direction: the gatehouse may stand square to the curtain while its street crosses the moat obliquely.
    // Among directions within 70° of the passage, the one along which the moat lies on both sides of the street and not under it.
    // Of the directions scoring at least 60 % of the best, the one closest to the passage (a long gap elsewhere in the moat
    // must not pull the bridge off the gate street).
    let s = axis;
    const scored: { deg: number; u: Point; score: number; gap: number }[] = [];
    for (let deg = -70; deg <= 70; deg += 5) {
      const r = (deg * Math.PI) / 180,
        u = { x: axis.x * Math.cos(r) - axis.y * Math.sin(r), y: axis.x * Math.sin(r) + axis.y * Math.cos(r) },
        v = { x: -u.y, y: u.x };
      let score = 0,
        gap = Infinity;
      for (let t = 2; t <= 40; t += 1) {
        const at = (o: number): Point => ({ x: b.x + u.x * t + v.x * o, y: b.y + u.y * t + v.y * o });
        if (pieceAt(at(0))) continue;
        // The final street may be wider than the passage: the causeway is as wide as its ribbon.
        const e = [1.5, 4, 8].find(e => pieceAt(at(-passage - e)) && pieceAt(at(passage + e)));
        if (e !== undefined) {
          score++;
          gap = Math.min(gap, e);
        }
      }
      scored.push({ deg, u, score, gap });
    }
    const top = Math.max(0, ...scored.map(c => c.score));
    let half = passage;
    if (top > 0) {
      const pick = scored.filter(c => c.score >= 0.6 * top).sort((a, b) => Math.abs(a.deg) - Math.abs(b.deg))[0];
      s = pick.u;
      half = passage + pick.gap - 1;
    }
    const n = { x: -s.y, y: s.x };
    // The first moat band met outwards (beside the street or under it); a later band (an outwork's) is not this span.
    let first = Infinity,
      last = -Infinity,
      depth = 0,
      wet = false;
    for (let t = 0; t <= 60; t += 0.5) {
      let hit = false;
      // Beside the street: the engine cuts the moat at the street ribbon (+1 m), the causeway.
      for (const o of [-half - 3, -half - 1, 0, half + 1, half + 3]) {
        const d = pieceAt({ x: b.x + s.x * t + n.x * o, y: b.y + s.y * t + n.y * o });
        if (d) {
          hit = true;
          depth = Math.max(depth, moatDepth(d));
          wet ||= d.kind === 'wet';
        }
      }
      if (hit) {
        first = Math.min(first, t);
        last = t;
      } else if (last > first && t - last > 3) break;
    }
    if (last > first) out.push({ b, s, n, first, last, half, depth, wet });
  }
  return out;
}

/** Bridges over the moat at the land gates: a level deck at the undug ground (+0.3 m) along the gate street, from one
 * abutment to the other across the dug span, with parapets. */
/** The moat under a gate street (its causeway in the engine's data), as a band polygon: drawn under the street in 2D. */
export function moatSpanShape({ b, s, n, first, last, half }: MoatSpan): Shape {
  const at = (t: number, o: number): Point => ({ x: b.x + s.x * t + n.x * o, y: b.y + s.y * t + n.y * o });
  const r = [at(first, -half - 0.5), at(last, -half - 0.5), at(last, half + 0.5), at(first, half + 0.5)];
  return { outer: r.reduce((a, p, i) => a + p.x * r[(i + 1) % 4].y - r[(i + 1) % 4].x * p.y, 0) < 0 ? r.reverse() : r, holes: [] };
}

export function moatBridges(gatehouses: readonly Gatehouse[], ditch: readonly Ditch[], g: (p: Point) => number, prism: Prism, side: string, deck: string): number {
  const spans = moatSpans(gatehouses, ditch);
  for (const { b, s, n, first, last, half } of spans) {
    const t0 = Math.max(0, first - 1.5),
      t1 = last + 1.5;
    const at = (t: number, o: number): Point => ({ x: b.x + s.x * t + n.x * o, y: b.y + s.y * t + n.y * o });
    const z = Math.max(g(at(t0, 0)), g(at(t1, 0))) + 0.3;
    // Counter-clockwise (positive shoelace) like the engine's footprints.
    const quad = (o0: number, o1: number): Shape => {
      const r = [at(t0, o0), at(t1, o0), at(t1, o1), at(t0, o1)];
      return { outer: r.reduce((a, p, i) => a + p.x * r[(i + 1) % 4].y - r[(i + 1) % 4].x * p.y, 0) < 0 ? r.reverse() : r, holes: [] };
    };
    prism(
      quad(-half - 0.4, half + 0.4),
      () => z - 0.7,
      () => z,
      side,
      deck,
      true,
    );
    for (const o of [-half - 0.4, half])
      prism(
        quad(o, o + 0.4),
        () => z,
        () => z + 0.9,
        side,
        side,
      );
  }
  return spans.length;
}
