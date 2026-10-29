import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({ default: vi.fn(), SettlementTerrain: class {} }));
import { createUrbanEngine, defaultLayoutConfig, normalizeLayoutConfig, type UrbanRequest } from '../../rust/bridge/urban';
import { encodeSituation, decodeSituation } from '../src/ui/citySituation';

const keys = ['powerHighGround', 'mergeParallelStreets', 'regularGridOutline'] as const;
afterEach(() => vi.unstubAllGlobals());

it('defaults every site option off and retains each opt-in through share queries and MU1 codes', async () => {
  for (const key of keys) expect(normalizeLayoutConfig({}, true)[key]).toBe(false);
  for (const key of keys) {
    const layoutConfig = { ...defaultLayoutConfig(), [key]: true };
    const q = new URLSearchParams({ artifact: 'city-04-mountain-bay-s', urban: JSON.stringify({ layoutConfig }) }).toString();
    const code = await encodeSituation({ v: 1, q, pins: [] });
    const restored = await decodeSituation(code);
    const saved = JSON.parse(new URLSearchParams(restored.q).get('urban')!);
    expect(normalizeLayoutConfig(saved.layoutConfig, true)).toEqual(layoutConfig);
  }
});

it('keeps disabled native payloads identical to missing options and sends explicit true options', async () => {
  const payloads: UrbanRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/urban')) payloads.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(url.endsWith('/raster') ? { ok: true } : { id: 1, layouts: [] }), { headers: { 'content-type': 'application/json' } });
  }));
  const runtime = { profile: 'local' as const, server: 'http://site-options.test:8795' };
  const raster = { width: 100, n: 2, height: new Float32Array(4), water: new Uint8Array(4), waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4).fill(-1) };
  for (const enabled of [false, true]) {
    const layoutConfig = { ...defaultLayoutConfig(), ...Object.fromEntries(keys.map(k => [k, enabled])) };
    const engine = await createUrbanEngine(runtime);
    const result = await engine.run({ id: 1, kind: 'quarters', seed: 'site-options', runtime, raster, layoutConfig });
    expect(result.error).toBeUndefined();
    for (const key of keys) enabled ? expect(payloads.at(-1)!.layoutConfig?.[key]).toBe(true) : expect(payloads.at(-1)!.layoutConfig).not.toHaveProperty(key);
    expect(layoutConfig.powerHighGround).toBe(enabled);
  }
});

it('puts all three checkboxes in the shared Reddit group with explanatory titles', () => {
  const source = readFileSync(new URL('../src/ui/terrainUrban.ts', import.meta.url), 'utf8');
  const group = source.slice(source.indexOf('const wallRedditControls'), source.indexOf('const enclosureControls'));
  expect(group).toContain('Options Reddit (27/10)');
  for (const key of keys) expect(group).toContain(`['${key}',`);
  expect(group).toContain('title="${title}"');
});
