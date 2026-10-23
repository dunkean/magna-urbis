/** Lossless scene archives for retained native plans. Compression is storage,
 * never procedural generation. Visible geometry stays outside these archives.
 */
import type { PlacementBatch, PlacedBuilding } from './urbanArchitecture';
import type { MaterialSlots, RoofSpec, Surface } from './housesContract';
import { gzipPlanBytes, gunzipPlanBytes } from '../../web/src/io/planArchiveCompression';

export const COMPACT_PLAN_ARCHIVE_FORMAT = 'compact-plan-archive-1';
export const PLAN_ARCHIVE_MAX_RECORDS = 64;
export const PLAN_ARCHIVE_CACHE_BYTES = 8 * 1024 * 1024;
export const PLAN_ARCHIVE_CACHE_COUNT = 2;
const MAX_RAW_BYTES = 32 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = MAX_RAW_BYTES + 64 * 1024;
const ID_PATTERN = /^plan-archive-[a-f0-9]{64}$/;

export interface ArchivedPlanReference {
  format: typeof COMPACT_PLAN_ARCHIVE_FORMAT;
  archive_id: string;
  index: number;
}
export interface PlanArchiveScene {
  buildings: Pick<PlacedBuilding, 'resolved'>[];
  plan_archives?: Record<string, string>;
}

// The reference belongs to its scene/building. Dropping the scene releases the
// archive association; there is no global table retaining every visited city.
const registered = new WeakMap<object, string>();
interface DecodedArchive {
  source: string;
  raw: Uint8Array<ArrayBuffer>;
  spans: Uint32Array<ArrayBuffer>;
  bytes: number;
}
const decoded = new Map<string, DecodedArchive>();
// Only active work is shared. The exact source participates in the key so an
// invalid/colliding payload cannot borrow another caller's integrity check.
const decoding = new Map<string, Map<string, Promise<DecodedArchive>>>();
let cacheEpoch = 0;
let cacheBytes = 0, hits = 0, misses = 0, evictions = 0;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Native records contain finite JSON values. Preserve signed zero as well: plain
// JSON.stringify otherwise maps -0 and +0 to the same key. No rounding, tolerance
// or coordinate normalization participates in sharing.
function exactJsonKey(value: unknown): string {
  let numberIndex = 0;
  const negativeZeros: number[] = [];
  const json = JSON.stringify(value, (_key, child) => {
    if (typeof child === 'number') {
      if (Object.is(child, -0)) negativeZeros.push(numberIndex);
      numberIndex++;
    }
    return child;
  });
  return negativeZeros.length ? `${json}\0${negativeZeros.join(',')}` : json;
}
function intern<T>(values: Map<string, T>, value: T): T {
  if (!value || typeof value !== 'object') return value;
  const key = exactJsonKey(value), previous = values.get(key);
  if (previous !== undefined) return previous;
  values.set(key, value);
  return value;
}
function mapChanged<T>(values: T[], map: (value: T) => T): T[] {
  let changed = false;
  const result = values.map(value => {
    const next = map(value);
    changed ||= next !== value;
    return next;
  });
  return changed ? result : values;
}

/** Intern only exact visible values. Geometry stays local to one building;
 * small authored material/roof records share within at most 64 buildings.
 * These maps are discarded after the chunk; the scene owns the resulting graph.
 * Scene geometry is consumed as immutable data, including after structuredClone.
 */
