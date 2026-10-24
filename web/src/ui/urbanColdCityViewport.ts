/** Actual CityBench B4 consumer. Opens metadata/exact-window immediately; complete
 * raster builds asynchronously. Never calls the all-city projection accumulator.
 * Source layouts/sites/3D/terrain and explicit legacy operations still require C. */
import type { Point, HouseMaterial } from '../../../rust/bridge/housesContract';
import type { ColdCityState } from './urbanColdCitySession';
import { openColdVisualSource, coldVisualVertices, type ColdVisualOptions, type ColdWindowLimits } from './urbanColdVisualWindow';
import { loadColdOverview, type ContourPreview, type OverviewRasterFactory } from './urbanColdOverviewCache';
import { decodeBrowserContour, type ContourDecoder, type DecodedContourImage } from './urbanColdWindowLod';
import { openUrbanBuildingChunks, type BuildingChunkBackend, type BuildingChunkRead, type ChunkBounds } from './urbanBuildingChunkStore';
import { translateBuilding } from './urbanSnapshot';
import { UrbanBuildingLodRenderer, type BuildingDrawOptions } from '../render/urbanBuildingLod';
import { UrbanBuildingDetailController, type BuildingDetailOptions } from '../render/urbanBuildingDetails';
import type { NativeBuildingProjection } from './urbanBuildingProjection';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';

