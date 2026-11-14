import type { TerrainData } from './terrain';
import { lakeSample } from '../../web/src/ui/lakeGeometry';
import { riverWidths } from '../../web/src/ui/vectorWaterRender';
import { channelWidth } from '../../web/src/ui/riverVectors';
import { createSettlementEngine, type SettlementEngine } from './settlementEngine';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';

export interface Point { x: number; y: number }
export interface SitePrefs { mountainFace?: number; woodland?: number; weights?: Record<string, number> }
export interface SettlementSpec {
  key: string; name: string; population: number; culture: string;
  siteType: string; position?: Point; sitePrefs: SitePrefs;
}
/** Placement only (Rust `settlements::Config`); roads have their own {@link RoadConfig}. */
export interface SettlementConfig {
  mode: 'auto' | 'counts' | 'list'; distribution: 'classes' | 'zipf';
  main: SettlementSpec; counts: Record<string, number>; list: SettlementSpec[]; relief: string;
  density: number; zipfExponent: number; minPopulation: number; populationJitter: number;
  spread: number; smallTop: number; mainClear: number; clustering: number; edgeMargin: number;
  flatnessWeight: number; buildableWeight: number; freshWaterWeight: number; riverWeight: number; coastWeight: number;
  floodWeight: number; defenseWeight: number; elevation: number; variationWeight: number;
  siteWeights: Record<string, number>;
  /** Multiplies the dispersed farms of the countryside (1 ≈ 0.45 per km² of land, 0 = none). */
  farmDensity: number;
  /** Frequency of the remote places (summit temples, cliff monasteries, lost ruins…): 1 ≈ one on 100 km² of land with dramatic ground, 0 = none. */
  remotePlaces: number;
}
export const defaultSettlementSpec = (key = 'main', population = 300): SettlementSpec => ({ key, name: '', population, culture: 'european-organic', siteType: 'auto', sitePrefs: {} });
export const defaultSettlementConfig = (): SettlementConfig => ({
  mode: 'auto', distribution: 'classes', main: defaultSettlementSpec(), counts: { city: 0, town: 0, village: 3, hamlet: 3, farmstead: 2 }, list: [], relief: 'flat',
  density: 1, zipfExponent: 1.1, minPopulation: 8, populationJitter: 0.25,
  spread: 1.3, smallTop: 0.35, mainClear: 2.5, clustering: 0, edgeMargin: 0.03,
  flatnessWeight: 1, buildableWeight: 1, freshWaterWeight: 1, riverWeight: 1, coastWeight: 1, floodWeight: 1, defenseWeight: 0, elevation: 0, variationWeight: 1,
  siteWeights: {}, farmDensity: 1, remotePlaces: 1,
});
export type ScoreTerm = 'flatness' | 'buildable' | 'freshWater' | 'river' | 'harbor' | 'flood' | 'culture' | 'site' | 'defense' | 'elevation' | 'cluster' | 'variation';
export interface Settlement extends SettlementSpec {
  center: Point; cls: string; archetype: string; radius: number;
  scores: Record<'total' | ScoreTerm | 'buildableFraction' | 'waterDistance' | 'slope' | 'heightAboveWater' | 'spacingRelaxation', number> & { manual: boolean; rankingScore: number | null; candidateRank: number | null; rankingPopulation: number | null };
}
/** One building of an activity site: footprint ring and its `urban/massing.rs` pieces (archetype look). */
export interface ActivityBuilding { archetype: string; look: string; ring: Point[]; massing: unknown }
/** Ground installation of a site (Rust `settlements::installations::Installation`): `kind` = activities.json ground kind; ring when `closed`, else polyline. */
export interface ActivityInstallation { archetype: string; kind: string; closed: boolean; points: Point[] }
/** Territorial activity site (Rust `settlements::activities::ActivitySite`): no residents, tied to `parent`.
 * Network nodes (`mode: 'network_node'`, Rust `settlements::nodes`) come with the road output; `resource` = road class there. */
export interface ActivitySite {
  id: string; template: string; mode: 'attached_external' | 'remote_seasonal' | 'network_node'; parent: string; anchor: string;
  kind: string; resource: string; culture: string; x: number; y: number; ground: number;
  /** `accessClass: 'none'`: a remote place no path leads to (never a road endpoint; `access` is the site itself). */
  access: Point; accessClass: 'track' | 'trail' | 'none'; residents: number; seasonMask: number;
  buildings: ActivityBuilding[]; installations: ActivityInstallation[];
  /** Remote places (Rust `settlements::remote`, `kind: 'remote'`): the terrain situation (`summit`, `crag`, `cliff-ledge`, `cliff-foot`, `gorge`, `islet`, `marsh-island`, `deep-forest`). */
  situation?: string;
  /** Remote places: how one gets there (`none`, `track`, `cliff-stair`, `rock-steps`, `tunnel`, `causeway`, `rope-bridge`); its line is the installation
   * `cliff_stair` | `rock_steps` | `rock_tunnel` | `tidal_causeway` | `rope_bridge`, from the place to the end of the ordinary path. */
  approach?: string;
}
export interface SettlementOutput { settlements: Settlement[]; warnings: string[]; requested: number; usableKm2: number; ms: number; activities?: ActivitySite[] }

