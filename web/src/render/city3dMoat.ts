import type { Enclosure } from '../../../rust/bridge/urban';
import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import { surfaceTriangles } from './urbanBuildingGeometry';
import { moatForm, moatSpec, moatState, moatBankEdge, moatBucket, moatDepth, moatFill, moatFreeboard, moatInk, moatInward, moatScarp, moatSharedEdges, moatSheet, moatWaterColour, type MoatForm, type MoatPartShape, type MoatSpec, type MoatState } from './moatModel';

/** Moats (fortification ditches) in the 3D view. The ground itself is dug: the terrain lowers its tiles inside every ditch
 * piece by the ditch depth, with a sloped scarp and counterscarp (ui/urbanGroundCuts.ts). Here, built once with the other wall
 * meshes (no per-frame work):
 * - a wet moat's water sheet, level, at the height its fill gives it inside the dug ditch (the banks above it hide its edges);
 * - the revetment of a faced ditch (masonry, timber, dressed stone): a battered face from the lip to the bottom, on both banks;
 * - the dams between two reaches and the sluice at a head by the water;
 * - at each land gate whose street crosses the moat, a bridge deck with parapets at the undug ground level, spanning the ditch.
 * `g` is the placement height: the undug ground on which walls, bridges and quays stand. `height_m` of a ditch is its depth. */
const MOAT_WATER_DEFAULT = '#6f8f98';
/** Water lies level: its surface steps down the ground by this height (m), each step a reach held by a dam. */
const REACH_STEP = 0.5;
type Shape = { outer: Point[]; holes: Point[][] };
type Face = (points: Vertex3[], material: string) => void;
type Prism = (shape: Shape, bottom: (p: Point) => number, top: (p: Point) => number, side: string, cap: string | undefined, under?: boolean) => void;
const MAX_EDGE = 6;

export { moatDepth };

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

/** Non-source inputs the walls read from the season and the moat review controls. The enclosure is an
 * immutable native layout record. Forced sluices/dams supply a fresh spec, so mutable review geometry
 * is always rebuilt. Compare the resolved fill and inks actually used by the sheet, even between two
 * dates with the same rounded season key. */
export function moatMeshInputs(enclosure: Enclosure, waterColor = MOAT_WATER_DEFAULT, engraved = false): unknown[] {
  const form = moatForm(enclosure),
    spec = moatSpec(enclosure),
    town = moatState({ moat: spec });
  const inputs: unknown[] = [form, spec, town];
  for (const ditch of enclosure.ditch ?? []) {
    if (!ditch.shape?.outer || ditch.shape.outer.length < 3) continue;
    const bucket = moatBucket(ditch.shape.outer),
      fill = moatFill(ditch.kind, bucket, form, undefined, town);
    inputs.push(fill);
    if (!engraved)
      for (const part of moatSheet(fill).afloat) {
        const ink = moatInk(part, ditch.kind, bucket, form, waterColor, town);
        inputs.push(ink.fill, ink.alpha);
      }
  }
  return inputs;
}

/** The water of a wet moat piece (nothing for a dry one: the dug ground and the plan texture show it), in the state its form,
 * the climate and the season give it (moatModel.ts): brim-full, low, stagnant or frozen. The sheet is level: at each point
 * the lowest rim within one ditch width, taken down to a whole step, less the freeboard of the fill. It never follows a
 * slope; where the dug bottom rises above it the ground hides it and the ditch shows dry.
 * `parts`: the plan parts of this piece (moatModel moatParts). The sheet covers the whole piece when the ditch stands in
 * water, only its channel or pools when the water is low or the ditch a marsh; what floats (duckweed, lilies, reeds, snow on
 * ice) lies on it in its own colour. `engraved`: a plan in ink keeps its wash and carries no such detail. */
