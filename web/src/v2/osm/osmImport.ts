/** OpenStreetMap import: OSM elements + a DEM grid of one square → a V2 recipe and a saved world holding the OSM town
 * (streets, regional roads, buildings with their 3D massing, walls, fences, water, land use, names). Pure: no network,
 * no file system, so the page can run it on what it fetched (osmSources.ts) and the CLI (scripts/osm_probe.mjs) on
 * its cache. The houses take the look of `culture`; the footprints and the OSM heights/levels stay. */
import type { World } from '../../gen/types';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import type { VectorWater } from '../../ui/vectorWater';
import type { RiverLine, RiverNetwork } from '../../ui/riverVectors';
import type { LakeField } from '../../ui/lakeGeometry';
import type { V2Settings } from '../contracts';
import { defaultSettings } from '../settings';
import { acceptHeightmap, imageHeightmap } from '../heightmapModel';
import { V2_ENGINE_VERSION } from '../cache';
import { terrainCacheKey } from '../engine';
import { recordGenerationValidity } from '../stageValidity';
import { urbanCatalogue } from '../urbanControlSchema';
import { createGrid, slopeGrid } from '../../gen/core/grid';
import { priorityFlood, accumulate } from '../../gen/terrain/hydrology';
import { cultureHouseLook } from '../../render/farmRoofs';
import { OSM_ATTRIBUTION, osmProjection, type OsmElement, type OverpassReply } from './osmSources';
import { HIGHWAY, LANDUSE, NATURAL, RIVER_WIDTH, URBAN_LANDUSE } from './osmTags';

export interface OsmImportOptions {
  lat: number;
  lon: number;
  size: number;
  grid: number;
  zoom: number;
  name: string;
  culture: string;
  /** Name of the admin_level=8 boundary in `commune` (log only). */
  communeName?: string;
}
export interface OsmImportInput {
  osm: OverpassReply;
  /** admin_level=8 relation: town content is kept when its centre lies inside it; roads, rivers, water and relief stay. */
  commune?: OsmElement;
  /** DEM, `grid` × `grid`, cell-centred, north-up, metres. */
  elevations: Float32Array;
  options: OsmImportOptions;
}
export interface OsmImport {
  settings: V2Settings;
  world: World;
  source: { attribution: typeof OSM_ATTRIBUTION; osmTimestamp: string; bbox: string; center: { lat: number; lon: number }; size: number };
  summary: Record<string, number>;
  log: string[];
}

type P = { x: number; y: number };
type Area = { outer: P[]; holes: P[][] };
type Tags = Record<string, string>;

/** OSM `roof:shape` → massing roof kind. */
const ROOF: Record<string, string> = { gabled: 'gable', hipped: 'hip', flat: 'flat', dome: 'dome', pyramidal: 'pyramid', conical: 'cone', round: 'barrel', half_hipped: 'hip', skillion: 'flat', mansard: 'hip', gambrel: 'gable', saltbox: 'gable' };
const KIND: Record<string, string> = {
  house: 'domestic',
  detached: 'domestic',
  semidetached_house: 'domestic',
  terrace: 'domestic',
  residential: 'domestic',
  apartments: 'collective',
  farm: 'domestic',
  commercial: 'mixed',
  retail: 'mixed',
  office: 'mixed',
  hotel: 'collective',
  industrial: 'warehouse',
  warehouse: 'warehouse',
  garage: 'workshop',
  garages: 'workshop',
  shed: 'workshop',
  barn: 'workshop',
  farm_auxiliary: 'workshop',
  church: 'collective',
  cathedral: 'collective',
  chapel: 'collective',
  school: 'collective',
  public: 'collective',
  civic: 'collective',
  castle: 'collective',
  tower: 'collective',
};
/** OSM barrier → lot boundary material and default height (m). */
const BARRIER: Record<string, { material: 'fence' | 'wall' | 'hedge'; height: number }> = { fence: { material: 'fence', height: 1.2 }, wall: { material: 'wall', height: 1.8 }, retaining_wall: { material: 'wall', height: 1.2 }, hedge: { material: 'hedge', height: 1.6 } };
const num = (v: unknown): number | undefined => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const round2 = (v: number): number => Math.round(v * 100) / 100;
/** Deterministic 0..1 of a string. */
const unit = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