/** Road network options (Rust `settlements::roads::RoadConfig`). */
export interface RoadConfig {
  level: RoadLevel; surface: 'auto' | RoadSurface; culture: string; density: number;
  gradeWeight: number; maxGrade: number; crossingCost: number; wobble: number; sharing: number; exits: number;
  /** Largest routing grid side (Rust default 512): finer rasters are pooled before routing; 0 routes on the raster itself. */
  grid?: number;
  /** Route tracks/trails to activity access points (Rust default on; false keeps the old network). */
  activityAccess?: boolean;
  /** Network nodes (tolls, ferries, inns, border posts) along the finished network (Rust default on). */
  networkNodes?: boolean;
}
export const defaultRoadConfig = (): RoadConfig => ({ level: 'rural', surface: 'auto', culture: 'auto', density: 0.5, gradeWeight: 1, maxGrade: 0, crossingCost: 1, wobble: 1, sharing: 0.7, exits: 2, activityAccess: true });
export type RoadLevel = 'primitive' | 'rural' | 'developed' | 'imperial';
export type RoadClass = 'highway' | 'main' | 'local' | 'track' | 'trail';
export type RoadSurface = 'dirt' | 'gravel' | 'paved' | 'flagstone';
export const ROAD_LEVELS: { id: RoadLevel; label: string }[] = [
  { id: 'primitive', label: 'Primitive · tracks and trails' }, { id: 'rural', label: 'Rural · no highways' },
  { id: 'developed', label: 'Developed · paved trunks' }, { id: 'imperial', label: 'Imperial · paved network' },
];
export const ROAD_CLASSES: RoadClass[] = ['highway', 'main', 'local', 'track', 'trail'];
export const ROAD_SURFACES: RoadSurface[] = ['dirt', 'gravel', 'paved', 'flagstone'];
/** Mirrors `PROFILES` in rust/crates/core/src/settlements/roads/profile.rs (Rust rejects unknown ids). */
export const ROAD_PROFILES: { id: string; label: string }[] = [
  { id: 'medieval', label: 'Medieval European' }, { id: 'roman', label: 'Roman / Byzantine' }, { id: 'east-asian', label: 'East Asian post roads' },
  { id: 'caravan', label: 'Caravan routes' }, { id: 'andean', label: 'Andean (stone stairs)' }, { id: 'mesoamerican', label: 'Mesoamerican causeways' },
  { id: 'tribal', label: 'Tribal paths' }, { id: 'elven', label: 'Elven (contour paths)' }, { id: 'dwarven', label: 'Dwarven (paved, steep)' },
];
/** `approach`: a remote place's access line (stair, tunnel, causeway) from the place down to `center`; the router cuts it at the first road it meets (`RoadOutput.approaches`). */
export interface RoadSite { key: string; population: number; culture: string; center: Point; radius: number; access?: 'track' | 'trail'; parent?: string; approach?: Point[] }
export { accessLineOf, roadSitesOf } from './roadSites';
export interface RoadCrossing { kind: 'bridge' | 'ford' | 'causeway'; path: Point[] }
export interface RoadSegment {
  class: RoadClass; surface: RoadSurface; profile: string; width: number; a: number; b: number;
  path: Point[]; crossings: RoadCrossing[]; length: number; grade: number; importance: number;
}
export interface RoadJunction { point: Point; degree: number; site: string | null }
export interface RoadOutput {
  segments: RoadSegment[]; junctions: RoadJunction[]; warnings: string[]; unreachable: string[]; routes: number;
  lengthByClass: Partial<Record<RoadClass, number>>; lengthBySurface: Partial<Record<RoadSurface, number>>; ms: number;
  /** Network nodes placed on the finished network (catalogue P4). */
  nodes?: ActivitySite[];
  /** Access lines of remote places cut where they meet a road (Rust `roads::Approach`); fewer than two points = no line left. */
  approaches?: { key: string; points: Point[] }[];
}

