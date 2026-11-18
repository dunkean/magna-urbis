import type { TerrainZones } from '../../../rust/bridge/terrainZones';
import { sampleZone } from './symbolicMap';

export interface CoastTraceLine {
  points: number[];
  closed: boolean;
  flipped: boolean;
}
export interface CoastTrace {
  version: 1;
  lines: CoastTraceLine[];
}

type Point = [number, number];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate saved geometry without coercing coordinates or silently accepting recipe typos. */
export function parseCoastTrace(value: unknown): CoastTrace {
  const fail = (): never => {
    throw new Error('Invalid terrain.coastTrace.');
  };
  if (!record(value) || value.version !== 1 || Object.keys(value).some(k => !['version', 'lines'].includes(k)) || !Array.isArray(value.lines) || value.lines.length > 256) return fail();
  const lines = Array.from(value.lines, (line): CoastTraceLine => {
    if (!record(line) || Object.keys(line).some(k => !['points', 'closed', 'flipped'].includes(k)) || typeof line.closed !== 'boolean' || typeof line.flipped !== 'boolean' || !Array.isArray(line.points)) return fail();
    const points = Array.from(line.points);
    if (points.length < (line.closed ? 6 : 4) || points.length > 400 || points.length % 2 || points.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) return fail();
    return { points: points.slice(), closed: line.closed, flipped: line.flipped };
  });
  return { version: 1, lines };
}

function segmentDistanceSquared(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}

/** Iterative Douglas–Peucker simplification, capped at 200 points for saved recipes. */
export function simplifyStroke(points: readonly number[], tolerance = 0.004): number[] {
  if (points.length <= 4) return Array.from(points);
  let result: number[];
  let threshold = Math.max(0.000001, tolerance);
  do {
    const count = points.length / 2,
      keep = new Uint8Array(count),
      stack = [[0, count - 1]];
    keep[0] = keep[count - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let farthest = -1,
        distance = threshold * threshold;
      for (let i = a + 1; i < b; i++) {
        const d = segmentDistanceSquared(points[2 * i], points[2 * i + 1], points[2 * a], points[2 * a + 1], points[2 * b], points[2 * b + 1]);
        if (d > distance) {
          farthest = i;
          distance = d;
        }
      }
      if (farthest >= 0) {
        keep[farthest] = 1;
        stack.push([a, farthest], [farthest, b]);
      }
    }
    result = [];
    for (let i = 0; i < count; i++) if (keep[i]) result.push(points[2 * i], points[2 * i + 1]);
    threshold *= 1.5;
  } while (result.length > 400);
  return result;
}

/** Nearest border projection; ties choose north, east, south, then west. */
export function coastTraceExtensions(line: CoastTraceLine): [Point, Point] {
  const project = (x: number, y: number): Point => {
    const distances = [y, 1 - x, 1 - y, x],
      side = distances.indexOf(Math.min(...distances));
    return side === 0 ? [x, 0] : side === 1 ? [1, y] : side === 2 ? [x, 1] : [0, y];
  };
  const p = line.points;
  return [project(p[0], p[1]), project(p[p.length - 2], p[p.length - 1])];
}
const perimeter = ([x, y]: Point): number => (y === 0 ? x : x === 1 ? 1 + y : y === 1 ? 3 - x : 4 - y);

/** For an open line, flipped:false designates SEA in the even-odd polygon made by
 * following the line from start to end (with nearest-border extensions), then
 * walking the map border clockwise from end back to start. This choice is stored,
 * never recomputed when other lines are added. Closed lines instead paint land
 * inside by default; flipped closed lines paint sea inside. */
export function coastTracePolygon(line: CoastTraceLine): number[] {
  if (line.closed) return line.points;
  const [start, end] = coastTraceExtensions(line),
    polygon = [...start, ...line.points, ...end];
  const from = perimeter(end),
    rawTo = perimeter(start),
    to = rawTo < from ? rawTo + 4 : rawTo;
  const corners: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (let t = Math.floor(from) + 1; t < to; t++) polygon.push(...corners[t % 4]);
  polygon.push(...start);
  return polygon;
}

function inside(points: readonly number[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const ax = points[i],
      ay = points[i + 1],
      bx = points[j],
      by = points[j + 1];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

/** Cell-centre sampling, north-west origin, row-major; 1 means sea. */
export function rasterizeCoastTrace(trace: CoastTrace, n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 1 || n > 4096) throw new Error('Invalid coast trace grid size.');
  const mask = new Uint8Array(n * n),
    open = trace.lines.filter(l => !l.closed),
    loops = trace.lines.filter(l => l.closed);
  const polygons = open.map(coastTracePolygon),
    baseSea = !open.length && loops.some(l => !l.flipped);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n,
        v = (y + 0.5) / n;
      let sea = baseSea;
      for (let j = 0; j < open.length; j++)
        if (inside(polygons[j], u, v) !== open[j].flipped) {
          sea = true;
          break;
        }
      for (const loop of loops) if (inside(loop.points, u, v)) sea = loop.flipped;
      mask[y * n + x] = sea ? 1 : 0;
    }
  return mask;
}

