import type { Polyline, Vec2 } from '../types';
import type { FieldNet } from './fields';

/** Bridge the unploughed verge between a partition's lane and an existing
 * road. Candidate lookup is spatial; the caller certifies the entire short
 * link against actual land polygons and water before it can become a track. */
export function connectFieldWays(net: FieldNet, connectors: { path: Polyline; width: number }[],
  reach: number, clear: (a: Vec2, b: Vec2) => boolean): number {
  const cell = Math.max(64, reach), buckets = new Map<string, number[]>();
  const segments: { a: Vec2; b: Vec2 }[] = [];
  for (const road of connectors) for (let i = 1; i < road.path.length; i++) {
    const a = road.path[i - 1], b = road.path[i], id = segments.length;
    segments.push({ a, b });
    for (let y = Math.floor(Math.min(a.y, b.y) / cell); y <= Math.floor(Math.max(a.y, b.y) / cell); y++) {
      for (let x = Math.floor(Math.min(a.x, b.x) / cell); x <= Math.floor(Math.max(a.x, b.x) / cell); x++) {
        const key = `${x}:${y}`, entries = buckets.get(key);
        if (entries) entries.push(id); else buckets.set(key, [id]);
      }
    }
  }
  let links = 0;
  for (const way of net.ways) {
    const candidates: { a: Vec2; b: Vec2; d: number }[] = [];
    for (const p of [way[0], way[way.length - 1]]) {
      if (!p) continue;
      const seen = new Set<number>();
      for (let y = Math.floor((p.y - reach) / cell); y <= Math.floor((p.y + reach) / cell); y++) {
        for (let x = Math.floor((p.x - reach) / cell); x <= Math.floor((p.x + reach) / cell); x++) {
          for (const id of buckets.get(`${x}:${y}`) ?? []) {
            if (seen.has(id)) continue;
            seen.add(id);
            const { a, b } = segments[id], dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            const q = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d > .01 && d <= reach) candidates.push({ a: p, b: q, d });
          }
        }
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const chosen = candidates.find(({ a, b }) => clear(a, b));
    if (chosen) {
      if (chosen.a === way[0]) way.unshift(chosen.b); else way.push(chosen.b);
      links++;
    }
  }
  return links;
}