function shareVisibleChunk(buildings: PlacedBuilding[], start: number): void {
  const materials = new Map<string, MaterialSlots>();
  const roofs = new Map<string, RoofSpec>();
  for (let position = start; position < Math.min(start + PLAN_ARCHIVE_MAX_RECORDS, buildings.length); position++) {
    const building = buildings[position];
    if (building.simplification !== 'architectural_plan') continue;
    const surfaces = new Map<string, Surface>();
    const surface = (value: Surface) => intern(surfaces, value);
    const footprint = surface(building.footprint), roof_footprint = surface(building.roof_footprint);
    const courtyards = surface(building.courtyards), circulation = surface(building.circulation);
    const volumes = building.volumes && mapChanged(building.volumes, volume => {
      const footprint = surface(volume.footprint);
      const levels = mapChanged(volume.levels, level => {
        const footprint = surface(level.footprint);
        const slots = level.materials ? intern(materials, level.materials) : level.materials;
        return footprint === level.footprint && slots === level.materials ? level
          : { ...level, footprint, ...(slots !== level.materials ? { materials: slots } : {}) };
      });
      const slots = intern(materials, volume.materials), roof_spec = intern(roofs, volume.roof_spec);
      const foundationFootprint = surface(volume.foundation.footprint);
      const foundation = foundationFootprint === volume.foundation.footprint ? volume.foundation : { ...volume.foundation, footprint: foundationFootprint };
      return footprint === volume.footprint && levels === volume.levels && slots === volume.materials && roof_spec === volume.roof_spec && foundation === volume.foundation
        ? volume : { ...volume, footprint, levels, materials: slots, roof_spec, foundation };
    });
    const structural_foundations = building.structural_foundations && mapChanged(building.structural_foundations, foundation => {
      const footprint = surface(foundation.footprint);
      return footprint === foundation.footprint ? foundation : { ...foundation, footprint };
    });
    if (footprint !== building.footprint || roof_footprint !== building.roof_footprint || courtyards !== building.courtyards || circulation !== building.circulation
      || volumes !== building.volumes || structural_foundations !== building.structural_foundations) {
      buildings[position] = { ...building, footprint, roof_footprint, courtyards, circulation, volumes,
        ...(structural_foundations !== building.structural_foundations ? { structural_foundations } : {}) };
    }
  }
}
export function isArchivedPlan(value: unknown): value is ArchivedPlanReference {
  return record(value) && value.format === COMPACT_PLAN_ARCHIVE_FORMAT
    && typeof value.archive_id === 'string' && ID_PATTERN.test(value.archive_id)
    && Number.isInteger(value.index) && (value.index as number) >= 0
    && (value.index as number) < PLAN_ARCHIVE_MAX_RECORDS;
}
function reference(value: unknown): ArchivedPlanReference | undefined {
  if (!record(value) || value.format !== COMPACT_PLAN_ARCHIVE_FORMAT) return undefined;
  if (!isArchivedPlan(value)) throw new Error('Invalid retained-plan archive reference.');
  return value;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (value.length > Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4) throw new Error('Retained-plan archive exceeds compressed byte budget.');
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('Invalid retained-plan archive base64.'); }
  if (binary.length > MAX_COMPRESSED_BYTES) throw new Error('Retained-plan archive exceeds compressed byte budget.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
async function archiveId(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `plan-archive-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Bind freshly received or JSON-restored building references to their scene.
 * This does not decompress archives or parse retained architecture. */
export function registerPlanArchives(scene: PlanArchiveScene): void {
  for (const building of scene.buildings) {
    const ref = reference(building.resolved);
    if (!ref) continue;
    const source = scene.plan_archives?.[ref.archive_id];
    if (typeof source !== 'string') throw new Error(`Missing retained-plan archive ${ref.archive_id}.`);
    registered.set(ref, source);
  }
}

/** Archive native compact plans in chunks of at most 64. Each payload is gzip
 * over newline-delimited JSON records: JSON.stringify escapes embedded newlines.
 * This lets selection parse one record, instead of materializing 64 plans.
 * The input and its retained native objects are never modified.
 */
export async function archivePlanBatch(batch: PlacementBatch): Promise<PlacementBatch> {
  const buildings = batch.buildings.slice();
  for (let start = 0; start < buildings.length; start += PLAN_ARCHIVE_MAX_RECORDS) shareVisibleChunk(buildings, start);
  const archives = { ...batch.plan_archives };
  const pending: number[] = [];
  for (let index = 0; index < buildings.length; index++) {
    const building = buildings[index];
    if (building.simplification !== 'architectural_plan' || reference(building.resolved)) continue;
    if (!record(building.resolved) || building.resolved.format !== 'compact-plan-1') {
      throw new Error(`Building ${building.id} has no native compact plan to archive.`);
    }
    pending.push(index);
  }
  if (!pending.length) {
    const result = buildings.every((building, index) => building === batch.buildings[index]) ? batch : { ...batch, buildings };
    registerPlanArchives(result);
    return result;
  }
  const encoder = new TextEncoder();
  for (let offset = 0; offset < pending.length;) {
    const positions: number[] = [], records: Uint8Array<ArrayBuffer>[] = [];
    let byteLength = 0;
    while (offset < pending.length && positions.length < PLAN_ARCHIVE_MAX_RECORDS) {
      const bytes = encoder.encode(JSON.stringify(buildings[pending[offset]].resolved));
      if (bytes.length > MAX_RAW_BYTES) throw new Error('Retained plan exceeds uncompressed byte budget.');
      const nextSize = byteLength + bytes.length + (records.length ? 1 : 0);
      if (nextSize > MAX_RAW_BYTES) break;
      positions.push(pending[offset++]); records.push(bytes); byteLength = nextSize;
    }
    const raw = new Uint8Array(byteLength);
    let cursor = 0;
    for (const [index, bytes] of records.entries()) {
      if (index) raw[cursor++] = 10;
      raw.set(bytes, cursor); cursor += bytes.length;
    }
    const compressed = await gzipPlanBytes(raw);
    if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error('Retained-plan archive exceeds compressed byte budget.');
    const id = await archiveId(compressed), source = base64(compressed);
    if (archives[id] !== undefined && archives[id] !== source) throw new Error('Conflicting retained-plan archive identity.');
    archives[id] = source;
    for (const [index, position] of positions.entries()) {
      buildings[position] = { ...buildings[position], resolved: { format: COMPACT_PLAN_ARCHIVE_FORMAT, archive_id: id, index } satisfies ArchivedPlanReference };
    }
  }
  const result = { ...batch, buildings, plan_archives: archives };
  registerPlanArchives(result);
  return result;
}

function recordSpans(raw: Uint8Array): Uint32Array<ArrayBuffer> {
  if (!raw.length) throw new Error('Empty retained-plan archive.');
  const spans: number[] = [];
  let start = 0;
  for (let offset = 0; offset < raw.length; offset++) {
    if (raw[offset] !== 10) continue;
    if (offset === start) throw new Error('Empty retained-plan archive record.');
    spans.push(start, offset); start = offset + 1;
    if (spans.length >= PLAN_ARCHIVE_MAX_RECORDS * 2) throw new Error('Too many retained plans in archive.');
  }
  if (start === raw.length) throw new Error('Empty retained-plan archive record.');
  spans.push(start, raw.length);
  return new Uint32Array(spans);
}

function retain(id: string, value: DecodedArchive): void {
  if (value.bytes > PLAN_ARCHIVE_CACHE_BYTES) return;
  const old = decoded.get(id);
  if (old) { decoded.delete(id); cacheBytes -= old.bytes; }
  while (decoded.size >= PLAN_ARCHIVE_CACHE_COUNT || cacheBytes + value.bytes > PLAN_ARCHIVE_CACHE_BYTES) {
    const oldest = decoded.keys().next().value;
    if (oldest === undefined) break;
    cacheBytes -= decoded.get(oldest)!.bytes;
    decoded.delete(oldest); evictions++;
  }
  decoded.set(id, value); cacheBytes += value.bytes;
}

function decode(id: string, source: string): Promise<DecodedArchive> {
  const cached = decoded.get(id);
  if (cached?.source === source) {
    decoded.delete(id); decoded.set(id, cached); hits++;
    return Promise.resolve(cached);
  }
  const sources = decoding.get(id) ?? new Map<string, Promise<DecodedArchive>>();
  const pending = sources.get(source);
  if (pending) return pending;
  misses++;
  const epoch = cacheEpoch;
  const promise = decodeUncached(id, source, epoch).finally(() => {
    // A clear may have installed a new generation for this same identity.
    // Completing old work must neither remove it nor refill its cache.
    if (decoding.get(id) !== sources || sources.get(source) !== promise) return;
    sources.delete(source);
    if (!sources.size) decoding.delete(id);
  });
  sources.set(source, promise); decoding.set(id, sources);
  return promise;
}

async function decodeUncached(id: string, source: string, epoch: number): Promise<DecodedArchive> {
  const compressed = fromBase64(source);
  if (compressed.length < 18 || compressed[0] !== 31 || compressed[1] !== 139 || compressed[2] !== 8) throw new Error('Invalid retained-plan gzip archive.');
  const expectedSize = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength).getUint32(compressed.length - 4, true);
  // fflate's single-member decoder allocates from this footer; validate it before
  // entering its worker, then verify the actual result too.
  if (!expectedSize || expectedSize > MAX_RAW_BYTES) throw new Error('Retained-plan archive exceeds uncompressed byte budget.');
  if (await archiveId(compressed) !== id) throw new Error('Retained-plan archive integrity mismatch.');
  const raw = await gunzipPlanBytes(compressed);
  if (raw.byteLength !== expectedSize || raw.byteLength > MAX_RAW_BYTES) throw new Error('Invalid retained-plan archive output size.');
  const spans = recordSpans(raw);
  // Account for all retained payload storage, including UTF-16 archive text and
  // its map key. Parsed architecture is never retained in this cache.
  const value = { source, raw, spans, bytes: raw.byteLength + spans.byteLength + (source.length + id.length) * 2 };
  if (epoch === cacheEpoch) retain(id, value);
  return value;
}

/** Materialize only the selected retained record. Unarchived native plans pass
 * through unchanged. The returned parsed record is independent of cached bytes,
 * so callers cannot mutate the archive by editing a previous result.
 */
export async function resolveArchivedPlan(building: Pick<PlacedBuilding, 'resolved'>, scene?: PlanArchiveScene): Promise<unknown> {
  const ref = reference(building.resolved);
  if (!ref) return building.resolved;
  const source = scene?.plan_archives?.[ref.archive_id] ?? registered.get(ref);
  if (typeof source !== 'string') throw new Error(`Missing retained-plan archive ${ref.archive_id}; register the restored scene first.`);
  registered.set(ref, source);
  const value = await decode(ref.archive_id, source);
  const start = value.spans[ref.index * 2], end = value.spans[ref.index * 2 + 1];
  if (start === undefined || end === undefined) throw new Error('Invalid retained-plan archive record index.');
  const resolved: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value.raw.subarray(start, end)));
  if (!record(resolved) || resolved.format !== 'compact-plan-1') throw new Error('Archive record is not a native compact plan.');
  return resolved;
}

/** Small diagnostics for tooling/tests; no retained native geometry is exposed. */
export function planArchiveCacheStats() {
  return { entries: decoded.size, bytes: cacheBytes, ids: [...decoded.keys()], hits, misses, evictions };
}
export function clearPlanArchiveCache(): void {
  // Existing consumers still receive their result; clearing ownership does
  // not cancel shared physical work or another client's awaited promise.
  cacheEpoch++; decoding.clear();
  decoded.clear(); cacheBytes = 0; hits = 0; misses = 0; evictions = 0;
}
