/** Optional, disposable child-data cache. Native manifests/archives stay exact. */
import type { ArchitectureBatchProgress } from '../../../rust/bridge/architectureBatch';
import type { BuildingChunkBackend, BuildingChunkManifest, BuildingChunkDescriptor } from './urbanBuildingChunkStore';
import type { NativeBuildingProjectionScene } from './urbanBuildingProjection';
import type { UrbanSiteVisual } from './urbanSiteStore';

// V1 discarded optional housing-floor metadata. Disposable children must be
// rebuilt serially from their exact native parent; native formats stay intact.
export const DERIVED_VISUAL_VERSION = 'urban-derived-visual-2';
export const DERIVED_MAX_CHUNK_BYTES = 32 * 1024 * 1024;
export interface DerivedDescriptor { index: number; nativeSha256: string; progress: ArchitectureBatchProgress; sha256: string; bytes: number }
export interface DerivedChunk extends DerivedDescriptor { json: string; negativeZeros: number[] }
export interface DerivedOrigin { id: string; parcelId: string; offset: number; chunkIndex: number; siteRecord: number }
export interface DerivedManifest {
  version: typeof DERIVED_VISUAL_VERSION; sceneId: string; cacheId: string; parentFingerprint: string; sourceFingerprint: string;
  totalRequests: number; buildings: number; refusals: number; openSpaces: number;
  origins: 'complete' | 'unknown'; chunks: DerivedDescriptor[]; fingerprint: string;
}
export interface DerivedBackend {
  begin(sceneId: string, cacheId: string): Promise<void>;
  append(sceneId: string, cacheId: string, chunk: DerivedChunk, origins: DerivedOrigin[]): Promise<void>;
  /** Must validate the committed native parent AND the current cacheId atomically. */
  commit(manifest: DerivedManifest, options?: { signal?: AbortSignal }): Promise<void>;
  manifest(sceneId: string): Promise<DerivedManifest | undefined>;
  chunk(sceneId: string, cacheId: string, index: number): Promise<DerivedChunk | undefined>;
  origin(sceneId: string, cacheId: string, id: string): Promise<DerivedOrigin | undefined>;
  discard(sceneId: string, cacheId: string): Promise<void>;
}
type Payload = { projection: NativeBuildingProjectionScene; sites?: UrbanSiteVisual[] };
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const shaPattern = /^[a-f0-9]{64}$/;
function fail(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;
async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function encode(value: unknown): { json: string; negativeZeros: number[] } {
  let ordinal = 0; const negativeZeros: number[] = [];
  const json = JSON.stringify(value, (_key, v) => {
    if (typeof v === 'number') { fail(Number.isFinite(v), 'Nonfinite derived visual.'); if (Object.is(v, -0)) negativeZeros.push(ordinal); ordinal++; }
    return v;
  });
  fail(typeof json === 'string', 'Unserializable derived value.');
  return { json, negativeZeros };
}
const encoded = (value: { json: string; negativeZeros: number[] }) => ({ json: value.json, negativeZeros: value.negativeZeros });
const descriptor = ({ index, nativeSha256, progress, sha256, bytes }: DerivedDescriptor): DerivedDescriptor => ({ index, nativeSha256, progress: { ...progress }, sha256, bytes });
const content = ({ fingerprint: _hash, ...value }: DerivedManifest) => value;
const validPoint = (p: { x: number; y: number }) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
function validSurface(value: NativeBuildingProjectionScene['buildings'][number]['footprint']): boolean {
  return Array.isArray(value) && value.every(shape => shape && Array.isArray(shape.outer) && shape.outer.every(validPoint)
    && Array.isArray(shape.holes) && shape.holes.every(ring => Array.isArray(ring) && ring.every(validPoint)));
}
function validateProjection(scene: NativeBuildingProjectionScene, progress: ArchitectureBatchProgress): void {
  fail(scene?.projection === 'native-building-visual-scene-1' && Array.isArray(scene.buildings) && Array.isArray(scene.refusals), 'Invalid derived projection.');
  fail(scene.metrics?.buildings === scene.buildings.length && scene.metrics.refusals === scene.refusals.length
    && scene.metrics.buildings + scene.metrics.refusals + scene.metrics.openSpaces === progress.completed - progress.start, 'Derived counts mismatch.');
  fail(scene.metrics.scope === 'provided-records' && [scene.metrics.buildings, scene.metrics.refusals, scene.metrics.openSpaces,
    scene.metrics.errors, scene.metrics.usefulAreaM2, scene.metrics.domesticUnits].every(n => Number.isFinite(n) && n >= 0), 'Invalid derived scalar metrics.');
  for (const building of scene.buildings) {
    fail(building.projection === 'native-building-visual-1' && building.nativeRealization === false && typeof building.id === 'string'
      && typeof building.parcel_id === 'string' && !['resolved', 'volumes', 'plan_archives', 'structural_features'].some(k => k in building), 'Derived cache contains parent/native data.');
    fail(Array.isArray(building.footprint) && Array.isArray(building.roof_footprint) && Array.isArray(building.occupation_surfaces)
      && Array.isArray(building.ground_constraints), 'Invalid derived geometry.');
    fail(validSurface(building.footprint) && validSurface(building.roof_footprint) && building.occupation_surfaces.every(validSurface)
      && building.ground_constraints.every((c: { footprint: typeof building.footprint; height_m: number }) => c && validSurface(c.footprint) && Number.isFinite(c.height_m))
      && validPoint(building.entrance!) && building.culture && typeof building.culture.mode === 'string'
      && typeof building.function === 'string' && typeof building.recipe_id === 'string' && typeof building.variant_id === 'string'
      && [building.height_m, building.ground_z_m, building.useful_area_m2, building.domestic_units].every(Number.isFinite)
      && (!building.cartographic || Array.isArray(building.cartographic.ridges)
        && building.cartographic.ridges.every((r: readonly { x: number; y: number }[]) => r.length === 2 && r.every(validPoint))), 'Malformed derived visual child.');
    // Restore exact child-surface aliasing lost by JSON, using -0-aware keys.
    const interned = new Map<string, typeof building.footprint>();
    const intern = (surface: typeof building.footprint) => {
      const key = JSON.stringify(encode(surface)), old = interned.get(key); if (old) return old;
      interned.set(key, surface); return surface;
    };
    const b = building as unknown as { footprint: typeof building.footprint; roof_footprint: typeof building.footprint;
      occupation_surfaces: Array<typeof building.footprint>; ground_constraints: { footprint: typeof building.footprint; height_m: number }[] };
    // Frozen freshly projected DTOs need no repair; parsed DTOs are mutable here.
    if (!Object.isFrozen(b)) {
      b.footprint = intern(b.footprint); b.roof_footprint = intern(b.roof_footprint);
      b.occupation_surfaces = b.occupation_surfaces.map(intern);
      b.ground_constraints = b.ground_constraints.map(c => ({ ...c, footprint: intern(c.footprint) }));
    }
  }
  for (const refusal of scene.refusals) fail(['id', 'parcel_id', 'code', 'message'].every(k => typeof refusal[k as keyof typeof refusal] === 'string'), 'Invalid derived refusal metadata.');
}
function validateSites(sites: UrbanSiteVisual[], progress: ArchitectureBatchProgress): void {
  fail(Array.isArray(sites) && sites.length === progress.completed - progress.start, 'Incomplete derived site origins.');
  const ids = new Set<string>();
  sites.forEach((site, i) => {
    fail(site && site.offset === progress.start + i && typeof site.id === 'string' && site.id.length && !ids.has(site.id)
      && typeof site.parcel_id === 'string' && Array.isArray(site.surface)
      && validSurface(site.surface) && validPoint(site.entrance) && Number.isFinite(site.ground_z_m)
      && typeof site.preview === 'boolean' && typeof site.function === 'string' && typeof site.access_id === 'string'
      && !['config', 'terrain', 'reserves', 'accesses', 'native_minimum_candidates'].some(k => k in site), 'Invalid projected site origin.');
    ids.add(site.id);
  });
}
async function decode(chunk: DerivedChunk, expected: DerivedDescriptor): Promise<Payload> {
  fail(chunk && JSON.stringify(descriptor(chunk)) === JSON.stringify(expected) && typeof chunk.json === 'string'
    && Array.isArray(chunk.negativeZeros) && chunk.negativeZeros.every((n, i, all) => integer(n) && (!i || n > all[i - 1])), 'Derived descriptor/encoding mismatch.');
  fail(byteLength(JSON.stringify(encoded(chunk))) === expected.bytes && expected.bytes <= DERIVED_MAX_CHUNK_BYTES
    && await digest(encoded(chunk)) === expected.sha256, 'Derived chunk integrity mismatch.');
  let ordinal = 0, cursor = 0;
  const value = JSON.parse(chunk.json, (_key, v) => {
    if (typeof v !== 'number') return v; fail(Number.isFinite(v), 'Nonfinite derived number.');
    if (chunk.negativeZeros[cursor] === ordinal++) { fail(v === 0, 'Invalid derived negative zero.'); cursor++; return -0; }
    return v;
  }) as Payload;
  fail(cursor === chunk.negativeZeros.length, 'Invalid derived negative zero ordinal.');
  validateProjection(value.projection, expected.progress); if (value.sites) validateSites(value.sites, expected.progress);
  return value;
}

/** Optional failures belong to this cache, never to a native stage. */
export async function beginDerivedWrite(backend: BuildingChunkBackend, sceneId: string, sourceFingerprint: string, totalRequests: number) {
  const storage = backend.derived; if (!storage) return undefined;
  const cacheId = crypto.randomUUID(); await storage.begin(sceneId, cacheId);
  const chunks: DerivedDescriptor[] = []; let completeOrigins = true, completed = 0;
  const totals = { buildings: 0, refusals: 0, openSpaces: 0 };
  return {
    async append(projection: NativeBuildingProjectionScene, native: BuildingChunkDescriptor, sites?: UrbanSiteVisual[]): Promise<void> {
      fail(native.index === chunks.length && native.progress.start === completed && native.progress.total === totalRequests, 'Noncontiguous derived chunk.');
      validateProjection(projection, native.progress); if (sites) validateSites(sites, native.progress); else completeOrigins = false;
      if (sites) {
        const byId = new Map(sites.map(site => [site.id, site]));
        for (const value of [...projection.buildings, ...(projection.refusals ?? [])]) fail(byId.get(value.id)?.parcel_id === value.parcel_id, 'Derived native/site identity mismatch.');
      }
      const data = encode({ projection, ...(sites ? { sites } : {}) }), bytes = byteLength(JSON.stringify(data));
      fail(bytes > 0 && bytes <= DERIVED_MAX_CHUNK_BYTES, 'Derived chunk exceeds cache budget.');
      const chunk: DerivedChunk = { index: native.index, nativeSha256: native.sha256, progress: { ...native.progress }, ...data, bytes, sha256: await digest(data) };
      await storage.append(sceneId, cacheId, chunk, (sites ?? []).map((site, siteRecord) => ({ id: site.id, parcelId: site.parcel_id, offset: site.offset, chunkIndex: native.index, siteRecord })));
      chunks.push(descriptor(chunk)); completed = native.progress.completed;
      for (const key of ['buildings', 'refusals', 'openSpaces'] as const) totals[key] += projection.metrics[key];
    },
    async commit(parent: BuildingChunkManifest, signal?: AbortSignal): Promise<void> {
      fail(parent.sceneId === sceneId && parent.sourceFingerprint === sourceFingerprint && completed === totalRequests
        && chunks.length === parent.chunks.length && totals.buildings === parent.buildings && totals.refusals === parent.refusals
        && totals.openSpaces === parent.openSpaces, 'Derived parent/count mismatch.');
      const manifest: DerivedManifest = { version: DERIVED_VISUAL_VERSION, sceneId, cacheId, parentFingerprint: parent.fingerprint, sourceFingerprint,
        totalRequests, ...totals, origins: completeOrigins ? 'complete' : 'unknown', chunks, fingerprint: '' };
      manifest.fingerprint = await digest(content(manifest)); signal?.throwIfAborted(); await storage.commit(manifest, { signal });
    },
    abort: () => storage.discard(sceneId, cacheId),
  };
}

export async function openDerivedCache(backend: BuildingChunkBackend, parent: BuildingChunkManifest) {
  const storage = backend.derived; if (!storage) throw new Error('Derived backend unavailable.');
  const manifest = await storage.manifest(parent.sceneId);
  fail(manifest && manifest.version === DERIVED_VISUAL_VERSION && manifest.sceneId === parent.sceneId
    && manifest.parentFingerprint === parent.fingerprint && manifest.sourceFingerprint === parent.sourceFingerprint
    && manifest.totalRequests === parent.totalRequests && manifest.buildings === parent.buildings && manifest.refusals === parent.refusals
    && manifest.openSpaces === parent.openSpaces && ['complete', 'unknown'].includes(manifest.origins)
    && Array.isArray(manifest.chunks) && manifest.chunks.length === parent.chunks.length
    && shaPattern.test(manifest.fingerprint) && await digest(content(manifest)) === manifest.fingerprint, 'Missing/stale derived cache.');
  for (const [i, chunk] of manifest.chunks.entries()) fail(chunk.index === i && chunk.nativeSha256 === parent.chunks[i].sha256
    && JSON.stringify(chunk.progress) === JSON.stringify(parent.chunks[i].progress) && integer(chunk.bytes) && chunk.bytes > 0
    && chunk.bytes <= DERIVED_MAX_CHUNK_BYTES && shaPattern.test(chunk.sha256), 'Derived native association mismatch.');
  const load = async (index: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    fail(integer(index) && index < manifest.chunks.length, 'Invalid derived chunk index.');
    const chunk = await storage.chunk(parent.sceneId, manifest.cacheId, index); fail(chunk, 'Derived chunk absent.');
    signal?.throwIfAborted();
    const value = await decode(chunk, manifest.chunks[index]), native = parent.chunks[index];
    signal?.throwIfAborted();
    fail(value.projection.metrics.buildings === native.buildings && value.projection.metrics.refusals === native.refusals
      && value.projection.metrics.openSpaces === native.openSpaces, 'Derived native chunk counts changed.');
    return value;
  };
  return {
    manifest,
    /** Authenticated child-only read; retains no chunks. Caller owns concurrency/budgets. */
    chunk: load,
    async *chunks() { for (const expected of manifest.chunks) { const value = await load(expected.index);
      if (manifest.origins === 'complete') fail(value.sites, 'Derived origins absent.'); yield value; } },
    /** Offset is authenticated child metadata, NOT a current native query proof. */
    async origin(id: string): Promise<DerivedOrigin | undefined> {
      if (manifest.origins !== 'complete') return undefined;
      const entry = await storage.origin(parent.sceneId, manifest.cacheId, id); if (!entry) return undefined;
      fail(entry.id === id && integer(entry.chunkIndex) && entry.chunkIndex < manifest.chunks.length && integer(entry.siteRecord)
        && integer(entry.offset) && entry.offset < parent.totalRequests, 'Derived origin index invalid.');
      const value = await load(entry.chunkIndex), site = value.sites?.[entry.siteRecord];
      fail(site && site.id === id && site.parcel_id === entry.parcelId && site.offset === entry.offset, 'Derived origin association changed.');
      return entry;
    },
  };
}
