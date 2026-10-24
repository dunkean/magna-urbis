import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ caps: [] as string[], plan: vi.fn(), bulk: vi.fn(), unpack: vi.fn(), realize: vi.fn(),
  pair: 'native-assembly-pair-1' }));
vi.mock('../../rust/pkg/houses/magna_urbis_houses_wasm.js', () => ({ default: vi.fn(async () => {}),
  architecture_capabilities_json: () => JSON.stringify({ ok: true, data: h.caps }), native_assembly_capability_json: () => JSON.stringify({ ok: true, data: h.pair }),
  assemble_pair_json: vi.fn(), unpack_assembly_json: vi.fn(), realize_assembly_json: vi.fn(),
  plan_parent_batch_json: h.plan, unpack_parent_json: h.unpack, unpack_parent_batch_json: h.bulk, realize_parent_json: h.realize }));
vi.mock('../../rust/bridge/houses', () => ({ compileHousesModule: vi.fn(async () => ({})) }));
import { nativeParentApi } from '../../rust/bridge/architecture';
import { NATIVE_PARENT_CAPABILITY, NATIVE_PARENT_SCHEMA, type NativeParentRequest } from '../../rust/bridge/nativeParentContract';
const caps = ['houses.native-assembly-pair-1', 'houses.native-assembly-std-json-v1', NATIVE_PARENT_CAPABILITY];
const input = (): NativeParentRequest => ({ schema_version: NATIVE_PARENT_SCHEMA, batch: { schema_version: '1', requests: [] }, prior_occupation: { land_parts: [], roof_parts: [] } });
beforeEach(() => { h.caps = [...caps]; h.pair = 'native-assembly-pair-1'; h.plan.mockReset(); h.bulk.mockReset(); h.unpack.mockReset(); h.realize.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
it('pair+Std legacy local runtime refuses parent route before source/action and capability result is fresh', async () => {
  const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: caps.slice(0, 2) })));
  vi.stubGlobal('fetch', fetch); const api = nativeParentApi({ profile: 'local', server: 'http://parent-old.test' });
  await expect(api.require()).rejects.toThrow(NATIVE_PARENT_CAPABILITY); await expect(api.plan(input())).rejects.toThrow(NATIVE_PARENT_CAPABILITY);
  expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/status'))).toBe(true);
});
it('Wasm metadata transport double requires parent capability before all four methods', async () => {
  h.caps = caps.slice(0, 2); const api = nativeParentApi();
  await expect(api.plan(input())).rejects.toThrow(NATIVE_PARENT_CAPABILITY); expect(h.plan).not.toHaveBeenCalled();
  h.caps = [...caps]; h.plan.mockReturnValue(JSON.stringify({ ok: true, data: { protocol_only: true } }));
  await api.plan(input()); expect(h.plan).toHaveBeenCalledOnce(); expect(JSON.parse(h.plan.mock.calls[0][0])).toEqual(input());
});
it('real local adapter dispatches versioned batch+bulk and retains exact archive payload', async () => {
  const posted: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/status')) return new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: caps }));
    if (path.endsWith('/native-assembly-capability')) return new Response(JSON.stringify({ ok: true, data: 'native-assembly-pair-1' }));
    posted.push({ path, body: JSON.parse(String(options?.body)) }); return new Response(JSON.stringify({ ok: true, data: { protocol_only: true } }));
  }));
  const api = nativeParentApi({ profile: 'local', server: 'http://parent-new.test' });
  const archive = { format: 'native-parent-archive-1' as const, sha256: 'a'.repeat(64), payload: { $f64: '8000000000000000' } };
  await api.plan(input()); await api.unpackBatch([archive]); await api.unpack(archive); await api.realize(archive, true);
  expect(posted.map(p => p.path.split('/').pop())).toEqual(['plan-parent-batch', 'unpack-parent-batch', 'unpack-parent', 'realize-parent']);
  expect(posted[1].body).toEqual({ schema_version: NATIVE_PARENT_SCHEMA, archives: [archive] }); expect(posted[3].body).toEqual({ parent: archive, interiors: true });
});
