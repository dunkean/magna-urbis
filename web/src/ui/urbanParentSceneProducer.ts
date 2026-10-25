/** ONE producer used by the real architecture Worker AND main-thread fallback.
 * No source upload/all-city projection in the retained local paged branch. */
import { nativeParentSessionApi } from '../../../rust/bridge/architecture';
import { beginUrbanBuildingPages, URBAN_BUILDING_PAGE_LIMIT } from '../../../rust/bridge/urbanBuildingPages';
import { createUrbanEngine } from '../../../rust/bridge/urban';
import type { ArchitectureRequestSource } from '../../../rust/bridge/architectureBatch';
import { streamNativeParentSession } from '../../../rust/bridge/nativeParentSessionStream';
import { parentWire } from '../../../rust/bridge/nativeParentBudget';
import { architectureProfile, type PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import type { NativeParentSessionApi } from '../../../rust/bridge/nativeParentSessionContract';
import { urbanSceneTransport, urbanBuildingSitesRequest, sceneRuntimeKey, type UrbanSceneRequest } from './urbanSceneProtocol';
import type { UrbanParentWorkerBatch, UrbanParentWorkerBegin, UrbanParentWorkerCompletion, UrbanParentAcknowledged } from './urbanParentSceneProtocol';
import { applyHouseEdits } from './cityEdits';
import { projectUrbanSite } from './urbanSiteStore';
let compatibilityEngine: ReturnType<typeof createUrbanEngine> | undefined, compatibilityRuntime = '';
export interface UrbanParentProducerOptions {
  cancelled(): boolean;
  acknowledged?(value: UrbanParentAcknowledged): void | Promise<void>;
  begin(reply: UrbanParentWorkerBegin): void | Promise<void>;
  batch(value: UrbanParentWorkerBatch): Promise<void>;
  complete(value: UrbanParentWorkerCompletion): void | Promise<void>;
  /** Protocol test injection only; default is the actual qualified local/Wasm API. */
  api?: NativeParentSessionApi;
}
export async function produceUrbanParentScene(input: UrbanSceneRequest, options: UrbanParentProducerOptions): Promise<void> {
  const request = urbanSceneTransport(input), identity = request.parentSession;
  if (!identity) throw new Error('Missing native parent generation identity.');
  const cancelled = () => { if (options.cancelled()) throw new DOMException('Native parent city replaced', 'AbortError'); };
  const api = options.api ?? nativeParentSessionApi(request.runtime);
  await api.require(); cancelled(); // BEFORE any Core building-site begin/read.
  const started = performance.now(), originals = new Map<number, PlacementRequest>();
  const overrides = request.buildingOverrides ? structuredClone(request.buildingOverrides) : undefined;
  let source: ArchitectureRequestSource, prepare = 0, read = 0, paged = false;
  const pages = request.source && request.runtime?.profile === 'local'
    ? await beginUrbanBuildingPages({ source: request.source, keys: request.keys, seed: request.seed, architectureCulture: architectureProfile(request.settings) },
      request.runtime, { cancelled: options.cancelled, requireSiteRead: true }) : undefined;
  cancelled();
  if (request.source && !pages) throw new Error('Parent city source requires real paged building-site support; full-source fallback forbidden.');
  if (pages) {
    paged = true; prepare = pages.timing.prepareMs;
    source = { total: pages.total, read: async (offset, limit, bytes) => {
      const page = await pages.read(offset, limit, bytes); cancelled();
      page.forEach((s, i) => originals.set(offset + i, s));
      if (originals.size > URBAN_BUILDING_PAGE_LIMIT) throw new Error('Parent source buffer exceeds one native prefix.');
      return applyHouseEdits([...page], overrides);
    } };
  } else {
    // Explicit already-resident compatibility source (Wasm/legacy local input).
    // This is not a claim of O(viewport) Core/site residency.
    const siteStart = performance.now(), key = sceneRuntimeKey(request.runtime);
    if (!compatibilityEngine || compatibilityRuntime !== key) { compatibilityEngine = createUrbanEngine(request.runtime); compatibilityRuntime = key; }
    const engine = await compatibilityEngine;
    const result = await engine.run(urbanBuildingSitesRequest(request, request.raster)); cancelled();
    if (result.error) throw new Error(result.error);
    const rows = result.placementRequests ?? []; prepare = performance.now() - siteStart;
    source = { total: rows.length, read: async (offset, limit) => {
      const page = rows.slice(offset, offset + limit); page.forEach((s, i) => originals.set(offset + i, s));
      if (originals.size > URBAN_BUILDING_PAGE_LIMIT) throw new Error('Resident parent source exceeds one prefix buffer.');
      return applyHouseEdits(page, overrides);
    } };
  }
  try {
    const summary = await streamNativeParentSession({ schema_version: '1', settings: request.settings }, source, identity, api, {
      cancelled: options.cancelled, onBegin: options.begin, onAcknowledged: (receipt, reply) => options.acknowledged?.({ receipt, reply }),
      onBatch: async (batch, progress, boundary, _actualRequests, receipt, sessionId, nativeBatchJson) => {
        const sites = [];
        for (let offset = progress.start; offset < progress.completed; offset++) {
          const original = originals.get(offset); if (!original) throw new Error('Missing exact original parent site.');
          sites.push(projectUrbanSite(original, offset));
        }
        await options.batch({ batch_json: nativeBatchJson ?? parentWire(batch).json, receipt, sessionId,
          administrativeEmpty: receipt === null, progress, boundary, sites });
        cancelled(); for (let offset = progress.start; offset < progress.completed; offset++) originals.delete(offset);
      },
    }); cancelled();
    if (pages) read = pages.timing.readMs;
    await options.complete({ summary, timing: { sites: prepare + read, sitesPrepare: prepare, sitesRead: read, paged,
      placement: Math.max(0, performance.now() - started - prepare - read) } });
  } finally { originals.clear(); }
}
