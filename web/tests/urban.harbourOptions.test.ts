import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({ default: vi.fn(), SettlementTerrain: class {} }));
import { createUrbanEngine, defaultLayoutConfig, layoutExtent, normalizeLayoutConfig, type Layout, type UrbanRequest } from '../../rust/bridge/urban';
import { encodeSituation, decodeSituation } from '../src/ui/citySituation';

const keys = ['shelteredHarbour'] as const;
afterEach(() => vi.unstubAllGlobals());

it('frames detached port districts and works even beyond allocated land', () => {
  const shape = (x: number, y: number) => ({ outer: [{ x, y }, { x: x + 10, y: y + 10 }, { x, y: y + 10 }], holes: [] });
  const layout = { quarters: [{ shape: shape(0, 0) }], structure: { allocated: [shape(0, 0)],
    portDistricts: [{ shapes: [shape(-200, 500)] }], quays: [{ shape: shape(-210, 510) }] },
    streets: [{ role: 'mole', path: [{ x: -210, y: 520 }, { x: -210, y: 700 }], widths: [8, 8] }] } as unknown as Layout;
  const extent = layoutExtent([layout])!;
  for (const p of [{ x: 0, y: 0 }, { x: -214, y: 704 }, { x: -200, y: 500 }]) {
    expect(Math.abs(p.x - extent.center.x)).toBeLessThanOrEqual(extent.radius);
    expect(Math.abs(p.y - extent.center.y)).toBeLessThanOrEqual(extent.radius);
  }
});

it('defaults the harbour option off and retains each opt-in through share queries and MU1 codes', async () => {
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
    expect(payloads.at(-1)!.layoutConfig).not.toHaveProperty('portDetachment');
    if (!enabled) expect(payloads.at(-1)!.layoutConfig).not.toHaveProperty('portShelter');
    expect(layoutConfig.shelteredHarbour).toBe(enabled);
  }
  for (const value of [0, 0.5, 1]) {
    const engine = await createUrbanEngine(runtime);
    await engine.run({ id: 1, kind: 'quarters', seed: 'port-params', runtime, raster,
      layoutConfig: { ...defaultLayoutConfig(), portDetachment: value, portShelter: value } });
    const native = payloads.at(-1)!.layoutConfig!;
    expect(native.portDetachment ?? 1).toBe(value);
    expect(native.portShelter ?? 0).toBe(value);
  }
});

it('puts numeric port controls in their theme and migrates old toggles', async () => {
  expect(normalizeLayoutConfig({ shelteredHarbour: true }, true).portShelter).toBe(1);
  expect(normalizeLayoutConfig({ shelteredHarbour: true, portShelter: 0 }, true).portShelter).toBe(0);
  expect(defaultLayoutConfig().portDetachment).toBe(1);
  expect(defaultLayoutConfig().portShelter).toBe(0);
  const source = readFileSync(new URL('../src/ui/terrainUrban.ts', import.meta.url), 'utf8');
  const controls = source.slice(source.indexOf('const portControls'), source.indexOf('const wallParameter'));
  for (const key of ['portDetachment', 'portShelter']) expect(controls).toContain(`data-config="${key}" type="range"`);
  expect(controls).toContain('<summary>Port</summary>');
  expect(controls).toContain('title="0 :');
  for (const value of [0, 0.5, 1]) {
    const layoutConfig = { ...defaultLayoutConfig(), portDetachment: value, portShelter: 1 - value };
    const q = new URLSearchParams({ urban: JSON.stringify({ layoutConfig }) }).toString();
    const restored = await decodeSituation(await encodeSituation({ v: 1, q, pins: [] }));
    const saved = JSON.parse(new URLSearchParams(restored.q).get('urban')!);
    expect(normalizeLayoutConfig(saved.layoutConfig, true)).toEqual(layoutConfig);
  }
});
