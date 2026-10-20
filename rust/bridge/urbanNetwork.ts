import type { Layout, Shape, Street } from './urban';
import type { Point, RoadOutput } from './settlements';

type Bounds = [number, number, number, number];
const EPS = 1e-8;
const bounds = (points: Point[]): Bounds => points.reduce<Bounds>((b, p) => [
  Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y),
], [Infinity, Infinity, -Infinity, -Infinity]);
const overlaps = (a: Bounds, b: Bounds): boolean => a[0] <= b[2] + EPS && a[2] >= b[0] - EPS && a[1] <= b[3] + EPS && a[3] >= b[1] - EPS;
const interpolate = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const same = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

function oriented(ring: Point[], positive: boolean): Point[] {
  const area = ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.y - p.y * q.x;
  }, 0);
  return (area >= 0) === positive ? ring : [...ring].reverse();
}

/** Native ownership for both transport clipping and an SVG nonzero union mask.
 * Allocated land leaves water holes open unless an explicit crossing owns them.
 * Legacy layouts retain quarter ownership; a growth reserve never hides a road.
 */
export function urbanRoadOwnership(layouts: Layout[]): Shape[] {
  const shapes: Shape[] = [];
  for (const layout of layouts) {
    const allocated = layout.structure && layout.structure.mechanism !== 'legacy' ? layout.structure.allocated : layout.quarters.map(q => q.shape);
    for (const shape of allocated) if (shape.outer.length >= 3) {
      shapes.push({ outer: oriented(shape.outer, true), holes: shape.holes.map(hole => oriented(hole, false)) });
    }
    for (const street of layout.streets) {
      if (!['bridge', 'ford', 'causeway'].includes(street.role)) continue;
      for (let i = 1; i < street.path.length; i++) {
        const a = street.path[i - 1], b = street.path[i];
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length <= EPS) continue;
        const wa = street.widths[i - 1] ?? street.widths.at(-1) ?? 3, wb = street.widths[i] ?? wa;
        // The SVG draws a constant width per segment. Taking its widest end
        // also contains variable-width ribbons, plus one metre for the casing.
        const halfWidth = Math.max(0, wa, wb) * 0.5 + 1;
        const nx = -dy / length * halfWidth, ny = dx / length * halfWidth;
        shapes.push({ outer: [
          { x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny },
          { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny },
        ], holes: [] });
      }
    }
  }
  return shapes;
}

/** Boundary is zero, interior one, exterior minus one. */
function inRing(point: Point, ring: Point[]): number {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length > EPS && Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) <= EPS * length
      && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
      && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS) return 0;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * dx / dy) inside = !inside;
  }
  return inside ? 1 : -1;
}

function inShape(point: Point, shape: Shape): boolean {
  // Shared outer edges and the banks bounding a hole belong to the urban plan;
  // the actual hole stays outside unless a separate native crossing owns it.
  return inRing(point, shape.outer) >= 0 && !shape.holes.some(hole => inRing(point, hole) > 0);
}

function cutsAtRing(a: Point, b: Point, ring: Point[], cuts: number[]): void {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[j], d = ring[i], ex = d.x - c.x, ey = d.y - c.y;
    const det = dx * ey - dy * ex;
    if (Math.abs(det) > 1e-12 * Math.sqrt(length2 * (ex * ex + ey * ey))) {
      const cx = c.x - a.x, cy = c.y - a.y;
      const t = (cx * ey - cy * ex) / det, u = (cx * dy - cy * dx) / det;
      if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) cuts.push(t);
    } else if (Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) <= EPS * Math.sqrt(length2)) {
      // A road following a district edge changes ownership at its endpoints.
      for (const p of [c, d]) {
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
  }
}

