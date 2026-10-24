import { afterEach, expect, it, vi } from 'vitest';
import { requireNativeAssemblyCapability } from '../../rust/bridge/architecture';
import raw from './fixtures/native-assembly-positive-consumer.json';
import type { NativeAssemblyApi, NativeAssemblyArchive, RetainedNativeAssembly, RealizedNativeAssembly } from '../../rust/bridge/nativeAssemblyContract';
import { ASSEMBLY_ARTIFACT_VERSION, parseAssemblyArtifact, readNativeAssemblyArtifact, stageNativeAssembly,
  type NativeAssemblyArtifact, type NativeAssemblyArtifactBackend, type StoredNativeAssemblyArtifact } from '../src/ui/nativeAssemblyStore';
import { nativeAssemblyWindow } from '../src/ui/nativeAssemblyProjection';
import { assemblyParentRows } from '../src/ui/nativeAssemblyBench';
import { publishSelectedAssemblyProposal } from '../src/ui/nativeAssemblyExperiment';
// Real native output on a SYNTHETIC site; physical tests ran separately in root.
// This suite replays those authoritative records, not a real HTTP/native run.
// input_sha256 is a protocol sentinel: the fixture has no selected-site preimage.
function fixture(): { archive: NativeAssemblyArchive; assembly: RetainedNativeAssembly; exterior: RealizedNativeAssembly } { return JSON.parse(JSON.stringify(raw)); }
class MemoryArtifactBackend implements NativeAssemblyArtifactBackend {
  value?: StoredNativeAssemblyArtifact; commits = 0; reads = 0;
  async read() { this.reads++; return this.value && structuredClone(this.value); }
  async commit(value: StoredNativeAssemblyArtifact, expected: string | null, signal?: AbortSignal) {
    signal?.throwIfAborted(); if ((this.value?.sha256 ?? null) !== expected) throw new Error('Artifact replaced');
    this.value = structuredClone(value); this.commits++;
  }
}
function setup() {
  const f = fixture(), backend = new MemoryArtifactBackend();
  const artifact: NativeAssemblyArtifact = { version: ASSEMBLY_ARTIFACT_VERSION, application: 'proposal_not_applied',
    parent_id: f.assembly.id, parcel_id: f.assembly.parcel_id, input_sha256: '1'.repeat(64), archive: f.archive };
  // Explicit metadata mock supports pair + correctly-rounded input reader.
  // The native consumer records below are replayed outputs, not an HTTP admission.
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({ service: 'magna-urbis-local',
      capabilities: ['houses.native-assembly-pair-1', 'houses.native-assembly-std-json-v1'] }));
    if (String(url).endsWith('/native-assembly-capability')) return new Response(JSON.stringify({ ok: true, data: 'native-assembly-pair-1' }));
    throw new Error('Unexpected native request in replay-only consumer test');
  }));
  const api: NativeAssemblyApi = { require: () => requireNativeAssemblyCapability({ profile: 'local', server: 'http://consumer-metadata-mock.test' }), assemble: vi.fn(async () => { throw new Error('No input fixture / no assembly generation'); }),
    unpack: vi.fn(async (archive: NativeAssemblyArchive) => { expect(archive).toEqual(f.archive); return f.assembly; }), realize: vi.fn(async (archive: NativeAssemblyArchive) => { expect(archive).toEqual(f.archive); return f.exterior; }) };
  return { f, backend, artifact, api };
}
it('stage -> durable archive -> cold native unpack -> member projections -> parent/member picks -> exact export keeps ONE parent', async () => {
  const { f, backend, artifact, api } = setup();
  const before = JSON.stringify(f), stage = await stageNativeAssembly(backend, artifact, api, { current: () => true });
  expect(backend.commits).toBe(0); await stage.commit(); expect(backend.commits).toBe(1);
  const cold = (await readNativeAssemblyArtifact(backend, api))!;
  expect(api.unpack).toHaveBeenCalledTimes(2); expect(cold.artifact.archive).toEqual(f.archive);
  const view = nativeAssemblyWindow(cold.native); expect(view.counts).toEqual({ parents: 1, members: 2, bodies: 2 });
  expect(view.scene.buildings).toHaveLength(2);
  for (const member of view.scene.buildings) {
    expect(member.nativeRealization).toBe(false); expect(member.parent_id).toBe(f.assembly.id);
    for (const field of ['resolved', 'volumes', 'programme', 'programme_outcome', 'useful_area_m2', 'domestic_units']) expect(member).not.toHaveProperty(field);
    const ring = member.roof_footprint[0].outer, point = { x: ring.reduce((n, p) => n + p.x, 0) / ring.length, y: ring.reduce((n, p) => n + p.y, 0) / ring.length };
    expect(view.pick(point)).toEqual({ kind: 'member', parent_id: f.assembly.id, member_key: member.member_key, member_id: member.member_id });
  }
  expect(view.pick({ x: view.bounds.maxX + 100, y: view.bounds.maxY + 100 })).toEqual({ kind: 'parent', parent_id: f.assembly.id });
  const restored = parseAssemblyArtifact(JSON.stringify(cold.artifact)); expect(restored).toEqual(artifact);
  expect(restored.archive.payload).toEqual(f.archive.payload); expect(JSON.stringify(f)).toBe(before);
  const realized = await api.realize(restored.archive);
  expect(realized.members.map(m => m.key)).toEqual(f.exterior.members.map(m => m.key));
  expect(realized.members.every(m => m.architecture.units.length === 1)).toBe(true);
  expect(api.assemble).not.toHaveBeenCalled();
});
it('shows only persisted parent model/need/composition and keeps residential capacity unknown', () => {
  const { f } = setup(), rows = assemblyParentRows(f.assembly);
  expect(rows.find(([k]) => k === 'Ménages demandés du modèle')?.[1]).toBe('3');
  expect(rows.find(([k]) => k === 'Composition demandée conservée')?.[1]).toBe('compound');
  expect(rows.find(([k]) => k === 'Modèle conservé')?.[1]).toContain('not-culture-calibrated');
  expect(rows.find(([k]) => k === 'Capacité résidentielle / utile réel')?.[1]).toContain('inconnus');
  expect(rows.filter(([k]) => k === 'Programme parent')).toHaveLength(1);
});
it('rejects stale stages and wrong parent/archive association without replacing saved authority', async () => {
  const { backend, artifact, api } = setup(); const first = await stageNativeAssembly(backend, artifact, api, { current: () => true }); await first.commit();
  const before = structuredClone(backend.value); let current = true;
  const staged = await stageNativeAssembly(backend, artifact, api, { current: () => current }); current = false;
  await expect(staged.commit()).rejects.toThrow('stale'); expect(backend.value).toEqual(before);
  await expect(stageNativeAssembly(backend, { ...artifact, parent_id: 'forged' }, api, { current: () => true })).rejects.toThrow('identity');
  expect(backend.value).toEqual(before);
});
it('does not accept legacy Single/unsupported proposal formats, malformed envelopes or an adjacent fake assembly view', () => {
  const { artifact } = setup();
  expect(() => parseAssemblyArtifact(JSON.stringify({ schema_version: '1', buildings: [] }))).toThrow('unsupported');
  expect(() => parseAssemblyArtifact(JSON.stringify({ ...artifact, version: 'native-assembly-proposal-999' }))).toThrow('unsupported');
  expect(() => parseAssemblyArtifact(JSON.stringify({ ...artifact, assembly: raw.assembly }))).toThrow('unsupported');
  expect(() => parseAssemblyArtifact(JSON.stringify({ ...artifact, archive: { ...artifact.archive, format: 'compact-plan-1' } }))).toThrow('archive');
});

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class DelayedCommitBackend extends MemoryArtifactBackend {
  entered = gate(); release = gate(); delayNext = true;
  override async commit(value: StoredNativeAssemblyArtifact, expected: string | null, signal?: AbortSignal) {
    if (this.delayNext) { this.delayNext = false; this.entered.resolve(); await this.release.promise; }
    // Same CAS contract as the real IndexedDB adapter; no stale cleanup.
    return super.commit(value, expected, signal);
  }
}
it('commit finishing after source replacement preserves exact historical archive but the ACTUAL producer tail never publishes proposed', async () => {
  const { artifact, api } = setup(), backend = new DelayedCommitBackend(); let current = true;
  const stage = await stageNativeAssembly(backend, artifact, api, { current: () => current }), state = vi.fn();
  const publication = publishSelectedAssemblyProposal(stage, { current: () => current, state });
  const rejected = expect(publication).rejects.toMatchObject({ name: 'AbortError' });
  await backend.entered.promise; current = false; backend.release.resolve(); await rejected;
  expect(state).not.toHaveBeenCalled(); expect(backend.commits).toBe(1);
  const history = (await readNativeAssemblyArtifact(backend, api))!;
  expect(history.artifact).toEqual(artifact); expect(history.artifact.application).toBe('proposal_not_applied');
  expect(history.artifact.archive.sha256).toBe(artifact.archive.sha256); expect(history.artifact.input_sha256).toBe(artifact.input_sha256);
});
it('a delayed obsolete commit cannot overwrite or delete a newer proposal published meanwhile', async () => {
  const { artifact, api } = setup(), backend = new DelayedCommitBackend(), state = vi.fn();
  const older = await stageNativeAssembly(backend, artifact, api, { current: () => true });
  const oldPublication = publishSelectedAssemblyProposal(older, { current: () => true, state });
  const rejected = expect(oldPublication).rejects.toThrow('replaced'); await backend.entered.promise;
  // Only transport provenance sentinel changes; native archive remains exact.
  const newerArtifact = { ...artifact, input_sha256: '2'.repeat(64) };
  const newer = await stageNativeAssembly(backend, newerArtifact, api, { current: () => true });
  const receipt = await newer.commit(); expect(receipt.source_status).toBe('current_at_return');
  const savedNewer = structuredClone(backend.value); backend.release.resolve(); await rejected;
  expect(backend.value).toEqual(savedNewer); expect(backend.commits).toBe(1); expect(state).not.toHaveBeenCalled();
  expect((await readNativeAssemblyArtifact(backend, api))!.artifact).toEqual(newerArtifact);
});

afterEach(() => vi.unstubAllGlobals());