export function moatFaces(ditch: { kind: string; shape: Shape; height_m: number }, form: MoatForm, g: (p: Point) => number, face: Face, waterColor = MOAT_WATER_DEFAULT, town: MoatState = '', parts: readonly MoatPartShape[] = [], engraved = false): void {
  const outer = ditch.shape?.outer;
  if (!outer || outer.length < 3) return;
  const bucket = moatBucket(outer),
    fill = moatFill(ditch.kind, bucket, form, undefined, town),
    drop = moatFreeboard(fill, moatDepth(ditch, form));
  if (drop === undefined) return;
  const holes = (ditch.shape.holes ?? []).filter(r => r.length >= 3),
    lies = moatSheet(fill),
    tris: [Point, Point, Point][] = [];
  if (lies.whole) for (const t of surfaceTriangles([{ outer: densify(outer, MAX_EDGE), holes: holes.map(h => densify(h, MAX_EDGE)) }])) fine(t, tris);
  let perimeter = 0,
    area = 0;
  [outer, ...holes].forEach((r, ri) => {
    let a2 = 0;
    for (let i = 0; i < r.length; i++) {
      perimeter += Math.hypot(r[(i + 1) % r.length].x - r[i].x, r[(i + 1) % r.length].y - r[i].y);
      a2 += r[i].x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * r[i].y;
    }
    area += (ri ? -1 : 1) * Math.abs(a2 / 2);
  });
  // Mean band width: area over half the perimeter.
  const reach = Math.min(30, (2 * area) / Math.max(1, perimeter)),
    levels = new Map<string, number>(),
    rim = (p: Point): number => {
      const key = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
      let z = levels.get(key);
      if (z === undefined) {
        z = g(p);
        for (let k = 0; k < 8; k++) z = Math.min(z, g({ x: p.x + Math.cos((k * Math.PI) / 4) * reach, y: p.y + Math.sin((k * Math.PI) / 4) * reach }));
        levels.set(key, (z = Math.floor(z / REACH_STEP) * REACH_STEP));
      }
      return z;
    };
  const sheet = `city3d:water@${moatWaterColour(fill, waterColor, engraved).replace('#', '')}`;
  for (const t of tris)
    face(
      t.map(p => ({ x: p.x, y: p.y, z: rim(p) - drop })),
      sheet,
    );
  // The parts are small (a few metres): a fan from their first corner follows the level.
  const lay = (ring: readonly Point[], lift: number, material: string): void => {
    for (let i = 1; i + 1 < ring.length; i++)
      face(
        [ring[0], ring[i], ring[i + 1]].map(p => ({ x: p.x, y: p.y, z: rim(p) - drop + lift })),
        material,
      );
  };
  for (const p of parts) {
    if (lies.water.includes(p.part)) lay(p.shape.outer, 0, sheet);
    else if (!engraved && lies.afloat.includes(p.part)) {
      const ink = moatInk(p.part, ditch.kind, bucket, form, waterColor, town);
      if (ink.fill && ink.alpha > 0) lay(p.shape.outer, 0.06, `city3d:cover:thatch@${ink.fill.replace('#', '')}`);
    }
  }
}

/** The revetment of a faced ditch: along every bank of its pieces, a battered face from just above the lip down to the
 * bottom, with a coping. The terrain is dug on a grid of a few metres, so its own scarp is a soft ramp; this face stands
 * over it and gives the ditch its wall. `material`: the facing (stone, wood). Earth forms have none. `only`: the one piece
 * to face (the others tell which of its edges are no banks). */
export function moatRevetment(pieces: readonly Ditch[], form: MoatForm, g: (p: Point) => number, face: Face, material: string, coping: string, only?: Ditch): void {
  if (form.revetment === 'earth') return;
  const shared = moatSharedEdges(pieces);
  for (const d of only ? [only] : pieces) {
    const outer = d.shape?.outer;
    if (!outer || outer.length < 3) continue;
    const holes = (d.shape.holes ?? []).filter(r => r.length >= 3);
    let perimeter = 0,
      area = 0;
    [outer, ...holes].forEach((r, ri) => {
      let a2 = 0;
      for (let i = 0; i < r.length; i++) {
        const p = r[i],
          q = r[(i + 1) % r.length];
        perimeter += Math.hypot(q.x - p.x, q.y - p.y);
        a2 += p.x * q.y - q.x * p.y;
      }
      area += (ri ? -1 : 1) * Math.abs(a2 / 2);
    });
    const width = (2 * area) / Math.max(1, perimeter),
      depth = moatDepth(d, form),
      // The foot of the face: past the ramp the terrain grid makes of the scarp, never past the middle of the ditch.
      run = Math.min(0.42 * width, Math.max(1.8, moatScarp(form, depth, width)));
    [outer, ...holes].forEach((ring, ri) => {
      const turn = moatInward(ring, ri);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l < 0.2 || !moatBankEdge(shared, a, b)) continue;
        const nx = (-(b.y - a.y) / l) * turn,
          ny = ((b.x - a.x) / l) * turn,
          k = Math.max(1, Math.ceil(l / MAX_EDGE)),
          at = (j: number, w: number): Point => ({ x: a.x + ((b.x - a.x) * j) / k + nx * w, y: a.y + ((b.y - a.y) * j) / k + ny * w });
        for (let j = 0; j < k; j++) {
          const z0 = g(at(j, 0)),
            z1 = g(at(j + 1, 0)),
            quad = (w0: number, h0: number, w1: number, h1: number, m: string): void => {
              const pts = [
                { ...at(j, w0), z: z0 + h0 },
                { ...at(j + 1, w0), z: z1 + h0 },
                { ...at(j + 1, w1), z: z1 + h1 },
                { ...at(j, w1), z: z0 + h1 },
              ];
              // Facing the ditch and the sky whatever way the ring winds.
              face(turn > 0 ? pts : pts.reverse(), m);
            };
          quad(-0.5, 0.18, 0.15, 0.18, coping);
          quad(0.15, 0.18, run, -depth + 0.06, material);
        }
      }
    });
  }
}

