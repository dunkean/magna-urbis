import type { PlacementBatch, PlacementBatchRequest, PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import { prepareUrbanOpenDeficits } from '../../../rust/bridge/urbanOpenDeficits';
import SceneWorker from './urbanSceneWorker?worker&inline';
import { createUrbanEngine } from '../../../rust/bridge/urban';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import type { ArchitectureBatchOptions, ArchitectureBatchProgress } from '../../../rust/bridge/architectureBatch';
import { registerPlanArchives } from '../../../rust/bridge/compactPlanArchive';
import { silhouetteScene, type CityPlacementRequest } from './urbanSilhouettes';
import { applyHouseEdits } from './cityEdits';
import { createUrbanSceneAccumulator, urbanSceneCompletion, type UrbanSceneBatchCallback, type UrbanSceneCompletion } from './urbanSceneProgress';
import { beginUrbanBuildingStage, type BuildingChunkBackend, type BuildingChunkManifest } from './urbanBuildingChunkStore';
import { projectNativeBuildingChunk, type NativeBuildingProjectionScene } from './urbanBuildingProjection';
import type { UrbanSiteVisual } from './urbanSiteStore';
import { copyBuildingSiteQuery, type UrbanBuildingSiteQuery } from '../../../rust/bridge/urbanBuildingSite';

import { RASTER_MISSING, sceneMode, usesCompactPlans, sceneRuntimeKey, urbanSceneTransport, urbanBuildingSitesRequest, type UrbanSceneRequest, type UrbanSceneResponse } from './urbanSceneProtocol';
export { RASTER_MISSING, sceneMode, type UrbanSceneMode, type UrbanSceneRequest, type UrbanSceneResponse } from './urbanSceneProtocol';
export type { UrbanSceneBatchCallback } from './urbanSceneProgress';

/** Explicit native-source path. No raster/layout/partition geometry belongs in
 * this input, and older workers without projected site reads fail explicitly. */
export type UrbanColdSceneInput = Pick<UrbanSceneRequest, 'seed' | 'settings' | 'keys' | 'buildingOverrides'> & {
  mode: 'compact' | 'detailed'; source: NonNullable<UrbanSceneRequest['source']>;
  runtime: NonNullable<UrbanSceneRequest['runtime']> & { profile: 'local' };
};
export interface UrbanColdSceneOptions {
  backend: BuildingChunkBackend; sourceFingerprint: string; sceneId?: string; expectedActive?: string | null;
  /** Default true: collect projected sites, never original constraints. */
  retainSites?: boolean;
  progress?(completed: number, total: number): void;
  onProjection?(projection: NativeBuildingProjectionScene, progress: ArchitectureBatchProgress): void | Promise<void>;
}
export interface UrbanColdSceneResponse {
  kind: 'cold-native-scene'; id: number;
  store: Pick<BuildingChunkManifest, 'format' | 'sceneId' | 'fingerprint' | 'sourceFingerprint'>;
  counts: UrbanSceneCompletion;
  siteData: { kind: 'native-sites'; visuals: UrbanSiteVisual[]; query: UrbanBuildingSiteQuery }
    | { kind: 'not-retained'; count: number };
  timing?: UrbanSceneResponse['timing'];
}
type ColdStage = Awaited<ReturnType<typeof beginUrbanBuildingStage>>;

/** One long-lived worker; each run owns its growing scene and ignores stale replies. */
export function createUrbanSceneClient() {
  let worker: Worker | undefined, fallback: ReturnType<typeof createUrbanEngine> | undefined, nextId = 0;
  let sentRaster: SettlementRaster | undefined, sentRuntime: string | undefined;
  let fallbackRunning = false, fallbackPending: UrbanSceneRequest | undefined;
  type Base = { request: UrbanSceneRequest; raster?: SettlementRaster; progress?(completed: number, total: number): void;
    published: boolean; superseded: Promise<void>; releaseConsumer(): void; reject(error: Error): void };
  type Legacy = Base & { kind: 'legacy'; onBatch?: UrbanSceneBatchCallback; accumulator: ReturnType<typeof createUrbanSceneAccumulator>;
    requests: NonNullable<UrbanSceneResponse['requests']>;
    sites: NonNullable<UrbanSceneResponse['sites']>; siteMode?: 'requests' | 'sites';
    resolve(result: UrbanSceneResponse): void };
  type Cold = Base & { kind: 'cold'; resolve(result: UrbanColdSceneResponse): void; cold: {
    backend: BuildingChunkBackend; sourceFingerprint: string; sceneId?: string; expectedActive: Promise<string | null>;
    stage?: ColdStage; work: Promise<void>; processing: boolean; stopping: boolean; abort: AbortController;
    receivedSites: number; sites?: UrbanSiteVisual[];
    onProjection?: UrbanColdSceneOptions['onProjection'];
  } };
  let current: Legacy | Cold | undefined;
  // A superseded storage transaction drains before the next native run starts.
  // Rapid replacement therefore cannot accumulate abandoned full input chunks.
  let coldBarrier: Promise<void> | undefined;
  function stop(item: NonNullable<typeof current>, error: Error): void {
    item.releaseConsumer();
    if (item.kind === 'legacy') { item.reject(error); return; }
    const cold = item.cold; if (cold.stopping) return; cold.stopping = true; cold.abort.abort(error);
    const cleanup = cold.work.then(async () => {
      if (cold.stage && !cold.stage.progress.committed) await cold.stage.abort();
    });
    const settled = cleanup.then(() => item.reject(error), cleanupError =>
      item.reject(new AggregateError([error, cleanupError], 'Cold stream failed and its staging cleanup failed.')));
    const barrier = Promise.all([coldBarrier, settled]).then(() => {}); coldBarrier = barrier;
    void barrier.then(() => { if (coldBarrier === barrier) coldBarrier = undefined; });
  }
  function fail(item: NonNullable<typeof current>, error: unknown): void {
    if (current !== item) return;
    current = undefined;
    stop(item, error instanceof Error ? error : new Error(String(error)));
    try { worker?.postMessage({ cancel: item.request.id }); }
    catch { worker?.terminate(); worker = undefined; sentRaster = undefined; }
  }
  const live = (item: Cold, source?: Worker): boolean => current === item && !item.cold.abort.signal.aborted && (!source || source === worker);
  function siteProjection(site: UrbanSiteVisual): UrbanSiteVisual {
    const c = site.culture, p = site.programme;
    return { id: site.id, parcel_id: site.parcel_id, offset: site.offset, function: site.function,
      culture: { culture: c.culture, pack: c.pack, mode: c.mode, borrowing: c.borrowing }, surface: site.surface,
      preview: site.preview, ground_z_m: site.ground_z_m, entrance: { x: site.entrance.x, y: site.entrance.y }, access_id: site.access_id,
      ...(p ? { programme: { role: p.role, label: p.label, landmark: p.landmark, district_role: p.district_role, wealth: p.wealth,
        households: p.households, state: p.state, composition: p.composition, built_area_m2: p.built_area_m2,
        frontage_continuity: p.frontage_continuity, party_walls: p.party_walls,
        ...(p.floors ? { floors: [p.floors[0], p.floors[1]] } : {}) } } : {}) };
  }
  async function receiveCold(item: Cold, response: UrbanSceneResponse, source?: Worker): Promise<void> {
    if (!live(item, source)) return;
    const cold = item.cold;
    if (response.scene || response.partitions || response.requests || response.sites) throw new Error('Cold stream cannot receive a collected native scene or original sites.');
    if (response.batch) {
      if (response.complete) throw new Error('Cold chunk cannot include completion.');
      item.published = true;
      const { delta, progress, requests, sites } = response.batch;
      if (!Array.isArray(requests) || requests.length || !Array.isArray(sites) || sites.length !== progress.completed - progress.start
        || progress.start !== cold.receivedSites || sites.some((site, i) => site.offset !== progress.start + i || !site.id || !site.parcel_id))
        throw new Error('Cold source stream requires ordered projected sites, never original constraints.');
      if (!cold.stage) {
        const expectedActive = await cold.expectedActive; if (!live(item, source)) return;
        cold.stage = await beginUrbanBuildingStage(cold.backend, { sceneId: cold.sceneId, sourceFingerprint: cold.sourceFingerprint,
          totalRequests: progress.total, expectedActive });
        if (!live(item, source)) return;
      }
      const projectedSites = sites.map(siteProjection);
      await cold.stage.append(delta, progress, projectedSites); if (!live(item, source)) return;
      // Only child outlines/metadata can reach the preview consumer. No growing
      // PlacementBatch accumulator is constructed anywhere on this branch.
      if (cold.onProjection) await Promise.race([cold.onProjection(cold.stage.lastProjection ?? projectNativeBuildingChunk(delta), { ...progress }), item.superseded]);
      if (!live(item, source)) return;
      if (cold.sites) cold.sites.push(...projectedSites);
      cold.receivedSites = progress.completed;
      source?.postMessage({ ack: { id: response.id, completed: progress.completed } });
      return;
    }
    if (!response.complete || !cold.stage || !response.siteQuery) throw new Error('Incomplete cold architecture stream or missing retained site descriptor.');
    const query = copyBuildingSiteQuery(response.siteQuery);
    const expectedQuery = copyBuildingSiteQuery({ source: item.request.source!, keys: item.request.keys, seed: item.request.seed,
      architectureCulture: item.request.settings?.culture });
    if (JSON.stringify(query) !== JSON.stringify(expectedQuery)) throw new Error('Cold building-site source identity changed.');
    if (cold.receivedSites !== cold.stage.progress.total) throw new Error('Incomplete cold building-site stream.');
    const manifest = await cold.stage.commit({ completion: response.complete, signal: cold.abort.signal });
    if (!live(item, source)) return; // A durable commit cannot be undone by a later cancellation; never publish its stale result.
    const complete = response.complete, timing = response.timing;
    current = undefined;
    item.resolve({ kind: 'cold-native-scene', id: response.id,
      store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
      counts: { schema_version: complete.schema_version, generator_version: complete.generator_version, buildings: complete.buildings,
        refusals: complete.refusals, open_spaces: complete.open_spaces },
      siteData: cold.sites ? { kind: 'native-sites', visuals: cold.sites, query } : { kind: 'not-retained', count: cold.receivedSites },
      ...(timing ? { timing: { sites: timing.sites, placement: timing.placement, sitesPrepare: timing.sitesPrepare,
        sitesRead: timing.sitesRead, paged: timing.paged } } : {}) });
  }
  async function receive(response: UrbanSceneResponse, source?: Worker): Promise<void> {
    if (response.id !== current?.request.id || (source && source !== worker)) return;
    const item = current;
    if (item.kind === 'cold') {
      if (response.error) { fail(item, new Error(response.error)); return; }
      if (response.progress) { try { item.progress?.(response.progress.completed, response.progress.total); } catch (error) { fail(item, error); } return; }
      if (item.cold.processing) { fail(item, new Error('Overlapping cold architecture messages before ACK/finalization.')); return; }
      item.cold.processing = true;
      item.cold.work = receiveCold(item, response, source).catch(error => fail(item, error)).finally(() => { item.cold.processing = false; });
      return;
    }
    try {
      // The worker lost its terrain: send it again once, before publishing a prefix.
      if (response.error === RASTER_MISSING && worker && !item.request.source && item.raster && item.request.raster === undefined && !item.published) {
        item.request = { ...item.request, raster: item.raster }; sentRaster = item.raster;
        try { worker.postMessage(item.request); } catch (error) { useFallback(error); }
        return;
      }
      if (response.error) throw new Error(response.error);
      if (response.batch) {
        if (!item.onBatch) throw new Error('Unexpected architecture stream.');
        item.published = true;
        const { delta, progress, requests, sites } = response.batch;
        const mode = sites !== undefined ? 'sites' : 'requests', values = sites ?? requests;
        if (!Array.isArray(requests) || !Array.isArray(values) || values.length !== progress.completed - progress.start
          || (item.siteMode && item.siteMode !== mode) || item[mode].length !== progress.start
          || (sites !== undefined && (requests.length || sites.some((site, i) => site.offset !== progress.start + i)))) throw new Error('Invalid architecture request chunk.');
        item.siteMode = mode;
        const scene = item.accumulator.append(delta, progress);
        if (sites !== undefined) item.sites.push(...sites); else item.requests.push(...requests);
        // A replaced consumer may never finish. Release only this UI wait;
        // native fetch promises themselves must always drain physically.
        await Promise.race([item.onBatch(delta, progress, scene), item.superseded]);
        if (current !== item || (source && source !== worker)) return;
        source?.postMessage({ ack: { id: response.id, completed: progress.completed } });
        return;
      }
      if (response.progress) { item.progress?.(response.progress.completed, response.progress.total); return; }
      const scene = response.complete ? item.accumulator.complete(response.complete) : response.scene;
      if (response.complete && item.siteMode === 'sites' && !response.siteQuery) throw new Error('Missing retained building-site descriptor.');
      // Streamed references were registered chunk by chunk, without rescanning.
      if (!response.complete && scene?.plan_archives) registerPlanArchives(scene);
      current = undefined;
      item.resolve({ ...response, scene, ...(response.complete ? item.siteMode === 'sites' ? { sites: item.sites } : { requests: item.requests } : {}) });
    } catch (error) { fail(item, error); }
  }
  async function runFallback(request: UrbanSceneRequest): Promise<void> {
    const cancelled = (): boolean => current?.request.id !== request.id;
    try {
      fallback ??= createUrbanEngine(request.runtime);
      const start = performance.now();
      const engine = await fallback;
      if (cancelled()) return;
      const sites = await engine.run(urbanBuildingSitesRequest(request, request.raster));
      if (cancelled()) return;
      if (sites.error) throw new Error(request.source ? `Lecture de la source urbaine retenue impossible : ${sites.error}` : sites.error);
      const requests = (sites.placementRequests ?? []) as CityPlacementRequest[];
      const sitesMs = performance.now() - start, placementStart = performance.now(), mode = sceneMode(request);
      if (mode === 'silhouette') { await receive({ id: request.id, scene: silhouetteScene(requests), timing: { sites: sitesMs, placement: performance.now() - placementStart } }); return; }
      let deficitJoin: ReturnType<typeof prepareUrbanOpenDeficits> | undefined;
      const carryEagerDeficits = (delta: PlacementBatch, page: readonly PlacementRequest[]): PlacementBatch =>
        delta.open_spaces.length ? (deficitJoin ??= prepareUrbanOpenDeficits(request.partitions ?? []))(delta, page) : delta;
      const options: ArchitectureBatchOptions = { cancelled,
        progress: (completed, total) => { void receive({ id: request.id, progress: { completed, total } }); },
        ...(request.progressive ? { onBatch: (delta, progress, actualRequests) => receive({ id: request.id,
          batch: { delta: compact ? delta : carryEagerDeficits(delta, actualRequests), progress, requests: requests.slice(progress.start, progress.completed) } }) } : {}) };
      const { placeUrbanBuildings, planUrbanBuildings } = await import('../../../rust/bridge/architecture');
      if (cancelled()) return;
      const compact = usesCompactPlans(request);
      const planInput: PlacementBatchRequest = { schema_version: '1', requests: applyHouseEdits(requests, request.buildingOverrides), settings: request.settings };
      let scene = await (compact ? planUrbanBuildings : placeUrbanBuildings)(planInput, request.runtime, options);
      if (cancelled()) return;
      const placementMs = performance.now() - placementStart;
      let partitions: UrbanSceneResponse['partitions'];
      if (!compact) {
        scene = carryEagerDeficits(scene, planInput.requests);
        const balance = await engine.run({ id: request.id, kind: 'builtCapacity', seed: request.seed, runtime: request.runtime, partitions: request.partitions, scene });
        if (cancelled()) return;
        if (balance.error) throw new Error(balance.error);
        partitions = balance.partitions;
      }
      await receive({ id: request.id, ...(request.progressive ? { complete: urbanSceneCompletion(scene) } : { scene, requests }),
        partitions, timing: { sites: sitesMs, placement: placementMs } });
    } catch (error) { await receive({ id: request.id, error: String(error) }); }
  }
  function queueFallback(request: UrbanSceneRequest): void {
    // One physical run plus the latest pending request. Replacing a request
    // cannot free a native slot or upload another raster while it still runs.
    fallbackPending = request;
    if (!fallbackRunning) void drainFallback();
  }
  async function drainFallback(): Promise<void> {
    fallbackRunning = true;
    try {
      while (fallbackPending) {
        const request = fallbackPending; fallbackPending = undefined;
        if (current?.request.id === request.id) await runFallback(request);
      }
    } finally { fallbackRunning = false; }
  }
  function useFallback(error?: unknown): void {
    worker?.terminate(); worker = undefined; sentRaster = undefined;
    // Replaying a published prefix would duplicate its buildings. Reject so the
    // caller can restore its previous complete scene instead.
    if (current?.published || current?.kind === 'cold') { fail(current, error ?? new Error('Architecture worker stopped during streaming.')); return; }
    if (current) queueFallback(urbanSceneTransport({ ...current.request, raster: current.raster }));
  }
  function dispatch(item: NonNullable<typeof current>, replacing: boolean): void {
    if (current !== item) return;
    const request = item.request;
    if (fallback || fallbackRunning) {
      if (item.kind === 'cold') { fail(item, new Error('Cold native streams require the architecture worker; legacy fallback is unavailable.')); return; }
      queueFallback(request); return;
    }
    if (!worker) {
      sentRaster = undefined;
      try {
        const created = new SceneWorker(); worker = created;
        created.onmessage = event => { void receive(event.data, created); };
        created.onerror = event => { event.preventDefault(); if (worker === created) useFallback(new Error(event.message || 'Architecture worker failed.')); };
      } catch (error) { useFallback(error); return; }
    }
    try {
      if (!request.source && !replacing && item.raster === sentRaster && sceneRuntimeKey(request.runtime) === sentRuntime) item.request = urbanSceneTransport(request, true);
      worker.postMessage(item.request);
      if (!request.source) { sentRaster = item.raster; sentRuntime = sceneRuntimeKey(request.runtime); }
    } catch (error) { useFallback(error); }
  }
  function dispatchWhenReady(item: NonNullable<typeof current>, replacing: boolean): void {
    const barrier = coldBarrier;
    if (item.kind === 'cold') void Promise.all([barrier, item.cold.expectedActive]).then(() => dispatch(item, replacing), error => fail(item, error));
    else if (barrier) void barrier.then(() => dispatch(item, replacing));
    else dispatch(item, replacing);
  }
  return {
    run(input: Omit<UrbanSceneRequest, 'id' | 'progressive'>,
      progress?: (completed: number, total: number) => void, onBatch?: UrbanSceneBatchCallback): Promise<UrbanSceneResponse> {
      let request: UrbanSceneRequest;
      try {
        if (input.parentSession) throw new Error('Native parent city generation requires the parent source receiver; legacy Single consumer refused.');
        request = urbanSceneTransport({ ...input, id: nextId + 1, progressive: Boolean(onBatch) });
      }
      catch (error) { return Promise.reject(error); }
      const replacing = Boolean(current);
      if (current) stop(current, new DOMException('Calcul remplacé', 'AbortError'));
      ++nextId;
      return new Promise((resolve, reject) => {
        let releaseConsumer!: () => void;
        const superseded = new Promise<void>(release => { releaseConsumer = release; });
        current = { kind: 'legacy', request, raster: input.raster, resolve, reject, progress, onBatch,
          accumulator: createUrbanSceneAccumulator(), requests: [], sites: [], published: false, superseded, releaseConsumer };
        dispatchWhenReady(current, replacing);
      });
    },
    runCold(input: UrbanColdSceneInput, options: UrbanColdSceneOptions): Promise<UrbanColdSceneResponse> {
      let request: UrbanSceneRequest;
      try {
        if (!input.source || input.runtime?.profile !== 'local' || !['compact', 'detailed'].includes(input.mode)
          || !/^[a-f0-9]{64}$/.test(options.sourceFingerprint)) throw new Error('Cold streams require a local retained source, explicit native plan mode and source fingerprint.');
        const source = input.source;
        request = urbanSceneTransport({ id: nextId + 1, progressive: true, requireProjectedSiteStream: true, seed: input.seed, mode: input.mode,
          source: { version: source.version, session: source.session, terrainRevision: source.terrainRevision,
            layoutsRevision: source.layoutsRevision, partitionsRevision: source.partitionsRevision },
          runtime: { profile: 'local', server: input.runtime.server }, ...(input.keys ? { keys: input.keys.slice() } : {}),
          ...(input.settings ? { settings: input.settings } : {}), ...(input.buildingOverrides ? { buildingOverrides: input.buildingOverrides } : {}) });
      } catch (error) { return Promise.reject(error); }
      const replacing = Boolean(current), previous = current;
      if (previous) { stop(previous, new DOMException('Calcul remplacé', 'AbortError')); worker?.postMessage({ cancel: previous.request.id }); }
      ++nextId;
      return new Promise((resolve, reject) => {
        let releaseConsumer!: () => void;
        const superseded = new Promise<void>(release => { releaseConsumer = release; });
        const expectedActive = options.expectedActive === undefined ? options.backend.active().then(manifest => manifest?.sceneId ?? null) : Promise.resolve(options.expectedActive);
        current = { kind: 'cold', request, resolve, reject, progress: options.progress, published: false, superseded, releaseConsumer,
          cold: { backend: options.backend, sourceFingerprint: options.sourceFingerprint, sceneId: options.sceneId, expectedActive,
            work: Promise.resolve(), processing: false, stopping: false, abort: new AbortController(), receivedSites: 0,
            sites: options.retainSites === false ? undefined : [], onProjection: options.onProjection } };
        dispatchWhenReady(current, replacing);
      });
    },
    /** Stop future native chunks while retaining the worker's terrain/session. */
    invalidate(): void {
      ++nextId; if (current) stop(current, new DOMException('Plan remplacé', 'AbortError')); current = undefined; fallbackPending = undefined;
      worker?.postMessage({ cancel: nextId });
    },
    dispose(): void { ++nextId; if (current) stop(current, new DOMException('Atelier fermé', 'AbortError')); current = undefined; fallbackPending = undefined; worker?.terminate(); worker = undefined; fallback = undefined; sentRaster = undefined; },
  };
}
