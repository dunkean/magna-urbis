import { createUrbanEngine } from '../../../rust/bridge/urban';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import type { ArchitectureBatchOptions } from '../../../rust/bridge/architectureBatch';
import type { PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import { beginUrbanBuildingPages, URBAN_BUILDING_PAGE_LIMIT } from '../../../rust/bridge/urbanBuildingPages';
import { RASTER_MISSING, sceneMode, usesCompactPlans, validateProjectedSiteStream, sceneRuntimeKey, urbanBuildingSitesRequest, type UrbanSceneRequest, type UrbanSceneResponse, type UrbanSceneWorkerMessage } from './urbanSceneProtocol';
import { urbanSceneCompletion } from './urbanSceneProgress';
import { silhouetteScene, type CityPlacementRequest } from './urbanSilhouettes';
import { applyHouseEdits } from './cityEdits';
import { projectUrbanSite } from './urbanSiteStore';

// The worker outlives plan changes: its engine keeps the native session (or the
// WASM terrain) and the raster is only sent again when it changes.
let engine: ReturnType<typeof createUrbanEngine> | undefined, raster: SettlementRaster | undefined;
let engineRuntime: string | undefined;
let pending: UrbanSceneRequest | undefined, running = false, cancelledThrough = 0;
let acknowledgement: { id: number; completed: number; resolve(): void; reject(error: Error): void } | undefined;
function cancelAcknowledgement(): void {
  const waiting = acknowledgement; acknowledgement = undefined;
  waiting?.reject(new DOMException('Calcul remplacé', 'AbortError'));
}
self.onmessage = (event: MessageEvent<UrbanSceneWorkerMessage>) => {
  if ('ack' in event.data) {
    const ack = event.data.ack;
    if (acknowledgement?.id === ack.id && acknowledgement.completed === ack.completed) {
      const waiting = acknowledgement; acknowledgement = undefined; waiting.resolve();
    }
    return;
  }
  if ('cancel' in event.data) {
    cancelledThrough = Math.max(cancelledThrough, event.data.cancel);
    if (acknowledgement && acknowledgement.id <= cancelledThrough) cancelAcknowledgement();
    return;
  }
  pending = event.data;
  if (acknowledgement && acknowledgement.id !== pending.id) cancelAcknowledgement();
  if (!running) void drain();
};
async function drain(): Promise<void> {
  running = true;
  while (pending) {
    const request = pending; pending = undefined;
    const cancelled = (): boolean => request.id <= cancelledThrough || Boolean(pending && pending.id !== request.id);
    if (cancelled()) continue;
    try {
      validateProjectedSiteStream(request);
      if (engineRuntime !== sceneRuntimeKey(request.runtime)) { engine = undefined; raster = undefined; engineRuntime = sceneRuntimeKey(request.runtime); }
      const pipelineStart = performance.now();
      if (request.source && request.runtime?.profile === 'local' && usesCompactPlans(request) && request.progressive) {
        const pages = await beginUrbanBuildingPages({ source: request.source, keys: request.keys, seed: request.seed,
          architectureCulture: request.settings?.culture }, request.runtime, { cancelled, requireSiteRead: request.requireProjectedSiteStream === true });
        if (cancelled()) continue;
        if (request.requireProjectedSiteStream && (!pages || !pages.siteQuery)) throw new Error('Projected site stream capabilities are unavailable; full-site fallback is forbidden.');
        if (pages) {
          // Only a pending chunk's original sites survive editing. Preserve
          // them through transport retries and ACK; never collect the city.
          const originals = new Map<number, PlacementRequest>();
          const edited = { total: pages.total, read: async (offset: number, limit: number, maxBytes: number) => {
            const page = await pages.read(offset, limit, maxBytes);
            page.forEach((site, i) => originals.set(offset + i, site));
            if (originals.size > URBAN_BUILDING_PAGE_LIMIT) throw new Error('Retained building-site buffer exceeds one native chunk.');
            return applyHouseEdits([...page], request.buildingOverrides);
          } };
          const { streamUrbanBuildingSource } = await import('../../../rust/bridge/architecture');
          const complete = await streamUrbanBuildingSource({ schema_version: '1', settings: request.settings }, edited, request.runtime, {
            cancelled, progress: (completed, total) => self.postMessage({ id: request.id, progress: { completed, total } } satisfies UrbanSceneResponse),
            onBatch: async (delta, progress) => {
              const sites: PlacementRequest[] = [];
              for (let offset = progress.start; offset < progress.completed; offset++) {
                const site = originals.get(offset);
                if (!site) throw new Error('Missing original retained building site for the acknowledged chunk.');
                sites.push(site);
              }
              await new Promise<void>((resolve, reject) => {
                if (cancelled()) { reject(new DOMException('Calcul remplacé', 'AbortError')); return; }
                acknowledgement = { id: request.id, completed: progress.completed, resolve, reject };
                try { self.postMessage({ id: request.id, batch: { delta, progress,
                  ...(pages.siteQuery ? { requests: [], sites: sites.map((site, i) => projectUrbanSite(site, progress.start + i)) } : { requests: sites }) } } satisfies UrbanSceneResponse); }
                catch (error) { acknowledgement = undefined; reject(error); }
              });
              for (let offset = progress.start; offset < progress.completed; offset++) originals.delete(offset);
            },
          });
          if (cancelled()) continue;
          const sites = pages.timing.prepareMs + pages.timing.readMs;
          self.postMessage({ id: request.id, complete, ...(pages.siteQuery ? { siteQuery: pages.siteQuery } : {}), timing: { sites, sitesPrepare: pages.timing.prepareMs, sitesRead: pages.timing.readMs,
            paged: true, placement: Math.max(0, performance.now() - pipelineStart - sites) } } satisfies UrbanSceneResponse);
          continue;
        }
        // Capability absence alone reaches the legacy full-site read below.
        // A failed begin/page bubbles out; it must never re-upload or regenerate.
      }
      engine ??= createUrbanEngine(request.runtime);
      // A new raster is uploaded once; later runs reuse the retained terrain.
      const upload = !request.source && request.raster && request.raster !== raster ? request.raster : undefined;
      if (!request.source && request.raster) raster = request.raster;
      if (!request.source && !raster) { self.postMessage({ id: request.id, error: RASTER_MISSING } satisfies UrbanSceneResponse); continue; }
      const start = performance.now();
      const sites = await (await engine).run(urbanBuildingSitesRequest(request, upload));
      if (sites.error) {
        if (!request.source) raster = undefined;
        throw new Error(request.source ? `Lecture de la source urbaine retenue impossible : ${sites.error}` : sites.error);
      }
      if (cancelled()) continue;
      const requests = (sites.placementRequests ?? []) as CityPlacementRequest[];
      const sitesMs = performance.now() - start, placementStart = performance.now(), mode = sceneMode(request);
      if (mode === 'silhouette') { self.postMessage({ id: request.id, scene: silhouetteScene(requests), timing: { sites: sitesMs, placement: performance.now() - placementStart } } satisfies UrbanSceneResponse); continue; }
      const progress = (completed: number, total: number): void => self.postMessage({ id: request.id, progress: { completed, total } } satisfies UrbanSceneResponse);
      const options: ArchitectureBatchOptions = { cancelled, progress,
        ...(request.progressive ? { onBatch: (delta, progress) => new Promise<void>((resolve, reject) => {
          if (cancelled()) { reject(new DOMException('Calcul remplacé', 'AbortError')); return; }
          // Only one chunk can be waiting: the bridge awaits this callback before
          // dispatching the next native request. Cancellation releases this wait.
          acknowledgement = { id: request.id, completed: progress.completed, resolve, reject };
          try { self.postMessage({ id: request.id, batch: { delta, progress,
            requests: requests.slice(progress.start, progress.completed) } } satisfies UrbanSceneResponse); }
          catch (error) { acknowledgement = undefined; reject(error); }
        }) } : {}) };
      // Houses WASM / native architecture is loaded on first use.
      const { placeUrbanBuildings, planUrbanBuildings, streamUrbanBuildingPlans } = await import('../../../rust/bridge/architecture');
      const compact = usesCompactPlans(request);
      const planInput = { schema_version: '1' as const, requests: applyHouseEdits(requests, request.buildingOverrides), settings: request.settings };
      if (compact && options.onBatch) {
        // The main thread owns the accumulated scene. The worker keeps only the
        // continuous occupancy index until this stream ends, not its archives,
        // full buildings, refusals, open spaces or material tables after ACK.
        const complete = await streamUrbanBuildingPlans(planInput, request.runtime, { ...options, onBatch: options.onBatch });
        if (cancelled()) continue;
        self.postMessage({ id: request.id, complete,
          timing: { sites: sitesMs, placement: performance.now() - placementStart } } satisfies UrbanSceneResponse);
        continue;
      }
      // Both explicit City modes retain native plans. Detailed display realizes
      // visible/selected houses lazily; a plan does not certify built capacity.
      const scene = await (compact ? planUrbanBuildings : placeUrbanBuildings)(
        planInput, request.runtime, options);
      if (cancelled()) continue;
      const placementMs = performance.now() - placementStart;
      let partitions: UrbanSceneResponse['partitions'];
      if (!compact) {
        const balance = await (await engine).run({ id: request.id, kind: 'builtCapacity', seed: request.seed, runtime: request.runtime, partitions: request.partitions, scene });
        if (cancelled()) continue;
        if (balance.error) throw new Error(balance.error);
        partitions = balance.partitions;
      }
      self.postMessage({ id: request.id, ...(request.progressive ? { complete: urbanSceneCompletion(scene) } : { scene, requests }),
        partitions, timing: { sites: sitesMs, placement: placementMs } } satisfies UrbanSceneResponse);
    } catch (error) { if (!cancelled()) self.postMessage({ id: request.id, error: String(error) } satisfies UrbanSceneResponse); }
  }
  running = false;
}
