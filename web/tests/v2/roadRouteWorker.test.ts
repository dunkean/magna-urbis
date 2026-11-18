import { afterEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ route: vi.fn(), dispose: vi.fn(async () => {}) }));
vi.mock('../../src/v2/roadRoute', () => ({ createRoadRouter: () => mocked }));
afterEach(() => vi.unstubAllGlobals());

describe('road preview worker lifecycle', () => {
  it('keeps only the latest unstarted request, discards cancelled results and releases its context on stop', async () => {
    vi.resetModules();
    mocked.route.mockReset();
    mocked.dispose.mockClear();
    const pending: ((value: object) => void)[] = [],
      replies: unknown[] = [],
      close = vi.fn();
    mocked.route.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const scope = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, postMessage: (data: unknown) => replies.push(data), close };
    vi.stubGlobal('self', scope);
    await import('../../src/v2/roadRoute.worker');
    const send = (data: unknown) => scope.onmessage!({ data });
    const request = (id: number) => ({
      id,
      type: 'route',
      world: {},
      settings: {},
      points: [
        { x: id, y: 0 },
        { x: id, y: 1 },
      ],
    });
    send(request(1));
    send(request(2));
    send({ type: 'cancel', id: 2 });
    send(request(3));
    send(request(4));
    send({ type: 'cancel', id: 1 });
    expect(mocked.route).toHaveBeenCalledTimes(1);
    pending.shift()!({ path: [], controls: [], controlIndices: [], segments: [] });
    await vi.waitFor(() => expect(mocked.route).toHaveBeenCalledTimes(2));
    expect(mocked.route.mock.calls[1][2][0].x).toBe(4);
    expect(replies).toEqual([]);
    send({ type: 'dispose' });
    pending.shift()!({ path: [], controls: [], controlIndices: [], segments: [] });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocked.dispose).toHaveBeenCalledOnce();
    expect(replies).toEqual([{ type: 'disposed' }]);
  });
});
