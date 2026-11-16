import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { backendAlternative, backendFailure, browserRuntimeSettings, fallbackRuntime, matchesRustTransport, retryNativeStage, runtimeForRun, runtimeNeedsProbe, F } from '../../src/v2/runtimeChoices';
import { nativeFetch, NativeConnectionError } from '../../../rust/bridge/nativeAvailability';
import { nativeRequest } from '../../../rust/bridge/nativeEngine';

const caps = (over: Partial<{ webgpu: boolean; native: boolean; python: boolean }> = {}) => ({ checked: true, webgpu: true, native: false, python: false, ...over });

describe('offline backends', () => {
  it('a restored native recipe switches to Rust in the browser before the run', () => {
    const s = defaultSettings(); s.runtime!.backend = 'native'; s.urban = { ...s.urban, backend: 'native' };
    expect(runtimeNeedsProbe(s, { ...caps(), checked: false })).toBe(true);
    expect(fallbackRuntime(s, caps())).toEqual([F.engineToBrowser, F.urbanToEngine]);
    expect(s.runtime!.backend).toBe('rust'); expect(s.urban!.backend).toBeUndefined();
  });
  it('native or Python neural falls back to browser WebGPU, else Python', () => {
    const native = defaultSettings(); native.generation = 'neural'; native.runtime = { ...native.runtime!, backend: 'native', source: 'neural' };
    expect(fallbackRuntime(native, caps())).toEqual([F.neuralToBrowser]); expect(native.runtime).toMatchObject({ backend: 'rust', source: 'neural-wasm' });
    const python = defaultSettings(); python.generation = 'neural'; python.runtime = { ...python.runtime!, source: 'neural-python' };
    expect(fallbackRuntime(python, caps())).toEqual([F.neuralToBrowser]); expect(python.runtime!.source).toBe('neural-wasm');
    const noGpu = defaultSettings(); noGpu.generation = 'neural'; noGpu.runtime = { ...noGpu.runtime!, source: 'neural-wasm' };
    expect(fallbackRuntime(noGpu, caps({ webgpu: false, python: true }))).toEqual([F.neuralToPython]); expect(noGpu.runtime!.source).toBe('neural-python');
  });
  it('nothing changes when the selection is available or has no alternative', () => {
    const s = defaultSettings(); s.runtime!.backend = 'native';
    expect(fallbackRuntime(s, caps({ native: true }))).toEqual([]);
    const neural = defaultSettings(); neural.generation = 'neural'; neural.runtime = { ...neural.runtime!, source: 'neural-wasm' };
    expect(fallbackRuntime(neural, caps({ webgpu: false }))).toEqual([]);
  });
  it('a backend error names the alternative without changing the settings', () => {
    expect(backendFailure('Moteur Rust local inaccessible (http://127.0.0.1:8791). Lancez le profil local ou l’application de bureau.')).toBe('native');
    expect(backendFailure('Neural service unreachable (http://127.0.0.1:8792): run “npm run neural:serve” from web/')).toBe('neural-service');
    expect(backendFailure('Hydrology failed: x')).toBeUndefined();
    const s = defaultSettings(); s.generation = 'neural'; s.runtime = { ...s.runtime!, backend: 'native', source: 'neural' };
    expect(backendAlternative(s, caps({ native: true }), 'neural-service')).toBe(F.altBrowserNeural);
    expect(s.runtime).toMatchObject({ backend: 'native', source: 'neural' });
    const p = defaultSettings(); p.runtime!.backend = 'native';
    expect(backendAlternative(p, caps(), 'native')).toBe(F.altBrowserGpu);
    expect(backendAlternative(p, caps({ webgpu: false }), 'native')).toBe(F.altBrowserCpu);
  });
});

let nextPort = 19000;
const nativeSettings = () => {
  const settings = defaultSettings();
  settings.runtime = { ...settings.runtime!, backend: 'native', localServer: `http://127.0.0.1:${nextPort++}` };
  return settings;
};
const statusResponse = () => new Response(JSON.stringify({ service: 'magna-urbis-local', backend: 'rust-native', capabilities: [] }),
  { headers: { 'Content-Type': 'application/json' } });
