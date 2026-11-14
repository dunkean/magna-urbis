/**
 * Room the forest leaves for circulation, water and settlements; one rule for every style.
 *
 * - Country road or larger: tree centres stay out of a corridor of half width
 *   `width / 2 + ROAD_MARGIN`, a clearing through the forest.
 * - Smaller road, lane or track: a covered way. No tree is rooted on the way itself, the stands run up to it and the
 *   crowns of both sides close over it: it shows in the gaps of the canopy, never as a cleared line.
 * - River: the same with `RIVER_MARGIN`; the bank keeps its trees, which may hang over the water.
 * - A per-tree offset of up to ±EDGE_JITTER moves each centre limit, so crowns overhang the corridor
 *   edge unevenly: the road or river disappears a little under some crowns, never under a closed canopy.
 * - Farmstead: its lot (or yard) and buildings, grown by FARM_MARGIN, are cleared like a town reserve.
 *   Trees planted by the farm itself (orchards, shelter belts) are drawn by the farm, not by the forest.
 */
import type { Polygon, Polyline, Vec2, World, LandUseLayer } from '../gen/types';

const ROAD_WIDTH: Record<string, number> = { major: 8, minor: 3.6, track: 3 };
export const ROAD_MARGIN = 2.5, RIVER_MARGIN = 1.5, EDGE_JITTER = 1.5, FARM_MARGIN = 5;
/** Clearings hold back most of a crown, leaving a small, irregular overhang (the 3D forest's existing rule). */
const CROWN_SETBACK_MIN = .7, CROWN_SETBACK_SPREAD = .3;
export const forestCrownSetback = (radius: number, u: number): number => (CROWN_SETBACK_MIN + CROWN_SETBACK_SPREAD * u) * radius;
export const FOREST_CROWN_SETBACK_GLSL = `float forestCrownSetback(float radius,float u){return (${CROWN_SETBACK_MIN}+${CROWN_SETBACK_SPREAD}*u)*radius;}`;

export interface ForestCorridor { path: Polyline; half: number | number[]; /** A way under the canopy: no rooted tree on it, no clearing beside it. */ covered?: boolean; /** Hold crowns back at a cleared road; rivers keep their existing overhang. */ crownSetback?: boolean }
/** Roads at least this wide (m) open a corridor in the forest; narrower earth ways run under the canopy. */
export const CLEARING_ROAD_WIDTH = 6;
/** Room a way takes in the forest. Regional classes decide explicitly; town streets use their width or pavement. */
export const roadCorridor = (path: Polyline, width: number, cleared = width >= CLEARING_ROAD_WIDTH): ForestCorridor =>
  cleared ? { path, half: width / 2 + ROAD_MARGIN, crownSetback: true } : { path, half: Math.max(1, width / 2), covered: true };
/** Projected and native regional classes share the same policy, independent of paving or physical width. */
export const regionalRoadCorridor = (path: Polyline, width: number, kind: string): ForestCorridor =>
  roadCorridor(path, width, kind !== 'track' && kind !== 'trail' && kind !== 'path');
/** A town street as the generator sends it (rust/bridge/urban.ts `Street`). */
type TownStreet = { path: Polyline; widths: readonly number[]; role: string };
/** The streets of one town as corridors, by street index with their surface ('asphalt' or 'earth'; roadPavement.ts):
 * no tree is rooted on any street; a paved street clears its sides, an earth one runs under the crowns. Tracks are
 * never paved. */
export function streetCorridors(streets: readonly TownStreet[], pavements?: readonly string[]): ForestCorridor[] {
  const out: ForestCorridor[] = [];
  streets.forEach((s, i) => {
    if (s.path.length < 2) return;
    const widths = s.widths.filter(w => Number.isFinite(w) && w > 0), width = widths.length ? Math.max(...widths) : 3;
    out.push(roadCorridor(s.path, Math.max(3, width), s.role !== 'track' && (width >= CLEARING_ROAD_WIDTH || pavements?.[i] === 'asphalt')));
  });
  return out;
}

/** Clear yard (m, beyond the walls) kept free of rooted crowns around the buildings of an isolated activity site (chapel,
 * quarry, mill, fishing hut): their crowns still overhang it from the edge, so the site reads as a clearing, not as a
 * building lost in the canopy. */
export const YARD_MARGIN = 8;
/** Logging, charcoal and resin sites work inside the forest and keep their trees. */
const WOODLAND_SITE = /^(forest_|resin_)/;
type RegionSites = { placement?: { activities?: ActivitySiteRings[] }; roads?: { nodes?: ActivitySiteRings[] } | null };
type ActivitySiteRings = { template: string; buildings: { ring: Vec2[] }[] };
/** One closed corridor along each building outline of the retained regional activity sites and network nodes. */
function yardCorridors(region: RegionSites | undefined): ForestCorridor[] {
  const out: ForestCorridor[] = [];
  for (const site of [...region?.placement?.activities ?? [], ...region?.roads?.nodes ?? []]) {
    if (WOODLAND_SITE.test(site.template)) continue;
    for (const building of site.buildings ?? []) if (building.ring?.length > 2) out.push({ path: [...building.ring, building.ring[0]], half: YARD_MARGIN });
  }
  return out;
}

/** Road and river corridors of a world, as centre lines with their cleared half widths (m). The satellite
 * ground leaves rivers out: its water mask already keeps trunks off the water and lets crowns overhang it. */