/** Map inputs of the Rust resource model (seed, sea-level °C, annual mm, biome or climate zone, world corner). */
export interface SettlementRegion { seed: string; temperature: number; precipitation: number; biome: string; x: number; y: number }
/** Full-extent, cell-centred ground elevation in metres. Planning and routing stay on the capped raster below. */
export interface PhysicalTerrain { n: number; height: Float32Array; interpolation?: 'bspline'; floor?: number }
export interface SettlementRaster { geometry?: import('./urbanGeography').VectorGeography; region?: SettlementRegion; physical?: PhysicalTerrain; width: number; n: number; height: Float32Array; water: Uint8Array; waterLevel: Float32Array; riverWidth: Float32Array; riverIds: Int32Array;
  /** JS-side only (never sent to Rust): 1 = cave rock. Rust sees rock as water class 2 at ground level (unbuildable, impassable); land use must not treat it as wet. */
  rock?: Uint8Array }
export function validatePhysicalTerrain(physical: PhysicalTerrain | undefined): void {
  if (!physical) return;
  const { n, height } = physical;
  if (!Number.isInteger(n) || n < 2 || n > 8192 || n * n * Float32Array.BYTES_PER_ELEMENT > 256 * 1024 * 1024
    || !(height instanceof Float32Array) || height.length !== n * n || !height.every(Number.isFinite)
    || (physical.interpolation !== undefined && physical.interpolation !== 'bspline')
    || (physical.floor !== undefined && !Number.isFinite(physical.floor))) {
    throw new Error('Invalid physical terrain height field.');
  }
}
/**
 * One worker request. `place` reruns placement (then routes the new places); without it the
 * roads are rerouted between `sites`. `roads: null` skips routing.
 */
/** `resources`: also return the compact resource payload of the retained terrain (view layers, rural soil). */
export interface SettlementRequest { id: number; seed: string; raster?: SettlementRaster; place?: SettlementConfig; sites?: RoadSite[]; roads: RoadConfig | null; resources?: boolean; runtime?: ExecutionRuntime }
export type SettlementResponse = { id: number; settlements?: SettlementOutput; roads: RoadOutput | null; resources?: import('./resources').ResourcePayload } | { id: number; error: string };

/** Fallback for browsers that refuse the inline worker in a standalone file. */
let fallbackEngine: SettlementEngine | undefined;
export async function runSettlementRequest(request: SettlementRequest): Promise<SettlementResponse> {
  fallbackEngine ??= await createSettlementEngine(request.runtime);
  return fallbackEngine.run(request);
}

/** Adapt the completed terrain and the displayed water geometry, without regenerating either. */
/** `upsample`: the planning grid may be finer than the physical source (bilinear heights; water and river masks
 * rasterised from the vector network at the finer cell). Decor exports ask for it; live planning does not. */