const execution = (settings: ReturnType<typeof nativeSettings>) => ({ profile: 'local' as const, server: settings.runtime!.localServer! });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('native reachability at run start (web and desktop)', () => {
  it('chooses the browser when native is unreachable, despite an earlier online status, and preserves the recipe', async () => {
    const settings = nativeSettings(); settings.urban = { ...settings.urban, backend: 'native' };
    const preference = structuredClone(settings), fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const selected = await runtimeForRun(settings, caps({ native: true }));
    expect(selected.settings.runtime!.backend).toBe('rust');
    expect(selected.settings.urban!.backend).toBe('rust');
    expect(selected.notes).toEqual([F.engineToBrowser]);
    expect(settings).toEqual(preference);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`${settings.runtime!.localServer}/status`);
  });
  it('keeps native when reachable, despite an earlier offline status', async () => {
    const settings = nativeSettings();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(statusResponse));
    const selected = await runtimeForRun(settings, caps());
    expect(selected.settings.runtime!.backend).toBe('native');
    expect(selected.notes).toEqual([]);
    expect(settings.runtime!.backend).toBe('native');
  });
  it('deduplicates checks briefly and automatically returns to native after recovery', async () => {
    vi.useFakeTimers();
    const settings = nativeSettings(), fetch = vi.fn().mockRejectedValueOnce(new TypeError('ECONNREFUSED')).mockImplementation(statusResponse);
    vi.stubGlobal('fetch', fetch);
    const runs = await Promise.all([runtimeForRun(settings), runtimeForRun(settings)]);
    expect(runs.map(run => run.settings.runtime!.backend)).toEqual(['rust', 'rust']);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3001);
    expect((await runtimeForRun(settings)).settings.runtime!.backend).toBe('native');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(settings.runtime!.backend).toBe('native');
  });
  it('checks again when a previously reachable server goes away between runs', async () => {
    vi.useFakeTimers();
    const settings = nativeSettings(), fetch = vi.fn().mockImplementationOnce(statusResponse).mockRejectedValue(new TypeError('ECONNRESET'));
    vi.stubGlobal('fetch', fetch);
    expect((await runtimeForRun(settings)).settings.runtime!.backend).toBe('native');
    await vi.advanceTimersByTimeAsync(3001);
    expect((await runtimeForRun(settings)).settings.runtime!.backend).toBe('rust');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('moves native neural generation to browser WASM without changing the saved source', async () => {
    const settings = nativeSettings(); settings.generation = 'neural'; settings.runtime!.source = 'neural';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const selected = await runtimeForRun(settings, caps({ webgpu: false, python: true }));
    expect(selected.settings.runtime).toMatchObject({ backend: 'rust', source: 'neural-wasm' });
    expect(settings.runtime).toMatchObject({ backend: 'native', source: 'neural' });
  });
  it('does not contact native services for a browser-only run', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await runtimeForRun(defaultSettings())).notes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds a hanging startup health check', async () => {
    vi.useFakeTimers();
    const settings = nativeSettings();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    const result = runtimeForRun(settings);
    await vi.advanceTimersByTimeAsync(1501);
    expect((await result).settings.runtime!.backend).toBe('rust');
  });
  it('matches retained Rust products across execution locations but still rejects recipe changes', () => {
    const settings = nativeSettings(), browser = browserRuntimeSettings(settings);
    const key = (s: typeof settings) => JSON.stringify([s.runtime!.backend, s.runtime!.source, s.options.seed]);
    expect(matchesRustTransport(browser, key, key(settings))).toBe(true);
    expect(matchesRustTransport(settings, key, key(browser))).toBe(true);
    browser.options = { ...browser.options, seed: 'changed' };
    expect(matchesRustTransport(browser, key, key(settings))).toBe(false);
  });
});

describe('transport failures during a native stage', () => {
  it('retries a connection failure once in the browser and leaves the native preference intact', async () => {
    const settings = nativeSettings(), fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') await nativeRequest(execution(effective), '/settlements', '{}');
      return effective.runtime!.backend;
    });
    expect(await retryNativeStage(settings, stage, fallback)).toBe('rust');
    expect(stage).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({ runtime: expect.objectContaining({ backend: 'rust' }) }), F.engineToBrowser);
    expect(settings.runtime!.backend).toBe('native');
  });
  it('retries a reset while reading the native response body', async () => {
    const settings = nativeSettings();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response(new ReadableStream({
      start(stream) { stream.error(new TypeError('Connection reset')); },
    }))));
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') await (await nativeRequest(execution(effective), '/terrain', '{}')).arrayBuffer();
      return effective.runtime!.backend;
    });
    expect(await retryNativeStage(settings, stage, vi.fn())).toBe('rust');
    expect(stage).toHaveBeenCalledTimes(2);
  });
  it('retries a native request timeout in the browser', async () => {
    vi.useFakeTimers();
    const settings = nativeSettings();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') await nativeFetch(execution(effective), '/terrain', {}, 100);
      return effective.runtime!.backend;
    });
    const result = retryNativeStage(settings, stage, vi.fn());
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toBe('rust');
    expect(stage).toHaveBeenCalledTimes(2);
  });
  it.each([200, 500])('keeps JSON engine errors visible (HTTP %s), including transport-like error text', async status => {
    const settings = nativeSettings(), fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response(JSON.stringify({ error: 'TypeError: Failed to fetch' }),
      { status, headers: { 'Content-Type': 'application/json' } })));
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend !== 'native') return 'browser';
      const result = await (await nativeRequest(execution(effective), '/settlements', '{}')).json() as { error: string };
      throw new Error(result.error);
    });
    await expect(retryNativeStage(settings, stage, fallback)).rejects.toThrow('TypeError: Failed to fetch');
    expect(stage).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('keeps malformed JSON visible rather than treating it as a connection failure', async () => {
    const settings = nativeSettings(), fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('{invalid json')));
    const stage = vi.fn(async (effective: typeof settings) => (await nativeRequest(execution(effective), '/settlements', '{}')).json());
    await expect(retryNativeStage(settings, stage, fallback)).rejects.toBeInstanceOf(SyntaxError);
    expect(stage).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('does not retry a failed browser retry', async () => {
    const settings = nativeSettings(), fallback = vi.fn();
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') throw new NativeConnectionError(settings.runtime!.localServer!);
      throw new Error('Browser stage failed');
    });
    await expect(retryNativeStage(settings, stage, fallback)).rejects.toThrow('Browser stage failed');
    expect(stage).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it('preserves explicit cancellation instead of retrying it in the browser', async () => {
    const settings = nativeSettings(), fallback = vi.fn(), controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    const stage = vi.fn(async () => nativeFetch(execution(settings), '/terrain', { signal: controller.signal }));
    const result = retryNativeStage(settings, stage, fallback);
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(stage).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
});
