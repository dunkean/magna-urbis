import init, { SettlementTerrain } from '../pkg/wasm/magna_urbis_wasm.js';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import type { Point, RoadSite, SettlementRaster } from './settlements';
export type { Point } from './settlements';

export interface Shape { outer: Point[]; holes: Point[][] }
export interface Street { path: Point[]; widths: number[]; rank: number; role: string }
export interface Quarter { shape: Shape; phase: number }
export interface Block { shape: Shape; quarter: number; kind: string; axis: Point }
export interface Layout { key: string; culture: string; center: Point; quarters: Quarter[]; streets: Street[]; blocks: Block[]; warnings: string[] }
export interface Parcel { shape: Shape; block: number; use: 'plot' | 'garden' | 'place' | 'compound' | 'market'; front: [Point, Point] | null; axis: Point; rank: number }
export interface Partition { key: string; parcels: Parcel[]; warnings: string[] }
export interface ParcelConfig { preset: string; culture?: string; recipe: string; zone: string; density: number; params: Record<string, unknown> }
export interface LayoutConfig extends ParcelConfig { count: number; rings: number; radius: number; radiusScale: number; placement: 'center' | 'rectangle' | 'skew' | 'notched'; monument: string }
export const defaultLayoutConfig = (): LayoutConfig => ({ preset: 'culture', culture: 'site', recipe: 'core', zone: 'core', density: 1, count: 4, rings: 1, radius: 0, radiusScale: 1, placement: 'center', params: {}, monument: 'none' });
export const defaultParcelConfig = (): ParcelConfig => ({ preset: 'culture', culture: 'site', recipe: 'core', zone: 'core', density: 1, params: {} });
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
