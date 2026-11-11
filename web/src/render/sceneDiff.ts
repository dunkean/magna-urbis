/**
 * Changed areas between two scenes of the same map, for dirty-region redraws: a town build or edit replaces the
 * World (new objects everywhere) but changes geometry only around the town and its countryside. Geometry is
 * compared by content (coordinate hashes), so rebuilt but identical layers are clean.
 * Pure (no DOM): `undefined` means "not comparable, redraw everything".
 */
import type { Polygon, Polyline, Vec2, World } from '../gen/types';
import type { Scene, PolyLayer, LineLayer, TextureLayer } from './scene';
import type { Rect } from './tileindex';

const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
/** Two independent 32-bit hashes over the exact coordinate bits. */
function mix(h: [number, number], v: number): void {
  F64[0] = v;
  h[0] = Math.imul(h[0] ^ U32[0], 0x01000193) ^ U32[1]; h[0] = Math.imul(h[0], 0x85ebca6b);
  h[1] = Math.imul(h[1] + U32[1], 0x9e3779b1) ^ (U32[0] >>> 7); h[1] = Math.imul(h[1] ^ (h[1] >>> 13), 0xc2b2ae35);
}
function addRing(h: [number, number], ring: readonly Vec2[] | undefined): void {
  if (!ring) { mix(h, -1); return; }
  mix(h, ring.length);
  for (const p of ring) { mix(h, p.x); mix(h, p.y); }
}
/** Content key of a ring with its holes (and an optional extra number, e.g. a strip angle). */
export function shapeKey(ring: readonly Vec2[], holes?: readonly (readonly Vec2[])[], extra?: number): string {
  const h: [number, number] = [0x811c9dc5, 0x2545f491];
  addRing(h, ring);
  mix(h, holes?.length ?? 0); for (const hole of holes ?? []) addRing(h, hole);
  if (extra !== undefined) mix(h, extra);
  return `${h[0] >>> 0}.${h[1] >>> 0}.${ring.length}`;
}
const boxOf = (ring: readonly Vec2[]): Rect => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  return { minX, minY, maxX, maxY };
};
/** Boxes of the shapes present in one list and not the other (multiset by content key). */
export function changedShapes<T>(a: readonly T[], b: readonly T[], key: (item: T) => string, ring: (item: T) => readonly Vec2[], out: Rect[]): void {
  const counts = new Map<string, number>();
  const keysA = a.map(key);
  for (const k of keysA) counts.set(k, (counts.get(k) ?? 0) + 1);
  const keysB = b.map(key);
  for (const k of keysB) counts.set(k, (counts.get(k) ?? 0) - 1);
  if ([...counts.values()].every(c => c === 0)) return;
  const left = new Map(counts);
  for (let i = 0; i < a.length; i++) { const c = left.get(keysA[i])!; if (c > 0) { left.set(keysA[i], c - 1); out.push(boxOf(ring(a[i]))); } }
  for (let i = 0; i < b.length; i++) { const c = left.get(keysB[i])!; if (c < 0) { left.set(keysB[i], c + 1); out.push(boxOf(ring(b[i]))); } }
}
const polyItems = (l: PolyLayer | undefined) => (l?.polys ?? []).map((poly, i) => ({ poly, holes: l!.holes?.[i] }));
const lineKey = (l: LineLayer): string => `${l.name}|${l.role}|${l.kind}|${l.width}`;
const textureItems = (l: TextureLayer | undefined) => l?.areas ?? [];

/** Merge boxes closer than `gap` (fewer, larger dirty rects; tile tests stay cheap). */
export function mergeRects(rects: readonly Rect[], gap = 64, limit = 128): Rect[] {
  let out = rects.filter(r => Number.isFinite(r.minX) && Number.isFinite(r.maxX)).map(r => ({ ...r }));
  for (let g = gap; ; g *= 2) {
    let merged = true;
    while (merged) {
      merged = false;
      out.sort((p, q) => p.minX - q.minX);
      const next: Rect[] = [];
      for (const r of out) {
        const hit = next.find(o => r.minX <= o.maxX + g && r.maxX >= o.minX - g && r.minY <= o.maxY + g && r.maxY >= o.minY - g);
        if (hit) { hit.minX = Math.min(hit.minX, r.minX); hit.minY = Math.min(hit.minY, r.minY); hit.maxX = Math.max(hit.maxX, r.maxX); hit.maxY = Math.max(hit.maxY, r.maxY); merged = true; }
        else next.push(r);
      }
      out = next;
    }
    if (out.length <= limit) return out;
  }
}