// ---------- geometry ----------
const signedArea = (ring: readonly P[]): number => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return a / 2;
};
const positive = (ring: P[]): P[] => (signedArea(ring) < 0 ? ring.slice().reverse() : ring);
const openRing = (ring: P[]): P[] => (ring.length > 1 && ring[0].x === ring.at(-1)!.x && ring[0].y === ring.at(-1)!.y ? ring.slice(0, -1) : ring);
const centroid = (ring: readonly P[]): P => {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
};
const length = (path: readonly P[]): number => path.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
const mid = (path: readonly P[]): P => path[Math.floor(path.length / 2)];
function pointInRing(ring: readonly P[], p: P): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const nearPath = (p: P, path: readonly P[], d: number): boolean => path.some((q, i) => i > 0 && segDist(p, path[i - 1], q) < d);
type LatLon = { lat: number; lon: number };
/** Multipolygon members (outer/inner ways) joined into closed rings. */
function joinRings(ways: LatLon[][]): LatLon[][] {
  const rings: LatLon[][] = [],
    open = ways.map(w => w.slice());
  const key = (p: LatLon): string => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  while (open.length) {
    let ring = open.pop()!;
    let guard = 0;
    while (key(ring[0]) !== key(ring.at(-1)!) && guard++ < 10000) {
      const i = open.findIndex(w => key(w[0]) === key(ring.at(-1)!) || key(w.at(-1)!) === key(ring.at(-1)!));
      if (i < 0) break;
      const next = open.splice(i, 1)[0];
      ring = ring.concat(key(next[0]) === key(ring.at(-1)!) ? next.slice(1) : next.slice(0, -1).reverse());
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring.at(-1)!)) rings.push(ring);
  }
  return rings;
}
/** Centre line of a thin polygon: its ring split at the two farthest vertices, the halves resampled and averaged. */
function centreLine(ring: P[]): P[] | null {
  if (ring.length < 4) return null;
  let a = 0,
    b = 0,
    best = -1;
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 1; j < ring.length; j++) {
      const d = Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y);
      if (d > best) [best, a, b] = [d, i, j];
    }
  const side1 = ring.slice(a, b + 1),
    side2 = ring
      .slice(b)
      .concat(ring.slice(0, a + 1))
      .reverse();
  const k = Math.max(2, Math.ceil(best / 4));
  const sample = (path: P[], f: number): P => {
    let target = f * length(path);
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (target <= d || i === path.length - 1) {
        const u = d ? Math.min(1, target / d) : 0;
        return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * u, y: path[i - 1].y + (path[i].y - path[i - 1].y) * u };
      }
      target -= d;
    }
    return path.at(-1)!;
  };
  return Array.from({ length: k + 1 }, (_, i) => {
    const p = sample(side1, i / k),
      q = sample(side2, i / k);
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
}

/** Signed shore distance of a lake mask (cells, + inside), prefiltered into cubic B-spline coefficients: the shape the
 * renderers sample (`lakeSample`, LAKE_GLSL). */
function lakeFieldOf(mask: Uint8Array, n: number): LakeField {
  const distance = new Float32Array(n * n).fill(4);
  const wet = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && !!mask[y * n + x];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const inside = wet(x, y);
      if (wet(x - 1, y) !== inside || wet(x + 1, y) !== inside || wet(x, y - 1) !== inside || wet(x, y + 1) !== inside) distance[y * n + x] = 0.5;
    }
  for (const direction of [1, -1]) {
    const neighbours = [
      [-direction, 0, 1],
      [0, -direction, 1],
      [-direction, -direction, Math.SQRT2],
      [direction, -direction, Math.SQRT2],
    ];
    for (let y = direction > 0 ? 0 : n - 1; y >= 0 && y < n; y += direction)
      for (let x = direction > 0 ? 0 : n - 1; x >= 0 && x < n; x += direction) {
        const i = y * n + x;
        for (const [dx, dy, cost] of neighbours) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) distance[i] = Math.min(distance[i], distance[yy * n + xx] + cost);
        }
      }
  }
  for (let i = 0; i < distance.length; i++) if (!mask[i]) distance[i] = -distance[i];
  const values = Float32Array.from(distance, value => value + 4);
  const inverse = new Float64Array(n),
    rhs = new Float64Array(n);
  inverse[0] = 0.25;
  for (let i = 1; i < n; i++) inverse[i] = 1 / (4 - inverse[i - 1]);
  const filter = (origin: number, stride: number): void => {
    rhs[0] = 6 * values[origin] * inverse[0];
    for (let i = 1; i < n; i++) rhs[i] = (6 * values[origin + i * stride] - rhs[i - 1]) * inverse[i];
    let next = rhs[n - 1];
    values[origin + (n - 1) * stride] = next;
    for (let i = n - 2; i >= 0; i--) {
      next = rhs[i] - inverse[i] * next;
      values[origin + i * stride] = next;
    }
  };
  for (let y = 0; y < n; y++) filter(y * n, 1);
  for (let x = 0; x < n; x++) filter(x, n);
  for (let i = 0; i < values.length; i++) values[i] -= 4;
  return { values, distance, n };
}

/** Town storeys of a culture: its core tissue's `arch.storeys` (catalogue presets), else one to two. */
function cultureStoreys(culture: string): [number, number] {
  const presets = (urbanCatalogue as unknown as { presets?: Record<string, { params?: { arch?: { storeys?: number[] } } }> }).presets ?? {};
  const s = presets[`${culture}/core`]?.params?.arch?.storeys;
  return Array.isArray(s) && s.length === 2 && s[0] >= 1 && s[1] >= s[0] ? [s[0], s[1]] : [1, 2];
}

