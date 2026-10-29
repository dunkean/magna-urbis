import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layout } from '../../rust/bridge/urban';
import type { SettlementRaster } from '../../rust/bridge/settlements';

const wasm = vi.hoisted(() => ({ quarters: vi.fn(), parcels: vi.fn() }));
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({
  default: vi.fn(),
  SettlementTerrain: class {
    urban_quarters = wasm.quarters;
    urban_parcels = wasm.parcels;
    free() {}
  },
}));
import { createUrbanEngine, defaultLayoutConfig } from '../../rust/bridge/urban';

const runtime = { profile: 'local' as const, server: 'http://127.0.0.1:8791' };
const redditOptions = ['oldEnclosureCitadel', 'medievalWalls', 'riverControl', 'dryDitches', 'gateVillages', 'shelteredHarbour', 'powerHighGround', 'mergeParallelStreets', 'regularGridOutline'] as const;
const disabledOptions = Object.fromEntries(redditOptions.map(key => [key, false]));
const layout = (): Layout => ({ key: 'town', culture: 'european-organic', center: { x: 1.2345678901234567, y: 2 },
  config: defaultLayoutConfig(), quarters: [], streets: [], blocks: [], warnings: [] });
const raster = (): SettlementRaster => ({ width: 100, n: 2, height: new Float32Array(4), water: new Uint8Array(4),
  waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4) });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('fortification style native transport compatibility', () => {
  it('omits the default in real local request JSON, while preserving explicit choices and old-engine errors', async () => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body); sent.push(input);
      return Object.hasOwn(input.layoutConfig, 'fortificationStyle')
        ? new Response(JSON.stringify({ error: 'unknown field `fortificationStyle`' }), { status: 400 })
        : new Response(JSON.stringify({ id: input.id, layouts: [] }));
    }));
    const engine = await createUrbanEngine(runtime);
    const config = defaultLayoutConfig();
    expect((await engine.run({ id: 1, kind: 'quarters', seed: 'old', runtime, layoutConfig: config })).error).toBeUndefined();
    expect(sent[0].layoutConfig).not.toHaveProperty('fortificationStyle');
    for (const key of redditOptions) expect(sent[0].layoutConfig).not.toHaveProperty(key);
    expect(config.fortificationStyle).toBe('auto');
    const explicit = { ...config, fortificationStyle: 'bastioned' as const };
    const result = await engine.run({ id: 2, kind: 'quarters', seed: 'explicit', runtime, layoutConfig: explicit });
    expect(sent[1].layoutConfig.fortificationStyle).toBe('bastioned');
    expect(result.error).toContain('unknown field `fortificationStyle`');
    expect(sent).toHaveLength(2); // No silent cultural retry after a rejected explicit style.
    expect(explicit.fortificationStyle).toBe('bastioned');
  });

  it('also omits auto from configs embedded in imported layouts and non-quarter requests without mutating them', async () => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body); sent.push(input);
      return new Response(JSON.stringify({ id: input.id }));
    }));
    const engine = await createUrbanEngine(runtime), imported = layout();
    const explicit = { ...layout(), key: 'explicit', config: { ...defaultLayoutConfig(), fortificationStyle: 'wengcheng' as const } };
    for (const [id, kind] of (['parcels', 'programme', 'buildingSites', 'builtCapacity'] as const).entries()) {
      await engine.run({ id, kind, seed: 'old-import', runtime, layoutConfig: defaultLayoutConfig(), layouts: [imported, explicit] });
    }
    for (const input of sent) {
      expect(input.layoutConfig).not.toHaveProperty('fortificationStyle');
      expect(input.layouts[0].config).not.toHaveProperty('fortificationStyle');
      // New default-off options are omitted even alongside an explicit style.
      for (const config of [input.layoutConfig, input.layouts[0].config, input.layouts[1].config])
        for (const key of redditOptions) expect(config).not.toHaveProperty(key);
      expect({ ...input.layouts[1], config: { ...defaultLayoutConfig(), ...input.layouts[1].config, ...disabledOptions } }).toEqual(explicit);
      expect({ ...input.layouts[0], config: imported.config }).toEqual(imported);
    }
    expect(imported.config!.fortificationStyle).toBe('auto');
  });

  it.each(redditOptions)('preserves explicit %s on direct and retained-layout requests without retry or mutation', async key => {
    const sent: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body); sent.push(input);
      return new Response(JSON.stringify({ error: `unknown field \`${key}\`` }), { status: 400 });
    }));
    const engine = await createUrbanEngine(runtime), config = { ...defaultLayoutConfig(), [key]: true };
    const imported = { ...layout(), config }, before = structuredClone(imported);
    for (const kind of ['quarters', 'parcels', 'programme', 'buildingSites', 'builtCapacity'] as const) {
      const result = await engine.run({ id: sent.length, kind, seed: 'opt-in', runtime, layoutConfig: config, layouts: [imported] });
      expect(result.error).toContain(`unknown field \`${key}\``);
      const input = sent.at(-1)!;
      for (const value of [input.layoutConfig, input.layouts[0].config]) {
        expect(value[key]).toBe(true);
        for (const other of redditOptions) if (other !== key) expect(value).not.toHaveProperty(other);
      }
    }
    expect(sent).toHaveLength(5); expect(imported).toEqual(before);
  });

  it('keeps the WASM config and retained-layout JSON compatible without changing returned snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) }));
    const imported = layout();
    wasm.quarters.mockReturnValue(JSON.stringify([imported])); wasm.parcels.mockReturnValue('[]');
    const engine = await createUrbanEngine();
    const result = await engine.run({ id: 1, kind: 'quarters', seed: 'wasm', raster: raster() });
    expect(result.layouts).toEqual([imported]);
    expect(JSON.parse(wasm.quarters.mock.calls[0][2])).not.toHaveProperty('fortificationStyle');
    for (const key of redditOptions) expect(JSON.parse(wasm.quarters.mock.calls[0][2])).not.toHaveProperty(key);
    await engine.run({ id: 2, kind: 'parcels', seed: 'retained', layoutsId: 1 });
    const retainedJson = wasm.parcels.mock.calls[0][1];
    expect(JSON.parse(retainedJson)[0].config).not.toHaveProperty('fortificationStyle');
    for (const key of redditOptions) expect(JSON.parse(retainedJson)[0].config).not.toHaveProperty(key);
    await engine.run({ id: 3, kind: 'parcels', seed: 'explicit', layouts: [imported] });
    expect(wasm.parcels.mock.calls[1][1]).toBe(retainedJson);
    await engine.run({ id: 4, kind: 'quarters', seed: 'style', layoutConfig: { ...defaultLayoutConfig(), fortificationStyle: 'flanked' } });
    expect(JSON.parse(wasm.quarters.mock.calls[1][2]).fortificationStyle).toBe('flanked');
    const enabled = { ...defaultLayoutConfig(), ...Object.fromEntries(redditOptions.map(key => [key, true])) };
    await engine.run({ id: 5, kind: 'quarters', seed: 'options', layoutConfig: enabled });
    for (const key of redditOptions) expect(JSON.parse(wasm.quarters.mock.calls[2][2])[key]).toBe(true);
    expect(imported.config!.fortificationStyle).toBe('auto');
  });
});
