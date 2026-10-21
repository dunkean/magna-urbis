import { normalizeLayoutConfig, normalizeParcelConfig, type LayoutConfig, type ParcelConfig } from './urbanConfig';
export * from './urbanConfig';
import init, { SettlementTerrain } from '../pkg/wasm/magna_urbis_wasm.js';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import type { Point, RoadOutput, RoadSite, SettlementRaster } from './settlements';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { nativeRasterClient } from './nativeEngine';
export type { Point } from './settlements';

export interface Shape { outer: Point[]; holes: Point[][] }
export interface Street { path: Point[]; widths: number[]; rank: number; role: string }
export interface Quarter { shape: Shape; phase: number; zone?: string }
export interface Block { shape: Shape; quarter: number; kind: string; axis: Point; zone?: string; phase?: number }
export interface Enclosure { path: Point[]; kind: string; gates: Point[] }
export interface GrowthPhase { culture?: string; kind: string; zone: string; recipe: string; population: number; targetArea: number; shapes: Shape[] }
export interface UrbanStructure {
  version: 1; mechanism: string; family: string; reserve: Shape[]; allocated: Shape[];
  centers: { id: number; point: Point; weight: number }[];
  districts: { id: number; center: number; phase: number; tissue: string; quarters: number[] }[];
  history: { epoch: number; kind: string; center: number; area: number }[];
  metrics: { targetArea: number; allocatedArea: number; streetArea: number; reservedArea: number; grossDensity: number; plannedPopulation: number; shortfallArea: number; components: number; accessAdded: number };
}
export interface Layout { config?: LayoutConfig; programme?: UrbanProgramme; key: string; culture: string; center: Point; quarters: Quarter[]; streets: Street[]; blocks: Block[]; enclosures?: Enclosure[]; phases?: GrowthPhase[]; archetype?: string; structure?: UrbanStructure; warnings: string[] }
export interface Parcel { pressure?: number; id?: string; parentIds?: string[]; provenance?: string[]; family?: string; reason?: string; contacts?: ParcelContact[]; envelope?: Shape; shape: Shape; block: number; use: 'plot' | 'garden' | 'place' | 'compound' | 'market' | 'reserve' | 'common' | 'residual' | 'court'; front: [Point, Point] | null; axis: Point; rank: number; access?: { kind: 'public' | 'collective' | 'private' | 'unserved' | 'reserved' | 'attached'; street: number | null; frontLength: number } }
export interface Partition { config?: ParcelConfig; programme?: UrbanProgramme; key: string; parcels: Parcel[]; warnings: string[]; diagnostics?: { coveredArea: number; residualArea: number; overlapArea: number; unservedArea: number } }
export interface ParcelContact { a: Point; b: Point; street: number; rank: number; length: number; kind: string }
export interface UrbanAdmissibility { recipeId: string; nativeLayout: string; floors: [number, number]; eras: string[]; minFrontage: number; minAccessWidth: number; minArea: number; minDepth: number; maxSlope: number; sharedAccess: boolean; partyWalls: boolean }
export interface CultureMapping { culture: string; family: string; functionalProfile: string; architectureFamily: string; architecturePack: string; coverage: string; borrowing: string; admissibility: UrbanAdmissibility }
export interface UrbanDemand { id: string; function: string; unit: 'domesticUnits' | 'usefulAreaM2'; requested: number; targetArea: number; targetFrontage: number; provenance: string[]; requires: string[]; parcelCapacity: number; builtCapacity: number; openCapacity?: number; deficit: number; reasons: string[] }
export interface UrbanAllocation { parcelId: string; demandId: string; function: string; culture: string; architecturePack: string; capacity: number; unit: 'domesticUnits' | 'usefulAreaM2'; score: number; reasons: string[] }
export interface UrbanProgramme {
  version: 1; population: number; context: import('./urbanConfig').ProgrammeContext; cultures: CultureMapping[]; demands: UrbanDemand[];
  reservations: { id: string; demandId: string; block: number; shape: Shape; street: number; frontage: number }[];
  allocations: UrbanAllocation[]; adjacency: { a: string; b: string; sharedLength: number }[];
  environment: { block: number; slope: number; wet: boolean; waterfront: boolean; pressure?: number }[]; reconciliationPasses: number; warnings: string[];
}
/** Include outward growth when framing a completed settlement. */
export function layoutExtent(layouts?: Layout[]): { center: Point; radius: number } | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layout of layouts ?? []) for (const shape of layout.structure?.allocated ?? layout.quarters.map(q => q.shape)) for (const p of shape.outer) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return Number.isFinite(x0) ? { center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, radius: Math.max(x1 - x0, y1 - y0) / 2 } : undefined;
}

