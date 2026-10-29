import init, { SettlementTerrain } from '../pkg/wasm/magna_urbis_wasm.js';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import type { RoadOutput, SettlementOutput, SettlementRequest, SettlementResponse } from './settlements';
import { nativeRasterClient } from './nativeEngine';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';

export interface SettlementEngine { run(request: SettlementRequest): SettlementResponse | Promise<SettlementResponse>; dispose?(): void }

/**
 * Runs placement and routing requests on one Rust terrain handle, kept until a new raster
 * arrives. Shared by the settlement worker and the main-thread fallback.
 */
export async function createSettlementEngine(runtime?: ExecutionRuntime): Promise<SettlementEngine> {
  if (runtime?.profile !== 'local') await init({ module_or_path: await (await fetch(wasmUrl)).arrayBuffer() });
  let terrain: SettlementTerrain | undefined;
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
          terrain = new SettlementTerrain(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
        }
        if (!terrain) throw new Error('Generate a terrain first.');
        let settlements: SettlementOutput | undefined, sites = request.sites ?? [];
        if (request.place) {
          const start = performance.now();
          settlements = JSON.parse(terrain.place(request.seed, JSON.stringify(request.place))) as SettlementOutput;
          settlements.ms = performance.now() - start;
          sites = settlements.settlements.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));
        }
        let roads: RoadOutput | null = null;
        if (request.roads) {
          const start = performance.now();
          roads = JSON.parse(terrain.roads(request.seed, JSON.stringify(sites), JSON.stringify(request.roads))) as RoadOutput;
          roads.ms = performance.now() - start;
        }
        return { id: request.id, settlements, roads };
      } catch (error) { return { id: request.id, error: String(error) }; }
    },
  };
}
