import { afterEach, expect, it, vi } from 'vitest';
import type { UrbanRequest, Layout, Partition } from '../../rust/bridge/urban';
import type { SettlementRaster } from '../../rust/bridge/settlements';

const wasm = vi.hoisted(() => ({ supported: false, version: 1, wrapperThrows: false, constructors: vi.fn(), quarters: vi.fn((_seed: string, _sites: string, _config: string, _roads: string) => '[]') }));
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({
  default: vi.fn(), SettlementTerrain: class {
    static get urban_programme_functions_version() {
      return wasm.supported ? () => { if (wasm.wrapperThrows) throw new Error('missing old binary export'); return wasm.version; } : undefined;
    }
    constructor(...args: unknown[]) { wasm.constructors(...args); }
    urban_quarters = wasm.quarters;
    free() {}
  },
}));
import { createUrbanEngine, defaultLayoutConfig } from '../../rust/bridge/urban';
import { requiresProgrammeFunctions, URBAN_PROGRAMME_FUNCTIONS_CAPABILITY } from '../../rust/bridge/urbanProgrammeSupport';

const runtime = { profile: 'local' as const, server: 'http://local.test:8795' };
const raster = (): SettlementRaster => ({ width: 100, n: 2, height: new Float32Array(4), water: new Uint8Array(4), waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4).fill(-1) });
const request = (functions?: Record<string, number> | null): UrbanRequest => ({ id: 1, kind: 'quarters', seed: 'same', runtime, raster: raster(),
  layoutConfig: { ...defaultLayoutConfig(), programme: { ...defaultLayoutConfig().programme, ...(functions === undefined ? {} : { functions }) } } });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const layout = (): Layout => ({ key: 'city', culture: 'roman-core', center: { x: 2639.9315590685324, y: 2668.9433913724934 },
  config: request({}).layoutConfig, quarters: [], streets: [], blocks: [], warnings: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); wasm.supported = false; wasm.version = 1; wasm.wrapperThrows = false; });

it('rejects every explicit local combination including empty/zero on an old engine before raster upload or urban generation', async () => {
  const cases: Record<string, number>[] = [{}, { port: 0 }, { port: .5, capital: 1, artisan: 1 }];
  for (const weights of cases) {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json({ service: 'magna-urbis-local', capabilities: ['urban.programme'] }));
    vi.stubGlobal('fetch', fetcher);
    const engine = await createUrbanEngine(runtime), result = await engine.run(request(weights));
    expect(result.error).toContain('version 1 requise');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toBe(`${runtime.server}/status`);
  }
});

it('keeps undefined and null on the legacy local path without a capability read', async () => {
  for (const weights of [undefined, null]) {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      sent.push(url);
      if (url.endsWith('/urban')) expect(JSON.parse(String(init?.body)).layoutConfig.programme).not.toHaveProperty('functions');
      return json(url.endsWith('/raster') ? { ok: true } : { id: 1, layouts: [] });
    }));
    const engine = await createUrbanEngine(runtime), result = await engine.run(request(weights));
    expect(result.error).toBeUndefined(); expect(sent).toEqual([`${runtime.server}/raster`, `${runtime.server}/urban`]);
  }
});

it('omits only automatic null from imported layout and partition contexts on the real legacy transport', async () => {
  const imported = layout(); imported.config!.programme.functions = null;
  const programme = { version: 1 as const, population: 5000, context: { ...defaultLayoutConfig().programme, functions: null }, cultures: [], demands: [],
    reservations: [], allocations: [], adjacency: [], environment: [], reconciliationPasses: 0, warnings: [] };
  imported.programme = programme;
  const partition: Partition = { key: 'city', parcels: [], warnings: [], programme };
  const sent: UrbanRequest[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return json({ id: 1 }); });
  vi.stubGlobal('fetch', fetcher);
  const engine = await createUrbanEngine(runtime), result = await engine.run({ id: 1, seed: 'same', kind: 'programme', runtime, layouts: [imported], partitions: [partition] });
  expect(result.error).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sent[0].layouts![0].config!.programme).not.toHaveProperty('functions');
  expect(sent[0].layouts![0].programme!.context).not.toHaveProperty('functions');
  expect(sent[0].partitions![0].programme!.context).not.toHaveProperty('functions');
  expect(imported.config!.programme.functions).toBeNull(); expect(programme.context.functions).toBeNull();
});

