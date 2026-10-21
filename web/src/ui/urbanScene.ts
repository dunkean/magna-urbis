import SceneWorker from './urbanSceneWorker?worker&inline';
import { createUrbanEngine, type Layout, type Partition } from '../../../rust/bridge/urban';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import { placeUrbanBuildings } from '../../../rust/bridge/architecture';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { ExecutionRuntime } from './executionProfile';

export interface UrbanSceneRequest { id: number; layouts: Layout[]; partitions: Partition[]; raster: SettlementRaster; seed: string; settings?: import('../../../rust/bridge/urbanArchitecture').PlacementBatchSettings; runtime?: ExecutionRuntime }
export interface UrbanSceneResponse { id: number; scene?: PlacementBatch; partitions?: Partition[]; timing?: { sites: number; placement: number }; progress?: { completed: number; total: number }; error?: string }

/** Explicit stage ownership: one worker and last successful scene, stale replies ignored. */
export function createUrbanSceneClient() {
  let worker: Worker | undefined, fallback: ReturnType<typeof createUrbanEngine> | undefined, nextId = 0;
  let current: { request: UrbanSceneRequest; progress?(completed: number, total: number): void; resolve(result: UrbanSceneResponse): void; reject(error: Error): void } | undefined;
  const receive = (response: UrbanSceneResponse): void => {
    if (response.id !== current?.request.id) return;
    if (response.progress) { current.progress?.(response.progress.completed, response.progress.total); return; }
    const item = current; current = undefined;
    if (response.error) item.reject(new Error(response.error)); else item.resolve(response);
  };
  async function runFallback(request: UrbanSceneRequest): Promise<void> {
    try {
      fallback ??= createUrbanEngine(request.runtime);
      const start = performance.now();
      const sites = await (await fallback).run({ id: request.id, kind: 'buildingSites', seed: request.seed, runtime: request.runtime,
        raster: request.raster, layouts: request.layouts, partitions: request.partitions, architectureCulture: request.settings?.culture });
      if (sites.error) throw new Error(sites.error);
      const sitesMs = performance.now() - start, placementStart = performance.now();
      const scene = await placeUrbanBuildings({ schema_version: '1', requests: sites.placementRequests ?? [], settings: request.settings }, request.runtime,
        { cancelled: () => current?.request.id !== request.id, progress: (completed, total) => receive({ id: request.id, progress: { completed, total } }) });
      const placementMs = performance.now() - placementStart;
      const balance = await (await fallback).run({ id: request.id, kind: 'builtCapacity', seed: request.seed, runtime: request.runtime, partitions: request.partitions, scene });
      if (balance.error) throw new Error(balance.error);
      receive({ id: request.id, scene, partitions: balance.partitions, timing: { sites: sitesMs, placement: placementMs } });
    } catch (error) { receive({ id: request.id, error: String(error) }); }
  }
  function useFallback(): void {
    worker?.terminate(); worker = undefined;
    if (current) void runFallback(current.request);
  }
  return {
    run(input: Omit<UrbanSceneRequest, 'id'>, progress?: (completed: number, total: number) => void): Promise<UrbanSceneResponse> {
      current?.reject(new DOMException('Calcul remplacé', 'AbortError'));
      const request = { ...input, id: ++nextId };
      return new Promise((resolve, reject) => {
        current = { request, resolve, reject, progress };
        if (fallback) { void runFallback(request); return; }
        if (!worker) {
          try { worker = new SceneWorker(); worker.onmessage = event => receive(event.data); worker.onerror = event => { event.preventDefault(); useFallback(); }; }
          catch { useFallback(); return; }
        }
        try { worker.postMessage(request); } catch { useFallback(); }
      });
    },
    invalidate(): void {
      ++nextId; current?.reject(new DOMException('Plan remplacé', 'AbortError')); current = undefined;
      // Stop dispatching further native chunks even if no replacement scene is
      // requested. At most the already submitted native chunk remains in flight.
      worker?.terminate(); worker = undefined;
    },
    dispose(): void { ++nextId; current?.reject(new DOMException('Atelier fermé', 'AbortError')); current = undefined; worker?.terminate(); worker = undefined; fallback = undefined; },
  };
}
