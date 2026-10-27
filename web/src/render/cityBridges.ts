import type { Layout, Point, Street } from '../../../rust/bridge/urban';
import type { RoadOutput } from '../../../rust/bridge/settlements';

const crossing = (s: Street): boolean => ['bridge', 'ford', 'causeway'].includes(s.role) && s.path.length >= 2;
const distance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Native urban crossings own their replaced regional artwork, including an
 * oblique old deck and a bank chord that the native street now skirts on land. */
export function urbanReplacesCrossing(street: Street, layouts: readonly Layout[]): boolean {
  if (!crossing(street)) return false;
  const a = street.path[0], b = street.path[street.path.length - 1], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
