import { expect, it, vi } from 'vitest';
import legacy from './fixtures/urban-building-chunks-c.json';
import group from './fixtures/native-assembly-positive-consumer.json';
import type { NativeParentApi, NativeParentBatch, NativeParentPlan, NativeParentRecord, NativeParentRequest, NativeParentArchive, UnpackedParentBatch } from '../../rust/bridge/nativeParentContract';
import { NATIVE_PARENT_SCHEMA, parentCounts, parentIdentity } from '../../rust/bridge/nativeParentContract';
import type { PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { RetainedNativeAssembly } from '../../rust/bridge/nativeAssemblyContract';
import type { Surface } from '../../rust/bridge/housesContract';
import { streamNativeParents } from '../../rust/bridge/nativeParentStream';
import { nativeParentSurfaces } from '../../rust/bridge/nativeParentOccupation';
import { runUrbanParentSource } from '../src/ui/urbanParentPipeline';
import { exportUrbanParentChunks, importUrbanParentChunks } from '../src/ui/urbanParentChunkTransport';
import { PARENT_SCENE_FORMAT, type ParentChunkBackend, type ParentSourceIndex, type ParentMemberIndex,
  type ParentSceneManifest, type StoredParentChunk, type ParentActiveReference } from '../src/ui/urbanParentChunkStore';
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
it('stream -> source/member indexes -> ACK -> active commits parents2/members3/completed4', async () => {
  const { records, sites } = mixed(), backend = new MemoryParents(), api = apiWith(records), ack = vi.fn();
  const result = await runUrbanParentSource({ schema_version: '1' }, source(sites, 1), api, backend,
    { sceneId: 'new', sourceFingerprint: 'a'.repeat(64), onDurableBatch: async (_b, p) => {
      const stage = backend.stages.get('new')!; expect(stage.parents.size).toBe(2); expect(stage.members.size).toBe(3);
      expect(stage.manifest).toBeUndefined(); expect(backend.active?.sceneId).toBe('previous-city'); expect(p.completed).toBe(4); ack();
    } });
  expect(ack).toHaveBeenCalledOnce(); expect(result.manifest.counts).toEqual({ requests: 4, admitted_parents: 2, single_parents: 1, assembly_parents: 1, physical_members: 3, refusals: 1, open_spaces: 1 });
  const saved = backend.stages.get('new')!; expect(saved.chunks).toHaveLength(1); const data = JSON.parse(saved.chunks[0].json);
  for (const row of data.rows.filter((r: { kind: string }) => r.kind === 'parent')) {
    expect(Object.keys(row.parent)).toEqual(['id', 'parcelId', 'nativeKind', 'archive', 'attempt', 'members']);
    for (const bad of ['plan', 'building', 'programme', 'resolved', 'useful_area_m2', 'domestic_units']) expect(row.parent).not.toHaveProperty(bad);
  }
  expect(backend.active).toEqual({ sceneId: 'new', format: PARENT_SCENE_FORMAT });
});
it('page2 waits durable append/ACK; cancellation keeps previous active', async () => {
  const rows = Array.from({ length: 65 }, (_, i) => site(`o-${i}`)), api = apiWith([]), backend = new MemoryParents();
  let release!: () => void; backend.pause = new Promise<void>(r => { release = r; }); const signal = new AbortController(), ack = vi.fn();
  const work = runUrbanParentSource({ schema_version: '1' }, source(rows), api, backend, { sceneId: 'blocked', sourceFingerprint: 'a'.repeat(64), signal: signal.signal, onDurableBatch: ack });
  await vi.waitFor(() => expect(api.plan).toHaveBeenCalledTimes(1));
  expect(backend.stages.get('blocked')!.chunks).toHaveLength(0); expect(ack).not.toHaveBeenCalled();
  signal.abort(new DOMException('replaced', 'AbortError')); release(); await expect(work).rejects.toThrow();
  expect(api.plan).toHaveBeenCalledTimes(1); expect(ack).not.toHaveBeenCalled(); expect(backend.active?.sceneId).toBe('previous-city'); expect(backend.stages.has('blocked')).toBe(false);
});
it('last storage fragment failure never ACKs native batch and discards only stage', async () => {
  const { records, sites } = mixed(); for (const r of records) r.archive.payload = { synthetic_protocol_padding: 'x'.repeat(4300000) };
  const api = apiWith(records), backend = new MemoryParents(), ack = vi.fn(); backend.failAt = 1;
  await expect(runUrbanParentSource({ schema_version: '1' }, source(sites), api, backend,
    { sceneId: 'quota', sourceFingerprint: 'a'.repeat(64), onDurableBatch: ack })).rejects.toThrow('QuotaExceeded');
  expect(backend.appends).toBe(2); expect(ack).not.toHaveBeenCalled(); expect(api.plan).toHaveBeenCalledOnce();
  expect(backend.active?.sceneId).toBe('previous-city'); expect(backend.stages.has('quota')).toBe(false);
});
it('canonical part-budget prefix is identical for source pages1/17/64', async () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ ...site(`r-${i}`), neighbors: Array.from({ length: 100 }, (_, j) => ({ id: `n-${j}`, footprint: rect(), height_m: 2 })) }));
  const results = [];
  for (const page of [1, 17, 64]) results.push(await streamNativeParents({ schema_version: '1' }, source(rows, page), apiWith([]), { onBatch: async () => {} }));
  expect(results[0].boundaries.map(b => b.completed)).toEqual([39, 78, 80]); expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
});
it('prior group roofs and true shared context reach the next page separately, regardless of camera', async () => {
  const { records } = mixed(), groupRecord = records[1], p = groupRecord.plan; if (p.kind !== 'assembly') throw new Error('fixture');
  const a = p.assembly, previous = nativeParentSurfaces(p), first = site(a.id, a.parcel_id), next = site('later');
  const points = a.members.flatMap(m => m.plan.roof_footprint.flatMap(s => s.outer));
  const minX = Math.min(...points.map(p => p.x)) - 1, maxX = Math.max(...points.map(p => p.x)) + 1, minY = Math.min(...points.map(p => p.y)) - 1, maxY = Math.max(...points.map(p => p.y)) + 1;
  next.cadastral = [{ outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }], holes: [] }]; next.buildable = next.cadastral;
  const rows = [first, ...Array.from({ length: 63 }, (_, i) => site(`empty-${i}`)), next], api = apiWith([groupRecord]);
  let second: Parameters<NativeParentApi['plan']>[0] | undefined; const original = api.plan;
  api.plan = vi.fn(async (input: NativeParentRequest) => { if (input.batch.requests.some(r => r.id === 'later')) second = input; return original(input); });
  await streamNativeParents({ schema_version: '1' }, source(rows), api, { onBatch: async () => {} });
  expect(second).toBeDefined(); expect(second!.prior_occupation.roof_parts).toEqual(previous.roof_parts.filter(s => s.length));
  for (const s of previous.land_parts.filter(s => s.length)) expect(second!.prior_occupation.land_parts).toContainEqual(s);
  expect(second!.batch.requests[0].neighbors).toEqual(next.neighbors);
});
it('exact export -> native bulk archive unpack -> index import never regenerates', async () => {
  const { records, sites } = mixed(), api = apiWith(records), backend = new MemoryParents();
  await runUrbanParentSource({ schema_version: '1' }, source(sites), api, backend, { sceneId: 'source', sourceFingerprint: 'a'.repeat(64) });
  const before = backend.stages.get('source')!.chunks.map(c => c.json), calls = vi.mocked(api.plan).mock.calls.length;
  const imported = await importUrbanParentChunks(backend, exportUrbanParentChunks(backend, 'source'), api, { sceneId: 'imported' });
  expect(imported.sceneId).toBe('imported'); expect(imported.fingerprint).toBe((await backend.manifest('source'))!.fingerprint);
  expect(backend.stages.get('imported')!.chunks.map(c => c.json)).toEqual(before); expect(api.unpackBatch).toHaveBeenCalledOnce();
  expect(api.plan).toHaveBeenCalledTimes(calls); expect(api.realize).not.toHaveBeenCalled(); expect(backend.stages.get('imported')!.members.size).toBe(3);
});
it('output budget failure never retries a different native prefix', async () => {
  const api = apiWith([]); api.plan = vi.fn(async () => { throw new Error('[output_budget] refused whole batch'); }); const backend = new MemoryParents();
  await expect(runUrbanParentSource({ schema_version: '1' }, source([site('x')]), api, backend,
    { sceneId: 'failed', sourceFingerprint: 'a'.repeat(64) })).rejects.toThrow('output_budget');
  expect(api.plan).toHaveBeenCalledOnce(); expect(backend.active?.sceneId).toBe('previous-city');
});
it('old runtime fails before source/stage and overlong source page never calls native', async () => {
  const api = apiWith([]); api.require = vi.fn(async () => { throw new Error('houses.native-parent-batch-1 required'); }); const src = source([site('x')]), backend = new MemoryParents();
  await expect(runUrbanParentSource({ schema_version: '1' }, src, api, backend, { sourceFingerprint: 'a'.repeat(64) })).rejects.toThrow('required');
  expect(src.read).not.toHaveBeenCalled(); expect(api.plan).not.toHaveBeenCalled(); expect(backend.stages.size).toBe(0);
  const fresh = apiWith([]); await expect(streamNativeParents({ schema_version: '1' }, { total: 1, read: async () => [site('1'), site('2')] }, fresh, { onBatch: async () => {} })).rejects.toThrow('source page'); expect(fresh.plan).not.toHaveBeenCalled();
});

it('small fetched pages cannot accumulate64 full-budget requests before the first ACK', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ ...site(`large-${i}`), seed: 'x'.repeat(13 * 1024 * 1024) }));
  const src = source(rows, 1), api = apiWith([]); let ackCount = 0;
  const result = await streamNativeParents({ schema_version: '1' }, src, api, { onBatch: async (_batch, progress) => {
    if (ackCount === 0) {
      expect(progress.completed).toBe(1); expect(src.read.mock.calls.every(([offset]) => offset < 2)).toBe(true);
      expect(src.read.mock.calls[1][2]).toBeLessThan(src.read.mock.calls[0][2]);
    } ackCount++;
  } });
  expect(result.boundaries.map(b => b.completed)).toEqual([1, 2, 3]); expect(api.plan).toHaveBeenCalledTimes(3);
}, 60000);
