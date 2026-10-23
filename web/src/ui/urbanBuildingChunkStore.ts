/** Cold retained architecture. This module does not publish UI state or ACKs.
 * Await stage.append before ACK; await stage.commit before replacing a scene.
 * Budgets below count encoded bytes, never measured JS heap. */
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { ArchitectureBatchProgress, ArchitectureStreamSummary } from '../../../rust/bridge/architectureBatch';
import { isArchivedPlan, registerPlanArchives } from '../../../rust/bridge/compactPlanArchive';

export const BUILDING_CHUNK_SCENE_FORMAT = 'urban-building-chunks-1';
export const BUILDING_CHUNK_TILE_M = 256;
export const BUILDING_CHUNK_MAX_BYTES = 64 * 1024 * 1024;
export type ChunkBounds = [number, number, number, number];
export interface BuildingChunkDescriptor {
  index: number; sha256: string; bytes: number; progress: ArchitectureBatchProgress;
  buildings: number; refusals: number; openSpaces: number;
}
export interface BuildingChunkManifest {
  format: typeof BUILDING_CHUNK_SCENE_FORMAT;
  /** Local storage generation, not an exported native/session handle. */
  sceneId: string; sourceFingerprint: string; schema_version: '1'; generator_version: string;
  totalRequests: number; buildings: number; refusals: number; openSpaces: number;
  chunks: BuildingChunkDescriptor[];
  /** Content hash excludes sceneId, allowing exact import into a new generation. */
  fingerprint: string;
}
export interface StoredBuildingChunk extends BuildingChunkDescriptor {
  json: string;
  /** JSON normally loses -0. Number ordinals preserve it without rewriting native records. */
  negativeZeros: number[];
}
export interface BuildingChunkIndex {
  id: string; parcelId: string; chunkIndex: number; recordIndex: number;
  bounds: ChunkBounds; tiles: string[];
}
export interface BuildingChunkBackend {
  begin(sceneId: string): Promise<void>;
  /** Atomic add: duplicate index/id or quota failure must roll back all writes. */
  append(sceneId: string, chunk: StoredBuildingChunk, entries: BuildingChunkIndex[]): Promise<void>;
  /** Atomic generation switch, conditional on the previously active scene. */
  commit(manifest: BuildingChunkManifest, expectedActive: string | null, options?: { signal?: AbortSignal }): Promise<void>;
  active(): Promise<BuildingChunkManifest | undefined>;
  manifest(sceneId: string): Promise<BuildingChunkManifest | undefined>;
  chunk(sceneId: string, index: number): Promise<StoredBuildingChunk | undefined>;
  building(sceneId: string, id: string): Promise<BuildingChunkIndex | undefined>;
  tile(sceneId: string, tile: string, limit: number): Promise<{ entries: BuildingChunkIndex[]; truncated: boolean }>;
  /** Delete only an uncommitted stage; never the previous committed scene. */
  discard(sceneId: string): Promise<void>;
}
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const hashPattern = /^[a-f0-9]{64}$/;
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
async function digest(text: string): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(value)].map(v => v.toString(16).padStart(2, '0')).join('');
}
const payload = (chunk: Pick<StoredBuildingChunk, 'json' | 'negativeZeros'>) =>
  JSON.stringify({ json: chunk.json, negativeZeros: chunk.negativeZeros });
const descriptor = ({ index, sha256, bytes, progress, buildings, refusals, openSpaces }: BuildingChunkDescriptor): BuildingChunkDescriptor =>
  ({ index, sha256, bytes, progress: { ...progress }, buildings, refusals, openSpaces });
