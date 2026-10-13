import init, { SettlementTerrain } from '../pkg/wasm/magna_urbis_wasm.js';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import type { Point, RoadOutput, RoadSite, SettlementRaster } from './settlements';
export type { Point } from './settlements';

export interface Shape { outer: Point[]; holes: Point[][] }
export interface Street { path: Point[]; widths: number[]; rank: number; role: string }
export interface Quarter { shape: Shape; phase: number; zone?: string }
export interface Block { shape: Shape; quarter: number; kind: string; axis: Point; zone?: string }
export interface Enclosure { path: Point[]; kind: string; gates: Point[] }
export interface Layout { key: string; culture: string; center: Point; quarters: Quarter[]; streets: Street[]; blocks: Block[]; enclosures?: Enclosure[]; warnings: string[] }
export interface Parcel { shape: Shape; block: number; use: 'plot' | 'garden' | 'place' | 'compound' | 'market' | 'reserve'; front: [Point, Point] | null; axis: Point; rank: number }
export interface Partition { key: string; parcels: Parcel[]; warnings: string[] }
export interface ParcelConfig { preset: string; culture?: string; recipe: string; zone: string; density: number; params: Record<string, unknown> }
export interface LayoutConfig extends ParcelConfig {
  count: number; rings: number; radius: number; radiusScale: number; placement: 'center' | 'rectangle' | 'skew' | 'notched'; monument: string;
  fortification: 'culture' | 'none' | 'wall' | 'palisade'; maxStreetGrade: number; maxLaneGrade: number; maxStairGrade: number; allowStairs: boolean;
}
export const defaultLayoutConfig = (): LayoutConfig => ({ preset: 'culture', culture: 'site', recipe: 'core', zone: 'auto', density: 1, count: 4, rings: 1, radius: 0, radiusScale: 1, placement: 'center', params: {}, monument: 'none', fortification: 'culture', maxStreetGrade: 0.12, maxLaneGrade: 0.18, maxStairGrade: 0.65, allowStairs: true });
export const defaultParcelConfig = (): ParcelConfig => ({ preset: 'culture', culture: 'site', recipe: 'core', zone: 'auto', density: 1, params: {} });

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
export interface UrbanRequest { id: number; seed: string; kind: 'quarters' | 'parcels'; raster?: SettlementRaster; sites?: RoadSite[]; roads?: Street[]; layoutConfig?: LayoutConfig; parcelConfig?: ParcelConfig; layouts?: Layout[] }
export interface UrbanResponse { id: number; layouts?: Layout[]; partitions?: Partition[]; ms?: number; error?: string }
export interface UrbanEngine { run(request: UrbanRequest): UrbanResponse }

/** Both calls run exclusively in Rust and keep their own immutable terrain handle. */
export async function createUrbanEngine(): Promise<UrbanEngine> {
  await init({ module_or_path: await (await fetch(wasmUrl)).arrayBuffer() });
  let terrain: SettlementTerrain | undefined;
  return { run(request) {
    try {
      if (request.raster) {
        const r = request.raster;
        terrain?.free();
        terrain = new SettlementTerrain(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
      }
      if (!terrain) throw new Error('Générez le terrain avant les quartiers.');
      const start = performance.now();
      if (request.kind === 'quarters') {
        const layouts = JSON.parse(terrain.urban_quarters(request.seed, JSON.stringify(request.sites ?? []), JSON.stringify(request.layoutConfig ?? defaultLayoutConfig()), JSON.stringify(request.roads ?? []))) as Layout[];
        return { id: request.id, layouts, ms: performance.now() - start };
      }
      const partitions = JSON.parse(terrain.urban_parcels(request.seed, JSON.stringify(request.layouts ?? []), JSON.stringify(request.parcelConfig ?? defaultParcelConfig()))) as Partition[];
      return { id: request.id, partitions, ms: performance.now() - start };
    } catch (error) { return { id: request.id, error: String(error) }; }
  } };
}
let fallback: Promise<UrbanEngine> | undefined;
export async function runUrbanRequest(request: UrbanRequest): Promise<UrbanResponse> {
  fallback ??= createUrbanEngine();
  return (await fallback).run(request);
}
