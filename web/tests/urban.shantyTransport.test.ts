import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({ default: vi.fn(), SettlementTerrain: class {} }));
import { createUrbanEngine, defaultLayoutConfig, type Layout } from '../../rust/bridge/urban';

afterEach(() => vi.unstubAllGlobals());

it.each([1, 0, 0.5, 3])('transports shantyScale=%s without sending the default to strict engines', async shantyScale => {
  const sent: { layoutConfig: Record<string, unknown>; layouts?: { config: Record<string, unknown> }[] }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const input = JSON.parse(init.body); sent.push(input);
    return new Response(JSON.stringify({ id: input.id, layouts: [] }));
  }));
  const runtime = { profile: 'local' as const, server: 'http://shanty-transport.test:8791' };
  const config = { ...defaultLayoutConfig(), shantyScale };
  const imported = { config, quarters: [], streets: [] } as unknown as Layout;
  const engine = await createUrbanEngine(runtime);
  try {
    expect((await engine.run({ id: 1, kind: 'quarters', seed: 'village', runtime, layoutConfig: config })).error).toBeUndefined();
    expect((await engine.run({ id: 2, kind: 'parcels', seed: 'village', runtime, layoutConfig: config, layouts: [imported] })).error).toBeUndefined();
    for (const input of sent) for (const value of [input.layoutConfig, ...(input.layouts?.map(layout => layout.config) ?? [])]) {
      if (shantyScale === 1) expect(value).not.toHaveProperty('shantyScale');
      else expect(value.shantyScale).toBe(shantyScale);
    }
    expect(config.shantyScale).toBe(shantyScale);
    expect(imported.config).toBe(config);
  } finally { await engine.release?.(runtime); }
});