export interface ColdCityViewportOptions {
  limits?: ColdVisualOptions['limits']; signal?: AbortSignal; resolution?: number;
  rasterFactory?: OverviewRasterFactory; decodeContour?: ContourDecoder; yieldControl?(): Promise<void>;
  realize?: BuildingDetailOptions<NativeBuildingProjection>['realize']; onChange?(): void;
}
export interface ColdCityViewportEvidence {
  version: 'cold-city-viewport-evidence-1'; active: boolean;
  sceneId: string; parentFingerprint: string; derivedFingerprint: string;
  totals: { buildings: number; refusals: number; openSpaces: number }; offset: Point;
  currentViewport?: Readonly<ChunkBounds>; drawViewport?: ChunkBounds; worldToCanvas?: [number, number, number, number, number, number];
  requesting: boolean; pending: boolean; truncated?: boolean; reason?: string; generation: number;
  coverage: 'pending' | 'partial-native-contours' | 'complete-native-contours' | 'exact';
  overviewStatus: 'checking' | 'rebuilding' | 'ready' | 'failed'; overviewProgress?: { pass: 1 | 2; completed: number; total: number };
  cacheStatus: 'pending' | 'hit' | 'built' | 'built-uncached'; overviewFingerprint: string;
  overview?: { bounds: Readonly<ChunkBounds>; pixels: number; painter: string; appearance?: UrbanBuildingAppearance; painted?: boolean };
  budget: Readonly<ColdWindowLimits>; residentRecords: number; residentVertices: number; encodedBytes: number;
  resident: { id: string; parcelId: string; recipeId: string; variantId: string; programmeOutcome: NativeBuildingProjection['programme_outcome'] | null }[];
  originBinding: 'unbound';
}
export async function openColdCityViewport(backend: BuildingChunkBackend, input: ColdCityState, options: ColdCityViewportOptions = {}) {
  const copy = structuredClone(input), state = Object.freeze({ ...copy, store: Object.freeze(copy.store), counts: Object.freeze(copy.counts),
    ...(copy.offset ? { offset: Object.freeze(copy.offset) } : {}) }), life = new AbortController(); let disposed = false;
  const aborted = () => life.abort(options.signal?.reason);
  if (options.signal?.aborted) aborted(); else options.signal?.addEventListener('abort', aborted, { once: true });
  life.signal.throwIfAborted();
  const source = await openColdVisualSource(backend, state.store.sceneId, { limits: options.limits, offset: state.offset, signal: life.signal })
    .catch(e => { options.signal?.removeEventListener('abort', aborted); throw e; });
  if (life.signal.aborted) { source.dispose(); options.signal?.removeEventListener('abort', aborted); life.signal.throwIfAborted(); }
  const m = source.manifest;
  if (m.fingerprint !== state.store.fingerprint || m.sourceFingerprint !== state.store.sourceFingerprint || m.format !== state.store.format
    || m.generator_version !== state.counts.generator_version || m.schema_version !== state.counts.schema_version
    || m.buildings !== state.counts.buildings || m.refusals !== state.counts.refusals || m.openSpaces !== state.counts.open_spaces) {
    source.dispose(); options.signal?.removeEventListener('abort', aborted); throw new Error('La scène froide ne correspond plus à son manifeste.');
  }
  const renderer = new UrbanBuildingLodRenderer<NativeBuildingProjection>({ buildings: [] }, { raster: false });
  let details: UrbanBuildingDetailController<NativeBuildingProjection> | undefined;
  let image: DecodedContourImage | undefined, preview: ContourPreview | undefined, overviewBytes = 0;
  let overviewFingerprint = '';
  let overviewAbort: AbortController | undefined, overviewEpoch = 0, overviewKey = '', cameraKey = '', requested = false;
  let overviewStatus: 'checking' | 'rebuilding' | 'ready' | 'failed' = 'checking', overviewReason = '';
  let cacheStatus: ColdCityViewportEvidence['cacheStatus'] = 'pending';
  let progress: { pass: 1 | 2; completed: number; total: number } | undefined;
  let coverage: 'pending' | 'partial-native-contours' | 'complete-native-contours' | 'exact' = 'pending';
  let drawViewport: ChunkBounds | undefined, worldToCanvas: ColdCityViewportEvidence['worldToCanvas'];
  let updateEpoch = 0, pendingNotify = false;
  let cameraBox: ChunkBounds | undefined, pinned: NativeBuildingProjection | undefined, pinMaterials: HouseMaterial[] = [], pickEpoch = 0;
  let pinOrder: { chunkIndex: number; recordIndex: number } | undefined, pinBytes = 0;
  let pointWitness: { point: Point; building?: NativeBuildingProjection } | undefined;
  const selected = (id: string) => pinned?.id === id ? pinned : source.selected(id);
  const pick = (p: Point) => {
    const hit = source.pick(p); if (hit.status === 'exact') return pinned && hit.building?.id === pinned.id ? { status: 'exact' as const, building: pinned } : hit;
    return pointWitness?.point.x === p.x && pointWitness.point.y === p.y ? { status: 'exact' as const, building: pointWitness.building } : hit;
  };
  const pinWeight = () => pinned && !source.snapshot?.buildings.includes(pinned)
    ? { records: 1, vertices: coldVisualVertices(pinned), encodedBytes: pinBytes } : { records: 0, vertices: 0, encodedBytes: 0 };
  const listeners = new Set<() => void>();
  const notify = () => { if (disposed || pendingNotify) return; pendingNotify = true; queueMicrotask(() => {
    pendingNotify = false; if (!disposed) { options.onChange?.(); for (const listener of listeners) listener(); }
  }); };
  const replaced = () => new DOMException('Ville ou sélection remplacée', 'AbortError');
  let native: Awaited<ReturnType<typeof openUrbanBuildingChunks>> | undefined, nativeActive = false;
  type NativeJob = { id: string; channel: string; base?: NativeBuildingProjection; run(): Promise<void>; reject(e: unknown): void };
  const nativeQueue: NativeJob[] = [];
  async function pumpNative() {
    if (nativeActive || disposed) return; const job = nativeQueue.shift(); if (!job) return; nativeActive = true;
    try { await job.run(); } finally { nativeActive = false; if (disposed) native?.clearCache(); else void pumpNative(); }
  }
  function read(id: string, channel = 'selection', base?: NativeBuildingProjection): Promise<BuildingChunkRead | undefined> {
    if (disposed) return Promise.reject(replaced());
    if (channel !== 'detail') {
      const index = nativeQueue.findIndex(j => j.channel === channel);
      if (index >= 0) nativeQueue.splice(index, 1)[0].reject(replaced());
    }
    if (nativeQueue.length >= 6) return Promise.reject(new Error('Lectures natives en attente : budget atteint.'));
    return new Promise((resolve, reject) => {
      const current = () => { if (disposed || life.signal.aborted || base && selected(id) !== base) throw replaced(); };
      nativeQueue.push({ id, channel, base, reject, async run() {
        try {
          current(); native ??= await openUrbanBuildingChunks(backend, state.store.sceneId, { maxCachedChunks: 1, maxCacheBytes: 8 * 1024 * 1024 }); current();
          if (native.manifest.fingerprint !== m.fingerprint) throw new Error('Le parent natif a changé.');
          const value = await native.readBuilding(id); current();
          if (!value) { resolve(undefined); return; }
          const dx = state.offset?.x ?? 0, dy = state.offset?.y ?? 0;
          const building = dx || dy ? translateBuilding(value.building, dx, dy) : value.building;
          resolve({ ...value, building, scene: { ...value.scene, buildings: [building] } });
        } catch (e) { reject(e); }
      } }); void pumpNative();
    });
  }
  function retireDetails() { details?.dispose(); details = undefined; }
  async function update(box: ChunkBounds, camera = true) {
    if (disposed) throw replaced(); const epoch = ++updateEpoch; requested = true;
    coverage = 'pending';
    if (camera) { const key = JSON.stringify(box); if (cameraKey !== key) pickEpoch++; cameraKey = key; cameraBox = [...box]; }
    retireDetails(); renderer.replaceScene({ buildings: [] }); if (!nativeActive) native?.clearCache();
    source.reserveBudget({ records: pinned ? 1 : 0, vertices: pinned ? coldVisualVertices(pinned) : 0, encodedBytes: pinned ? pinBytes : 0 });
    notify();
    try {
      const result = await source.request(box, life.signal);
      if (disposed || epoch !== updateEpoch) throw replaced();
      // A prefix is legitimate partial ink during reconstruction, never complete.
      const display = [...result.buildings.filter(b => b.id !== pinned?.id), ...(pinned ? [pinned] : [])];
      const order = new Map(result.orders.map(o => [o.id, o])); if (pinned && pinOrder) order.set(pinned.id, { ...pinOrder, id: pinned.id });
      display.sort((a, b) => order.get(a.id)!.chunkIndex - order.get(b.id)!.chunkIndex || order.get(a.id)!.recordIndex - order.get(b.id)!.recordIndex);
      const palette = new Map(result.materials.map(m => [m.id, m])); for (const m of pinMaterials) {
        const old = palette.get(m.id); if (old && JSON.stringify(old) !== JSON.stringify(m)) throw new Error('Pinned material identity changed.'); palette.set(m.id, m);
      }
      renderer.replaceScene({ buildings: display, materials: [...palette.values()] });
      coverage = 'pending'; // a new membership must actually paint before capture is final
      if (result.complete && options.realize) details = new UrbanBuildingDetailController<NativeBuildingProjection>({ renderer,
        canRealize: v => v.nativeRealization === false, load: v => read(v.id, 'detail', v), realize: options.realize,
        maxConcurrency: 1, onChange: () => { coverage = 'pending'; notify(); } });
      return result;
    } finally { if (epoch === updateEpoch) requested = false; notify(); }
  }
  function startOverview(appearance: UrbanBuildingAppearance, painted: boolean) {
    const key = JSON.stringify([appearance.style, appearance.diagnostic, painted]); if (disposed || overviewKey === key) return;
    overviewKey = key; const epoch = ++overviewEpoch;
    overviewAbort?.abort(replaced()); overviewAbort = new AbortController(); const abort = overviewAbort;
    const cancel = () => abort.abort(life.signal.reason); if (life.signal.aborted) cancel(); else life.signal.addEventListener('abort', cancel, { once: true });
    image?.close(); image = undefined; preview = undefined; overviewFingerprint = ''; overviewBytes = 0; cacheStatus = 'pending'; overviewStatus = 'checking'; progress = undefined; overviewReason = ''; notify();
    // Intentionally not awaited by openColdCityViewport. Both success and failure
    // settle visibly; no unhandled rejection or fake complete/empty prefix.
    void loadColdOverview(backend, source.derived, { resolution: options.resolution, signal: abort.signal, requireContour: true,
      maxChunkBytes: source.limits.maxDecodeBytes, rasterFactory: options.rasterFactory, appearance, painted,
      progress: p => { if (epoch === overviewEpoch && !disposed) { progress = p; overviewStatus = 'rebuilding'; notify(); } },
      yieldControl: options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0))),
    }).then(async result => {
      if (disposed || epoch !== overviewEpoch) return;
      if (!result.contour) throw new Error('Aperçu architectural non terminé.');
      const decoded = await (options.decodeContour ?? decodeBrowserContour)(result.contour);
      if (disposed || epoch !== overviewEpoch || abort.signal.aborted) { decoded.close(); return; }
      if (decoded.width !== result.contour.pixels || decoded.height !== result.contour.pixels) { decoded.close(); throw new Error('Dimensions de l’aperçu incohérentes.'); }
      const b = result.contour.bounds, dx = state.offset?.x ?? 0, dy = state.offset?.y ?? 0;
      image = decoded; preview = { ...result.contour, bounds: [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] };
      overviewBytes = result.overview.counts.byteLength + result.contour.png.byteLength; overviewFingerprint = result.fingerprint;
      coverage = 'pending'; // image readiness is distinct from its first actual draw
      cacheStatus = result.cacheStatus; overviewStatus = 'ready'; notify();
    }).catch(e => { if (!disposed && epoch === overviewEpoch && !abort.signal.aborted) { overviewStatus = 'failed'; overviewReason = String(e); notify(); } })
      .finally(() => life.signal.removeEventListener('abort', cancel));
  }
  // Default actual CityBench appearance: relief background, shared cartography.
  startOverview({ style: 'cartographic', diagnostic: 'none' }, false);
  return {
    state, manifest: m, originBinding: 'unbound' as const,
    read, async readOrigin(id: string) { if (disposed || life.signal.aborted) throw replaced(); const value = await source.readOrigin(id);
      if (disposed || life.signal.aborted) throw replaced(); return value; },
    get renderer() { return renderer; }, get details() { return details; },
    get snapshot() { return source.snapshot; },
    get totals() { return { buildings: m.buildings, refusals: m.refusals, openSpaces: m.openSpaces }; },
    /** Pure read-only observation: no archive/constraint lookup or cache warming. */
    get evidence(): ColdCityViewportEvidence { return { version: 'cold-city-viewport-evidence-1', active: !disposed && !life.signal.aborted,
      sceneId: m.sceneId, parentFingerprint: m.fingerprint, derivedFingerprint: source.derived.manifest.fingerprint,
      totals: { buildings: m.buildings, refusals: m.refusals, openSpaces: m.openSpaces }, offset: state.offset ?? { x: 0, y: 0 },
      currentViewport: source.snapshot?.viewport, drawViewport, worldToCanvas, requesting: requested,
      pending: requested || coverage === 'pending' || coverage === 'partial-native-contours', truncated: source.snapshot ? !source.snapshot.complete : undefined,
      reason: source.snapshot?.reason, generation: updateEpoch, coverage, overviewStatus, overviewProgress: progress, overviewFingerprint, cacheStatus,
      budget: source.limits, residentRecords: source.stats.residentBuildings + pinWeight().records,
      residentVertices: source.stats.residentVertices + pinWeight().vertices, encodedBytes: source.stats.encodedBytes + pinWeight().encodedBytes,
      overview: preview ? { bounds: preview.bounds, pixels: preview.pixels, painter: preview.painter, appearance: preview.appearance, painted: preview.painted } : undefined,
      resident: [...(source.snapshot?.buildings ?? []).filter(b => b.id !== pinned?.id), ...(pinned ? [pinned] : [])].map(b => ({ id: b.id, parcelId: b.parcel_id, recipeId: b.recipe_id, variantId: b.variant_id,
        programmeOutcome: b.programme_outcome ?? null })), originBinding: 'unbound' as const }; },
    update,
    /** Only a changed camera queues IO; RAFs/progress do not restart the read. */
    ensureViewport(box: ChunkBounds) {
      cameraBox = [...box];
      const key = JSON.stringify(box); if (cameraKey === key || disposed) return;
      void update(box).catch(e => { if (!disposed && (e as Error).name !== 'AbortError') { overviewReason = String(e); notify(); } });
    },
    pick,
    async pickAt(point: Point) {
      const token = ++pickEpoch;
      const hit = pick(point); if (hit.status === 'exact') return hit;
      pinned = undefined; pinOrder = undefined; pinMaterials = []; pinBytes = 0; pointWitness = undefined;
      let result: ReturnType<typeof pick>;
      {
        const exact = await update([point.x, point.y, point.x, point.y], false);
        if (disposed || token !== pickEpoch) throw replaced(); result = source.pick(point);
        if (result.status === 'exact') {
          pointWitness = { point: { ...point }, building: result.building };
          if (result.building) {
            pinned = result.building; pinOrder = exact.orders.find(o => o.id === pinned!.id);
            const used = new Set(Object.values(pinned.materials ?? {})); pinMaterials = exact.materials.filter(m => used.has(m.id)); pinBytes = exact.encodedBytes;
          }
        }
      }
      // Restore the current camera query, reserving one authenticated visual for
      // selection. Never leave a point-sized source window behind cameraKey.
      if (cameraBox && !disposed) await update(cameraBox);
      return result;
    },
    selected,
    draw(ctx: CanvasRenderingContext2D, draw: BuildingDrawOptions, detailed = false) {
      if (disposed || life.signal.aborted) throw replaced();
      coverage = 'pending';
      drawViewport = [draw.viewport.minX, draw.viewport.minY, draw.viewport.maxX, draw.viewport.maxY];
      const matrix = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
      worldToCanvas = matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : undefined;
      const painted = draw.painted ?? globalThis.document?.documentElement.dataset.cityBackground === 'render'; startOverview(draw.appearance, painted);
      const box = source.snapshot?.viewport, v = draw.viewport;
      const exact = source.snapshot?.complete && box && box[0] <= v.minX && box[1] <= v.minY && box[2] >= v.maxX && box[3] >= v.maxY;
      details?.update({ viewport: v, metresPerPixel: draw.metresPerPixel, selectedId: draw.selectedId, enabled: detailed && !!exact });
      if (exact) { coverage = 'exact'; const metrics = renderer.draw(ctx, draw); return { coverage, complete: true, visibleBuildings: metrics.visibleBuildings }; }
      if (preview && image) {
        ctx.save(); try { ctx.beginPath(); ctx.rect(v.minX, v.minY, v.maxX - v.minX, v.maxY - v.minY); ctx.clip();
          ctx.drawImage(image.source, 0, 0, preview.pixels, preview.pixels, preview.bounds[0], preview.bounds[1], preview.bounds[2] - preview.bounds[0], preview.bounds[3] - preview.bounds[1]);
          if (draw.selectedId) renderer.drawSelection(ctx, draw.selectedId, draw.metresPerPixel);
        } finally { ctx.restore(); }
        coverage = 'complete-native-contours'; return { coverage, complete: true, visibleBuildings: undefined };
      }
      const metrics = renderer.draw(ctx, draw); coverage = metrics.visibleBuildings ? 'partial-native-contours' : 'pending';
      return { coverage, complete: false, visibleBuildings: metrics.visibleBuildings };
    },
    get statusText() { return overviewStatus === 'ready' ? `Aperçu complet · ${m.buildings.toLocaleString()} plans` : overviewStatus === 'failed'
      ? `Couverture globale partielle · aperçu indisponible : ${overviewReason}` : `Couverture globale partielle · aperçu architectural en préparation${progress ? ` · passe ${progress.pass}/2 · ${progress.completed}/${progress.total} lots` : ''}`; },
    get stats() { return { ...source.stats, residentBuildings: source.stats.residentBuildings + pinWeight().records,
      residentVertices: source.stats.residentVertices + pinWeight().vertices, encodedBytes: source.stats.encodedBytes + pinWeight().encodedBytes,
      pinnedVisuals: pinned ? 1 : 0, coverage, overviewStatus, overviewReason, overviewProgress: progress, cacheStatus,
      overviewBytes, decodedContourBytes: image ? image.width * image.height * 4 : 0, requesting: requested,
      nativeReads: { active: nativeActive, queued: nativeQueue.length, chunks: native?.stats.chunks ?? 0, bytes: native?.stats.bytes ?? 0 } }; },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispose() {
      if (disposed) return; disposed = true; life.abort(replaced()); options.signal?.removeEventListener('abort', aborted);
      overviewAbort?.abort(replaced()); image?.close(); image = undefined; preview = undefined; overviewBytes = 0;
      retireDetails(); renderer.replaceScene({ buildings: [] }); source.dispose(); listeners.clear();
      pinned = undefined; pinMaterials = []; pinOrder = undefined; pinBytes = 0; pointWitness = undefined;
      for (const job of nativeQueue.splice(0)) job.reject(replaced()); if (!nativeActive) native?.clearCache();
    },
  };
}
export type ColdCityViewport = Awaited<ReturnType<typeof openColdCityViewport>>;
