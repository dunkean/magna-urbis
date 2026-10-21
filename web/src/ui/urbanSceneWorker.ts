import { createUrbanEngine } from '../../../rust/bridge/urban';
import { placeUrbanBuildings } from '../../../rust/bridge/architecture';
import type { UrbanSceneRequest, UrbanSceneResponse } from './urbanScene';

let engine: ReturnType<typeof createUrbanEngine> | undefined;
let pending: UrbanSceneRequest | undefined, running = false;
self.onmessage = (event: MessageEvent<UrbanSceneRequest>) => {
  pending = event.data;
  if (!running) void drain();
};
async function drain(): Promise<void> {
  running = true;
  while (pending) {
    const request = pending; pending = undefined;
    try {
      engine ??= createUrbanEngine(request.runtime);
      const start = performance.now();
      const sites = await (await engine).run({ id: request.id, kind: 'buildingSites', seed: request.seed, runtime: request.runtime,
        raster: request.raster, layouts: request.layouts, partitions: request.partitions, architectureCulture: request.settings?.culture });
      if (sites.error) throw new Error(sites.error);
      const sitesMs = performance.now() - start, placementStart = performance.now();
      const scene = await placeUrbanBuildings({ schema_version: '1', requests: sites.placementRequests ?? [], settings: request.settings }, request.runtime,
        { cancelled: () => Boolean(pending && pending.id !== request.id),
          progress: (completed, total) => self.postMessage({ id: request.id, progress: { completed, total } } satisfies UrbanSceneResponse) });
      const placementMs = performance.now() - placementStart;
      const balance = await (await engine).run({ id: request.id, kind: 'builtCapacity', seed: request.seed, runtime: request.runtime, partitions: request.partitions, scene });
      if (balance.error) throw new Error(balance.error);
      self.postMessage({ id: request.id, scene, partitions: balance.partitions, timing: { sites: sitesMs, placement: placementMs } } satisfies UrbanSceneResponse);
    } catch (error) { self.postMessage({ id: request.id, error: String(error) } satisfies UrbanSceneResponse); }
  }
  running = false;
}
