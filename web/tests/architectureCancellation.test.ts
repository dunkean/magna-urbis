import { afterEach, expect, it, vi } from 'vitest';
import { callArchitecture } from '../../rust/bridge/architecture';
import type { ExecutionRuntime } from '../src/ui/executionProfile';

afterEach(() => vi.unstubAllGlobals());

it('does not dispatch cancelled work and drains in-flight native work before freeing a scheduler slot', async () => {
  let finish!: (response: Response) => void;
  let posted!: () => void;
  const dispatched = new Promise<void>(resolve => { posted = resolve; });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) return new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: ['houses.placement', 'houses.style-index'] }));
    expect(init?.signal).toBeUndefined();
    posted();
    return new Promise<Response>(resolve => { finish = resolve; });
  });
  vi.stubGlobal('fetch', fetch);
  const runtime = { profile: 'local', server: 'http://native-cancellation.test' } as ExecutionRuntime;
  const cancelled = new AbortController(); cancelled.abort();
  await expect(callArchitecture('style-index', {}, runtime, { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();

  const controller = new AbortController();
  const pending = callArchitecture('style-index', {}, runtime, { signal: controller.signal });
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await dispatched;
  controller.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  finish(new Response(JSON.stringify({ ok: true, data: {} })));
  await rejection;
  expect(fetch).toHaveBeenCalledTimes(2);
});
