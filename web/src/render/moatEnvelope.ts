/**
 * The moat envelopes of the walled towns (`Enclosure.moat.runs`, render/moatLine.ts), built once per set of layouts and read
 * by what the world draws around a town:
 * - a regional deck whose middle lies in the band between a curtain and its counterscarp (plus MOAT_DECK_MARGIN) is not the
 *   world's: the town's crossing over the ditch is the bridge there (cityBridges.ts `urbanReplacesCrossing`: the 2D map, the
 *   3D structures and the terrain road clip);
 * - a stream that the moat takes in ends at the outer lip (`courseCut`: the GPU rivers of the V2 ground, waterProducts.ts).
 * Every query tests the boxes first.
 */
import type { Layout, MoatRun, Point } from '../../../rust/bridge/urban';
import { pathDistance, runStrip, stationCount, stationWidth } from './moatLine';

/** A regional deck whose middle lies this close (m) to the band between a curtain and its counterscarp is the town's. */
export const MOAT_DECK_MARGIN = 6;
/** A captured stream runs at most the moat width + the berm + this (m) beyond the outer lip. */
export const MOAT_CAPTURE_REACH = 60;

/** Where a course is cut: on its segment `segment` (vertex `segment` to the next), at `t` along it. */
export interface CourseCut {
  segment: number;
  t: number;
}
interface Envelope {
  /** The outer-lip polygon: the counterscarp ring of a closed run, the strip of an open one. */
  outer: Point[];
  /** The inner lips of a closed run: the hole of its band. */
  hole?: Point[];
  /** The inner lips as a line (closed back to the first on a closed run). */
  inner: Point[];
  /** The curtain of the circuit. */
  curtain: Point[];
  /** Median distance from the inner lip to the curtain (m). */
  berm: number;
  /** Longest course a captured stream keeps beyond its entry (m). */
  capture: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const inRing = (p: Point, ring: readonly Point[]): boolean => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const closedLine = (ring: readonly Point[]): Point[] => (ring.length > 2 ? [...ring, ring[0]] : [...ring]);
const median = (values: number[]): number => {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
};
/** First crossing (t in [0, 1]) of the segment a -> b with the edges of `ring`, undefined for none. */
function ringEntry(ax: number, ay: number, bx: number, by: number, ring: readonly Point[]): number | undefined {
  const dx = bx - ax,
    dy = by - ay;
  let best: number | undefined;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[j],
      ex = ring[i].x - c.x,
      ey = ring[i].y - c.y,
      den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((c.x - ax) * ey - (c.y - ay) * ex) / den,
      u = ((c.x - ax) * dy - (c.y - ay) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === undefined || t < best)) best = t;
  }
  return best;
}

function envelopeOf(run: MoatRun, curtain: readonly Point[]): Envelope | undefined {
  const n = stationCount(run),
    strip = runStrip(run);
  if (n < 2 || strip.outer.length < 3) return undefined;
  const inner = run.closed ? closedLine(run.inner.slice(0, n)) : run.inner.slice(0, n),
    berm = curtain.length >= 2 ? median(Array.from({ length: n }, (_, k) => pathDistance(run.inner[k], curtain))) : 0,
    width = Array.from({ length: n }, (_, k) => stationWidth(run, k)).reduce((s, w) => s + w, 0) / n,
    pad = berm + MOAT_DECK_MARGIN,
    xs = strip.outer.map(p => p.x),
    ys = strip.outer.map(p => p.y);
  return { outer: strip.outer, hole: strip.holes[0], inner, curtain: closedLine(curtain), berm, capture: width + berm + MOAT_CAPTURE_REACH, x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}
const inBox = (e: Envelope, p: Point, pad = 0): boolean => p.x >= e.x0 - pad && p.x <= e.x1 + pad && p.y >= e.y0 - pad && p.y <= e.y1 + pad;
/** `p` lies between the curtain and the counterscarp of `e`, or within MOAT_DECK_MARGIN of that band. */
function inBand(e: Envelope, p: Point): boolean {
  if (inRing(p, e.outer) && !(e.hole && inRing(p, e.hole))) return true;
  if (pathDistance(p, closedLine(e.outer)) < MOAT_DECK_MARGIN) return true;
  // The berm, from the inner lip to the curtain.
  return e.curtain.length >= 2 && pathDistance(p, e.inner) <= e.berm + MOAT_DECK_MARGIN && pathDistance(p, e.curtain) <= e.berm + MOAT_DECK_MARGIN;
}
/** The middle of a path by arc length. */
function middle(path: readonly Point[]): Point {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  let left = total / 2;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= left && l > 0) return { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l };
    left -= l;
  }
  return path[path.length - 1];
}