const modeCache = new WeakMap<CoastTrace, { key: string; mode: string | undefined }>();
export function coastTraceMode(trace: CoastTrace, n = 96): string | undefined {
  if (!trace.lines.length) return undefined;
  // Forms read effective settings repeatedly; also detect in-place edits from JSON or the editor.
  const key = `${n}:${JSON.stringify(trace)}`,
    saved = modeCache.get(trace);
  if (saved?.key === key) return saved.mode;
  const mask = rasterizeCoastTrace(trace, n);
  if (!mask.some(v => v === 1) || !mask.some(v => v === 0)) {
    modeCache.set(trace, { key, mode: undefined });
    return undefined;
  }
  const mode = encodeSeaMask(mask, n);
  modeCache.set(trace, { key, mode });
  return mode;
}

/** Same north-west, row-major, low-bit-first format as traced coast geometry. */
export function encodeSeaMask(mask: Uint8Array, n: number): string | undefined {
  if (!mask.some(Boolean)) return undefined;
  const bytes = new Uint8Array(Math.ceil((n * n) / 8));
  for (let i = 0; i < mask.length; i++) bytes[i >> 3] |= mask[i] << (i & 7);
  const mode = `traced:${n}:${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
  return mode;
}

/** Painted sea and traced sea share one field; compass directions add edge seas. */
export function seaCoastInputs(zones: TerrainZones | undefined, trace: CoastTrace | undefined, coastMask: number, islandMode: string | undefined): { coastMask: number; islandMode: string | undefined } {
  const n = 96;
  let traced: Uint8Array = emptySea,
    painted: Uint8Array = emptySea;
  // Forms ask for effective settings for each field. Reuse rasters while still
  // detecting in-place edits from JSON, without caching the user's compass.
  if (trace && coastTraceMode(trace)) {
    const key = JSON.stringify(trace),
      saved = seaTraceCache.get(trace);
    if (saved?.key === key) traced = saved.mask;
    else {
      traced = rasterizeCoastTrace(trace, n);
      seaTraceCache.set(trace, { key, mask: traced });
    }
  }
  if (zones) {
    const count = zones.resolution ** 2,
      saved = seaZoneCache.get(zones);
    let same = saved?.sea.length === count;
    if (same)
      for (let i = 0; i < count; i++)
        if (saved!.sea[i] !== zones.weights[i * 5]) {
          same = false;
          break;
        }
    if (same) painted = saved!.mask;
    else {
      const sea = Uint8Array.from({ length: count }, (_, i) => zones.weights[i * 5]);
      painted = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) painted[y * n + x] = sampleZone(zones, (x + 0.5) / n, (y + 0.5) / n, 0) >= 128 ? 1 : 0;
      seaZoneCache.set(zones, { sea, mask: painted });
    }
  }
  if (!seaUnionCache || seaUnionCache.traced !== traced || seaUnionCache.painted !== painted) {
    const mask = Uint8Array.from(traced, (value, i) => value | painted[i]);
    seaUnionCache = { traced, painted, mode: encodeSeaMask(mask, n) };
  }
  const mode = seaUnionCache.mode;
  return mode ? { coastMask: coastMask > 0 && coastMask < 255 ? coastMask : 255, islandMode: mode } : { coastMask, islandMode };
}

const emptySea = new Uint8Array(96 * 96);
const seaTraceCache = new WeakMap<CoastTrace, { key: string; mask: Uint8Array }>();
const seaZoneCache = new WeakMap<TerrainZones, { sea: Uint8Array; mask: Uint8Array }>();
let seaUnionCache: { traced: Uint8Array; painted: Uint8Array; mode: string | undefined } | undefined;

/** Reject tiny strokes, close near-returning loops, and select the smaller sea
 * region of an open line once at creation (96² cell-centre area estimate). */
export function lineFromStroke(stroke: readonly number[]): CoastTraceLine | undefined {
  if (stroke.length < 4 || stroke.length % 2 || stroke.some(v => !Number.isFinite(v))) return undefined;
  const clipped = stroke.map(v => Math.max(0, Math.min(1, v)));
  let length = 0;
  for (let i = 2; i < clipped.length; i += 2) length += Math.hypot(clipped[i] - clipped[i - 2], clipped[i + 1] - clipped[i - 1]);
  if (length < 0.03) return undefined;
  const closed = length > 0.15 && Math.hypot(clipped[0] - clipped[clipped.length - 2], clipped[1] - clipped[clipped.length - 1]) <= 0.05;
  const points = simplifyStroke(clipped);
  if (closed && points[0] === points[points.length - 2] && points[1] === points[points.length - 1]) points.splice(-2);
  if (points.length < (closed ? 6 : 4)) return undefined;
  const line: CoastTraceLine = { points, closed, flipped: false };
  if (!closed) {
    const mask = rasterizeCoastTrace({ version: 1, lines: [line] }, 96);
    line.flipped = mask.reduce((a, v) => a + v, 0) > mask.length / 2;
  }
  return line;
}

/** Distance to the visible line, including its border extensions, for selection. */
export function coastTraceLineDistance(line: CoastTraceLine, x: number, y: number): number {
  const p = line.closed ? [...line.points, ...line.points.slice(0, 2)] : [...coastTraceExtensions(line)[0], ...line.points, ...coastTraceExtensions(line)[1]];
  let distance = Infinity;
  for (let i = 2; i < p.length; i += 2) distance = Math.min(distance, segmentDistanceSquared(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]));
  return Math.sqrt(distance);
}