export function importOsm(input: OsmImportInput): OsmImport {
  const { osm, elevations } = input,
    { lat, lon, size: SIZE, grid: GRID, zoom: ZOOM, name: NAME, culture: CULTURE } = input.options;
  const log: string[] = [];
  const { bbox, project } = osmProjection({ lat, lon, size: SIZE });
  const half = SIZE / 2,
    cell = SIZE / GRID;
  const osmTimestamp = osm.osm3s?.timestamp_osm_base ?? '';
  const pts = (geometry: OsmElement['geometry']): P[] => (geometry ?? []).filter((g): g is LatLon => !!g).map(g => project(g.lat, g.lon));
  const inMap = (p: P, m = 0): boolean => p.x >= -m && p.y >= -m && p.x <= SIZE + m && p.y <= SIZE + m;
  /** Clip a polyline to the map (plus a margin): the runs of consecutive inside points. */
  const clipLine = (path: P[], margin = 30): P[][] => {
    const runs: P[][] = [];
    let run: P[] = [];
    for (const p of path) {
      if (inMap(p, margin)) run.push(p);
      else if (run.length) {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (run.length > 1) runs.push(run);
    return runs;
  };
  const memberRings = (el: OsmElement, inner: boolean): LatLon[][] =>
    joinRings(
      (el.members ?? [])
        .filter(m => m.type === 'way' && (m.role === 'inner') === inner && m.geometry)
        .map(m => m.geometry!.filter((g): g is LatLon => !!g))
        .filter(way => way.length >= 2),
    );
  const areas = (el: OsmElement): Area[] => {
    if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
      const ring = openRing(pts(el.geometry));
      return ring.length >= 3 ? [{ outer: positive(ring), holes: [] }] : [];
    }
    if (el.type === 'relation' && el.members) {
      const holes = memberRings(el, true).map(r => positive(openRing(pts(r))));
      return memberRings(el, false)
        .map(r => ({ outer: positive(openRing(pts(r))), holes }))
        .filter(a => a.outer.length >= 3);
    }
    return [];
  };
  const visible = (a: Area): boolean => a.outer.some(p => inMap(p, 200));
  /** Even-odd scanline fill of one area into a grid mask, at cell centres. */
  const rasterize = (mask: Uint8Array, area: Area, value: number): void => {
    const rings = [area.outer, ...area.holes];
    let y0 = Infinity,
      y1 = -Infinity;
    for (const p of area.outer) {
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    for (let gy = Math.max(0, Math.floor(y0 / cell)); gy <= Math.min(GRID - 1, Math.ceil(y1 / cell)); gy++) {
      const cy = (gy + 0.5) * cell,
        xs: number[] = [];
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (a.y > cy !== b.y > cy) xs.push(((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x);
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let gx = Math.max(0, Math.ceil(xs[k] / cell - 0.5)); gx <= Math.min(GRID - 1, Math.floor(xs[k + 1] / cell - 0.5)); gx++) mask[gy * GRID + gx] = value;
    }
  };

  // ---------- classify OSM elements ----------
  type Building = { poly: P[]; courtyards: P[][]; kind: string; height: number; arch: string; roof: string; storeys: number; material: string; orientation: number; tagged: boolean; osmRoof?: string };
  type Street = { path: P[]; width: number; widths: number[]; kind: string; rank: number; role: string; phase: number; name?: string };
  type Road = { path: P[]; kind: string; width: number; editorId: string; name?: string };
  type Fence = { path: P[]; material: 'fence' | 'wall' | 'hedge'; side: 'side'; height: number; fenceStyle?: 'plank' };
  const streets: Street[] = [],
    roads: Road[] = [],
    bridges: { a: P; b: P; width: number }[] = [],
    buildings: Building[] = [],
    landmarks: { kind: string; poly: P[]; name: string }[] = [],
    squares: Area[] = [],
    wallWays: { path: P[]; closed: boolean }[] = [],
    fences: Fence[] = [],
    towerPoints: P[] = [],
    gatePoints: P[] = [],
    waterAreas: (Area & { river: boolean; name?: string })[] = [],
    riverLines: { path: P[]; width: number; name?: string; type: string }[] = [],
    landAreas: { kind: string; poly: P[]; holes?: P[][] }[] = [],
    footprint: Area[] = [],
    places: { name: string; place: string; p: P }[] = [];
  let roadSerial = 0;
  /** OSM identity and use of each building, for the 3D scene (not written into the world's urban layer). */
  const buildingRoles = new Map<Building, { osmId: string; function: string; curtain: boolean; tower: boolean }>();
  for (const el of osm.elements) {
    const t: Tags = el.tags ?? {};
    if (el.type === 'node') {
      const p = project(el.lat!, el.lon!);
      if (t.barrier === 'city_gate') gatePoints.push(p);
      if (t.man_made === 'tower' || t.historic === 'tower') towerPoints.push(p);
      if (t.place && t.name) places.push({ name: t.name, place: t.place, p });
      continue;
    }
    if (el.type === 'way' && el.geometry && (t['tower:type'] === 'defensive' || t.historic === 'tower')) towerPoints.push(centroid(pts(el.geometry)));
    if (el.type === 'way' && el.geometry && (t.historic === 'city_gate' || t.barrier === 'city_gate')) gatePoints.push(centroid(pts(el.geometry)));
    // Cadastre-traced curtains (Carcassonne): thin building areas tagged defensive_works=curtain_wall, kept as buildings
    // and also turned into wall centre lines.
    if (el.type === 'way' && el.geometry && t.defensive_works === 'curtain_wall') {
      const line = centreLine(openRing(pts(el.geometry)));
      if (line) wallWays.push({ path: line, closed: false });
    }
    if (t.highway && el.type === 'way' && el.geometry) {
      const spec = HIGHWAY[t.highway];
      if (t.area === 'yes' && t.highway === 'pedestrian') {
        squares.push(...areas(el).filter(visible));
        continue;
      }
      if (!spec || t.footway === 'sidewalk' || t.footway === 'crossing') continue;
      const width = num(t.width) ?? spec.width;
      for (const path of clipLine(pts(el.geometry))) {
        if (path.length < 2 || length(path) < 2) continue;
        if (spec.region) roads.push({ path, kind: spec.region, width, editorId: `osm-way-${el.id}-${roadSerial++}`, name: t.name });
        else streets.push({ path, width, widths: path.map(() => width), kind: spec.kind!, rank: spec.rank!, role: spec.role!, phase: 0, name: t.name });
        if (t.bridge && t.bridge !== 'no') bridges.push({ a: path[0], b: path.at(-1)!, width });
      }
      continue;
    }
    if (t.building && t.building !== 'no') {
      for (const a of areas(el)) {
        if (!a.outer.some(p => inMap(p))) continue;
        const levels = num(t['building:levels']) ?? (KIND[t.building] === 'workshop' ? 1 : 2);
        const height = num(t.height) ?? levels * 3.1 + 2;
        let best = 0,
          orientation = 0;
        for (let i = 0; i < a.outer.length; i++) {
          const p = a.outer[i],
            q = a.outer[(i + 1) % a.outer.length],
            d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d > best) {
            best = d;
            orientation = Math.atan2(q.y - p.y, q.x - p.x);
          }
        }
        const religious = ['church', 'cathedral', 'chapel'].includes(t.building) || t.amenity === 'place_of_worship';
        const castle = t.building === 'castle' || t.historic === 'castle';
        // Untagged heights of the fortifications and churches: OSM levels say nothing useful there.
        const tower = t['tower:type'] === 'defensive' || t.historic === 'tower' || t.building === 'tower',
          curtain = t.defensive_works === 'curtain_wall',
          tagged = t.height !== undefined || t['building:levels'] !== undefined;
        const fixedHeight = tagged ? height : tower ? 15 : curtain ? 10 : religious ? 18 : castle ? 16 : height;
        const building: Building = {
          poly: a.outer,
          courtyards: a.holes,
          kind: KIND[t.building] ?? (religious || castle ? 'collective' : 'domestic'),
          height: round2(fixedHeight),
          arch: 'silhouette',
          roof: tower ? 'cone' : curtain ? 'flat' : 'gable',
          storeys: Math.max(1, Math.min(100, Math.round(tagged || !(tower || curtain || religious || castle) ? levels : fixedHeight / 3.5))),
          material: 'stone',
          orientation,
          tagged,
          ...(ROOF[t['roof:shape']] ? { osmRoof: ROOF[t['roof:shape']] } : {}),
        };
        buildings.push(building);
        buildingRoles.set(building, { osmId: `${el.type}-${el.id}`, function: religious ? 'religious' : castle || tower || curtain ? 'defensive' : building.kind === 'domestic' ? 'domestic' : 'mixed', curtain, tower });
        if ((religious || castle) && t.name) landmarks.push({ kind: castle ? 'castle' : t.building === 'cathedral' ? 'cathedral' : 'church', poly: a.outer, name: t.name });
      }
      continue;
    }
    if (t.barrier === 'city_wall' || t.historic === 'citywalls') {
      if (el.type === 'way' && el.geometry) for (const path of clipLine(pts(el.geometry), 0)) wallWays.push({ path, closed: el.geometry.length > 3 && el.geometry[0]?.lat === el.geometry.at(-1)?.lat && el.geometry[0]?.lon === el.geometry.at(-1)?.lon });
      continue;
    }
    const barrier = BARRIER[t.barrier] ?? (t.natural === 'hedge' ? BARRIER.hedge : undefined);
    if (barrier && el.type === 'way' && el.geometry) {
      const height = num(t.height) ?? barrier.height;
      for (const path of clipLine(pts(el.geometry), 0)) if (length(path) >= 1) fences.push({ path, material: barrier.material, side: 'side', height, ...(barrier.material === 'fence' ? { fenceStyle: 'plank' as const } : {}) });
      continue;
    }
    if ((t.man_made === 'tower' || t.historic === 'tower') && el.type === 'way' && el.geometry) {
      if (!(t['tower:type'] === 'defensive' || t.historic === 'tower')) towerPoints.push(centroid(pts(el.geometry)));
      continue;
    }
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') {
      const river = t.water === 'river' || t.water === 'canal' || t.waterway === 'riverbank' || t.water === 'stream';
      for (const a of areas(el).filter(visible)) waterAreas.push({ ...a, river, name: t.name });
      continue;
    }
    if (t.waterway && el.type === 'way' && el.geometry) {
      const width = num(t.width) ?? RIVER_WIDTH[t.waterway];
      if (!width) continue;
      for (const path of clipLine(pts(el.geometry), 50)) riverLines.push({ path, width, name: t.name, type: t.waterway });
      continue;
    }
    if (t.place === 'square') {
      squares.push(...areas(el).filter(visible));
      continue;
    }
    const land = LANDUSE[t.landuse] ?? NATURAL[t.natural] ?? (t.leisure ? 'garden' : undefined);
    if (land) {
      for (const a of areas(el).filter(visible)) landAreas.push({ kind: land, poly: a.outer, ...(a.holes.length ? { holes: a.holes } : {}) });
      continue;
    }
    if (URBAN_LANDUSE.has(t.landuse)) footprint.push(...areas(el).filter(visible));
  }

  // Commune limit: town content is kept when its centre lies inside the boundary; roads, rivers, water and relief stay
  // over the whole square.
  if (input.commune) {
    const ringsOf = (inner: boolean): P[][] => memberRings(input.commune!, inner).map(r => openRing(pts(r)));
    const outer = ringsOf(false),
      inner = ringsOf(true);
    if (!outer.length) throw new Error(`The boundary of "${input.options.communeName ?? NAME}" could not be reconstructed.`);
    const inside = (p: P): boolean => outer.some(r => pointInRing(r, p)) && !inner.some(r => pointInRing(r, p));
    const keep = <T>(list: T[], at: (item: T) => P): void => {
      let length = 0;
      for (const item of list) if (inside(at(item))) list[length++] = item;
      list.length = length;
    };
    const before = { buildings: buildings.length, streets: streets.length, landAreas: landAreas.length, footprint: footprint.length, fences: fences.length };
    keep(buildings, b => centroid(b.poly));
    keep(streets, s => mid(s.path));
    keep(squares, a => centroid(a.outer));
    keep(landmarks, l => centroid(l.poly));
    keep(landAreas, a => centroid(a.poly));
    keep(footprint, a => centroid(a.outer));
    keep(wallWays, w => mid(w.path));
    keep(fences, f => mid(f.path));
    keep(towerPoints, p => p);
    keep(gatePoints, p => p);
    const kept = places.filter(p => p.name === NAME || inside(p.p));
    places.length = 0;
    places.push(...kept);
    log.push(
      `Commune ${input.options.communeName ?? ''}: buildings ${before.buildings} -> ${buildings.length}, streets ${before.streets} -> ${streets.length}, fences ${before.fences} -> ${fences.length}, land areas ${before.landAreas} -> ${landAreas.length}, urban areas ${before.footprint} -> ${footprint.length}`,
    );
  }

  const walls = wallWays.map(w => ({ path: w.path, closed: w.closed, towers: towerPoints.filter(p => nearPath(p, w.path, 20)), gates: gatePoints.filter(p => nearPath(p, w.path, 25)), thickness: 3, towerShape: 'round', role: 'town' }));

  // ---------- terrain ----------
  const height = createGrid(GRID, GRID, cell);
  height.data.set(elevations);
  const water = new Uint8Array(GRID * GRID);
  for (const a of waterAreas) rasterize(water, a, a.river ? 3 : 2);
  // Water surfaces are flat and sit a little below their banks.
  for (const a of waterAreas) {
    const mask = new Uint8Array(GRID * GRID);
    rasterize(mask, a, 1);
    let low = Infinity;
    for (let i = 0; i < mask.length; i++) if (mask[i]) low = Math.min(low, height.data[i]);
    if (!a.river && Number.isFinite(low)) for (let i = 0; i < mask.length; i++) if (mask[i]) height.data[i] = low - 0.5;
  }
  const flood = priorityFlood(height, new Uint8Array(GRID * GRID));
  const receiver = flood.receiver instanceof Int32Array ? flood.receiver : Int32Array.from(flood.receiver);
  const order = flood.order instanceof Int32Array ? flood.order : Int32Array.from(flood.order);
  const counts = accumulate(receiver, order);
  const flow = createGrid(GRID, GRID, cell);
  flow.data.set(counts);
  const filled = flood.filled ?? Float32Array.from(height.data);
  const edgeMean = (side: string): number => {
    let s = 0;
    for (let k = 0; k < GRID; k++) s += height.data[side === 'N' ? k : side === 'S' ? (GRID - 1) * GRID + k : side === 'W' ? k * GRID : k * GRID + GRID - 1];
    return s / GRID;
  };
  const downSide = (['N', 'E', 'S', 'W'] as const).slice().sort((a, b) => edgeMean(a) - edgeMean(b))[0];

  // Rivers: OSM waterway lines (the main one is the longest named river), in their drawn (flow) direction.
  riverLines.sort((a, b) => Number(b.type === 'river') - Number(a.type === 'river') || length(b.path) - length(a.path));
  const rivers = riverLines.map((r, id) => ({
    path: r.path,
    width: r.path.map(() => r.width),
    ...(r.name ? { name: r.name } : {}),
    id,
    ...(id === 0 && r.type === 'river' ? { main: true } : {}),
    cls: (r.width >= 60 ? 'major' : r.width >= 12 ? 'river' : r.width >= 3 ? 'stream' : 'brook') as 'major' | 'river' | 'stream' | 'brook',
  }));
  // The planning raster carries the river beds too (placement, roads and towns keep off them).
  for (const r of rivers)
    for (let j = 1; j < r.path.length; j++) {
      const a = r.path[j - 1],
        b = r.path[j],
        radius = Math.max(cell * 0.6, r.width[j] / 2),
        steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 2)));
      for (let s = 0; s <= steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / steps,
          y = a.y + ((b.y - a.y) * s) / steps,
          k = Math.ceil(radius / cell);
        const cx = Math.floor(x / cell),
          cy = Math.floor(y / cell);
        for (let gy = cy - k; gy <= cy + k; gy++) for (let gx = cx - k; gx <= cx + k; gx++) if (gx >= 0 && gy >= 0 && gx < GRID && gy < GRID && Math.hypot((gx + 0.5) * cell - x, (gy + 0.5) * cell - y) <= radius && !water[gy * GRID + gx]) water[gy * GRID + gx] = 3;
      }
    }

  // The drawn water of the V2 (`TerrainData.water`, a VectorWater): the DEM's drainage for the grid products and the
  // OSM courses as an authored network (`editedNetwork`), drawn in every style, 2D and 3D.
  const sample = (x: number, y: number): number => {
    const gx = Math.max(0, Math.min(GRID - 1, Math.floor(x / cell))),
      gy = Math.max(0, Math.min(GRID - 1, Math.floor(y / cell)));
    return filled[gy * GRID + gx];
  };
  const cellOf = (p: P): number => Math.max(0, Math.min(GRID - 1, Math.floor(p.y / cell))) * GRID + Math.max(0, Math.min(GRID - 1, Math.floor(p.x / cell)));
  const areaOfWidth = (w: number): number => 1e6 * Math.pow(Math.max(0.5, w) / 3, 1 / 0.45);
  const lines: RiverLine[] = rivers.map(r => {
    const level: number[] = [];
    let low = Infinity;
    for (const p of r.path) level.push((low = Math.min(low, sample(p.x, p.y))));
    // The course joins the line whose bed holds its last vertex.
    const end = r.path.at(-1)!;
    const host = rivers.find(o => o !== r && o.path.some((q, i) => i > 0 && segDist(end, o.path[i - 1], q) < Math.max(2, o.width[0] / 2)));
    return { points: r.path.flatMap(p => [p.x, p.y]), area: r.path.map((_, i) => areaOfWidth(r.width[i])), level, kind: r.path.map(() => 0), id: r.id, joins: host?.id ?? -1, outlet: cellOf(end) };
  });
  const lake = Uint8Array.from(water, v => (v === 2 ? 1 : 0));
  const basin = new Int32Array(GRID * GRID).fill(-1);
  let outlets = 0;
  for (let k = 0; k < order.length; k++) {
    const c = order[k],
      r = receiver[c];
    if (r < 0) {
      basin[c] = outlets++;
    } else basin[c] = basin[r];
  }
  const network: RiverNetwork = { rivers: lines, oxbows: [], braids: [], distributaries: [], widthScale: 1, meanderRuns: 0, lengthKm: rivers.reduce((s, r) => s + length(r.path), 0) / 1000, meanderKm: 0, braidedKm: 0, avulsions: 0, deltas: 0, ms: 0 };
  const vectorWater: VectorWater = {
    lakeField: lakeFieldOf(lake, GRID),
    hydro: { n: GRID, width: SIZE, cellArea: cell * cell, height: Float32Array.from(height.data), filled: Float32Array.from(filled), receiver, accumulation: Float32Array.from(counts, v => v * cell * cell), order, basin, sea: new Uint8Array(GRID * GRID), outlets, ms: 0 },
    lake,
    lakes: waterAreas.filter(a => !a.river).length,
    closedLakes: 0,
    lakeAreaKm2: (lake.reduce((s, v) => s + v, 0) * cell * cell) / 1e6,
    riverCells: water.reduce((s, v) => s + (v === 3 ? 1 : 0), 0),
    rivers: network,
    editedNetwork: true,
    widthScale: 1,
    riverArea: 0.02,
    metrics: { order: 1 },
    runoff: { r0: 600, e0: 0, aridity: 0 },
    hydrologyMs: 0,
    balanceMs: 0,
  } as VectorWater;
  let minH = Infinity,
    maxH = -Infinity;
  for (const v of height.data) {
    minH = Math.min(minH, v);
    maxH = Math.max(maxH, v);
  }
  const normalX = new Float32Array(GRID * GRID),
    normalY = new Float32Array(GRID * GRID),
    normalZ = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x,
        h = height.data;
      const dx = (h[y * GRID + Math.min(GRID - 1, x + 1)] - h[y * GRID + Math.max(0, x - 1)]) / (2 * cell),
        dy = (h[Math.min(GRID - 1, y + 1) * GRID + x] - h[Math.max(0, y - 1) * GRID + x]) / (2 * cell),
        norm = Math.hypot(dx, dy, 1);
      normalX[i] = -dx / norm;
      normalY[i] = -dy / norm;
      normalZ[i] = 1 / norm;
    }
  const native: TerrainData = {
    x: 0,
    y: 0,
    width: SIZE,
    resolution: GRID,
    height: height.data,
    caveMask: new Uint8Array(),
    normalX,
    normalY,
    normalZ,
    minHeight: minH,
    maxHeight: maxH,
    globalMinHeight: minH,
    globalMaxHeight: maxH,
    motifSize: SIZE,
    generationMs: 0,
    field: { n: GRID, data: height.data, exact: true, floor: minH },
    water: vectorWater,
  } as TerrainData;
  const terrain = {
    height,
    slope: slopeGrid(height),
    water,
    flow,
    seaLevel: 0,
    seaFraction: 0,
    coastline: [],
    lakes: waterAreas.filter(a => !a.river).map(a => a.outer),
    rivers,
    waterGeometry: waterAreas.map(a => [a.outer, ...a.holes]),
    receiver,
    filled,
    downSide,
    seaSide: null,
    v2NativeTerrain: native,
  };

  // ---------- town ----------
  const town = places.find(p => p.name === NAME) ?? places.find(p => ['city', 'town'].includes(p.place));
  // La Cité is the historic core of Carcassonne; elsewhere the town's own place node.
  const cite = NAME === 'Carcassonne' ? places.find(p => /cit[ée]/i.test(p.name)) : undefined;
  const center = cite?.p ?? town?.p ?? { x: half, y: half };
  if (!footprint.length && buildings.length) {
    // The buildings' bounding box.
    const xs = buildings.flatMap(b => b.poly.map(p => p.x)),
      ys = buildings.flatMap(b => b.poly.map(p => p.y));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    footprint.push({
      outer: [
        { x: x0, y: y0 },
        { x: x0, y: y1 },
        { x: x1, y: y1 },
        { x: x1, y: y0 },
      ].reverse(),
      holes: [],
    });
  }

  // ---------- the culture's houses on the OSM footprints ----------
  // Roof kind, cover and wall come from the culture; OSM levels/heights stay when tagged. Landmarks keep their OSM
  // roof shape (towers, churches), big plain buildings (sheds, halls) a flat roof.
  const look = cultureHouseLook(CULTURE),
    [lowStoreys, highStoreys] = cultureStoreys(CULTURE);
  for (const [i, b] of buildings.entries()) {
    const role = buildingRoles.get(b)!,
      area = Math.abs(signedArea(b.poly)),
      landmark = role.function === 'religious' || role.function === 'defensive';
    b.roof = landmark ? (b.osmRoof ?? b.roof) : area > 600 ? 'flat' : look.roof;
    b.material = landmark ? 'stone' : look.wall;
    if (!b.tagged && !landmark) {
      const floors = b.kind === 'workshop' ? 1 : lowStoreys + Math.floor(unit(`${role.osmId}/${i}`) * Math.min(2, highStoreys - lowStoreys + 1));
      b.storeys = floors;
      b.height = round2(floors * 3.1 + 2);
    }
  }
  const population = Math.round(buildings.filter(b => b.kind === 'domestic' || b.kind === 'collective' || b.kind === 'mixed').length * 3.5);
  const named = streets.filter(s => s.name);
  for (const s of streets) delete s.name;
  const urban = {
    footprintH: footprint,
    footprint: footprint.map(a => a.outer),
    population,
    culture: CULTURE,
    cultures: [CULTURE],
    archetype: 'town',
    morphology: 'osm-import',
    blocks: footprint.map(a => a.outer),
    blockInfo: footprint.map(() => ({ quarter: 0, phase: 0, zone: 'core', kind: 'block', culture: CULTURE })),
    quarters: [{ poly: footprint[0] ?? { outer: [], holes: [] }, phase: 0, zone: 'core', streetSpace: [], culture: CULTURE }],
    phases: [{ id: 0, kind: 'core', zone: 'core', region: footprint, walled: walls.length > 0, fossil: false }],
    streets,
    parcels: [],
    // The world layer keeps the legacy roof words (`conical`, `pyramidal`); the snapshot massing has the 3D kinds.
    buildings: buildings.map(({ tagged: _t, osmRoof: _r, ...b }) => ({ ...b, roof: b.roof === 'cone' || b.roof === 'tent' ? 'conical' : b.roof === 'pyramid' ? 'pyramidal' : b.roof })),
    masses: buildings.map(b => ({ outer: b.poly, holes: b.courtyards })),
    walls,
    landmarks,
    squares: squares.map(a => a.outer),
    backLand: [],
    ruralReserve: [],
    quays: [],
  };
  const ring = (c: P, r: number, k = 28): P[] => Array.from({ length: k }, (_, i) => ({ x: c.x + r * Math.cos((i / k) * 2 * Math.PI), y: c.y + r * Math.sin((i / k) * 2 * Math.PI) }));
  const radius = Math.min(half, Math.max(300, Math.sqrt(buildings.length) * 15));
  const settlement = {
    key: 'main',
    index: 0,
    main: true,
    cls: population > 20000 ? 'city' : 'town',
    population,
    culture: CULTURE,
    center,
    archetype: 'bridge',
    radius,
    extent: ring(center, radius),
    region: [
      { x: 0, y: 0 },
      { x: 0, y: SIZE },
      { x: SIZE, y: SIZE },
      { x: SIZE, y: 0 },
    ].reverse(),
    fixed: true,
    name: NAME,
    detail: 'main',
    urban,
  };

  // ---------- 3D: the retained town snapshot the V2 draws its houses from ----------
  // The V2 3D view raises the houses of `world.debug.v2RustCities[key].scene`, a PlacementBatch, for a town snapshot at
  // stage 'buildings' with a layout (v2/nativeProducts.ts nativeCitiesOf). City volumes ('silhouette' generator) read
  // each building's `programme.massing` (render/cityMassing.ts readMassing). With it, the 2D plan is drawn by the City
  // Bench renderer from the snapshot's layout and scene; the OSM fences ride on its partition (`lotEnclosures`).
  const groundAt = (x: number, y: number): number => {
    const fx = Math.max(0, Math.min(GRID - 1, x / cell - 0.5)),
      fy = Math.max(0, Math.min(GRID - 1, y / cell - 0.5));
    const ax = Math.floor(fx),
      ay = Math.floor(fy),
      bx = Math.min(GRID - 1, ax + 1),
      by = Math.min(GRID - 1, ay + 1),
      tx = fx - ax,
      ty = fy - ay,
      h = height.data;
    return (h[ay * GRID + ax] * (1 - tx) + h[ay * GRID + bx] * tx) * (1 - ty) + (h[by * GRID + ax] * (1 - tx) + h[by * GRID + bx] * tx) * ty;
  };
  const massingOf = (b: Building, serial: number, landmark: boolean) => {
    const u = { x: Math.cos(b.orientation), y: Math.sin(b.orientation) },
      v = { x: -u.y, y: u.x },
      c = centroid(b.poly);
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const p of b.poly) {
      const pu = (p.x - c.x) * u.x + (p.y - c.y) * u.y,
        pv = (p.x - c.x) * v.x + (p.y - c.y) * v.y;
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      v0 = Math.min(v0, pv);
      v1 = Math.max(v1, pv);
    }
    const halfWidth = (v1 - v0) / 2,
      vm = (v0 + v1) / 2;
    const roof = b.roof;
    const pitch = landmark ? 38 : look.pitch;
    const rise = roof === 'flat' ? 0 : roof === 'cone' || roof === 'tent' ? Math.min(8, halfWidth * 1.6) : roof === 'dome' || roof === 'barrel' ? halfWidth : Math.min(6, Math.tan((pitch * Math.PI) / 180) * halfWidth);
    // Hip ridges stop half a width short of both ends; gables run the whole length.
    const inset = roof === 'hip' ? Math.min(halfWidth, (u1 - u0) / 2) : 0;
    const at = (t: number): P => ({ x: c.x + u.x * t + v.x * vm, y: c.y + u.y * t + v.y * vm });
    const a = at(u0 + inset),
      e = at(u1 - inset);
    const ridges = roof === 'gable' || roof === 'hip' || roof === 'barrel' ? [[round2(a.x), round2(a.y), round2(e.x), round2(e.y)]] : [];
    const eave = Math.max(2.5, b.height - rise);
    const cover = landmark ? (roof === 'flat' ? 'stone' : 'tile') : roof === 'flat' && !['earth', 'plaster', 'stone', 'turf', 'snow'].includes(look.cover) ? 'stone' : look.cover;
    return { floors: b.storeys, eave_m: round2(eave), rise_m: round2(rise), roof, ridges, cover, wall: landmark ? 'stone' : look.wall, tone: round2(0.85 + 0.15 * ((serial * 0.618034) % 1)) };
  };
  const sceneBuildings = buildings.map((b, i) => {
    const role = buildingRoles.get(b),
      id = `osm/${role?.osmId ?? i}/${i}`,
      c = centroid(b.poly),
      shape = [{ outer: b.poly, holes: b.courtyards }],
      landmark = role?.function === 'religious' || role?.function === 'defensive';
    return {
      id,
      parcel_id: `osm/${role?.osmId ?? i}`,
      function: role?.function ?? 'domestic',
      culture: { culture: CULTURE, pack: '', mode: 'historical_inspired', borrowing: null },
      recipe_id: 'silhouette',
      variant_id: 'silhouette',
      transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 },
      ground_z_m: round2(groundAt(c.x, c.y)),
      footprint: shape,
      roof_footprint: shape,
      courtyards: [],
      circulation: [],
      entrance: c,
      access_id: '',
      volumes: [],
      useful_area_m2: round2(Math.abs(signedArea(b.poly)) * b.storeys),
      domestic_units: role?.function === 'domestic' ? 1 : 0,
      structural_features: [],
      simplification: 'recipe_volumes',
      diagnostics: ['osm:footprint'],
      resolved: null,
      programme: { built_area_m2: round2(Math.abs(signedArea(b.poly))), floors: [b.storeys, b.storeys], landmark, massing: [massingOf(b, i, landmark)] },
    };
  });
  const nativeTown = {
    backend: 'rust-wasm-cpu',
    stage: 'buildings',
    layoutKey: `osm:${osmTimestamp}:${bbox}`,
    layouts: [
      {
        key: 'main',
        culture: CULTURE,
        center,
        quarters: footprint.map(a => ({ shape: a, phase: 0, zone: 'core' })),
        streets: streets.map(s => ({ path: s.path, widths: s.widths, rank: s.rank, role: s.role })),
        blocks: footprint.map(a => ({ shape: a, quarter: 0, kind: 'block', axis: { x: 1, y: 0 }, zone: 'core', phase: 0 })),
        enclosures: [],
        warnings: [],
      },
    ],
    partitions: [{ key: 'main', parcels: [], warnings: [], lotEnclosures: fences.map(f => ({ ...f, culture: CULTURE })) }],
    scene: { schema_version: '1', generator_version: 'silhouette', buildings: sceneBuildings, refusals: [], open_spaces: [] },
    buildingIds: sceneBuildings.map(b => b.id),
    warnings: [],
  };

  // ---------- names ----------
  const entries: Record<string, unknown>[] = [];
  const add = (kind: string, text: string, anchor: P, extra: Record<string, unknown> = {}): void => {
    entries.push({
      id: `osm:${kind}:${entries.length}`,
      entityKey: `osm:${kind}:${entries.length}`,
      kind,
      text,
      canonicalText: text,
      rank: { town: 0, river: 1, castle: 1, church: 2, road: 2, square: 3, street: 3, quarter: 2, village: 2 }[kind] ?? 3,
      anchor,
      generated: false,
      ...extra,
    });
  };
  add('town', NAME, town?.p ?? center);
  for (const p of places) if (p !== town && ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'locality'].includes(p.place) && inMap(p.p)) add(p.place === 'village' || p.place === 'hamlet' ? 'village' : 'quarter', p.name, p.p);
  const seenRivers = new Set<string>();
  for (const r of rivers)
    if (r.name && !seenRivers.has(r.name) && length(r.path) > 300) {
      seenRivers.add(r.name);
      add('river', r.name, mid(r.path), { path: r.path });
    }
  for (const l of landmarks) add(l.kind === 'castle' ? 'castle' : 'church', l.name, centroid(l.poly));
  const seenStreets = new Set<string>();
  for (const s of named.sort((a, b) => length(b.path) - length(a.path)))
    if (!seenStreets.has(s.name!) && length(s.path) > 80) {
      seenStreets.add(s.name!);
      add('street', s.name!, mid(s.path), { path: s.path, cityKey: 'main' });
    }
  const seenRoads = new Set<string>();
  for (const r of roads)
    if (r.name && !seenRoads.has(r.name) && length(r.path) > 300) {
      seenRoads.add(r.name);
      add('road', r.name, mid(r.path), { path: r.path });
    }

  // ---------- recipe + world ----------
  const settings = defaultSettings();
  acceptHeightmap(settings, imageHeightmap({ w: GRID, h: GRID, rgba: new Uint8Array(GRID * GRID * 4), elevations: Float32Array.from(elevations), name: 'Terrarium DEM' }), `${NAME} DEM (AWS Terrain Tiles z${ZOOM})`);
  settings.extent = SIZE;
  settings.options.mapSize = SIZE;
  settings.options.culture = CULTURE;
  settings.options.population = population;
  settings.options.workflow = 'list';
  settings.naming = { ...settings.naming, title: NAME, places: { main: NAME } } as V2Settings['naming'];
  settings.region = {
    ...settings.region,
    placement: { ...settings.region?.placement, mode: 'list', farmDensity: 0, remotePlaces: 0, list: [{ key: 'main', name: NAME, population, culture: CULTURE, siteType: 'auto', sitePrefs: {} }] },
    demography: { ...settings.region?.demography, isolatedCount: 0, followCulture: false },
  } as V2Settings['region'];
  const notice = `Imported from OpenStreetMap, ${osmTimestamp.slice(0, 10)}: ${OSM_ATTRIBUTION.osm}. ${OSM_ATTRIBUTION.dem}.`;
  const world = {
    // The recipe's seed and terrain key: the V2 takes this relief as already generated, so the town stages can run.
    seed: settings.options.seed,
    options: { ...settings.options },
    mapSize: SIZE,
    terrain,
    roads: roads.map(({ path, kind, width, editorId }) => ({ path, kind, width, editorId })),
    bridges,
    urban,
    settlements: [settlement],
    landuse: { areas: landAreas, farmsteads: [], reserve: urban.footprint, ways: [], headlands: [] },
    names: { family: 'french', town: NAME, entries },
    debug: { v2RustCities: { main: nativeTown } },
    stats: {
      'v2.stage': 'towns',
      'v2.engine': V2_ENGINE_VERSION,
      'v2.terrainKey': terrainCacheKey({ ...settings, extent: SIZE }),
      'v2.compositionNotice': notice,
      'osm.attribution': OSM_ATTRIBUTION.osm,
      'osm.timestamp': osmTimestamp,
      'osm.bbox': bbox,
      'dem.attribution': OSM_ATTRIBUTION.dem,
      'dem.source': `AWS Terrain Tiles terrarium z${ZOOM}`,
    },
  } as unknown as World;
  recordGenerationValidity(world, settings, 'terrain');
  recordGenerationValidity(world, settings, 'region');
  const summary = {
    buildings: buildings.length,
    streets: streets.length,
    roads: roads.length,
    bridges: bridges.length,
    walls: walls.length,
    towers: walls.reduce((s, w) => s + w.towers.length, 0),
    gates: walls.reduce((s, w) => s + w.gates.length, 0),
    fences: fences.length,
    waterAreas: waterAreas.length,
    rivers: rivers.length,
    landAreas: landAreas.length,
    urbanAreas: footprint.length,
    squares: squares.length,
    landmarks: landmarks.length,
    names: entries.length,
    population,
  };
  return { settings, world, source: { attribution: OSM_ATTRIBUTION, osmTimestamp, bbox, center: { lat, lon }, size: SIZE }, summary, log };
}
