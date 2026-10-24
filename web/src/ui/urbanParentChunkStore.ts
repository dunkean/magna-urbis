import { projectParentRecords } from './urbanParentVisual';
import { encodeParentVisual, type ParentVisualChunk } from './urbanParentVisualCache';
import type { NativeParentSessionEvidence } from '../../../rust/bridge/nativeParentSessionContract';
/** Native city parent source. Archives only; fresh views are discarded after
 * deriving atomically associated indexes. Append is the ACK durability boundary. */
import type { Surface } from '../../../rust/bridge/housesContract';
import type { ArchitectureBatchProgress } from '../../../rust/bridge/architectureBatch';
import type { NativeParentApi, NativeParentArchive, NativeParentBatch, NativeParentCounts, NativeParentPlan, NativeParentRecord } from '../../../rust/bridge/nativeParentContract';
import { NATIVE_PARENT_SCHEMA, parentIdentity, validateParentBatch, validateParentCounts } from '../../../rust/bridge/nativeParentContract';
import { nativeParentLeaves, surfaceBounds, type ParentBounds } from '../../../rust/bridge/nativeParentOccupation';
import { parentDigest, type ParentBatchBoundary, type NativeParentStreamSummary } from '../../../rust/bridge/nativeParentStream';
import { parentWire, PARENT_LIMITS } from '../../../rust/bridge/nativeParentBudget';
export const PARENT_SCENE_FORMAT = 'urban-native-parent-chunks-1';
export const PARENT_CHUNK_BYTES = 8 * 1024 * 1024;
export interface ParentSourceRecord { id: string; parcelId: string; nativeKind: NativeParentPlan['kind'];
  archive: NativeParentArchive; attempt: NativeParentRecord['attempt']; members: { id: string; key: string | null }[] }
export type ParentSourceRow = { kind: 'parent'; parent: ParentSourceRecord }
  | { kind: 'refusal'; refusal: NativeParentBatch['refusals'][number] }
  | { kind: 'open'; open: NativeParentBatch['open_spaces'][number] };
export interface ParentChunkPayload { schema_version: typeof NATIVE_PARENT_SCHEMA; generator_version: string;
  rows: ParentSourceRow[]; materials: NativeParentBatch['materials'] }
export interface ParentChunkDescriptor { index: number; sha256: string; bytes: number; progress: ArchitectureBatchProgress;
  nativeBatch: number; counts: NativeParentCounts }
export interface StoredParentChunk extends ParentChunkDescriptor { json: string }
export interface ParentSceneManifest { format: typeof PARENT_SCENE_FORMAT; sceneId: string; sourceFingerprint: string;
  schema_version: typeof NATIVE_PARENT_SCHEMA; generator_version: string; totalRequests: number; counts: NativeParentCounts;
  generation?: NativeParentSessionEvidence; boundaries: ParentBatchBoundary[]; chunks: ParentChunkDescriptor[]; fingerprint: string }
