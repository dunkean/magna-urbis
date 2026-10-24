/** B1 usable child-only spatial reader. Existing durable native indexes select
 * candidates; derived hashes authenticate exact contours and identity. No native
 * archive, full projection accumulator, all-city byId map or parsed chunk LRU.
 * Consumers must replace snapshots (and their renderer) rather than append them.
 * Native manifests still cost O(chunks); this is not whole-product boundedness. */
import type { HouseMaterial, Point, Surface } from '../../../rust/bridge/housesContract';
import { BUILDING_CHUNK_TILE_M, openUrbanBuildingChunks, type BuildingChunkBackend,
  type BuildingChunkIndex, type ChunkBounds } from './urbanBuildingChunkStore';
import { openDerivedCache } from './urbanBuildingDerivedCache';
import type { NativeBuildingProjection } from './urbanBuildingProjection';
import { loadColdOverview, type OverviewRasterFactory } from './urbanColdOverviewCache';
import { buildingSurfaceContains } from '../render/urbanBuildingLod';

export interface ColdWindowLimits {
  maxTiles: number; maxCandidates: number; maxBuildings: number; maxChunks: number;
  maxEncodedBytes: number; maxVertices: number; maxDecodeBytes: number;
}
export const COLD_WINDOW_LIMITS: Readonly<ColdWindowLimits> = Object.freeze({
  maxTiles: 64, maxCandidates: 4096, maxBuildings: 2048, maxChunks: 64,
  maxEncodedBytes: 8 * 1024 * 1024, maxVertices: 200000, maxDecodeBytes: 8 * 1024 * 1024,
});
export interface ColdWindowSnapshot {
  readonly parentFingerprint: string; readonly derivedFingerprint: string;
  readonly viewport: Readonly<ChunkBounds>; readonly buildings: readonly NativeBuildingProjection[];
  readonly materials: HouseMaterial[]; readonly complete: boolean;
  readonly orders: readonly { id: string; chunkIndex: number; recordIndex: number }[];
  readonly reason: 'complete' | 'tiles' | 'candidates' | 'records' | 'chunks' | 'bytes' | 'vertices';
  readonly candidatesRead: number; readonly chunksRead: number; readonly encodedBytes: number; readonly vertices: number;
  /** Instrumentation includes all decoded siblings/sites, not just selected children.
   * Transient decode is byte-capped; this value is measured, not a hard vertex cap. */
  readonly maxDecodedChunkVertices: number;
}
const overlap = (a: readonly number[], b: readonly number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const aborted = () => new DOMException('Visual window replaced/disposed', 'AbortError');
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
/** Counts unique XY objects over all exact child surfaces/ridges, including aliases.
 * Serialized bytes remain a separate conservative accounting unit, NOT heap. */
export function coldVisualVertices(value: unknown): number {
  const seen = new WeakSet<object>(); let count = 0;
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if ('x' in v && 'y' in v && typeof v.x === 'number' && typeof v.y === 'number') count++;
    for (const child of Object.values(v)) visit(child);
  };
  visit(value); return count;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function translate(building: NativeBuildingProjection, dx: number, dy: number): NativeBuildingProjection {
  if (!dx && !dy) return building;
  const surfaces = new WeakMap<object, Surface>(), point = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  const surface = (input: Surface): Surface => {
    const old = surfaces.get(input); if (old) return old;
    const result = input.map(s => ({ outer: s.outer.map(point), holes: s.holes.map(r => r.map(point)) })); surfaces.set(input, result); return result;
  };
  return { ...building, footprint: surface(building.footprint), roof_footprint: surface(building.roof_footprint),
    ...(building.entrance ? { entrance: point(building.entrance) } : {}),
    ...(building.cartographic ? { cartographic: { ...building.cartographic,
      ridges: building.cartographic.ridges.map(([a, b]) => [point(a), point(b)] as const) } } : {}),
    occupation_surfaces: building.occupation_surfaces.map(surface),
    ground_constraints: building.ground_constraints.map(c => ({ footprint: surface(c.footprint), height_m: c.height_m })) };
}

export interface ColdVisualOptions {
  limits?: Partial<ColdWindowLimits>; overviewResolution?: number; signal?: AbortSignal;
  offset?: Point;
  overviewMode?: 'diagnostic' | 'architectural'; rasterFactory?: OverviewRasterFactory;
}
/** Metadata + exact-window core: deliberately does not await global overview. */
export async function openColdVisualSource(backend: BuildingChunkBackend, sceneId: string, options: ColdVisualOptions = {}) {
  options.signal?.throwIfAborted();
  const limits = Object.freeze({ ...COLD_WINDOW_LIMITS, ...options.limits });
  check(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), 'Invalid visual window limits.');
  // Opens/validates only native manifest. Never invokes any native read method.
  const native = await openUrbanBuildingChunks(backend, sceneId);
  options.signal?.throwIfAborted();
  const derived = await openDerivedCache(backend, native.manifest);
  options.signal?.throwIfAborted();
  const dx = options.offset?.x ?? 0, dy = options.offset?.y ?? 0;
  check([dx, dy].every(Number.isFinite), 'Invalid visual world offset.');
  let current: ColdWindowSnapshot | undefined, disposed = false, running = false;
  let reservation = { records: 0, vertices: 0, encodedBytes: 0 };
  let epoch = 0, queued: Job | undefined, active: AbortController | undefined;
  type Job = { viewport: ChunkBounds; epoch: number; controller: AbortController;
    reservation: typeof reservation;
    resolve(value: ColdWindowSnapshot): void; reject(error: unknown): void; cleanup(): void };
  const alive = (job: Job) => { job.controller.signal.throwIfAborted(); if (disposed || epoch !== job.epoch) throw aborted(); };
  async function query(job: Job): Promise<ColdWindowSnapshot> {
    const budget = { ...limits, maxBuildings: Math.max(0, limits.maxBuildings - job.reservation.records),
      maxVertices: Math.max(0, limits.maxVertices - job.reservation.vertices), maxEncodedBytes: Math.max(0, limits.maxEncodedBytes - job.reservation.encodedBytes) };
    alive(job); const worldBox = job.viewport, box: ChunkBounds = [worldBox[0] - dx, worldBox[1] - dy, worldBox[2] - dx, worldBox[3] - dy];
    const range = box.map(v => Math.floor(v / BUILDING_CHUNK_TILE_M));
    check(range.every(Number.isSafeInteger), 'Viewport exceeds tile range.');
    const [x0, y0, x1, y1] = range;
    const keys = ['*']; let reason: ColdWindowSnapshot['reason'] = 'complete';
    tileLoop: for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (keys.length >= limits.maxTiles) { reason = 'tiles'; break tileLoop; } keys.push(`${x},${y}`);
    }
    const entries = new Map<string, BuildingChunkIndex>(); let candidatesRead = 0;
    for (const key of keys) {
      alive(job); const remaining = limits.maxCandidates - candidatesRead;
      if (!remaining) { reason = 'candidates'; break; }
      const page = await backend.tile(sceneId, key, remaining); alive(job);
      check(page.entries.length <= remaining, 'Spatial index exceeded requested budget.');
      candidatesRead += page.entries.length; if (page.truncated) reason = 'candidates';
      for (const e of page.entries) {
        check(typeof e.id === 'string' && typeof e.parcelId === 'string'
          && Number.isSafeInteger(e.chunkIndex) && e.chunkIndex >= 0 && e.chunkIndex < derived.manifest.chunks.length
          && Number.isSafeInteger(e.recordIndex) && e.recordIndex >= 0 && e.recordIndex < native.manifest.chunks[e.chunkIndex].buildings
          && e.bounds.length === 4 && e.bounds.every(Number.isFinite) && e.bounds[0] <= e.bounds[2] && e.bounds[1] <= e.bounds[3], 'Malformed durable spatial index.');
        if (!overlap(box, e.bounds)) continue;
        const old = entries.get(e.id);
        check(!old || JSON.stringify(old) === JSON.stringify(e), 'Inconsistent duplicate spatial identity.'); entries.set(e.id, e);
      }
    }
    const buildings: NativeBuildingProjection[] = [], materialMap = new Map<string, HouseMaterial>();
    const orders: { id: string; chunkIndex: number; recordIndex: number }[] = [];
    let chunksRead = 0, encodedBytes = 0, retainedVertices = 0, maxDecodedChunkVertices = 0;
    const ordered = [...entries.values()].sort((a, b) => a.chunkIndex - b.chunkIndex || a.recordIndex - b.recordIndex);
    for (let pos = 0; pos < ordered.length;) {
      alive(job);
      if (buildings.length >= budget.maxBuildings) { reason = 'records'; break; }
      if (chunksRead >= limits.maxChunks) { reason = 'chunks'; break; }
      const index = ordered[pos].chunkIndex, expected = derived.manifest.chunks[index];
      let end = pos + 1; while (end < ordered.length && ordered[end].chunkIndex === index) end++;
      if (expected.bytes > limits.maxDecodeBytes || encodedBytes + expected.bytes > budget.maxEncodedBytes) { reason = 'bytes'; pos = end; continue; }
      // Only one decoded chunk lives in this scope. All siblings and site metadata
      // count toward transient bytes; none are cached after extracting children.
      const payload = await derived.chunk(index, job.controller.signal); alive(job);
      chunksRead++; encodedBytes += expected.bytes;
      maxDecodedChunkVertices = Math.max(maxDecodedChunkVertices, coldVisualVertices(payload));
      for (let i = pos; i < end; i++) {
        const e = ordered[i], source = payload.projection.buildings[e.recordIndex];
        check(source?.id === e.id && source.parcel_id === e.parcelId, 'Spatial/derived identity mismatch.');
        if (buildings.length >= budget.maxBuildings) { reason = 'records'; break; }
        const b = translate(source, dx, dy), n = coldVisualVertices(b);
        if (retainedVertices + n > budget.maxVertices) { reason = 'vertices'; continue; }
        buildings.push(freeze(b)); retainedVertices += n;
        orders.push({ id: e.id, chunkIndex: e.chunkIndex, recordIndex: e.recordIndex });
        const used = new Set(Object.values(b.materials ?? {}));
        for (const m of payload.projection.materials ?? []) if (used.has(m.id)) {
          const old = materialMap.get(m.id);
          check(!old || JSON.stringify(old) === JSON.stringify(m), 'Conflicting derived material identity.'); materialMap.set(m.id, freeze(m));
        }
      }
      pos = end;
    }
    alive(job);
    return freeze({ parentFingerprint: native.manifest.fingerprint, derivedFingerprint: derived.manifest.fingerprint,
      viewport: [...worldBox] as ChunkBounds, buildings, materials: [...materialMap.values()], orders, complete: reason === 'complete', reason,
      candidatesRead, chunksRead, encodedBytes, vertices: retainedVertices, maxDecodedChunkVertices });
  }
  async function drain() {
    if (running) return; running = true;
    try { while (queued && !disposed) {
      const job = queued; queued = undefined; active = job.controller;
      // Retire all old exact state before loading replacement: no append-only map.
      current = undefined;
      try { const value = await query(job); alive(job); current = value; job.resolve(value); }
      catch (error) { job.reject(error); } finally { job.cleanup(); active = undefined; }
    } } finally { running = false; }
  }
  return {
    derived, limits, offset: Object.freeze({ x: dx, y: dy }), readOrigin: (id: string) => derived.origin(id),
    manifest: native.manifest, originBinding: 'unbound' as const,
    reserveBudget(value: typeof reservation) {
      check(Object.values(value).every(n => Number.isSafeInteger(n) && n >= 0)
        && value.records <= limits.maxBuildings && value.vertices <= limits.maxVertices && value.encodedBytes <= limits.maxEncodedBytes, 'Invalid selected visual reservation.');
      reservation = { ...value };
    },
    /** Latest camera wins; at most one active storage/decode and one queued job. */
    request(viewport: ChunkBounds, signal?: AbortSignal): Promise<ColdWindowSnapshot> {
      if (disposed) return Promise.reject(aborted());
      check(viewport.length === 4 && viewport.every(Number.isFinite) && viewport[0] <= viewport[2] && viewport[1] <= viewport[3], 'Invalid visual viewport.');
      epoch++; active?.abort(aborted()); if (queued) { queued.reject(aborted()); queued.cleanup(); queued = undefined; }
      const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      const result = new Promise<ColdWindowSnapshot>((resolve, reject) => {
        queued = { viewport: [...viewport], epoch, reservation: { ...reservation }, controller, resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      });
      void drain(); return result;
    },
    /** Coarse aggregate never picks; a capped/in-flight window never asserts empty. */
    pick(point: Point): { status: 'pending' } | { status: 'exact'; building?: NativeBuildingProjection } {
      if (!current?.complete || !overlap(current.viewport, [point.x, point.y, point.x, point.y])) return { status: 'pending' };
      for (let i = current.buildings.length - 1; i >= 0; i--) {
        const b = current.buildings[i]; if (buildingSurfaceContains(b.roof_footprint.length ? b.roof_footprint : b.footprint, point)) return { status: 'exact', building: b };
      }
      return { status: 'exact' };
    },
    /** Selection is exact only while its immutable base is in the resident window. */
    selected(id: string) { return current?.buildings.find(b => b.id === id); },
    get snapshot() { return current; },
    get stats() { return { residentBuildings: current?.buildings.length ?? 0, residentVertices: current?.vertices ?? 0,
      encodedBytes: current?.encodedBytes ?? 0, residentChunkCache: 0, overviewBytes: 0,
      maxDecodedChunkVertices: current?.maxDecodedChunkVertices ?? 0,
      activeReads: active ? 1 : 0, queuedRequests: queued ? 1 : 0, originBinding: 'unbound' as const }; },
    dispose() { disposed = true; epoch++; current = undefined; active?.abort(aborted());
      if (queued) { queued.reject(aborted()); queued.cleanup(); queued = undefined; } },
  };
}