/** Preserve crossing spans when the regional network becomes urban frontage. */
export function regionalStreets(roads?: RoadOutput): Street[] {
  return roads?.segments.flatMap(segment => {
    const points = segment.path;
    if (points.length < 2) return [];
    const rank = segment.class === 'highway' ? 0 : segment.class === 'main' ? 1 : 2;
    const station = [0];
    for (let i = 1; i < points.length; i++) station.push(station[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const project = (p: Point): number => {
      let best = Infinity, at = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
        if (d < best) { best = d; at = station[i - 1] + t * (station[i] - station[i - 1]); }
      }
      return at;
    };
    const crossings = segment.crossings.filter(c => c.path.length > 1).map(c => {
      const a = project(c.path[0]), b = project(c.path[c.path.length - 1]);
      return { from: Math.min(a, b), to: Math.max(a, b), role: c.kind };
    });
    const total = station[station.length - 1];
    const cuts = [...new Set([0, total, ...crossings.flatMap(c => [c.from, c.to])])].sort((a, b) => a - b);
    const pointAt = (d: number): Point => {
      let i = 1; while (i < station.length - 1 && station[i] < d) i++;
      const t = (d - station[i - 1]) / (station[i] - station[i - 1] || 1), a = points[i - 1], b = points[i];
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    };
    return cuts.slice(1).flatMap((to, i): Street[] => {
      const from = cuts[i]; if (to - from < 0.001) return [];
      const mid = (from + to) / 2, role = crossings.find(c => mid >= c.from && mid <= c.to)?.role ?? 'regional';
      const path = [pointAt(from), ...points.filter((_, j) => station[j] > from && station[j] < to), pointAt(to)];
      return [{ path, widths: path.map(() => segment.width), rank, role }];
    });
  }) ?? [];
}
export interface UrbanRequest { id: number; seed: string; kind: 'quarters' | 'parcels' | 'programme' | 'buildingSites' | 'builtCapacity'; architectureCulture?: string; scene?: import('./urbanArchitecture').PlacementBatch; raster?: SettlementRaster; sites?: RoadSite[]; roads?: Street[]; layoutConfig?: LayoutConfig; parcelConfig?: ParcelConfig; layouts?: Layout[]; partitions?: Partition[]; layoutsId?: number; runtime?: ExecutionRuntime }
export interface UrbanResponse { id: number; layouts?: Layout[]; partitions?: Partition[]; placementRequests?: import('./urbanArchitecture').PlacementRequest[]; ms?: number; error?: string }
export interface UrbanEngine { run(request: UrbanRequest): UrbanResponse | Promise<UrbanResponse> }

/** Reconciliation needs capacities, identities and open surfaces, never roof
 * meshes or retained architectural plans. Keep those out of the native transfer. */
function capacityInput(scene: UrbanRequest['scene']) {
  if (!scene) return undefined;
  return {
    buildings: scene.buildings.map(({ parcel_id, function: fn, useful_area_m2, domestic_units }) => ({ parcel_id, function: fn, useful_area_m2, domestic_units })),
    refusals: scene.refusals.map(({ parcel_id, message }) => ({ parcel_id, message })),
    open_spaces: scene.open_spaces,
  };
}

/** Both calls run exclusively in Rust and keep their own immutable terrain handle. */
export async function createUrbanEngine(runtime?: ExecutionRuntime): Promise<UrbanEngine> {
  if (runtime?.profile !== 'local') await init({ module_or_path: await (await fetch(wasmUrl)).arrayBuffer() });
  let terrain: SettlementTerrain | undefined;
  let retainedLayouts: { id: number; json: string } | undefined;
  const native = nativeRasterClient();
  return { run(request) {
    if (request.runtime?.profile === 'local') {
      return native<UrbanResponse>('/urban', { ...request, runtime: request.runtime,
        ...(request.kind === 'builtCapacity' ? { scene: capacityInput(request.scene) } : {}),
        ...(request.kind === 'quarters' ? { layoutConfig: normalizeLayoutConfig(request.layoutConfig, true) }
          : { parcelConfig: normalizeParcelConfig(request.parcelConfig) }),
      }).catch(error => ({ id: request.id, error: String(error) }));
    }
    try {
      if (request.raster) {
        const r = request.raster;
        retainedLayouts = undefined;
        terrain?.free();
        terrain = undefined;
        const next = new SettlementTerrain(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
        try { if (r.geometry) next.set_urban_geometry(JSON.stringify(r.geometry)); }
        catch (error) { next.free(); throw error; }
        terrain = next;
      }
      if (!terrain) throw new Error('Générez le terrain avant les quartiers.');
      const start = performance.now();
      if (request.kind === 'quarters') {
        retainedLayouts = undefined;
        const layouts = JSON.parse(terrain.urban_quarters(request.seed, JSON.stringify(request.sites ?? []), JSON.stringify(normalizeLayoutConfig(request.layoutConfig, true)), JSON.stringify(request.roads ?? []))) as Layout[];
        // Preserve the existing JS number roundtrip before Rust parses parcels.
        // Keeping native f64 layouts instead can subtly change polygon cuts.
        retainedLayouts = { id: request.id, json: JSON.stringify(layouts) };
        return { id: request.id, layouts, ms: performance.now() - start };
      }
      const layoutsJson = request.layouts ? JSON.stringify(request.layouts)
        : request.layoutsId === undefined ? '[]'
        : retainedLayouts?.id === request.layoutsId ? retainedLayouts.json : undefined;
      if (layoutsJson === undefined) throw new Error('Le plan des quartiers a changé. Régénérez les quartiers avant les parcelles.');
      if (request.kind === 'builtCapacity') {
        const partitions = JSON.parse(terrain.urban_built_capacity(JSON.stringify(request.partitions ?? []), JSON.stringify(capacityInput(request.scene)))) as Partition[];
        return { id: request.id, partitions, ms: performance.now() - start };
      }
      if (request.kind === 'programme') {
        const partitions = JSON.parse(terrain.urban_programme(layoutsJson, JSON.stringify(request.partitions ?? []))) as Partition[];
        return { id: request.id, partitions, ms: performance.now() - start };
      }
      if (request.kind === 'buildingSites') {
        const placementRequests = JSON.parse(terrain.urban_building_sites(request.seed, layoutsJson, JSON.stringify(request.partitions ?? []), request.architectureCulture)) as import('./urbanArchitecture').PlacementRequest[];
        return { id: request.id, placementRequests, ms: performance.now() - start };
      }
      const partitions = JSON.parse(terrain.urban_parcels(request.seed, layoutsJson, JSON.stringify(normalizeParcelConfig(request.parcelConfig)))) as Partition[];
      return { id: request.id, partitions, ms: performance.now() - start };
    } catch (error) { return { id: request.id, error: String(error) }; }
  } };
}
let fallback: Promise<UrbanEngine> | undefined;
export async function runUrbanRequest(request: UrbanRequest): Promise<UrbanResponse> {
  fallback ??= createUrbanEngine(request.runtime);
  return (await fallback).run(request);
}
