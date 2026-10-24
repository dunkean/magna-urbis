import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import native from './fixtures/native-assembly-positive-consumer.json';
const wasmHarness = vi.hoisted(() => ({ capabilities: [] as string[], pair: 'native-assembly-pair-1',
  init: vi.fn(async () => undefined), compile: vi.fn(async () => ({})), assemble: vi.fn(), unpack: vi.fn(), realize: vi.fn() }));
// Metadata/method transport double ONLY. Real copied Wasm assets are unchanged;
// this does not claim executing the actual Wasm native constructor/Std reader.
vi.mock('../../rust/pkg/houses/magna_urbis_houses_wasm.js', () => ({ default: wasmHarness.init,
  architecture_capabilities_json: () => JSON.stringify({ ok: true, data: wasmHarness.capabilities }),
  native_assembly_capability_json: () => JSON.stringify({ ok: true, data: wasmHarness.pair }),
  assemble_pair_json: wasmHarness.assemble, unpack_assembly_json: wasmHarness.unpack, realize_assembly_json: wasmHarness.realize,
  architecture_profiles_json: vi.fn(), place_buildings_json: vi.fn(), enrich_placement_json: vi.fn() }));
vi.mock('../../rust/bridge/houses', () => ({ compileHousesModule: wasmHarness.compile }));
import { callArchitecture, requireNativeAssemblyCapability, nativeAssemblyApi } from '../../rust/bridge/architecture';
import type { RetainedNativeAssembly } from '../../rust/bridge/nativeAssemblyContract';
import { readNativeAssemblyArtifact, stageNativeAssembly, ASSEMBLY_ARTIFACT_VERSION, parseAssemblyArtifact } from '../src/ui/nativeAssemblyStore';
const pair = 'houses.native-assembly-pair-1', std = 'houses.native-assembly-std-json-v1';
beforeEach(() => {
  wasmHarness.capabilities = [pair]; wasmHarness.pair = 'native-assembly-pair-1';
  wasmHarness.assemble.mockReset(); wasmHarness.unpack.mockReset(); wasmHarness.realize.mockReset();
  wasmHarness.unpack.mockReturnValue(JSON.stringify({ ok: true, data: native.assembly }));
});
afterEach(() => vi.unstubAllGlobals());
it('requires the new local capabilities freshly and refuses an old engine before any group route', async () => {
  const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: ['houses.placement', 'houses.compact-plans'] })));
  vi.stubGlobal('fetch', fetch);
  await expect(callArchitecture('unpack-assembly', native.archive, { profile: 'local', server: 'http://old-assembly.test' })).rejects.toThrow(pair);
  expect(fetch).toHaveBeenCalledOnce(); expect(String(fetch.mock.calls[0][0])).toContain('/status');
});
it('rejects V4 pair-only local runtime before any archive read, native route or save', async () => {
  const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: [pair] })));
  vi.stubGlobal('fetch', fetch);
  const api = nativeAssemblyApi({ profile: 'local', server: 'http://v4-pair-only.test' });
  const backend = { read: vi.fn(async () => undefined), commit: vi.fn(async () => {}) };
  const artifact = parseAssemblyArtifact(JSON.stringify({ version: ASSEMBLY_ARTIFACT_VERSION, application: 'proposal_not_applied',
    parent_id: native.assembly.id, parcel_id: native.assembly.parcel_id, input_sha256: '1'.repeat(64), archive: native.archive }));
  await expect(readNativeAssemblyArtifact(backend, api)).rejects.toThrow(std);
  await expect(stageNativeAssembly(backend, artifact, api, { current: () => true })).rejects.toThrow(std);
  expect(backend.read).not.toHaveBeenCalled(); expect(backend.commit).not.toHaveBeenCalled();
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/status'))).toBe(true);
});
it('also refuses a coherent list with an inconsistent local pair getter before native action', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    paths.push(String(url)); return new Response(JSON.stringify(String(url).endsWith('/status')
      ? { service: 'magna-urbis-local', capabilities: [pair, std] } : { ok: true, data: 'wrong-pair-contract' }));
  }));
  await expect(callArchitecture('unpack-assembly', native.archive, { profile: 'local', server: 'http://inconsistent-assembly.test' })).rejects.toThrow('incohérent');
  expect(paths).toEqual(['http://inconsistent-assembly.test/status', 'http://inconsistent-assembly.test/houses/native-assembly-capability']);
});
it('advertises BOTH required capabilities and uses coherent getter + dedicated exact archive route', async () => {
  const paths: string[] = [], posted: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    paths.push(String(url));
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: [pair, std] }));
    if (String(url).endsWith('/native-assembly-capability')) return new Response(JSON.stringify({ ok: true, data: 'native-assembly-pair-1' }));
    posted.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, data: native.assembly }));
  }));
  const runtime = { profile: 'local' as const, server: 'http://new-assembly.test' };
  await requireNativeAssemblyCapability(runtime);
  const decoded = await callArchitecture<RetainedNativeAssembly>('unpack-assembly', native.archive, runtime);
  expect(paths.filter(path => path.endsWith('/status'))).toHaveLength(2);
  expect(paths.filter(path => path.endsWith('/native-assembly-capability'))).toHaveLength(2);
  expect(paths.at(-1)).toBe('http://new-assembly.test/houses/unpack-assembly'); expect(posted).toEqual([native.archive]); expect(decoded).toEqual(native.assembly);
});
it('rejects V4 pair-only Wasm metadata before touching any assembly/archive native method', async () => {
  wasmHarness.capabilities = [pair];
  await expect(callArchitecture('unpack-assembly', native.archive)).rejects.toThrow(std);
  expect(wasmHarness.unpack).not.toHaveBeenCalled(); expect(wasmHarness.assemble).not.toHaveBeenCalled(); expect(wasmHarness.realize).not.toHaveBeenCalled();
});
it('accepts the explicit two-capability Wasm TRANSPORT MOCK with coherent existing pair getter', async () => {
  wasmHarness.capabilities = [pair, std];
  const decoded = await callArchitecture<RetainedNativeAssembly>('unpack-assembly', native.archive);
  expect(wasmHarness.unpack).toHaveBeenCalledWith(JSON.stringify(native.archive)); expect(decoded).toEqual(native.assembly);
});
