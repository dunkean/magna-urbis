import type { TerrainData } from './terrain';
import { lakeField, lakeSample } from '../../web/src/ui/lakeGeometry';
import { riverWidths } from '../../web/src/ui/vectorWaterRender';
import { channelWidth } from '../../web/src/ui/riverVectors';
import { createSettlementEngine, type SettlementEngine } from './settlementEngine';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';

export interface Point { x: number; y: number }
export interface SitePrefs { mountainFace?: number; woodland?: number; weights?: Record<string, number> }
export interface SettlementSpec {
  key: string; name: string; population: number; culture: string; kind: string;
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
}
export const defaultSettlementSpec = (key = 'main', population = 300): SettlementSpec => ({ key, name: '', population, culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {} });
export const defaultSettlementConfig = (): SettlementConfig => ({
  mode: 'auto', distribution: 'classes', main: defaultSettlementSpec(), counts: { city: 0, town: 0, village: 3, hamlet: 3, farmstead: 2 }, list: [], relief: 'flat',
  density: 1, zipfExponent: 1.1, minPopulation: 8, populationJitter: 0.25,
  spread: 1.3, smallTop: 0.35, mainClear: 2.5, clustering: 0, edgeMargin: 0.03,
  flatnessWeight: 1, buildableWeight: 1, freshWaterWeight: 1, riverWeight: 1, coastWeight: 1, floodWeight: 1, defenseWeight: 0, elevation: 0, variationWeight: 1,
  siteWeights: {},
});
export type ScoreTerm = 'flatness' | 'buildable' | 'freshWater' | 'river' | 'harbor' | 'flood' | 'culture' | 'site' | 'defense' | 'elevation' | 'cluster' | 'variation';
export interface Settlement extends SettlementSpec {
  center: Point; cls: string; archetype: string; radius: number;
  scores: Record<'total' | ScoreTerm | 'buildableFraction' | 'waterDistance' | 'slope' | 'heightAboveWater' | 'spacingRelaxation', number> & { manual: boolean; rankingScore: number | null; candidateRank: number | null; rankingPopulation: number | null };
}
export interface SettlementOutput { settlements: Settlement[]; warnings: string[]; requested: number; usableKm2: number; ms: number }

/** Road network options (Rust `settlements::roads::RoadConfig`). */
export interface RoadConfig {
  level: RoadLevel; surface: 'auto' | RoadSurface; culture: string; density: number;
  gradeWeight: number; maxGrade: number; crossingCost: number; wobble: number; sharing: number; exits: number;
  /** Largest routing grid side (Rust default 512): finer rasters are pooled before routing; 0 routes on the raster itself. */
  grid?: number;
}
export const defaultRoadConfig = (): RoadConfig => ({ level: 'rural', surface: 'auto', culture: 'auto', density: 0.5, gradeWeight: 1, maxGrade: 0, crossingCost: 1, wobble: 1, sharing: 0.7, exits: 2 });
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
export interface RoadSite { key: string; population: number; culture: string; center: Point; radius: number }
export interface RoadCrossing { kind: 'bridge' | 'ford' | 'causeway'; path: Point[] }
export interface RoadSegment {
  class: RoadClass; surface: RoadSurface; profile: string; width: number; a: number; b: number;
  path: Point[]; crossings: RoadCrossing[]; length: number; grade: number; importance: number;
}
export interface RoadJunction { point: Point; degree: number; site: string | null }
export interface RoadOutput {
  segments: RoadSegment[]; junctions: RoadJunction[]; warnings: string[]; unreachable: string[]; routes: number;
  lengthByClass: Partial<Record<RoadClass, number>>; lengthBySurface: Partial<Record<RoadSurface, number>>; ms: number;
}

export interface SettlementRaster { geometry?: import('./urbanGeography').VectorGeography; width: number; n: number; height: Float32Array; water: Uint8Array; waterLevel: Float32Array; riverWidth: Float32Array; riverIds: Int32Array }
/**
 * One worker request. `place` reruns placement (then routes the new places); without it the
 * roads are rerouted between `sites`. `roads: null` skips routing.
 */
export interface SettlementRequest { id: number; seed: string; raster?: SettlementRaster; place?: SettlementConfig; sites?: RoadSite[]; roads: RoadConfig | null; runtime?: ExecutionRuntime }
export type SettlementResponse = { id: number; settlements?: SettlementOutput; roads: RoadOutput | null } | { id: number; error: string };

/** Fallback for browsers that refuse the inline worker in a standalone file. */
let fallbackEngine: SettlementEngine | undefined;
export async function runSettlementRequest(request: SettlementRequest): Promise<SettlementResponse> {
  fallbackEngine ??= await createSettlementEngine(request.runtime);
  return fallbackEngine.run(request);
}

/** Adapt the completed terrain and the displayed water geometry, without regenerating either. */
export function settlementRaster(t: TerrainData, maxResolution = 512): SettlementRaster {
  const source = t.field?.data ?? t.height, sn = t.field?.n ?? t.resolution;
  const n = Math.min(maxResolution, sn), width = t.width, cell = width / n, size = n * n;
  const height = new Float32Array(size), water = new Uint8Array(size), waterLevel = new Float32Array(size), riverWidth = new Float32Array(size), riverIds = new Int32Array(size).fill(-1);
  const sample = (values: ArrayLike<number>, vn: number, x: number, y: number): number => {
    const gx = Math.max(0, Math.min(vn - 1, x / width * vn - 0.5)), gy = Math.max(0, Math.min(vn - 1, y / width * vn - 0.5));
    const xx = Math.floor(gx), yy = Math.floor(gy), dx = gx - xx, dy = gy - yy;
    const a = values[yy * vn + xx], b = values[yy * vn + Math.min(vn - 1, xx + 1)], c = values[Math.min(vn - 1, yy + 1) * vn + xx], d = values[Math.min(vn - 1, yy + 1) * vn + Math.min(vn - 1, xx + 1)];
    return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
  };
  const vector = t.water, hydro = t.hydrology;
  const lakes = vector ? lakeField(vector.lake, vector.hydro.n) : undefined;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, px = (x + 0.5) * cell, py = (y + 0.5) * cell;
    height[i] = sample(source, sn, px, py); waterLevel[i] = height[i];
    if (height[i] <= 0) { water[i] = 1; waterLevel[i] = 0; }
    if (t.caveMask.length || t.field?.cave?.length) {
      const cave = t.field?.cave ?? t.caveMask, cn = t.field?.cave ? sn : t.resolution;
      if (cave[Math.min(cn - 1, Math.floor(py / width * cn)) * cn + Math.min(cn - 1, Math.floor(px / width * cn))]) water[i] = 2;
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
  return { width, n, height, water, waterLevel, riverWidth, riverIds };
}
