import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRemainingGeneration, REUSED, type FullGenerationAction } from '../src/v2/fullGeneration';
import { recordGenerationValidity } from '../src/v2/stageValidity';
import { defaultSettings } from '../src/v2/settings';
import { engineIdentity, recordNativeBuild } from '../../rust/bridge/engineIdentity';
import type { World } from '../src/gen/types';
import type { V2Progress } from '../src/v2/contracts';

const SERVER = 'http://127.0.0.1:8791';
let build = 'A';
function serveStatus(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/status')
    ? new Response(JSON.stringify({ ok: true, service: 'magna-urbis-local', backend: 'rust-native', build }), { status: 200 })
    : new Response('', { status: 404 })));
}
function nativeSettings() {
  const settings = defaultSettings();
  settings.extent = 1200;
  settings.runtime = { backend: 'native', compute: 'cpu', source: 'procedural', localServer: SERVER };
  return settings;
}
afterEach(() => { vi.unstubAllGlobals(); recordNativeBuild(SERVER, undefined); });

describe('engine identity keys the retained stage results', () => {
  it('a native engine without a known build is the browser engine; a stamp wins over the registry', () => {
    expect(engineIdentity('native', SERVER)).toMatch(/^wasm:/);
    recordNativeBuild(SERVER, 'A');
    expect(engineIdentity('native', SERVER)).toBe('native:A');
    expect(engineIdentity('native', SERVER, { native: 'B' })).toBe('native:B');
    expect(engineIdentity('typescript', SERVER)).toBe('typescript');
  });

  it('a rebuilt native engine makes full generation place and route again; an unchanged one is reported reused', async () => {
    serveStatus(); build = 'A';
    const settings = nativeSettings();
    recordNativeBuild(SERVER, 'A');
    const world = { seed: settings.options.seed, mapSize: 1200, options: settings.options, settlements: [], stats: { 'v2.terrainKey': 'terrain' } } as unknown as World;
    recordGenerationValidity(world, settings, 'terrain');
    recordGenerationValidity(world, settings, 'region');
    const run = () => {
      const progress: V2Progress[] = [];
      const api = { settings: () => settings, world: () => world, targets: () => undefined, redraw: vi.fn(async () => {}),
        progress: (p: V2Progress) => { progress.push(p); },
        generate: vi.fn(async (_action: FullGenerationAction) => true) };
      return { api, progress };
    };

    const same = run();
    expect(await runRemainingGeneration('settlements', same.api)).toBe(true);
    expect(same.api.generate).not.toHaveBeenCalled();
    expect(same.progress.map(p => p.label)).toEqual([REUSED.all]);

    build = 'B'; // the engine was rebuilt and redeployed while the page stayed open
    const rebuilt = run();
    await runRemainingGeneration('settlements', rebuilt.api);
    expect(rebuilt.api.generate.mock.calls[0]).toEqual(['region']);
    expect(rebuilt.progress.map(p => p.label)).toEqual([REUSED.terrain]);
  });
});
