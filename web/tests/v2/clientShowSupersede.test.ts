import { describe, expect, it, vi } from 'vitest';

// A style switch (satellite -> parchment) followed at once by a language redraw left the satellite look under a
// "Parchment" selector: an older show() must never put its look back over a newer one, and bench sets never interleave.
const bench = vi.hoisted(() => ({ releases: [] as (() => void)[], looks: [] as string[] }));
vi.mock('../../src/v2/engine.worker?worker', () => ({
  default: class {
    postMessage(): void {}
    addEventListener(): void {}
    terminate(): void {}
  },
}));
vi.mock('../../src/ui/renderWorker?worker', () => ({
  default: class {
    postMessage(): void {}
    terminate(): void {}
  },
}));
vi.mock('../../../rust/bridge/renderGeometry', () => ({ renderGeometryReady: () => true, loadRenderGeometry: async () => {} }));
vi.mock('../../src/v2/benchRenderer', () => ({
  BenchRenderer: class {
    element = {};
    setSuspended(): void {}
    set(_world: unknown, settings: { look: string }): Promise<void> {
      bench.looks.push(settings.look);
      return new Promise(resolve => {
        bench.releases.push(resolve);
      });
    }
  },
}));

import { StudioClient } from '../../src/v2/client';

type Look = { look: string };
function makeClient(paths: Record<string, string>) {
  bench.releases = [];
  bench.looks = [];
  const viewer = { setDirectSource: vi.fn(), setSource: vi.fn(), contentChanged: vi.fn() };
  const client = Object.assign(Object.create(StudioClient.prototype), {
    viewer,
    render: { postMessage: vi.fn() },
    world: null,
    benchActive: false,
    benchPreparing: 0,
    minimalActive: false,
    view3dActive: false,
    showRequest: 0,
    drawingId: 0,
    pendingDraw: null,
    resolutions: [],
    presentations: new WeakMap(),
    display: {},
    appearanceSettings: { look: 'satellite' },
    resolve: (settings: Look) => ({ path: paths[settings.look] }),
    presentWorld: (world: unknown) => world,
  }) as StudioClient;
  const state = client as unknown as Record<string, unknown>;
  return { client, viewer, state };
}
const world = { mapSize: 6000, stats: {}, options: {} } as never;

describe('StudioClient.show', () => {
  it('keeps a newer render-worker look when an older bench show finishes last', async () => {
    const { client, viewer, state } = makeClient({ satellite: 'composite', parchment: 'classic' });
    const satellite = client.show(world, true);
    await vi.waitFor(() => expect(bench.looks).toEqual(['satellite']));
    state.appearanceSettings = { look: 'parchment' };
    void client.show(world, true).catch(() => {});
    expect(viewer.setSource).toHaveBeenCalledTimes(1);
    bench.releases[0]();
    await satellite;
    expect(viewer.setDirectSource).not.toHaveBeenCalled();
    expect(state.benchActive).toBe(false);
    clearTimeout((state.pendingDraw as { timer: ReturnType<typeof setTimeout> } | null)?.timer);
  });

  it('runs bench sets one at a time and ends on the newest look', async () => {
    const { client, viewer, state } = makeClient({ satellite: 'composite', parchment: 'composite' });
    const satellite = client.show(world, true);
    await vi.waitFor(() => expect(bench.looks).toEqual(['satellite']));
    state.appearanceSettings = { look: 'parchment' };
    const parchment = client.show(world, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(bench.looks).toEqual(['satellite']); // the newer set waits for the one in flight
    bench.releases[0]();
    await satellite;
    await vi.waitFor(() => expect(bench.looks).toEqual(['satellite', 'parchment']));
    bench.releases[1]();
    await parchment;
    expect(viewer.setDirectSource).toHaveBeenCalledTimes(1);
    expect(state.benchActive).toBe(true);
  });
});