/** Dams and sluices of a circuit's ditch: a dam is a wall across the ditch, its crest half a metre under the lip, that holds
 * the upper reach; a sluice is two cheek walls and a lintel over the channel cut from the head of a wet ditch to the water. */
export function moatWorks(moat: MoatSpec | undefined, depth: number, g: (p: Point) => number, prism: Prism, side: string, top: string): number {
  const band = (a: Point, b: Point, o0: number, o1: number, t0 = 0, t1 = 0): Shape => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1,
      s = { x: (b.x - a.x) / l, y: (b.y - a.y) / l },
      at = (t: number, o: number): Point => ({ x: a.x + s.x * t - s.y * o, y: a.y + s.y * t + s.x * o }),
      r = [at(t0, o0), at(l + t1, o0), at(l + t1, o1), at(t0, o1)];
    return { outer: r.reduce((x, p, i) => x + p.x * r[(i + 1) % 4].y - r[(i + 1) % 4].x * p.y, 0) < 0 ? r.reverse() : r, holes: [] };
  };
  let n = 0;
  for (const [a, b] of moat?.dams ?? []) {
    const crest = Math.min(g(a), g(b)) - 0.5;
    prism(
      band(a, b, -0.9, 0.9, -0.5, 0.5),
      p => Math.min(g(p), crest) - depth - 0.5,
      () => crest,
      side,
      top,
    );
    n++;
  }
  for (const [head, shore] of moat?.sluices ?? []) {
    const z = g(head);
    for (const [o0, o1] of [
      [-2.1, -1.4],
      [1.4, 2.1],
    ])
      prism(
        band(head, shore, o0, o1, -1.5, 0),
        () => z - 2,
        () => z + 0.3,
        side,
        top,
      );
    // The gate frame over the channel, at the head.
    prism(
      band(head, shore, -2.1, 2.1, -1.5, -Math.hypot(shore.x - head.x, shore.y - head.y) - 0.3),
      () => z + 0.3,
      () => z + 1,
      side,
      top,
      true,
    );
    n++;
  }
  return n;
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
  /** The piece of ditch met first: the span is filled like it. */
  piece: Ditch;
}
/** The 2D walls, the 3D ground cuts and the 3D bridges all ask for the spans of the same circuit: computed once per ditch list. */
const spanCache = new WeakMap<readonly Ditch[], { gatehouses: readonly Gatehouse[]; spans: MoatSpan[] }>();
export function moatSpans(gatehouses: readonly Gatehouse[], ditch: readonly Ditch[], form: MoatForm): MoatSpan[] {
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
      wet = false,
      piece: Ditch | undefined;
    for (let t = 0; t <= 60; t += 0.5) {
      let hit = false;
      // Beside the street: the engine cuts the moat at the street ribbon (+1 m), the causeway.
      for (const o of [-half - 3, -half - 1, 0, half + 1, half + 3]) {
        const d = pieceAt({ x: b.x + s.x * t + n.x * o, y: b.y + s.y * t + n.y * o });
        if (d) {
          hit = true;
          depth = Math.max(depth, moatDepth(d, form));
          wet ||= d.kind === 'wet';
          piece ??= d;
        }
      }
      if (hit) {
        first = Math.min(first, t);
        last = t;
      } else if (last > first && t - last > 3) break;
    }
    if (last > first && piece) out.push({ b, s, n, first, last, half, depth, wet, piece });
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

export function moatBridges(gatehouses: readonly Gatehouse[], ditch: readonly Ditch[], form: MoatForm, g: (p: Point) => number, prism: Prism, side: string, deck: string): number {
  const spans = moatSpans(gatehouses, ditch, form);
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