export interface ParentSourceIndex { id: string; parcelId: string; chunkIndex: number; rowIndex: number; bounds: ParentBounds; tiles: string[] }
export interface ParentMemberIndex extends ParentSourceIndex { parentId: string; memberKey: string | null; memberOrdinal: number }
export interface ParentActiveReference { sceneId: string; format: string }
export interface ParentChunkBackend {
  begin(sceneId: string): Promise<void>;
  /** Source + all parent/member indexes, no partial mutation on failure. */
  append(sceneId: string, chunk: StoredParentChunk, parents: ParentSourceIndex[], members: ParentMemberIndex[], visual?: ParentVisualChunk): Promise<void>;
  commit(manifest: ParentSceneManifest, expectedActive: ParentActiveReference | null, options?: { signal?: AbortSignal }): Promise<void>;
  visualChunk?(sceneId: string, index: number): Promise<ParentVisualChunk | undefined>;
  putVisual?(sceneId: string, chunk: ParentVisualChunk): Promise<void>;
  parentTile?(sceneId: string, tile: string, limit: number): Promise<{ entries: ParentSourceIndex[]; truncated: boolean }>;
  activeReference(): Promise<ParentActiveReference | undefined>;
  manifest(sceneId: string): Promise<ParentSceneManifest | undefined>;
  chunk(sceneId: string, index: number): Promise<StoredParentChunk | undefined>;
  parent(sceneId: string, id: string): Promise<ParentSourceIndex | undefined>;
  member(sceneId: string, id: string): Promise<ParentMemberIndex | undefined>;
  tile(sceneId: string, tile: string, limit: number): Promise<{ entries: ParentMemberIndex[]; truncated: boolean }>;
  discard(sceneId: string): Promise<void>;
}
const assert = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const emptyCounts = (): NativeParentCounts => ({ requests: 0, admitted_parents: 0, single_parents: 0, assembly_parents: 0, physical_members: 0, refusals: 0, open_spaces: 0 });
function addCounts(target: NativeParentCounts, add: NativeParentCounts): void { for (const key of Object.keys(target) as (keyof NativeParentCounts)[]) target[key] += add[key]; }
function descriptor({ json: _json, ...d }: StoredParentChunk): ParentChunkDescriptor { return d; }
function manifestContent({ sceneId: _id, fingerprint: _fingerprint, ...m }: ParentSceneManifest) { return m; }
export function parentRowCounts(rows: readonly ParentSourceRow[]): NativeParentCounts {
  const c = emptyCounts(); c.requests = rows.length;
  for (const r of rows) {
    if (r.kind === 'open') c.open_spaces++; else if (r.kind === 'refusal') c.refusals++;
    else { c.admitted_parents++; c[r.parent.nativeKind === 'single' ? 'single_parents' : 'assembly_parents']++; c.physical_members += r.parent.members.length; }
  } return c;
}
function tiles(b: ParentBounds): string[] {
  const x0 = Math.floor(b[0] / 256), y0 = Math.floor(b[1] / 256), x1 = Math.floor(b[2] / 256), y1 = Math.floor(b[3] / 256);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return ['*'];
  const out: string[] = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`); return out;
}
function combined(surfaces: Surface[], points: { x: number; y: number }[] = []): ParentBounds {
  const boxes = surfaces.filter(s => s.length).map(surfaceBounds);
  const b: ParentBounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const a of boxes) { b[0] = Math.min(b[0], a[0]); b[1] = Math.min(b[1], a[1]); b[2] = Math.max(b[2], a[2]); b[3] = Math.max(b[3], a[3]); }
  for (const p of points) { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); }
  assert(b.every(Number.isFinite), 'Invalid parent/member index bounds.'); return b;
}
export function parentRecordSource(record: NativeParentRecord): ParentSourceRecord {
  const p = record.plan, identity = parentIdentity(p);
  return { id: identity.id, parcelId: identity.parcel_id, nativeKind: p.kind, archive: record.archive, attempt: record.attempt,
    members: p.kind === 'single' ? [{ id: p.building.id, key: null }] : p.assembly.members.map(m => ({ id: m.plan.id, key: m.key })) };
}
export function parentRecordIndexes(plan: NativeParentPlan, chunkIndex: number, rowIndex: number): { parent: ParentSourceIndex; members: ParentMemberIndex[] } {
  const identity = parentIdentity(plan);
  const members = (plan.kind === 'single' ? [{ key: null, plan: plan.building }] : plan.assembly.members).map((m, memberOrdinal) => {
    const p = m.plan, surfaces = [p.footprint, p.roof_footprint, p.courtyards, ...p.structural_features.map(f => f.surface),
      ...p.volumes.flatMap(v => [v.footprint, ...(v.foundation ? [v.foundation.footprint] : []), ...v.levels.map(l => l.footprint)])];
    const bounds = combined(surfaces, p.volumes.flatMap(v => v.roof_mesh?.vertices ?? []));
    return { id: p.id, parcelId: p.parcel_id, parentId: identity.id, memberKey: m.key, memberOrdinal, chunkIndex, rowIndex, bounds, tiles: tiles(bounds) };
  });
  const bounds = combined(nativeParentLeaves(plan).map(l => l.surface));
  for (const m of members) { bounds[0] = Math.min(bounds[0], m.bounds[0]); bounds[1] = Math.min(bounds[1], m.bounds[1]); bounds[2] = Math.max(bounds[2], m.bounds[2]); bounds[3] = Math.max(bounds[3], m.bounds[3]); }
  return { parent: { id: identity.id, parcelId: identity.parcel_id, chunkIndex, rowIndex, bounds, tiles: tiles(bounds) }, members };
}
export async function decodeParentChunk(chunk: StoredParentChunk): Promise<ParentChunkPayload> {
  assert(chunk.bytes <= PARENT_CHUNK_BYTES && new TextEncoder().encode(chunk.json).byteLength === chunk.bytes
    && await parentDigest(chunk.json) === chunk.sha256, 'Native parent chunk integrity mismatch.');
  const value = JSON.parse(chunk.json) as ParentChunkPayload;
  assert(value?.schema_version === NATIVE_PARENT_SCHEMA && typeof value.generator_version === 'string' && Array.isArray(value.rows)
    && value.rows.length <= 64 && Array.isArray(value.materials), 'Invalid parent source chunk.');
  for (const r of value.rows) assert(r && (r.kind === 'parent' && r.parent?.archive?.format === 'native-parent-archive-1'
    && /^[a-f0-9]{64}$/.test(r.parent.archive.sha256) && Array.isArray(r.parent.members)
    || r.kind === 'refusal' && r.refusal?.id || r.kind === 'open' && r.open?.id), 'Invalid parent source row.');
  assert(JSON.stringify(parentRowCounts(value.rows)) === JSON.stringify(chunk.counts), 'Parent chunk accounting mismatch.'); return value;
}
export async function validateParentManifest(m: ParentSceneManifest): Promise<void> {
  assert(m?.format === PARENT_SCENE_FORMAT && /^[a-f0-9]{64}$/.test(m.sourceFingerprint) && m.schema_version === NATIVE_PARENT_SCHEMA
    && Number.isSafeInteger(m.totalRequests) && m.totalRequests >= 0 && Array.isArray(m.chunks) && m.chunks.length > 0
    && Array.isArray(m.boundaries) && m.boundaries.length > 0, 'Invalid native parent manifest.');
  let n = 0; const c = emptyCounts(), ranges = new Map<number, { start: number; end: number }>();
  const validCounts = (v: NativeParentCounts) => Object.values(v).every(n => Number.isSafeInteger(n) && n >= 0)
    && v.admitted_parents === v.single_parents + v.assembly_parents
    && v.physical_members === v.single_parents + 2 * v.assembly_parents
    && v.requests === v.admitted_parents + v.refusals + v.open_spaces;
  assert(validCounts(m.counts), 'Invalid native parent manifest counts.');
  for (const [i, d] of m.chunks.entries()) {
    assert(d.index === i && d.progress.start === n && d.progress.total === m.totalRequests && d.progress.completed - n === d.counts.requests
      && d.progress.completed <= m.totalRequests && d.bytes > 0 && d.bytes <= PARENT_CHUNK_BYTES
      && validCounts(d.counts) && /^[a-f0-9]{64}$/.test(d.sha256) && Number.isSafeInteger(d.nativeBatch) && d.nativeBatch >= 0 && !!m.boundaries[d.nativeBatch], 'Invalid native parent chunk sequence.');
    const boundary = m.boundaries[d.nativeBatch];
    assert(d.progress.start >= boundary.start && d.progress.completed <= boundary.completed, 'Fragment lies outside its original native batch.');
    const range = ranges.get(d.nativeBatch);
    assert(!range || range.end === d.progress.start, 'Non-contiguous native batch fragments.');
    ranges.set(d.nativeBatch, { start: range?.start ?? d.progress.start, end: d.progress.completed });
    n = d.progress.completed; addCounts(c, d.counts);
  }
  for (const [index, boundary] of m.boundaries.entries()) {
    const range = ranges.get(index);
    assert(range && range.start === boundary.start && range.end === boundary.completed, 'Missing original native batch fragments.');
  }
  let boundaryEnd = 0;
  for (const boundary of m.boundaries) {
    assert(boundary.start === boundaryEnd && boundary.completed >= boundary.start && boundary.completed - boundary.start <= 64
      && boundary.inputBytes <= PARENT_LIMITS.bytes && boundary.floatSlots <= PARENT_LIMITS.floatSlots
      && boundary.rewrittenBytes <= PARENT_LIMITS.rewrittenBytes && /^[a-f0-9]{64}$/.test(boundary.inputSha256), 'Invalid native batch boundary.');
    boundaryEnd = boundary.completed;
  }
  if (m.generation) {
    const g = m.generation, begin = g.begin;
    assert(g.status === 'completed-and-released' && begin?.schema_version === 'native-parent-session-1'
      && begin.source?.fingerprint === m.sourceFingerprint && begin.source.coordinate_space === 'world-metres'
      && begin.total_requests === m.totalRequests && g.empty_administrative_scene === (m.totalRequests === 0), 'Native generation evidence/source mismatch.');
    if (m.totalRequests) {
      assert(g.final_prefix?.parents === m.counts.admitted_parents && g.final_prefix.members === m.counts.physical_members, 'Native final prefix/manifest count mismatch.');
      for (const b of m.boundaries) { const r = b.sessionReceipt; assert(r && r.session_id === begin.session_id
        && r.source_fingerprint === m.sourceFingerprint && r.revision === begin.source.revision && r.offset === b.start
        && r.completed === b.completed && r.total === m.totalRequests && /^[a-f0-9]{64}$/.test(r.request_sha256)
        && /^[a-f0-9]{64}$/.test(r.batch_sha256), 'Native boundary receipt identity mismatch.'); }
    } else assert(m.boundaries.length === 1 && m.boundaries[0].emptySessionId === begin.session_id
      && !m.boundaries[0].sessionReceipt && g.final_prefix === null, 'Invalid administrative empty generation evidence.');
  }
  assert(n === m.totalRequests && boundaryEnd === n && JSON.stringify(c) === JSON.stringify(m.counts)
    && await parentDigest(JSON.stringify(manifestContent(m))) === m.fingerprint, 'Native parent manifest integrity mismatch.');
}
export async function beginUrbanParentStage(backend: ParentChunkBackend, options: { sceneId?: string; sourceFingerprint: string;
  totalRequests: number; expectedActive?: ParentActiveReference | null; signal?: AbortSignal }) {
  assert(/^[a-f0-9]{64}$/.test(options.sourceFingerprint) && Number.isSafeInteger(options.totalRequests) && options.totalRequests >= 0, 'Invalid parent scene source.');
  const sceneId = options.sceneId ?? crypto.randomUUID(), expectedActive = options.expectedActive === undefined ? await backend.activeReference() ?? null : options.expectedActive;
  await backend.begin(sceneId);
  const chunks: ParentChunkDescriptor[] = [], boundaries: ParentBatchBoundary[] = [], counts = emptyCounts();
  let completed = 0, generator = '', state: 'staging' | 'failed' | 'committed' | 'aborted' = 'staging';
  const check = () => { options.signal?.throwIfAborted(); assert(state === 'staging', 'Parent stage is no longer writable.'); };
  const write = async (payload: ParentChunkPayload, nativeBatch: number, plans: Map<string, NativeParentPlan>) => {
    const json = parentWire(payload).json, bytes = new TextEncoder().encode(json).byteLength;
    assert(bytes <= PARENT_CHUNK_BYTES, 'Whole native parent exceeds cold source read budget; no partial parent stored.');
    const c = parentRowCounts(payload.rows), index = chunks.length;
    const chunk: StoredParentChunk = { index, sha256: await parentDigest(json), bytes, json, nativeBatch, counts: c,
      progress: { start: completed, completed: completed + c.requests, total: options.totalRequests } };
    const parents: ParentSourceIndex[] = [], members: ParentMemberIndex[] = [];
    for (const [rowIndex, r] of payload.rows.entries()) if (r.kind === 'parent') {
      const plan = plans.get(r.parent.id); assert(plan, 'Parent source has no true native view.');
      const projected = parentRecordIndexes(plan!, index, rowIndex); parents.push(projected.parent); members.push(...projected.members);
    }
    const records: NativeParentRecord[] = payload.rows.flatMap(r => r.kind === 'parent'
      ? [{ plan: plans.get(r.parent.id)!, archive: r.parent.archive, attempt: r.parent.attempt }] : []);
    const visual = await encodeParentVisual(index, chunk.sha256, projectParentRecords(records, payload.materials));
    check(); await backend.append(sceneId, chunk, parents, members, visual); check();
    chunks.push(descriptor(chunk)); completed += c.requests; addCounts(counts, c);
  };
  return {
    get state() { return state; },
    async append(batch: NativeParentBatch, progress: ArchitectureBatchProgress, boundary: ParentBatchBoundary, requests: readonly { id: string; parcel_id: string }[]) {
      try {
        check(); validateParentBatch(batch, requests);
        assert(progress.start === completed && progress.completed === completed + batch.counts.requests && progress.total === options.totalRequests
          && boundary.start === progress.start && boundary.completed === progress.completed, 'Native parent stage progress mismatch.');
        assert(!generator || generator === batch.generator_version, 'Native parent generator changed.'); generator = batch.generator_version;
        const parentMap = new Map(batch.parents.map(r => [parentIdentity(r.plan).id, r])), refusalMap = new Map(batch.refusals.map(r => [r.id, r])), openMap = new Map(batch.open_spaces.map(r => [r.id, r]));
        const plans = new Map(batch.parents.map(r => [parentIdentity(r.plan).id, r.plan]));
        let payload: ParentChunkPayload = { schema_version: NATIVE_PARENT_SCHEMA, generator_version: generator, rows: [], materials: batch.materials };
        for (const request of requests) {
          const p = parentMap.get(request.id), refusal = refusalMap.get(request.id), open = openMap.get(request.id);
          const row: ParentSourceRow = p ? { kind: 'parent', parent: parentRecordSource(p) } : refusal ? { kind: 'refusal', refusal } : { kind: 'open', open: open! };
          const candidate = { ...payload, rows: [...payload.rows, row] };
          if (payload.rows.length && new TextEncoder().encode(parentWire(candidate).json).byteLength > PARENT_CHUNK_BYTES) {
            await write(payload, boundaries.length, plans); payload = { ...payload, rows: [], materials: batch.materials }; // tiny native catalogue repeated for independent bounded cold repair.
          }
          payload.rows.push(row);
        }
        if (payload.rows.length || batch.counts.requests === 0) await write(payload, boundaries.length, plans);
        boundaries.push(boundary); // native identity never changed by storage fragmentation.
      } catch (error) { state = 'failed'; throw error; }
    },
    async commit(summary: NativeParentStreamSummary): Promise<ParentSceneManifest> {
      try {
        check(); assert(completed === options.totalRequests && JSON.stringify(summary.counts) === JSON.stringify(counts)
          && summary.generator_version === generator && JSON.stringify(summary.boundaries) === JSON.stringify(boundaries), 'Incomplete native parent stage.');
        const m: ParentSceneManifest = { format: PARENT_SCENE_FORMAT, sceneId, sourceFingerprint: options.sourceFingerprint,
          schema_version: NATIVE_PARENT_SCHEMA, generator_version: generator, totalRequests: completed, counts, boundaries, chunks,
          ...(summary.session ? { generation: summary.session } : {}), fingerprint: '' };
        m.fingerprint = await parentDigest(JSON.stringify(manifestContent(m))); await validateParentManifest(m); check();
        await backend.commit(m, expectedActive, { signal: options.signal }); state = 'committed'; return m;
      } catch (error) { state = 'failed'; throw error; }
    },
    async abort() { if (state !== 'committed' && state !== 'aborted') { await backend.discard(sceneId); state = 'aborted'; } },
  };
}
/** Import/cache rebuild must use native archive validation in a bounded bulk,
 * never an untrusted decimal adjacent view. At most one source chunk resident. */
export async function unpackParentChunk(chunk: StoredParentChunk, api: NativeParentApi) {
  await api.require(); const payload = await decodeParentChunk(chunk);
  const rows = payload.rows.filter((r): r is Extract<ParentSourceRow, { kind: 'parent' }> => r.kind === 'parent');
  const result = await api.unpackBatch(rows.map(r => r.parent.archive));
  assert(result.schema_version === NATIVE_PARENT_SCHEMA && result.plans.length === rows.length, 'Incomplete native bulk unpack.');
  validateParentCounts(result.counts, result.plans);
  for (let i = 0; i < rows.length; i++) {
    const p = result.plans[i], stored = rows[i].parent, identity = parentIdentity(p);
    const actual = parentRecordSource({ plan: p, archive: stored.archive, attempt: stored.attempt });
    assert(identity.id === stored.id && identity.parcel_id === stored.parcelId && JSON.stringify(actual) === JSON.stringify(stored), 'Native archive/source index identity mismatch.');
  }
  return { payload, plans: result.plans };
}
