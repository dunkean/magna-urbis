import { afterEach, expect, it, vi } from 'vitest';
import { requireNativeAssemblyCapability } from '../../rust/bridge/architecture';
import nativeSingles from './fixtures/urban-building-chunks-c.json';
import nativeSites from './fixtures/urban-cold-sites-c.json';
import type { PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { NativeAssemblyApi, AssemblePairRequest, AssemblyAttemptReport, AssemblyDecision } from '../../rust/bridge/nativeAssemblyContract';
import { attemptSelectedNativeAssembly } from '../src/ui/nativeAssemblyExperiment';
const single: PlacedBuilding = JSON.parse(JSON.stringify(nativeSingles.chunks[0].delta.buildings[0]));
const sites: PlacementRequest[] = JSON.parse(JSON.stringify(nativeSites.chunks.flatMap(chunk => chunk.requests)));
const site = sites.find(value => value.id === single.id)!;
const request: AssemblePairRequest = { site, incumbent: single, occupied_parts: [], occupied_roof_parts: [] };
// Occupied arrays/report are protocol-only controls. This test never invokes
// native admission and does not claim a complete physical neighborhood.
const report: AssemblyAttemptReport = { reason: 'SYNTHETIC TRANSPORT FALLBACK', errors: [], source_resolutions: 0,
  occupied_parts: 0, occupied_roof_parts: 0, occupation_union_ms: null, necessary_checks: 0, necessary_terrain_checks: 0,
  new_body_rebuilds: 0, new_native_preparations: 0, new_admissions: 0, incumbent_preparations: 0, incumbent_admissions: 0,
  incumbent_connector_evaluations: 0, new_connector_evaluations: 0, necessary: [], selected_dimensions: null };
function setup() {
  const backend = { read: vi.fn(async () => undefined), commit: vi.fn(async () => {}) };
  const api: NativeAssemblyApi = { require: vi.fn(async () => {}), assemble: vi.fn(async (): Promise<AssemblyDecision> => ({ outcome: 'retained', building: single, report })),
    unpack: vi.fn(async () => { throw new Error('Unexpected group unpack'); }), realize: vi.fn(async () => { throw new Error('Unexpected group realization'); }) };
  return { backend, api };
}
it('refuses an old capability before reading the native site, dispatching generation or saving a parent', async () => {
  const { api, backend } = setup(), load = vi.fn(async () => request);
  vi.mocked(api.require).mockRejectedValue(new Error('houses.native-assembly-pair-1 required'));
  await expect(attemptSelectedNativeAssembly({ parentId: single.id, api, backend, current: () => true, load })).rejects.toThrow('required');
  expect(load).not.toHaveBeenCalled(); expect(api.assemble).not.toHaveBeenCalled(); expect(backend.read).not.toHaveBeenCalled(); expect(backend.commit).not.toHaveBeenCalled();
});
it('discards source replacement after the selected-site read before any assembly call', async () => {
  const { api, backend } = setup(); let current = true;
  await expect(attemptSelectedNativeAssembly({ parentId: single.id, api, backend, current: () => current,
    load: async () => { current = false; return request; } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(api.assemble).not.toHaveBeenCalled(); expect(backend.commit).not.toHaveBeenCalled();
});
it('keeps the real retained Single as a fallback and never stores or projects it as an assembly', async () => {
  const { api, backend } = setup(), before = JSON.stringify(single);
  const result = await attemptSelectedNativeAssembly({ parentId: single.id, api, backend, current: () => true, load: async () => request });
  expect(result.state).toBe('retained'); expect(backend.commit).not.toHaveBeenCalled(); expect(api.unpack).not.toHaveBeenCalled(); expect(JSON.stringify(single)).toBe(before);
});

afterEach(() => vi.unstubAllGlobals());
it('the actual pair-only V4 capability gate refuses BEFORE the selected-site loader or any new native method', async () => {
  const { api, backend } = setup(), load = vi.fn(async () => request), paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    paths.push(String(url)); return new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: ['houses.native-assembly-pair-1'] }));
  }));
  api.require = () => requireNativeAssemblyCapability({ profile: 'local', server: 'http://pair-only-selected.test' });
  await expect(attemptSelectedNativeAssembly({ parentId: single.id, api, backend, current: () => true, load })).rejects.toThrow('houses.native-assembly-std-json-v1');
  expect(paths).toEqual(['http://pair-only-selected.test/status']); expect(load).not.toHaveBeenCalled();
  expect(api.assemble).not.toHaveBeenCalled(); expect(api.unpack).not.toHaveBeenCalled(); expect(backend.read).not.toHaveBeenCalled(); expect(backend.commit).not.toHaveBeenCalled();
});
