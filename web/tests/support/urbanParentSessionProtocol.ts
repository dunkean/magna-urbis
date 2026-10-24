import { expect, it, vi } from 'vitest';
import { runUrbanParentSessionSource } from '../../src/ui/urbanParentSessionPipeline';
import { parentDigest } from '../../../rust/bridge/nativeParentStream';
import { parentWire } from '../../../rust/bridge/nativeParentBudget';
import { NATIVE_PARENT_SESSION_SCHEMA, NATIVE_PARENT_SESSION_PARTITION, sameParentSessionReceipt, type NativeParentSessionApi, type ParentSessionReceipt, type ParentSessionLimits, type BeginParentSessionRequest, type PlanParentSessionRequest, type ParentSessionSource, type BeginParentSessionReply, type PlanParentSessionReply, type AckParentSessionReply, type CloseParentSessionRequest, type CloseParentSessionReply } from '../../../rust/bridge/nativeParentSessionContract';
import legacy from '../fixtures/urban-building-chunks-c.json';
import group from '../fixtures/native-assembly-positive-consumer.json';
import type { NativeParentApi, NativeParentBatch, NativeParentPlan, NativeParentRecord, NativeParentRequest, NativeParentArchive, UnpackedParentBatch } from '../../../rust/bridge/nativeParentContract';
import { NATIVE_PARENT_SCHEMA, parentCounts, parentIdentity } from '../../../rust/bridge/nativeParentContract';
import type { PlacementRequest, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { RetainedNativeAssembly } from '../../../rust/bridge/nativeAssemblyContract';
import type { Surface } from '../../../rust/bridge/housesContract';
import { streamNativeParents } from '../../../rust/bridge/nativeParentStream';
import { nativeParentSurfaces } from '../../../rust/bridge/nativeParentOccupation';
import { runUrbanParentSource } from '../../src/ui/urbanParentPipeline';
import { exportUrbanParentChunks, importUrbanParentChunks } from '../../src/ui/urbanParentChunkTransport';
import { PARENT_SCENE_FORMAT, type ParentChunkBackend, type ParentSourceIndex, type ParentMemberIndex,
  type ParentSceneManifest, type StoredParentChunk, type ParentActiveReference } from '../../src/ui/urbanParentChunkStore';
// Geometry from native fixtures; NEW parent archives are SYNTHETIC protocol
// sentinels. This suite is NOT native parent batch admission evidence.
function plans(): NativeParentPlan[] {
  const building: PlacedBuilding = JSON.parse(JSON.stringify(legacy.chunks[0].delta.buildings[0]));
  const assembly: RetainedNativeAssembly = JSON.parse(JSON.stringify(group.assembly));
  return [{ kind: 'single', programme: null, building }, { kind: 'assembly', assembly }];
}
const rect = (x = 0): Surface => [{ outer: [{ x, y: 0 }, { x: x + 2, y: 0 }, { x: x + 2, y: 2 }, { x, y: 2 }], holes: [] }];
function site(id: string, parcel_id = `p-${id}`): PlacementRequest {
  return { id, parcel_id, cadastral: rect(), buildable: rect(), reserves: [], accesses: [], party_boundaries: [], neighbors: [],
    culture: { culture: 'roman-core', pack: 'roman', mode: 'historical_inspired', borrowing: null }, function: 'domestic', seed: id,
    terrain: { origin: { x: 0, y: 0 }, ground_z_m: 0, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 } };
}
const source = (rows: PlacementRequest[], page = 64) => ({ total: rows.length,
  read: vi.fn(async (offset: number, limit: number, _maxBytes: number) => rows.slice(offset, offset + Math.min(limit, page))) });
function record(plan: NativeParentPlan, ordinal: number): NativeParentRecord {
  return { plan, archive: { format: 'native-parent-archive-1', sha256: String(ordinal + 1).repeat(64),
    payload: { synthetic_protocol_only: true, index: ordinal } }, attempt: null };
}
function batch(records: NativeParentRecord[], requests: readonly PlacementRequest[]): NativeParentBatch {
  const admitted = new Set(records.map(r => parentIdentity(r.plan).id)), remaining = requests.filter(r => !admitted.has(r.id));
  const refusals = remaining.filter(r => r.id === 'refused').map(r => ({ id: r.id, parcel_id: r.parcel_id, code: 'protocol_refusal', message: 'Transport-only fixture', attempts: 1 }));
  const refused = new Set(refusals.map(r => r.id)), open_spaces = remaining.filter(r => !refused.has(r.id)).map(r => ({ id: r.id, parcel_id: r.parcel_id, surface: r.cadastral }));
  return { schema_version: NATIVE_PARENT_SCHEMA, generator_version: 'protocol-fixture-parent-1', parents: records, refusals, open_spaces, materials: [],
    counts: { requests: requests.length, ...parentCounts(records.map(r => r.plan)), refusals: refusals.length, open_spaces: open_spaces.length } };
}
class MemoryParents implements ParentChunkBackend {
  stages = new Map<string, { chunks: StoredParentChunk[]; parents: Map<string, ParentSourceIndex>; members: Map<string, ParentMemberIndex>; manifest?: ParentSceneManifest }>();
  active: ParentActiveReference | undefined = { sceneId: 'previous-city', format: 'urban-building-chunks-1' };
  pause?: Promise<void>; failAt?: number; appends = 0;
  async begin(id: string) { if (this.stages.has(id)) throw new Error('duplicate stage'); this.stages.set(id, { chunks: [], parents: new Map(), members: new Map() }); }
  async append(id: string, chunk: StoredParentChunk, parents: ParentSourceIndex[], members: ParentMemberIndex[]) {
    await this.pause; this.appends++; if (chunk.index === this.failAt) throw new Error('QuotaExceededError');
    const s = this.stages.get(id)!; if (s.manifest || s.chunks.length !== chunk.index) throw new Error('invalid sequence');
    const p = new Set<string>(), m = new Set<string>();
    for (const row of parents) { if (p.has(row.id) || s.parents.has(row.id)) throw new Error('duplicate parent'); p.add(row.id); }
    for (const row of members) { if (m.has(row.id) || s.members.has(row.id)) throw new Error('duplicate member'); m.add(row.id); }
    // All checks before writes: memory contract, not browser IDB proof.
    s.chunks.push(structuredClone(chunk)); parents.forEach(p => s.parents.set(p.id, structuredClone(p))); members.forEach(m => s.members.set(m.id, structuredClone(m)));
  }
  async commit(manifest: ParentSceneManifest, expected: ParentActiveReference | null, options?: { signal?: AbortSignal }) {
    options?.signal?.throwIfAborted(); if (JSON.stringify(this.active ?? null) !== JSON.stringify(expected)) throw new Error('active changed');
    const s = this.stages.get(manifest.sceneId)!; if (s.manifest || s.chunks.length !== manifest.chunks.length) throw new Error('incomplete');
    s.manifest = structuredClone(manifest); this.active = { sceneId: manifest.sceneId, format: PARENT_SCENE_FORMAT };
  }
  async activeReference() { return this.active && structuredClone(this.active); }
  async manifest(id: string) { return this.stages.get(id)?.manifest; }
  async chunk(id: string, index: number) { return this.stages.get(id)?.chunks[index]; }
  async parent(id: string, parentId: string) { return this.stages.get(id)?.parents.get(parentId); }
  async member(id: string, memberId: string) { return this.stages.get(id)?.members.get(memberId); }
  async tile(id: string, tile: string, limit: number) { const rows = [...this.stages.get(id)!.members.values()].filter(m => m.tiles.includes(tile)); return { entries: rows.slice(0, limit), truncated: rows.length >= limit }; }
  async discard(id: string) { if (this.stages.get(id)?.manifest) throw new Error('committed'); this.stages.delete(id); }
}
function apiWith(records: NativeParentRecord[]): NativeParentApi {
  return { require: vi.fn(async () => {}), plan: vi.fn(async (request: NativeParentRequest) => batch(records.filter(r => request.batch.requests.some(q => q.id === parentIdentity(r.plan).id)), request.batch.requests)),
    unpack: vi.fn(async (archive: NativeParentArchive) => { const r = records.find(r => r.archive.sha256 === archive.sha256); if (!r) throw new Error('unknown archive'); return r.plan; }),
    unpackBatch: vi.fn(async (archives: NativeParentArchive[]): Promise<UnpackedParentBatch> => { const plans = archives.map(a => { const r = records.find(r => r.archive.sha256 === a.sha256); if (!r || JSON.stringify(a) !== JSON.stringify(r.archive)) throw new Error('unknown archive'); return r.plan; });
      return { schema_version: NATIVE_PARENT_SCHEMA, plans, counts: parentCounts(plans) }; }),
    realize: vi.fn(async () => { throw new Error('No native realization in protocol tests'); }) };
}
const mixed = () => { const records = plans().map(record); return { records, sites: [...records.map(r => { const p = parentIdentity(r.plan); return site(p.id, p.parcel_id); }), site('refused'), site('open')] }; };

// Session transport MOCK: opaque hashes/limits and zero query counters are
// protocol sentinels, never a claim of native geometry/index execution.
const identity: ParentSessionSource = { fingerprint: 'a'.repeat(64), revision: 'b'.repeat(64), coordinate_space: 'world-metres' };
const limits: ParentSessionLimits = { max_parents_per_batch: 64, max_input_bytes: 24 * 1024 * 1024, max_raw_bytes: 32 * 1024 * 1024,
  max_std_rewritten_bytes: 64 * 1024 * 1024, max_std_float_slots: 262144, max_output_bytes: 64 * 1024 * 1024,
  max_hit_parts: 4096, max_hit_vertices: 262144, max_runs: 4, max_total_requests: 1000000, max_retained_vertices: 1000000,
  max_index_references: 1000000, max_retained_index_bytes: 512 * 1024 * 1024, max_identity_bytes: 128 * 1024 * 1024,
  ack_history_entries: 256, idle_timeout_ms: 900000 };
function sessionApi(records: NativeParentRecord[], events: string[] = []): NativeParentSessionApi {
  let total = 0, offset = 0, parents = 0, members = 0, pending: { receipt: ParentSessionReceipt; batch: NativeParentBatch } | undefined;
  return {
    require: vi.fn(async () => { events.push('qualified'); }),
    begin: vi.fn(async (input: BeginParentSessionRequest): Promise<BeginParentSessionReply> => { events.push('begin'); total = input.total_requests;
      return { schema_version: NATIVE_PARENT_SESSION_SCHEMA, session_id: 'engine-incarnation:run-nonce', source: { ...input.source },
        generator_version: 'native-parent-session-protocol-mock', batch_schema_version: NATIVE_PARENT_SCHEMA,
        partition: NATIVE_PARENT_SESSION_PARTITION, offset: 0, total_requests: total, state: total ? 'ready' : 'complete', limits };
    }),
    plan: vi.fn(async (input: PlanParentSessionRequest): Promise<PlanParentSessionReply> => {
      events.push(`plan:${input.expected_offset}`); if (pending || input.expected_offset !== offset) throw new Error('pending/unacked');
      const output = batch(records.filter(r => input.requests.some(q => q.id === parentIdentity(r.plan).id)), input.requests), batch_json = parentWire(output).json;
      const receipt: ParentSessionReceipt = { session_id: input.session_id, source_fingerprint: input.source_fingerprint, revision: input.revision,
        key: input.key, offset, completed: offset + input.requests.length, total, request_sha256: 'c'.repeat(64), batch_sha256: await parentDigest(batch_json) };
      pending = { receipt, batch: output };
      return { receipt, batch_json, context_report: { queries: 0, land_queries: 0, roof_queries: 0, leaf_hits: 0, union_calls: 0, max_query_parts: 0, max_query_vertices: 0 } };
    }),
    ack: vi.fn(async (receipt: ParentSessionReceipt): Promise<AckParentSessionReply> => {
      events.push(`native-ack:${receipt.completed}`); if (!pending || !sameParentSessionReceipt(pending.receipt, receipt)) throw new Error('bad receipt');
      offset = receipt.completed; parents += pending.batch.counts.admitted_parents; members += pending.batch.counts.physical_members; pending = undefined;
      return { session_id: receipt.session_id, source_fingerprint: receipt.source_fingerprint, revision: receipt.revision, completed: offset, total,
        state: offset === total ? 'complete' : 'ready', prefix: { parents, members, leaves: 0, vertices: 0, index_references: 0, retained_index_bytes: 0 } };
    }),
    abort: vi.fn(async (input: CloseParentSessionRequest): Promise<CloseParentSessionReply> => { events.push('native-abort'); return { session_id: input.session_id, state: 'released' }; }),
    release: vi.fn(async (input: CloseParentSessionRequest): Promise<CloseParentSessionReply> => { events.push('native-release'); return { session_id: input.session_id, state: 'released' }; }),
  };
}

export { MemoryParents, sessionApi, mixed, site, source, identity, limits };