export function settlementRaster(t: TerrainData, maxResolution = 512, upsample = false): SettlementRaster {
  const source = t.physical?.height ?? t.height, sn = t.physical?.n ?? t.resolution;
  validatePhysicalTerrain({ n: sn, height: source });
  if (!Number.isInteger(maxResolution) || maxResolution < 1 || maxResolution > 8192) throw new Error('Invalid settlement planning resolution.');
  const n = Math.min(1024, Math.max(16, maxResolution), upsample ? 1024 : Math.max(16, sn)), width = t.width, cell = width / n, size = n * n;
  const height = new Float32Array(size), water = new Uint8Array(size), waterLevel = new Float32Array(size), riverWidth = new Float32Array(size), riverIds = new Int32Array(size).fill(-1);
  const sample = (values: ArrayLike<number>, vn: number, x: number, y: number): number => {
    const gx = Math.max(0, Math.min(vn - 1, x / width * vn - 0.5)), gy = Math.max(0, Math.min(vn - 1, y / width * vn - 0.5));
    const xx = Math.floor(gx), yy = Math.floor(gy), dx = gx - xx, dy = gy - yy;
    const a = values[yy * vn + xx], b = values[yy * vn + Math.min(vn - 1, xx + 1)], c = values[Math.min(vn - 1, yy + 1) * vn + xx], d = values[Math.min(vn - 1, yy + 1) * vn + Math.min(vn - 1, xx + 1)];
    return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
  };
  // Exact area-weighted box mean for downsampling; no full-size integral plane.
  const groundAt = (x: number, y: number): number => {
    if (sn <= n) return sample(source, sn, (x + .5) * cell, (y + .5) * cell);
    const x0 = x * sn / n, x1 = (x + 1) * sn / n, y0 = y * sn / n, y1 = (y + 1) * sn / n;
    let sum = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
      const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
      for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
        sum += source[sy * sn + sx] * wx * wy;
      }
    }
    return sum / ((x1 - x0) * (y1 - y0));
  };
  let rock: Uint8Array | undefined;
  const vector = t.water, hydro = t.hydrology;
  const lakes = vector ? vector.lakeField : undefined;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, px = (x + 0.5) * cell, py = (y + 0.5) * cell;
    height[i] = groundAt(x, y); waterLevel[i] = height[i];
    if (height[i] <= 0) { water[i] = 1; waterLevel[i] = 0; }
    if (t.caveMask.length || t.field?.cave?.length) {
      const cave = t.field?.cave ?? t.caveMask, cn = t.field?.cave ? t.field.n : t.resolution;
      // The physical cave field is a soft mask (128 on the wall); the region mask is 0/1.
      const v = cave[Math.min(cn - 1, Math.floor(py / width * cn)) * cn + Math.min(cn - 1, Math.floor(px / width * cn))];
      if (t.field?.cave ? v >= 128 : v) { water[i] = 2; (rock ??= new Uint8Array(n * n))[i] = 1; }
    }
    if (vector) {
      const h = vector.hydro, c = Math.min(h.n - 1, Math.floor(py / width * h.n)) * h.n + Math.min(h.n - 1, Math.floor(px / width * h.n));
      if (h.sea[c]) { water[i] = 1; waterLevel[i] = 0; }
      else if (lakeSample(lakes!, width, px, py) >= 0) { water[i] = 2; waterLevel[i] = Number.isFinite(vector.lakeLevel?.[c]) ? vector.lakeLevel![c] : h.filled[c]; }
    } else if (hydro) {
      const hn = hydro.resolution, c = Math.min(hn - 1, Math.floor(py / width * hn)) * hn + Math.min(hn - 1, Math.floor(px / width * hn));
      if (hydro.seaMask?.[c]) { water[i] = 1; waterLevel[i] = 0; }
      else if (hydro.lakeLabels[c] && hydro.lakeDepth[c] > 0) { water[i] = 2; waterLevel[i] = hydro.filled[c]; }
    }
  }
  const segment = (ax: number, ay: number, bx: number, by: number, wd: number, levelA: number, levelB: number, id: number): void => {
    const rad = Math.max(wd / 2, cell * 0.6), dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - rad) / cell)), x1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + rad) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - rad) / cell)), y1 = Math.min(n - 1, Math.floor((Math.max(ay, by) + rad) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = (x + 0.5) * cell, py = (y + 0.5) * cell, u = den ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / den)) : 0;
      if (Math.hypot(px - ax - dx * u, py - ay - dy * u) > rad) continue;
      const i = y * n + x; if (water[i] === 1 || water[i] === 2 || riverWidth[i] > wd) continue;
      water[i] = 3; riverWidth[i] = wd; riverIds[i] = id; waterLevel[i] = levelA * (1 - u) + levelB * u;
    }
  };
  if (vector?.rivers) {
    const r = vector.rivers;
    for (const [id, line] of [...r.rivers, ...r.braids, ...r.distributaries, ...r.oxbows].entries()) {
      const widths = riverWidths(vector, line, r.oxbows.includes(line) ? 1 : 0);
      for (let j = 2; j < line.points.length; j += 2) {
        const k = j / 2, wd = Math.max(widths[k - 1], widths[k]);
        segment(line.points[j - 2], line.points[j - 1], line.points[j], line.points[j + 1], wd, line.level[k - 1], line.level[k], line.id ?? id);
      }
    }
  } else if (vector) {
    const h = vector.hydro, hc = width / h.n;
    const threshold = (vector.riverArea ?? Math.max(.02, .003 * (width / 1000) ** 2)) * 1e6;
    for (let i = 0; i < h.n * h.n; i++) {
      const r = h.receiver[i];
      if (h.sea[i] || vector.lake[i] || h.accumulation[i] < threshold || r < 0 || r >= h.n * h.n || r === i) continue;
      segment((i % h.n + .5) * hc, (Math.floor(i / h.n) + .5) * hc,
        (r % h.n + .5) * hc, (Math.floor(r / h.n) + .5) * hc,
        Math.max(channelWidth(h.accumulation[i], vector.widthScale ?? 1), channelWidth(h.accumulation[r], vector.widthScale ?? 1)), h.filled[i], h.filled[r], i);
    }
  } else if (hydro) for (let id = 0; id < hydro.riverOffsets.length - 1; id++) {
    for (let j = hydro.riverOffsets[id] + 1; j < hydro.riverOffsets[id + 1]; j++) {
      const a = (j - 1) * 4, b = j * 4, p = hydro.riverPoints;
      segment(p[a], p[a + 1], p[b], p[b + 1], Math.max(p[a + 2], p[b + 2]), p[a + 3], p[b + 3], id);
    }
  }
  const field = t.field?.n === sn && t.field.data.length === source.length ? t.field : undefined;
  const physical = field ? { n: sn, height: field.data, interpolation: 'bspline' as const, floor: field.floor }
    : sn !== n ? { n: sn, height: source } : undefined;
  return { width, n, height, water, waterLevel, riverWidth, riverIds, ...(rock ? { rock } : {}), ...(physical ? { physical } : {}) };
}