export class MoatEnvelopes {
  private readonly envelopes: Envelope[] = [];

  constructor(layouts: readonly Layout[]) {
    for (const l of layouts)
      for (const e of l.enclosures ?? [])
        for (const run of e.moat?.runs ?? []) {
          const envelope = envelopeOf(run, e.path ?? []);
          if (envelope) this.envelopes.push(envelope);
        }
  }
  get empty(): boolean {
    return !this.envelopes.length;
  }
  /** The middle of the deck `path` lies in the band of a moat (MOAT_DECK_MARGIN included). */
  holdsDeck(path: readonly Point[]): boolean {
    if (!this.envelopes.length || path.length < 2) return false;
    const p = middle(path);
    return this.envelopes.some(e => inBox(e, p) && inBand(e, p));
  }
  /** Where a moat takes the course in (flat x, y vertices, downstream): the first entry into the outer-lip polygon of a run
   * past which the course runs at most the moat width + berm + MOAT_CAPTURE_REACH and ends in the band or inside the walls.
   * Undefined for a course that goes on through or past the town, or rises inside it. */
  courseCut(points: ArrayLike<number>): CourseCut | undefined {
    const n = points.length >> 1;
    if (!this.envelopes.length || n < 2) return undefined;
    const end = { x: points[2 * n - 2], y: points[2 * n - 1] };
    let best: (CourseCut & { rest: number }) | undefined;
    for (const e of this.envelopes) {
      if (!inBox(e, end, e.capture) || !(inRing(end, e.outer) || inBand(e, end) || (e.curtain.length > 3 && inRing(end, e.curtain)))) continue;
      // From the end upstream: only the last `capture` metres of the course can hold the entry.
      for (let j = n - 2, after = 0; j >= 0 && after <= e.capture; j--) {
        const ax = points[2 * j],
          ay = points[2 * j + 1],
          bx = points[2 * j + 2],
          by = points[2 * j + 3],
          l = Math.hypot(bx - ax, by - ay),
          t = inRing({ x: ax, y: ay }, e.outer) ? undefined : ringEntry(ax, ay, bx, by, e.outer),
          rest = t === undefined ? 0 : after + (1 - t) * l;
        if (t !== undefined && rest <= e.capture && (!best || rest > best.rest)) best = { segment: j, t, rest };
        after += l;
      }
    }
    return best && { segment: best.segment, t: best.t };
  }
}

const built = new WeakMap<readonly Layout[], MoatEnvelopes>();
/** The envelopes of the moats of `layouts`, built once per layouts array. */
export function moatEnvelopes(layouts: readonly Layout[]): MoatEnvelopes {
  let envelopes = built.get(layouts);
  if (!envelopes) built.set(layouts, (envelopes = new MoatEnvelopes(layouts)));
  return envelopes;
}

/** A short key of the moat runs of `layouts` (their lips, rounded to 0.1 m): what the river cut reads of the towns. */
const keys = new WeakMap<readonly Layout[], string>();
export function moatEnvelopeKey(layouts: readonly Layout[]): string {
  let key = keys.get(layouts);
  if (key !== undefined) return key;
  let h = 0x811c9dc5,
    runs = 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ Math.round(v * 10), 0x01000193);
  };
  for (const l of layouts)
    for (const e of l.enclosures ?? [])
      for (const run of e.moat?.runs ?? []) {
        runs++;
        for (const p of run.outer) {
          mix(p.x);
          mix(p.y);
        }
        for (const p of run.inner) {
          mix(p.x);
          mix(p.y);
        }
      }
  keys.set(layouts, (key = runs ? `${runs}:${(h >>> 0).toString(36)}` : ''));
  return key;
}
