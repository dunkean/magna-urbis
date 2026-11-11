import { loadCoreWasm } from './wasmRuntime';
import type { RoadOutput, SettlementOutput, SettlementRequest, SettlementResponse } from './settlements';
import type { ResourcePayload } from './resources';
import { nativeRasterClient } from './nativeEngine';
import { validatePhysicalTerrain } from './settlements';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';

export interface SettlementEngine { run(request: SettlementRequest): SettlementResponse | Promise<SettlementResponse>; dispose?(): void }

/**
 * Runs placement and routing requests on one Rust terrain handle, kept until a new raster
 * arrives. Shared by the settlement worker and the main-thread fallback.
 */
export async function createSettlementEngine(runtime?: ExecutionRuntime): Promise<SettlementEngine> {
  // The realm's core package: in an isolated worker the threads build, so placement, road search and
  // resources run on the rayon pool (they were serial on a second, single-thread instance).
  const SettlementTerrain = runtime?.profile !== 'local' ? (await loadCoreWasm()).SettlementTerrain : undefined;
  let terrain: InstanceType<NonNullable<typeof SettlementTerrain>> | undefined;
  const native = nativeRasterClient();
  return {
    dispose() { terrain?.free(); terrain = undefined; },
    run(request) {
      if (request.runtime?.profile === 'local') {
        return native<SettlementResponse>('/settlements', { ...request, runtime: request.runtime })
          .catch(error => ({ id: request.id, error: String(error) }));
      }
      try {
        if (request.raster) {
          const r = request.raster;
          terrain?.free();
          validatePhysicalTerrain(r.physical);
          if (!SettlementTerrain) throw new Error('Core WASM is not loaded.');
          terrain = new SettlementTerrain(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
          if (r.physical) {
            const physical = terrain as typeof terrain & {
              set_physical_height(n: number, height: Float32Array): void;
              set_physical_height_spline(n: number, height: Float32Array, floor: number): void;
            };
            if (r.physical.interpolation === 'bspline') physical.set_physical_height_spline(r.physical.n, r.physical.height, r.physical.floor ?? 0);
            else physical.set_physical_height(r.physical.n, r.physical.height);
          }
          if (r.region) terrain.set_region(r.region.seed, r.region.temperature, r.region.precipitation, r.region.biome, r.region.x, r.region.y);
        }
        if (!terrain) throw new Error('Generate a terrain first.');
        let settlements: SettlementOutput | undefined, sites = request.sites ?? [];
        if (request.place) {
          const start = performance.now();
          settlements = JSON.parse(terrain.place(request.seed, JSON.stringify(request.place))) as SettlementOutput;
          settlements.ms = performance.now() - start;
          // Same as settlements.ts roadSitesOf (not imported: settlements.ts imports this module).
          sites = [...settlements.settlements.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius })),
            ...(settlements.activities ?? []).map(a => ({ key: a.id, population: 0, culture: a.culture, center: a.access, radius: 0, access: a.accessClass, parent: a.parent }))];
        }
        let roads: RoadOutput | null = null;
        if (request.roads) {
          const start = performance.now();
          roads = JSON.parse(terrain.roads(request.seed, JSON.stringify(sites), JSON.stringify(request.roads))) as RoadOutput;
          roads.ms = performance.now() - start;
        }
        const resources = request.resources ? JSON.parse(terrain.resources()) as ResourcePayload : undefined;
        return { id: request.id, settlements, roads, ...(resources ? { resources } : {}) };
      } catch (error) { return { id: request.id, error: String(error) }; }
    },
  };
}