export function forestCorridors(world: Pick<World, 'roads' | 'terrain'> & Partial<Pick<World, 'debug'>>, rivers = true,
  /** Further ways, such as the streets of the towns (streetCorridors). */
  extra: readonly ForestCorridor[] = []): ForestCorridor[] {
  const out: ForestCorridor[] = yardCorridors(world.debug?.v2RustRegion as RegionSites | undefined);
  for (const road of world.roads ?? []) if (road.path.length > 1) {
    // The drawn width (render/scene.ts) where the network carries none.
    const width = road.width > 0 ? road.width : ROAD_WIDTH[road.kind] ?? 3;
    // Even a narrow unpaved country road clears its canopy; tracks keep their covered character at any width.
    out.push(regionalRoadCorridor(road.path, width, road.kind));
  }
  out.push(...extra);
  if (rivers) for (const river of world.terrain?.rivers ?? []) if (river.path.length > 1)
    out.push({ path: river.path, half: river.path.map((_, i) => (river.width[i] ?? river.width[river.width.length - 1] ?? 0) / 2 + RIVER_MARGIN) });
  return out;
}

/** Convex miter offset of a ring by `d` metres, whatever its winding. */
export function growRing(ring: Polygon, d: number): Polygon {
  const n = ring.length; if (n < 3) return ring;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  const s = area > 0 ? 1 : -1;
  const normal = (a: Vec2, b: Vec2): Vec2 => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: s * dy / l, y: -s * dx / l }; };
  return ring.map((p, i) => {
    const n1 = normal(ring[(i + n - 1) % n], p), n2 = normal(p, ring[(i + 1) % n]), k = 1 + n1.x * n2.x + n1.y * n2.y;
    const f = d / Math.max(k, .25);
    return { x: p.x + (n1.x + n2.x) * f, y: p.y + (n1.y + n2.y) * f };
  });
}

/** Cleared ground of every farmstead: lot (or yard) and buildings, grown by FARM_MARGIN. */
export function farmClearings(landuse: Pick<LandUseLayer, 'farmsteads'> | undefined): Polygon[] {
  const out: Polygon[] = [];
  for (const farm of landuse?.farmsteads ?? []) {
    const ground = farm.lot ?? farm.yard;
    if (ground?.length > 2) out.push(growRing(ground, FARM_MARGIN));
    for (const building of farm.buildings) if (building.length > 2) out.push(growRing(building, FARM_MARGIN));
  }
  return out;
}

/** Point queries against corridors and farm clearings (vector canopies). */
export class ForestRoom {
  private readonly cells = new Map<number, number[]>();
  private readonly segs: number[] = [];   // ax, ay, bx, by, ha, hb, flags (1 crown setback, 2 covered)
  private readonly farms: { ring: Polygon; holes?: Polygon[]; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  private readonly farmCells = new Map<number, number[]>();
  constructor(corridors: readonly ForestCorridor[], farms: readonly (Polygon | { poly: Polygon; holes?: Polygon[] })[], private readonly cell = 64) {
    for (const c of corridors) for (let i = 1; i < c.path.length; i++) {
      const a = c.path[i - 1], b = c.path[i], ha = typeof c.half === 'number' ? c.half : c.half[i - 1], hb = typeof c.half === 'number' ? c.half : c.half[i];
      const id = this.segs.length / 7; this.segs.push(a.x, a.y, b.x, b.y, ha, hb, (c.crownSetback ? 1 : 0) | (c.covered ? 2 : 0));
      const r = Math.max(ha, hb) + EDGE_JITTER;
      this.addBox(this.cells, id, Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r);
    }
    for (const shape of farms) {
      const ring = Array.isArray(shape) ? shape : shape.poly, holes = Array.isArray(shape) ? undefined : shape.holes;
      const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
      const box = { ring, holes, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
      this.addBox(this.farmCells, this.farms.length, box.minX, box.minY, box.maxX, box.maxY); this.farms.push(box);
    }
  }
  private addBox(map: Map<number, number[]>, id: number, x0: number, y0: number, x1: number, y1: number): void {
    for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++) for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
      const key = j * 65536 + i; let list = map.get(key); if (!list) map.set(key, list = []); list.push(id);
    }
  }
  /** True when a tree centred at (x, y) keeps its place; `u` in [0, 1] is the tree's own hash for the ragged edge. */
  keeps(x: number, y: number, u: number, radius = 0): boolean {
    const key = Math.floor(y / this.cell) * 65536 + Math.floor(x / this.cell), s = this.segs;
    // Query the crown's reach too: a large crown can lean into a corridor indexed in the neighbouring cell.
    for (let j = Math.floor((y - radius) / this.cell); j <= Math.floor((y + radius) / this.cell); j++)
    for (let i = Math.floor((x - radius) / this.cell); i <= Math.floor((x + radius) / this.cell); i++)
    for (const id of this.cells.get(j * 65536 + i) ?? []) {
      const o = id * 7, ax = s[o], ay = s[o + 1], dx = s[o + 2] - ax, dy = s[o + 3] - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      // A covered way has no ragged clearing edge: keep every trunk off its bed, as the 3D root query does.
      const jitter = (s[o + 6] & 2) ? 0 : (u * 2 - 1) * EDGE_JITTER;
      const half = Math.max(0, s[o + 4] + (s[o + 5] - s[o + 4]) * t + jitter)
        + ((s[o + 6] & 1) ? forestCrownSetback(radius, u) : 0);
      if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 < half * half) return false;
    }
    for (const id of this.farmCells.get(key) ?? []) {
      const f = this.farms[id];
      if (x >= f.minX && x <= f.maxX && y >= f.minY && y <= f.maxY && inside(f.ring, x, y) && !f.holes?.some(h => inside(h, x, y))) return false;
    }
    return true;
  }
}
function inside(ring: Polygon, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