/** Avoid doubled regional pieces even when their input vertices differ. */
function uncovered(a: Point, b: Point, covered: Map<string, [number, number][]>): [number, number][] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  if (ux < -EPS || Math.abs(ux) <= EPS && uy < 0) { ux = -ux; uy = -uy; }
  const line = `${Math.round(ux * 1e9)},${Math.round(uy * 1e9)},${Math.round((ux * a.y - uy * a.x) * 1e7)}`;
  const from = ux * a.x + uy * a.y, to = ux * b.x + uy * b.y;
  const lo = Math.min(from, to), hi = Math.max(from, to), intervals = covered.get(line) ?? [];
  const remaining: [number, number][] = [];
  let cursor = lo;
  for (const [start, end] of intervals) {
    if (end <= cursor + EPS) continue;
    if (start >= hi - EPS) break;
    if (start > cursor + EPS) remaining.push([cursor, Math.min(start, hi)]);
    cursor = Math.max(cursor, end);
    if (cursor >= hi - EPS) break;
  }
  if (cursor < hi - EPS) remaining.push([cursor, hi]);
  intervals.push([lo, hi]); intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of intervals) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  covered.set(line, merged);
  return remaining.map(([start, end]): [number, number] => {
    const a = (start - from) / (to - from), b = (end - from) / (to - from);
    return [Math.min(a, b), Math.max(a, b)];
  }).sort((a, b) => a[0] - b[0]);
}

/** Keep original regional geometry outside attributed land and crossing ribbons.
 * This is a downstream view; neither RoadOutput nor the generation inputs change.
 * Type-only imports keep this adapter usable without loading the Rust WASM engine.
 */
export function outsideUrbanStreets(streets: Street[], layouts: Layout[]): Street[] {
  return prepareUrbanRoadClip(layouts)(streets);
}

/** Prepare an immutable layout snapshot once for all regional roads and display styles.
 * Each call retains its own duplicate coverage, including independent bridge artwork.
 */
export function prepareUrbanRoadClip(layouts: Layout[]): (streets: Street[]) => Street[] {
  const masks = urbanRoadOwnership(layouts).map(shape => ({ shape, bounds: bounds(shape.outer) }));
  return streets => clipUrbanStreets(streets, masks);
}

function clipUrbanStreets(streets: Street[], masks: { shape: Shape; bounds: Bounds }[]): Street[] {
  const result: Street[] = [], covered = new Map<string, [number, number][]>();
  for (const street of streets) {
    let path: Point[] = [], widths: number[] = [];
    const flush = (): void => {
      if (path.length > 1) result.push({ path, widths, rank: street.rank, role: street.role });
      path = []; widths = [];
    };
    for (let i = 1; i < street.path.length; i++) {
      const a = street.path[i - 1], b = street.path[i];
      if (same(a, b)) continue;
      const segmentBounds: Bounds = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
      const relevant = masks.filter(mask => overlaps(mask.bounds, segmentBounds));
      const cuts = [0, 1];
      for (const { shape } of relevant) {
        cutsAtRing(a, b, shape.outer, cuts);
        for (const hole of shape.holes) cutsAtRing(a, b, hole, cuts);
      }
      cuts.sort((a, b) => a - b);
      const unique = cuts.filter((t, j) => j === 0 || t - cuts[j - 1] > 1e-10);
      const wa = street.widths[i - 1] ?? street.widths.at(-1) ?? 4;
      const wb = street.widths[i] ?? wa;
      for (let j = 1; j < unique.length; j++) {
        const from = unique[j - 1], to = unique[j];
        const mid = interpolate(a, b, (from + to) * 0.5);
        if (relevant.some(mask => inShape(mid, mask.shape))) { flush(); continue; }
        const start = interpolate(a, b, from), end = interpolate(a, b, to);
        if (same(start, end)) continue;
        const spans = uncovered(start, end, covered);
        if (!spans.length) { flush(); continue; }
        for (const [lo, hi] of spans) {
          const p = interpolate(start, end, lo), q = interpolate(start, end, hi);
          if (path.length && !same(path[path.length - 1], p)) flush();
          if (!path.length) { path.push(p); widths.push(wa + (wb - wa) * (from + (to - from) * lo)); }
          path.push(q); widths.push(wa + (wb - wa) * (from + (to - from) * hi));
        }
      }
    }
    flush();
  }
  return result;
}

export function regionalOutsideUrban(roads: RoadOutput | undefined, layouts: Layout[]): Street[] {
  return outsideUrbanStreets(roads?.segments.map(segment => ({
    path: segment.path,
    widths: segment.path.map(() => segment.width),
    rank: segment.class === 'highway' ? 0 : segment.class === 'main' ? 1 : 2,
    role: 'regional',
  })) ?? [], layouts);
}