it('retains the exact explicit payload and checks fresh support before each upload/generation rather than caching across server replacement', async () => {
  const calls: { url: string; body?: unknown }[] = []; let support = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return json(url.endsWith('/status') ? { service: 'magna-urbis-local', capabilities: support ? [URBAN_PROGRAMME_FUNCTIONS_CAPABILITY] : [] } : { id: 1, layouts: [] });
  }));
  const engine = await createUrbanEngine(runtime), original = request({ capital: 1, artisan: .5, port: 1 });
  expect((await engine.run(original)).error).toBeUndefined();
  expect(calls.map(c => c.url)).toEqual(['/status', '/raster', '/urban'].map(path => `${runtime.server}${path}`));
  expect((calls[2].body as UrbanRequest).layoutConfig?.programme.functions).toEqual(original.layoutConfig?.programme.functions);
  expect(original.layoutConfig?.programme.functions).toEqual({ capital: 1, artisan: .5, port: 1 });
  support = false;
  expect((await engine.run({ ...original, id: 2 })).error).toContain('version 1 requise');
  expect(calls.map(c => c.url)).toEqual(['/status', '/raster', '/urban', '/status'].map(path => `${runtime.server}${path}`));
});

it('guards nested imported layout/programme/partition contexts and rejects invalid weights without any generation call', async () => {
  const explicit = layout(), programme = { context: request({}).layoutConfig!.programme };
  const nested: Pick<UrbanRequest, 'layouts' | 'partitions'>[] = [
    { layouts: [explicit] },
    { layouts: [{ ...explicit, config: undefined, programme: programme as Layout['programme'] }] },
    { partitions: [{ key: 'city', parcels: [], warnings: [], programme: programme as Partition['programme'] }] },
  ];
  for (const input of nested) {
    expect(requiresProgrammeFunctions(input)).toBe(true);
    const fetcher = vi.fn(async () => json({ service: 'magna-urbis-local', capabilities: [] })); vi.stubGlobal('fetch', fetcher);
    const engine = await createUrbanEngine(runtime), result = await engine.run({ id: 1, seed: 'same', kind: 'programme', runtime, ...input });
    expect(result.error).toContain('version 1 requise'); expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const invalidCases: Record<string, number>[] = [{ port: 2 }, { ports: .5 }, { artisan: NaN }];
  for (const weights of invalidCases) {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const engine = await createUrbanEngine(runtime), result = await engine.run(request(weights));
    expect(result.error).toMatch(/invalide|inconnue/); expect(fetcher).not.toHaveBeenCalled();
  }
});

it('refuses explicit new plan functions on an operation that cannot apply them instead of accepting and ignoring them', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const engine = await createUrbanEngine(runtime);
  const result = await engine.run({ ...request({ port: 1 }), kind: 'parcels' });
  expect(result.error).toContain('régénérant les quartiers'); expect(fetcher).not.toHaveBeenCalled();
});

it('rejects old WASM, a wrong version and new-wrapper/old-binary mismatch before creating terrain or calling a generator', async () => {
  for (const mode of ['missing', 'wrong', 'wrapper-mismatch']) {
    wasm.supported = mode !== 'missing'; wasm.version = mode === 'wrong' ? 2 : 1; wasm.wrapperThrows = mode === 'wrapper-mismatch';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array())));
    const engine = await createUrbanEngine(), result = await engine.run({ ...request({}), runtime: undefined });
    expect(result.error).toContain('version 1 requise'); expect(wasm.constructors).not.toHaveBeenCalled(); expect(wasm.quarters).not.toHaveBeenCalled();
  }
});

it('allows supported WASM and preserves explicit weights in the actual native config call', async () => {
  wasm.supported = true;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array())));
  const engine = await createUrbanEngine(), result = await engine.run({ ...request({ capital: 1, artisan: .5, port: 1 }), runtime: undefined });
  expect(result.error).toBeUndefined(); expect(wasm.constructors).toHaveBeenCalledTimes(1); expect(wasm.quarters).toHaveBeenCalledTimes(1);
  expect(JSON.parse(wasm.quarters.mock.calls[0][2]).programme.functions).toEqual({ capital: 1, artisan: .5, port: 1 });
});

it('keeps missing/null automatic settings usable on old WASM and omits only the null wire field', async () => {
  for (const weights of [undefined, null]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array())));
    const engine = await createUrbanEngine(), before = wasm.quarters.mock.calls.length;
    const result = await engine.run({ ...request(weights), runtime: undefined });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(wasm.quarters.mock.calls[before][2]).programme).not.toHaveProperty('functions');
  }
});