/** Areas whose drawing differs between `prev` and `next`; [] when identical, undefined when not comparable. */
export function sceneDirty(prev: Scene, next: Scene): Rect[] | undefined {
  if (prev.mapSize !== next.mapSize || prev.tileSize !== next.tileSize || !!prev.earthStreets !== !!next.earthStreets || !!prev.renderedWorld !== !!next.renderedWorld) return undefined;
  const out: Rect[] = [];
  for (const name of new Set([...prev.poly.keys(), ...next.poly.keys()])) {
    const a = prev.poly.get(name), b = next.poly.get(name);
    if (a === b) continue;
    changedShapes(polyItems(a), polyItems(b), s => shapeKey(s.poly, s.holes), s => s.poly, out);
  }
  const linesA = new Map<string, Polyline[]>(), linesB = new Map<string, Polyline[]>();
  for (const l of prev.lines) linesA.set(lineKey(l), [...(linesA.get(lineKey(l)) ?? []), ...l.lines]);
  for (const l of next.lines) linesB.set(lineKey(l), [...(linesB.get(lineKey(l)) ?? []), ...l.lines]);
  for (const key of new Set([...linesA.keys(), ...linesB.keys()]))
    changedShapes(linesA.get(key) ?? [], linesB.get(key) ?? [], line => shapeKey(line), line => line, out);
  const kinds = new Set([...prev.textures.map(t => t.kind), ...next.textures.map(t => t.kind)]);
  for (const kind of kinds)
    changedShapes(textureItems(prev.textures.find(t => t.kind === kind)), textureItems(next.textures.find(t => t.kind === kind)),
      a => shapeKey(a.poly, a.holes, a.stripAngle), a => a.poly, out);
  if (prev.furrows !== next.furrows)
    changedShapes(prev.furrows?.areas ?? [], next.furrows?.areas ?? [], a => shapeKey(a.poly, a.holes, a.angle), a => a.poly, out);
  const da = prev.density, db = next.density;
  if (da !== db) {
    if (!da || !db || da.w !== db.w || da.cell !== db.cell) return undefined;
    for (let i = 0; i < da.cov.length; i++) if (da.cov[i] !== db.cov[i]) {
      const x = (i % da.w) * da.cell, y = Math.floor(i / da.w) * da.cell;
      out.push({ minX: x, minY: y, maxX: x + da.cell, maxY: y + da.cell });
    }
  }
  return mergeRects(out);
}

/** World products the overlay draws outside the scene: bridges and settlements (site markers, labels, clearings). */
export function worldDirty(prev: World, next: World, reach = 0): Rect[] {
  const out: Rect[] = [];
  const bridge = (b: { a: Vec2; b: Vec2; width: number }): Polygon => [b.a, b.b, { x: b.width, y: 0 }];
  changedShapes(prev.bridges ?? [], next.bridges ?? [], b => shapeKey(bridge(b)), b => [b.a, b.b], out);
  const place = (s: NonNullable<World['settlements']>[number]): Polygon => [s.center, { x: s.radius, y: s.population }, ...(s.extent ?? [])];
  changedShapes(prev.settlements ?? [], next.settlements ?? [], s => `${s.key}|${s.name ?? ''}|${s.cls}|${s.detail}|${shapeKey(place(s))}`,
    s => [{ x: s.center.x - s.radius - reach, y: s.center.y - s.radius - reach }, { x: s.center.x + s.radius + reach, y: s.center.y + s.radius + reach }, ...(s.extent ?? [])], out);
  return out;
}