function content(manifest: BuildingChunkManifest) {
  const { sceneId: _id, fingerprint: _hash, ...value } = manifest; return value;
}
async function validateManifest(manifest: BuildingChunkManifest): Promise<void> {
  assert(manifest && manifest.format === BUILDING_CHUNK_SCENE_FORMAT && typeof manifest.sceneId === 'string' && manifest.sceneId.length > 0
    && hashPattern.test(manifest.sourceFingerprint) && manifest.schema_version === '1' && typeof manifest.generator_version === 'string'
    && manifest.generator_version.length > 0 && integer(manifest.totalRequests) && Array.isArray(manifest.chunks)
    && manifest.chunks.length > 0, 'Invalid building chunk manifest.');
  let completed = 0, buildings = 0, refusals = 0, open = 0;
  for (const [i, chunk] of manifest.chunks.entries()) {
    assert(chunk.index === i && hashPattern.test(chunk.sha256) && integer(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= BUILDING_CHUNK_MAX_BYTES
      && chunk.progress?.start === completed && chunk.progress.total === manifest.totalRequests
      && integer(chunk.progress.completed) && chunk.progress.completed <= manifest.totalRequests
      && chunk.progress.completed - completed <= 64 && (chunk.progress.completed > completed || manifest.totalRequests === 0 && i === 0)
      && [chunk.buildings, chunk.refusals, chunk.openSpaces].every(integer)
      && chunk.buildings + chunk.refusals + chunk.openSpaces === chunk.progress.completed - completed, 'Invalid building chunk sequence.');
    completed = chunk.progress.completed; buildings += chunk.buildings; refusals += chunk.refusals; open += chunk.openSpaces;
  }
  assert(completed === manifest.totalRequests && buildings === manifest.buildings && refusals === manifest.refusals
    && open === manifest.openSpaces && hashPattern.test(manifest.fingerprint)
    && await digest(JSON.stringify(content(manifest))) === manifest.fingerprint, 'Building manifest integrity mismatch.');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function encode(delta: PlacementBatch): Pick<StoredBuildingChunk, 'json' | 'negativeZeros'> {
  let ordinal = 0; const negativeZeros: number[] = [];
  const json = JSON.stringify(delta, (_key, value) => {
    if (typeof value === 'number') { assert(Number.isFinite(value), 'Nonfinite building chunk value.'); if (Object.is(value, -0)) negativeZeros.push(ordinal); ordinal++; }
    return value;
  });
  return { json, negativeZeros };
}
async function decode(chunk: StoredBuildingChunk): Promise<PlacementBatch> {
  assert(typeof chunk.json === 'string' && Array.isArray(chunk.negativeZeros)
    && chunk.negativeZeros.every((n, i, all) => integer(n) && (i === 0 || n > all[i - 1])), 'Invalid building chunk encoding.');
  const encoded = payload(chunk);
  assert(bytes(encoded) === chunk.bytes && chunk.bytes <= BUILDING_CHUNK_MAX_BYTES && await digest(encoded) === chunk.sha256, 'Building chunk integrity mismatch.');
  let ordinal = 0, cursor = 0;
  const delta = JSON.parse(chunk.json, (_key, value) => {
    if (typeof value !== 'number') return value;
    assert(Number.isFinite(value), 'Nonfinite building chunk value.');
    const negative = chunk.negativeZeros[cursor] === ordinal++;
    if (negative) { assert(value === 0, 'Invalid negative-zero position.'); cursor++; return -0; }
    return value;
  }) as PlacementBatch;
  assert(cursor === chunk.negativeZeros.length, 'Invalid negative-zero ordinal.');
  validateDelta(delta); return delta;
}
function validateDelta(delta: PlacementBatch): void {
  assert(delta && delta.schema_version === '1' && typeof delta.generator_version === 'string' && delta.generator_version.length
    && Array.isArray(delta.buildings) && Array.isArray(delta.refusals) && Array.isArray(delta.open_spaces), 'Invalid building chunk delta.');
  for (const building of delta.buildings) assert(building.simplification === 'architectural_plan' && isArchivedPlan(building.resolved), 'Chunk store requires already archived native plans.');
  // This checks associations only; it neither recompresses nor realizes architecture.
  registerPlanArchives(delta);
}
function bounds(building: PlacedBuilding): ChunkBounds {
  const box: ChunkBounds = [Infinity, Infinity, -Infinity, -Infinity];
  const point = (p: { x: number; y: number }) => {
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'Invalid building index coordinates.');
    box[0] = Math.min(box[0], p.x); box[1] = Math.min(box[1], p.y); box[2] = Math.max(box[2], p.x); box[3] = Math.max(box[3], p.y);
  };
  const surface = (s: PlacedBuilding['footprint']) => { for (const shape of s) for (const ring of [shape.outer, ...shape.holes]) ring.forEach(point); };
  [building.footprint, building.roof_footprint, building.courtyards, building.circulation].forEach(surface);
  for (const volume of building.volumes) {
    surface(volume.footprint); if (volume.foundation) surface(volume.foundation.footprint);
    for (const level of volume.levels) surface(level.footprint);
    volume.roof_mesh?.vertices.forEach(point); volume.roof_mesh?.groups?.forEach(group => surface(group.domain));
  }
  building.structural_foundations?.forEach(value => surface(value.footprint));
  for (const feature of building.structural_features) {
    surface(feature.surface); feature.vertices3d.forEach(point);
    if (feature.roof) { surface(feature.roof.domain); for (const arm of feature.roof.arms) { point(arm.origin); surface(arm.domain); } }
  }
  building.cartographic?.ridges.forEach(ridge => ridge.forEach(point));
  assert(box.every(Number.isFinite), 'Building has no spatial index geometry.'); return box;
}
function tileRange(box: ChunkBounds) {
  assert(box.length === 4 && box.every(Number.isFinite) && box[0] <= box[2] && box[1] <= box[3], 'Invalid chunk viewport.');
  const range = box.map(v => Math.floor(v / BUILDING_CHUNK_TILE_M));
  assert(range.every(Number.isSafeInteger), 'Chunk coordinates exceed tile range.'); return range;
}
function tiles(box: ChunkBounds, limit: number): { keys: string[]; truncated: boolean } {
  const [x0, y0, x1, y1] = tileRange(box), keys: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (keys.length === limit) return { keys, truncated: true }; keys.push(`${x},${y}`);
  }
  return { keys, truncated: false };
}
const overlap = (a: ChunkBounds, b: ChunkBounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function indexChunk(delta: PlacementBatch, chunkIndex: number): BuildingChunkIndex[] {
  return delta.buildings.map((building, recordIndex) => {
    assert(typeof building.id === 'string' && building.id.length > 0 && building.id.length <= 1024
      && typeof building.parcel_id === 'string' && building.parcel_id.length > 0 && building.parcel_id.length <= 1024, 'Invalid building identity.');
    const box = bounds(building), keys = tiles(box, 4096);
    return { id: building.id, parcelId: building.parcel_id, chunkIndex, recordIndex, bounds: box, tiles: keys.truncated ? ['*'] : keys.keys };
  });
}

export async function beginUrbanBuildingStage(backend: BuildingChunkBackend, input: {
  sceneId?: string; sourceFingerprint: string; totalRequests: number; expectedActive?: string | null;
}) {
  const sceneId = input.sceneId ?? crypto.randomUUID();
  assert(sceneId.length > 0 && sceneId.length <= 128 && !sceneId.includes('\0') && hashPattern.test(input.sourceFingerprint) && integer(input.totalRequests), 'Invalid building stage identity.');
  const expectedActive = input.expectedActive === undefined ? (await backend.active())?.sceneId ?? null : input.expectedActive;
  await backend.begin(sceneId);
  const chunks: BuildingChunkDescriptor[] = [];
  let completed = 0, schema: '1' | undefined, generator: string | undefined, failed = false, committed = false, busy = false;
  async function writeStored(chunk: StoredBuildingChunk): Promise<void> {
    try {
      assert(chunk.index === chunks.length && chunk.progress.start === completed && chunk.progress.total === input.totalRequests
        && integer(chunk.progress.completed) && chunk.progress.completed <= input.totalRequests && chunk.progress.completed - completed <= 64
        && (chunk.progress.completed > completed || input.totalRequests === 0 && chunks.length === 0), 'Noncontiguous building chunk.');
      const delta = await decode(chunk);
      assert((!schema || delta.schema_version === schema && delta.generator_version === generator)
        && chunk.buildings === delta.buildings.length && chunk.refusals === delta.refusals.length && chunk.openSpaces === delta.open_spaces.length
        && chunk.buildings + chunk.refusals + chunk.openSpaces === chunk.progress.completed - completed, 'Building chunk metadata changed.');
      const entries = indexChunk(delta, chunk.index);
      // This is the ACK boundary: no local counter changes before durable success.
      await backend.append(sceneId, chunk, entries);
      schema = delta.schema_version; generator = delta.generator_version; completed = chunk.progress.completed; chunks.push(descriptor(chunk));
    } catch (error) { failed = true; throw error; }
  }
  async function appendStored(chunk: StoredBuildingChunk): Promise<void> {
    assert(!failed && !committed && !busy, 'Building stage is failed, committed or busy.'); busy = true;
    try { await writeStored(chunk); } finally { busy = false; }
  }
  return {
    sceneId,
    async append(delta: PlacementBatch, progress: ArchitectureBatchProgress): Promise<void> {
      assert(!failed && !committed && !busy, 'Building stage is failed, committed or busy.'); busy = true;
      try {
        validateDelta(delta); const data = encode(delta), text = payload(data), size = bytes(text);
        assert(size <= BUILDING_CHUNK_MAX_BYTES, 'Building chunk exceeds storage byte budget.');
        const chunk: StoredBuildingChunk = { ...data, index: chunks.length, sha256: await digest(text), bytes: size, progress: { ...progress },
          buildings: delta.buildings.length, refusals: delta.refusals.length, openSpaces: delta.open_spaces.length };
        await writeStored(chunk);
      } catch (error) { failed = true; throw error; } finally { busy = false; }
    },
    /** Import/copy-on-write: exact stored payload, without a new codec/compression pass. */
    appendStored,
    async commit(expected: { fingerprint?: string; completion?: ArchitectureStreamSummary; signal?: AbortSignal } = {}): Promise<BuildingChunkManifest> {
      assert(!failed && !committed && !busy && completed === input.totalRequests && schema && generator && chunks.length, 'Incomplete building stage.'); busy = true;
      try {
        expected.signal?.throwIfAborted();
        const manifest: BuildingChunkManifest = { format: BUILDING_CHUNK_SCENE_FORMAT, sceneId, sourceFingerprint: input.sourceFingerprint,
          schema_version: schema, generator_version: generator, totalRequests: input.totalRequests,
          buildings: chunks.reduce((n, c) => n + c.buildings, 0), refusals: chunks.reduce((n, c) => n + c.refusals, 0),
          openSpaces: chunks.reduce((n, c) => n + c.openSpaces, 0), chunks, fingerprint: '' };
        manifest.fingerprint = await digest(JSON.stringify(content(manifest)));
        assert(expected.fingerprint === undefined || manifest.fingerprint === expected.fingerprint, 'Imported manifest does not match its chunks.');
        const complete = expected.completion;
        assert(!complete || complete.schema_version === manifest.schema_version && complete.generator_version === manifest.generator_version
          && complete.buildings === manifest.buildings && complete.refusals === manifest.refusals && complete.open_spaces === manifest.openSpaces,
        'Worker completion does not match staged building chunks.');
        expected.signal?.throwIfAborted();
        await backend.commit(manifest, expectedActive, { signal: expected.signal });
        // Cancellation after the durable transaction is too late to undo it.
        committed = true; return freeze(manifest);
      } catch (error) { failed = true; throw error; } finally { busy = false; }
    },
    async abort(): Promise<void> { assert(!busy && !committed, 'Building stage is busy or committed.'); failed = true; await backend.discard(sceneId); },
    get progress() { return { completed, total: input.totalRequests, chunks: chunks.length, failed, committed }; },
  };
}

/** A selection must not retain the other parsed buildings of its cold chunk. */
export type BuildingChunkContext = Pick<PlacementBatch, 'schema_version' | 'generator_version' | 'materials' | 'plan_archives'>
  & { buildings: [PlacedBuilding] };
export interface BuildingChunkRead { building: PlacedBuilding; scene: BuildingChunkContext; chunkIndex: number }
export async function openUrbanBuildingChunks(backend: BuildingChunkBackend, sceneId?: string,
  options: { maxCachedChunks?: number; maxCacheBytes?: number } = {}) {
  const found = sceneId ? await backend.manifest(sceneId) : await backend.active(); assert(found, 'Retained building scene is absent.');
  const manifest = freeze(structuredClone(found)); await validateManifest(manifest);
  const maxChunks = options.maxCachedChunks ?? 2, maxBytes = options.maxCacheBytes ?? 8 * 1024 * 1024;
  assert(integer(maxChunks) && maxChunks > 0 && integer(maxBytes) && maxBytes > 0, 'Invalid building chunk cache budget.');
  const cache = new Map<number, { scene: PlacementBatch; bytes: number }>();
  let cachedBytes = 0, pinned: number | undefined;
  // Reads are serialized: even callers issuing many requests cannot materialize an unbounded in-flight cache.
  let reading = false;
  const remove = (index: number) => { const value = cache.get(index)!; cachedBytes -= value.bytes; cache.delete(index); };
  async function load(index: number): Promise<PlacementBatch> {
    const hit = cache.get(index); if (hit) { cache.delete(index); cache.set(index, hit); return hit.scene; }
    const expected = manifest.chunks[index];
    assert(expected && expected.bytes <= maxBytes, 'Retained chunk exceeds read/cache byte budget.');
    const chunk = await backend.chunk(manifest.sceneId, index);
    assert(chunk && expected && JSON.stringify(descriptor(chunk)) === JSON.stringify(expected), 'Retained chunk descriptor mismatch.');
    const scene = freeze(await decode(chunk));
    if (chunk.bytes <= maxBytes) {
      while (cache.size >= maxChunks || cachedBytes + chunk.bytes > maxBytes) {
        const oldest = [...cache.keys()].find(key => key !== pinned); if (oldest === undefined) break; remove(oldest);
      }
      if (cache.size < maxChunks && cachedBytes + chunk.bytes <= maxBytes) { cache.set(index, { scene, bytes: chunk.bytes }); cachedBytes += chunk.bytes; }
    }
    return scene;
  }
  async function exclusive<T>(body: () => Promise<T>): Promise<T> {
    assert(!reading, 'A building chunk read is already active.'); reading = true; try { return await body(); } finally { reading = false; }
  }
  async function read(entry: BuildingChunkIndex, loadedScene?: PlacementBatch): Promise<BuildingChunkRead> {
    const chunkScene = loadedScene ?? await load(entry.chunkIndex), building = chunkScene.buildings[entry.recordIndex];
    assert(building?.id === entry.id && building.parcel_id === entry.parcelId, 'Retained building identity mismatch.');
    assert(isArchivedPlan(building.resolved), 'Selected building has no archive reference.');
    const id = building.resolved.archive_id;
    const scene = freeze({ schema_version: chunkScene.schema_version, generator_version: chunkScene.generator_version,
      buildings: [building] as [PlacedBuilding], ...(chunkScene.materials ? { materials: chunkScene.materials } : {}),
      plan_archives: { [id]: chunkScene.plan_archives![id] } });
    return { building, scene, chunkIndex: entry.chunkIndex };
  }
  return {
    manifest,
    readBuilding(id: string): Promise<BuildingChunkRead | undefined> { return exclusive(async () => {
      const entry = await backend.building(manifest.sceneId, id); return entry ? read(entry) : undefined;
    }); },
    /** A single selected chunk may be pinned. It must itself fit the cache budget. */
    pinBuilding(id?: string): Promise<BuildingChunkRead | undefined> { return exclusive(async () => {
      if (id === undefined) { pinned = undefined; return undefined; }
      const entry = await backend.building(manifest.sceneId, id); assert(entry, 'Selected building is absent.');
      assert(manifest.chunks[entry.chunkIndex]?.bytes <= maxBytes, 'Selected chunk exceeds cache budget.');
      const previous = pinned; pinned = entry.chunkIndex;
      try { return await read(entry); } catch (error) { pinned = previous; throw error; }
    }); },
    readVisible(viewport: ChunkBounds, limits: { maxTiles: number; maxCandidates: number; maxBuildings: number; maxChunks: number; maxBytes: number }) {
      return exclusive(async () => {
        assert(['maxTiles', 'maxCandidates', 'maxBuildings', 'maxChunks', 'maxBytes']
          .every(key => integer(limits[key as keyof typeof limits]) && limits[key as keyof typeof limits] > 0), 'Invalid visible building budgets.');
        // Reserve one spatial read for oversized records indexed under '*'.
        const requested = tiles(viewport, limits.maxTiles - 1), entries = new Map<string, BuildingChunkIndex>();
        let truncated = requested.truncated, scanned = 0;
        for (const key of ['*', ...requested.keys]) {
          const remaining = limits.maxCandidates - scanned; if (!remaining) { truncated = true; break; }
          const result = await backend.tile(manifest.sceneId, key, remaining); scanned += result.entries.length; truncated ||= result.truncated;
          for (const entry of result.entries) if (overlap(viewport, entry.bounds)) entries.set(entry.id, entry);
        }
        const result: BuildingChunkRead[] = [], loaded = new Map<number, PlacementBatch>(); let used = 0;
        for (const entry of [...entries.values()].sort((a, b) => a.chunkIndex - b.chunkIndex || a.recordIndex - b.recordIndex)) {
          if (result.length >= limits.maxBuildings) { truncated = true; break; }
          if (!loaded.has(entry.chunkIndex)) {
            const size = manifest.chunks[entry.chunkIndex]?.bytes; assert(size !== undefined, 'Invalid spatial chunk index.');
            if (size > maxBytes || loaded.size >= limits.maxChunks || used + size > limits.maxBytes) { truncated = true; continue; }
            loaded.set(entry.chunkIndex, await load(entry.chunkIndex)); used += size;
          }
          result.push(await read(entry, loaded.get(entry.chunkIndex)));
        }
        return { buildings: result, chunkIndices: [...loaded.keys()], bytes: used, truncated, candidatesRead: scanned };
      });
    },
    clearCache() { assert(!reading, 'Building chunk read is active.'); cache.clear(); cachedBytes = 0; pinned = undefined; },
    get stats() { return { chunks: cache.size, bytes: cachedBytes, pinnedChunk: pinned, indices: [...cache.keys()] }; },
  };
}

export interface AuthenticatedBuildingChunk {
  descriptor: BuildingChunkDescriptor; stored: StoredBuildingChunk; delta: PlacementBatch;
}
/** One authenticated chunk and its exact stored payload. Used for transactional
 * copy-on-write edits; callers must not retain an entire native city. */
export async function* iterateUrbanBuildingChunkRecords(backend: BuildingChunkBackend, sceneId: string,
  options: { maxChunkBytes?: number; cancelled?(): boolean } = {}): AsyncGenerator<AuthenticatedBuildingChunk> {
  const found = await backend.manifest(sceneId); assert(found, 'Retained building scene is absent.');
  const manifest = freeze(structuredClone(found)); await validateManifest(manifest);
  const cap = options.maxChunkBytes ?? BUILDING_CHUNK_MAX_BYTES;
  assert(integer(cap) && cap > 0 && cap <= BUILDING_CHUNK_MAX_BYTES, 'Invalid native chunk traversal budget.');
  for (const expected of manifest.chunks) {
    if (options.cancelled?.()) throw new DOMException('Building traversal replaced', 'AbortError');
    assert(expected.bytes <= cap, 'Retained chunk exceeds traversal byte budget.');
    const chunk = await backend.chunk(sceneId, expected.index);
    assert(chunk && JSON.stringify(descriptor(chunk)) === JSON.stringify(expected), 'Retained chunk descriptor mismatch.');
    const delta = freeze(await decode(chunk));
    if (options.cancelled?.()) throw new DOMException('Building traversal replaced', 'AbortError');
    yield { descriptor: expected, stored: freeze(chunk), delta };
  }
}

/** Walk one authenticated native chunk at a time. Consumers must retain only
 * projected children/scalars; this never constructs a complete native scene. */
export async function* iterateUrbanBuildingChunks(backend: BuildingChunkBackend, sceneId: string,
  options: { maxChunkBytes?: number; cancelled?(): boolean } = {}): AsyncGenerator<PlacementBatch> {
  for await (const record of iterateUrbanBuildingChunkRecords(backend, sceneId, options)) yield record.delta;
}

/** NDJSON frames: one manifest, one exact stored payload per chunk, one footer.
 * Consumer backpressure bounds export to one chunk; no whole-scene stringify. */
export async function* exportUrbanBuildingChunks(backend: BuildingChunkBackend, sceneId: string): AsyncGenerator<Uint8Array> {
  const manifest = await backend.manifest(sceneId); assert(manifest, 'Retained building scene is absent.'); await validateManifest(manifest);
  const frame = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + '\n');
  yield frame({ type: 'manifest', manifest });
  for (const expected of manifest.chunks) {
    const chunk = await backend.chunk(sceneId, expected.index);
    assert(chunk && JSON.stringify(descriptor(chunk)) === JSON.stringify(expected), 'Retained chunk descriptor mismatch.');
    await decode(chunk); yield frame({ type: 'chunk', chunk });
  }
  yield frame({ type: 'complete', fingerprint: manifest.fingerprint });
}
async function* frames(source: AsyncIterable<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '', count = 0;
  for await (const piece of source) {
    assert(piece instanceof Uint8Array, 'Invalid building import bytes.');
    let start = 0;
    for (let i = 0; i < piece.length; i++) if (piece[i] === 10) {
      count += i - start; assert(count <= BUILDING_CHUNK_MAX_BYTES + 64 * 1024, 'Building import frame exceeds byte budget.');
      pending += decoder.decode(piece.subarray(start, i), { stream: true }); pending += decoder.decode();
      assert(pending.length > 0, 'Empty building import frame.'); yield JSON.parse(pending); pending = ''; count = 0; start = i + 1;
    }
    count += piece.length - start; assert(count <= BUILDING_CHUNK_MAX_BYTES + 64 * 1024, 'Building import frame exceeds byte budget.');
    pending += decoder.decode(piece.subarray(start), { stream: true });
  }
  pending += decoder.decode(); assert(!pending.length && count === 0, 'Truncated building import frame.');
}
export async function importUrbanBuildingChunks(backend: BuildingChunkBackend, source: AsyncIterable<Uint8Array>, options: {
  sceneId?: string; expectedActive?: string | null;
} = {}): Promise<BuildingChunkManifest> {
  let stage: Awaited<ReturnType<typeof beginUrbanBuildingStage>> | undefined, original: BuildingChunkManifest | undefined, complete = false, ordinal = 0;
  try {
    for await (const frame of frames(source)) {
      assert(!complete, 'Trailing building import frames.');
      if (!stage) {
        assert(frame.type === 'manifest', 'Building import must begin with manifest.');
        original = frame.manifest as BuildingChunkManifest; await validateManifest(original);
        stage = await beginUrbanBuildingStage(backend, { sceneId: options.sceneId, sourceFingerprint: original.sourceFingerprint,
          totalRequests: original.totalRequests, expectedActive: options.expectedActive });
      } else if (frame.type === 'chunk') {
        const chunk = frame.chunk as StoredBuildingChunk;
        assert(original!.chunks[ordinal] && JSON.stringify(descriptor(chunk)) === JSON.stringify(original!.chunks[ordinal]), 'Imported chunk order/identity mismatch.');
        await stage.appendStored(chunk); ordinal++;
      } else {
        assert(frame.type === 'complete' && frame.fingerprint === original!.fingerprint && ordinal === original!.chunks.length, 'Incomplete building import.'); complete = true;
      }
    }
    assert(stage && original && complete, 'Incomplete building import.'); return await stage.commit({ fingerprint: original.fingerprint });
  } catch (error) { await stage?.abort(); throw error; }
}
