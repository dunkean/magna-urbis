import type { Layout, Point, Street } from '../../../rust/bridge/urban';
import type { RoadOutput } from '../../../rust/bridge/settlements';
import { urbanRoadOwnership } from '../../../rust/bridge/urbanNetwork';

/** Dry waterLevel cells contain terrain height. Never interpolate those
 * hillside samples into the water surface beside a bridge abutment. */
export function bridgeWaterHeight(r: { n: number; width: number; water: Uint8Array; waterLevel: Float32Array }, wet: (x: number, y: number) => boolean): (x: number, y: number) => number {
  return (x, y) => {
    if (!wet(x, y)) return NaN;
    const gx = x / r.width * r.n - 0.5, gy = y / r.width * r.n - 0.5, ix = Math.round(gx), iy = Math.round(gy);
    let distance = Infinity, level = NaN;
    for (let j = Math.max(0, iy-2); j <= Math.min(r.n-1, iy+2); j++) for (let i = Math.max(0, ix-2); i <= Math.min(r.n-1, ix+2); i++) {
      const at = j*r.n+i, d = (i-gx)**2+(j-gy)**2;
      if (r.water[at] && d < distance && Number.isFinite(r.waterLevel[at])) { distance = d; level = r.waterLevel[at]; }
    }
    return level;
  };
}

const crossing = (s: Street): boolean => ['bridge', 'ford', 'causeway'].includes(s.role) && s.path.length >= 2;
const distance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const inside = (p: Point, ring: Point[]): boolean => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit = !hit;
  }
  return hit;
};

/** Land where the town draws the roads itself (the regional road is clipped there). */
const OWNERSHIP = new WeakMap<readonly Layout[], (p: Point) => boolean>();
function townOwns(layouts: readonly Layout[]): (p: Point) => boolean {
  let owns = OWNERSHIP.get(layouts);
  if (!owns) {
    const shapes = urbanRoadOwnership(layouts as Layout[]).map(s => {
      const xs = s.outer.map(p => p.x), ys = s.outer.map(p => p.y);
      return { s, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    owns = p => shapes.some(({ s, box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]
      && inside(p, s.outer) && !s.holes.some(h => inside(p, h)));
    OWNERSHIP.set(layouts, owns);
  }
  return owns;
}

/** Native urban crossings own their replaced regional artwork, including an
 * oblique old deck and a bank chord that the native street now skirts on land.
 * A regional deck is also retired when its road was rejected: one of its banks
 * lies where the town draws the roads and no town street meets it there. A deck
 * whose road is still drawn on both banks always stays. */
export function urbanReplacesCrossing(street: Street, layouts: readonly Layout[]): boolean {
  if (!crossing(street)) return false;
  const a = street.path[0], b = street.path[street.path.length - 1], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const owns = townOwns(layouts), served = (p: Point): boolean => layouts.some(l => l.streets.some(s =>
    !['bridge', 'ford', 'causeway', 'pier', 'mole', 'landing'].includes(s.role)
    && s.path.slice(1).some((q, i) => distance(p, s.path[i], q) < 12 + Math.max(0, ...s.widths.filter(Number.isFinite)) / 2)));
  if ([a, b].some(p => owns(p) && !served(p))) return true;
  return layouts.some(l => {
    const direct = l.streets.some(s => {
    if (s.role === 'approach') return [a, b].every(p => s.path.slice(1).some((q, i) => distance(p, s.path[i], q) < 6));
    if (!crossing(s)) return false;
    const p = s.path[0], q = s.path[s.path.length - 1], len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 0.1) return false;
    const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len, project = (v: Point): number => (v.x - p.x) * ux + (v.y - p.y) * uy;
    const lo = Math.min(project(a), project(b)), hi = Math.max(project(a), project(b)), tolerance = Math.max(6, len * 0.3);
    const along = Math.abs((mid.x - p.x) * -uy + (mid.y - p.y) * ux);
    return Math.abs(lo) < tolerance && Math.abs(hi - len) < tolerance && along < Math.min(200, 30 + 2 * len);
    });
    if (direct) return true;
    // A native span may move along a bend to obtain buildable landings. Its
    // bank connections still replace the old regional artwork at that site.
    const near = l.streets.some(s => s.role === 'bridge' && s.path.length >= 2 && Math.hypot(
      (s.path[0].x + s.path[s.path.length - 1].x) / 2 - mid.x, (s.path[0].y + s.path[s.path.length - 1].y) / 2 - mid.y) < 200);
    const reach = Math.max(6, Math.min(50, Math.hypot(b.x - a.x, b.y - a.y) * 0.5));
    return near && [a, b].every(p => l.streets.some(s => !['bridge', 'pier', 'mole', 'landing'].includes(s.role)
      && s.path.slice(1).some((q, i) => distance(p, s.path[i], q) < reach)));
  });
}

/** Extra ownership strips hide the retired regional span in the base road
 * layer. These copies only enter its clipper, never the city data or drawing. */
export function bridgeRoadOwnership(layouts: Layout[], roads?: RoadOutput): Layout[] {
  if (!layouts.length || !roads) return layouts;
  const retired: Street[] = roads.segments.flatMap(s => s.crossings.map(c => ({ path: c.path, widths: c.path.map(() => s.width), rank: 0, role: c.kind })))
    .filter(s => urbanReplacesCrossing(s, layouts));
  return retired.length ? [{ ...layouts[0], streets: [...layouts[0].streets, ...retired] }, ...layouts.slice(1)] : layouts;
}

export function cityBridgeStreets(layouts: readonly Layout[], regional: readonly Street[]): Street[] {
  return [...layouts.flatMap(l => l.streets), ...regional.filter(s => !urbanReplacesCrossing(s, layouts))];
}

/** Regional crossing paths can contain long dry approaches. Only their wet
 * runs and short abutments carry a deck; hills on an approach cannot lift it. */
export function wetBridgeSpans<T extends { path: Point[]; widths: number[]; role: string }>(street: T, waterAt?: (x: number, y: number) => number): T[] {
  if (!waterAt || !['bridge', 'causeway'].includes(street.role) || street.path.length < 2) return [street];
  const points: Point[] = [], widths: number[] = [];
  for (let i = 1; i < street.path.length; i++) {
    const a = street.path[i - 1], b = street.path[i], steps = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y) / 2));
    for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
      points.push({ x: a.x+(b.x-a.x)*j/steps, y: a.y+(b.y-a.y)*j/steps });
      widths.push(street.widths[i - 1] ?? street.widths[0] ?? 3);
    }
  }
  const wet = points.map(p => Number.isFinite(waterAt(p.x, p.y))), runs: T[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!wet[i]) continue;
    const start = Math.max(0, i - 1);
    while (i + 1 < points.length && wet[i + 1]) i++;
    const end = Math.min(points.length - 1, i + 1);
    if (end > start) {
      const ids = [start];
      for (let j = start + 1; j < end; j++) {
        const a = points[ids[ids.length - 1]], b = points[j], c = points[j + 1];
        if (Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)) > 1e-6) ids.push(j);
      }
      ids.push(end);
      runs.push({ ...street, path: ids.map(j => points[j]), widths: ids.map(j => widths[j]) });
    }
  }
  // Retain the original segmentation for a span entirely over water.
  return wet.every(Boolean) ? [street] : runs;
}