/** Original blocking API kept for B1–B3 and batch callers. CityBench B4 uses
 * openColdVisualSource directly and rebuilds the overview in the background. */
export async function openColdVisualWindow(backend: BuildingChunkBackend, sceneId: string, options: ColdVisualOptions = {}) {
  const source = await openColdVisualSource(backend, sceneId, options);
  const { derived, limits, offset: { x: dx, y: dy } } = source;
  const loadedOverview = await loadColdOverview(backend, derived, { resolution: options.overviewResolution, signal: options.signal,
    maxChunkBytes: limits.maxDecodeBytes, requireContour: options.overviewMode === 'architectural', rasterFactory: options.rasterFactory });
  const sourceOverview = loadedOverview.overview;
  const ob = sourceOverview.bounds;
  const overview = Object.freeze({ ...sourceOverview, bounds: Object.freeze([ob[0] + dx, ob[1] + dy, ob[2] + dx, ob[3] + dy] as ChunkBounds) });
  const pc = loadedOverview.contour, cb = pc?.bounds;
  const contourPreview = pc && cb ? Object.freeze({ ...pc, bounds: Object.freeze([cb[0] + dx, cb[1] + dy, cb[2] + dx, cb[3] + dy] as ChunkBounds) }) : undefined;
  return { ...source, overview, contourPreview, overviewCacheStatus: loadedOverview.cacheStatus, overviewCacheReason: loadedOverview.cacheReason,
    get snapshot() { return source.snapshot; },
    get stats() { return { ...source.stats, overviewBytes: overview.counts.byteLength, overviewCacheStatus: loadedOverview.cacheStatus,
      contourEncodedBytes: contourPreview?.png.byteLength ?? 0 }; },
  };
}
