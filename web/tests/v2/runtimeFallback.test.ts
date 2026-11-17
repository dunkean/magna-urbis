import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { backendAlternative, backendFailure, browserRuntimeSettings, nativeOrigin, normalizeRuntime, fallbackRuntime, isSelectedNativeServer, matchesRustTransport, retryNativeStage, runtimeChoiceStates, runtimeForRun, runtimeNeedsProbe, runtimeValues, RuntimeFallbackState, setRuntimeChoice, F } from '../../src/v2/runtimeChoices';
import { nativeFetch, NativeConnectionError, onNativeConnectionFailure } from '../../../rust/bridge/nativeAvailability';
import { detectPlatform, resolveCompute, runtimeOptions, runtimeWorkerOptions } from '../../src/v2/platform';
import { nativeRequest } from '../../../rust/bridge/nativeEngine';
import { assertNeuralCompute } from '../../src/v2/neuralExecution';

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
  delete settings.runtime.autoBackend; // explicit Native override
  return settings;
};
const statusResponse = () => new Response(JSON.stringify({ service: 'magna-urbis-local', backend: 'rust-native', capabilities: [] }),
  { headers: { 'Content-Type': 'application/json' } });
const execution = (settings: ReturnType<typeof nativeSettings>) => ({ profile: 'local' as const, server: settings.runtime!.localServer! });

const local = { hostname: 'localhost', protocol: 'http:', search: '?profile=local' };
beforeEach(() => { vi.stubGlobal('window', { location: local }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('native reachability at run start (web and desktop)', () => {
  it('chooses the browser when native is unreachable, despite an earlier online status, and preserves the recipe', async () => {
    const settings = nativeSettings(); settings.urban = { ...settings.urban, backend: 'native' };
    const preference = structuredClone(settings), fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const selected = await runtimeForRun(settings, caps({ native: true }));
    expect(selected.settings.runtime!.backend).toBe('rust');
    expect(selected.settings.urban!.backend).toBe('rust');
    expect(selected.notes).toEqual([]);
    expect(selected.nativeOffline).toBe(true);
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
    const settings = defaultSettings(); delete settings.runtime!.autoBackend;
    expect((await runtimeForRun(settings)).notes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not probe a native city override when running browser terrain', async () => {
    const settings = defaultSettings(); delete settings.runtime!.autoBackend; settings.urban = { backend: 'native' };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const selected = await runtimeForRun(settings, caps(), 'terrain');
    expect(selected.notes).toEqual([]);
    expect(selected.settings.runtime!.backend).toBe('rust');
    expect(selected.settings.urban!.backend).toBe('native');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rechecks a cached offline result immediately when the next run requests native', async () => {
    const settings = nativeSettings(), fetch = vi.fn().mockRejectedValueOnce(new TypeError('ECONNREFUSED')).mockImplementation(statusResponse);
    vi.stubGlobal('fetch', fetch);
    expect((await runtimeForRun(settings)).notes).toEqual([]);
    const recovered = await runtimeForRun(settings, caps());
    expect(recovered.settings.runtime!.backend).toBe('native');
    expect(recovered.notes).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
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

describe('fallback notices and Settings preferences', () => {
  it('does not label unprobed optional services as offline or disable their choices', async () => {
    const settings = defaultSettings(), capabilities = { ...caps(), servicesChecked: false };
    delete settings.runtime!.autoBackend;
    settings.generation = 'neural'; settings.runtime!.source = 'neural-python';
    const selected = await runtimeForRun(settings, capabilities);
    expect(selected.notes).toEqual([]);
    expect(selected.settings.runtime!.source).toBe('neural-python');
    expect(runtimeChoiceStates(settings, capabilities).engine.native.enabled).toBe(true);
    expect(runtimeChoiceStates(settings, capabilities).neural.python.enabled).toBe(true);
  });
  it('browser selected with WebGPU and missing optional services produces no native notice', async () => {
    const settings = defaultSettings(), state = new RuntimeFallbackState(), notice = vi.fn(), fetch = vi.fn();
    settings.runtime!.compute = 'gpu'; delete settings.runtime!.autoBackend; vi.stubGlobal('fetch', fetch);
    const selected = await runtimeForRun(settings, caps());
    if (state.update(settings, selected.settings)) notice();
    expect(selected.notes).toEqual([]);
    expect(notice).not.toHaveBeenCalled();
    expect(state.status(settings)).toBeUndefined();
    expect(runtimeValues(settings)).toMatchObject({ engine: 'rust', compute: 'gpu' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('native selected and reachable produces no notice, including before capabilities are checked', async () => {
    const settings = nativeSettings(), state = new RuntimeFallbackState(), notice = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(statusResponse));
    expect(state.status(settings)).toBeUndefined();
    const selected = await runtimeForRun(settings, { ...caps(), checked: false });
    if (state.update(settings, selected.settings)) notice();
    expect(selected.notes).toEqual([]);
    expect(notice).not.toHaveBeenCalled();
    expect(state.status(settings)).toBeUndefined();
    expect(runtimeValues(settings).engine).toBe('native');
  });
  it('automatic engine: native unreachable moves every run to the browser silently, shows a Settings status, and returns to native on recovery', async () => {
    const settings = nativeSettings(), preference = structuredClone(settings), state = new RuntimeFallbackState();
    const fetch = vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')); vi.stubGlobal('fetch', fetch);
    settings.urban = { ...settings.urban, backend: 'native' }; preference.urban = { ...settings.urban };
    for (const action of ['terrain', 'region', 'towns']) {
      const selected = await runtimeForRun(settings, caps(), action);
      expect(selected.notes).toEqual([]);
      expect(selected.nativeOffline).toBe(true);
      expect(selected.settings.runtime!.backend).toBe('rust');
      state.update(settings, selected.settings);
      expect(runtimeValues(settings).engine).toBe('native');
      expect(state.status(settings)).toBe(F.runningInBrowser);
      expect(settings).toEqual(preference);
    }
    fetch.mockImplementation(statusResponse);
    const recovered = await runtimeForRun(settings, caps());
    expect(recovered).toMatchObject({ notes: [], nativeOffline: false });
    expect(recovered.settings.runtime!.backend).toBe('native');
    state.update(settings, recovered.settings);
    expect(state.status(settings)).toBeUndefined();
  });
  it('an explicit browser choice changes the Settings selection and clears the fallback status', () => {
    const settings = nativeSettings(), state = new RuntimeFallbackState();
    state.update(settings, browserRuntimeSettings(settings));
    setRuntimeChoice(settings, 'engine', 'rust');
    expect(runtimeValues(settings).engine).toBe('rust');
    expect(state.status(settings)).toBeUndefined();
    expect(state.update(settings, settings)).toBe(false);
  });
});

describe('web and local execution policy', () => {
  const dev = { hostname: 'localhost', protocol: 'http:', search: '' };
  const published = { hostname: 'example.github.io', protocol: 'https:', search: '' };
  const automatic = () => { const settings = defaultSettings(); settings.runtime!.localServer = `http://127.0.0.1:${nextPort++}`; return settings; };
  it('requires the local profile or desktop, including on loopback origins', () => {
    expect(runtimeValues(defaultSettings()).engine).toBe('auto');
    expect(nativeOrigin(dev)).toBe(false);
    expect(nativeOrigin({ ...dev, hostname: '127.0.0.1' })).toBe(false);
    expect(nativeOrigin(published)).toBe(false);
    expect(nativeOrigin(local)).toBe(true);
    expect(nativeOrigin({ ...dev, hostname: 'tauri.localhost' })).toBe(true);
    vi.stubGlobal('window', { location: dev, __TAURI_INTERNALS__: {} });
    expect(nativeOrigin()).toBe(true);
    expect(runtimeOptions().profile).toBe('local');
  });
  it.each([true, false])('web Automatic uses WebGPU when available, otherwise CPU (WebGPU=%s)', async webgpu => {
    vi.stubGlobal('window', { location: dev });
    const settings = automatic(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const selected = await runtimeForRun(settings, caps({ webgpu }), 'all');
    expect(selected).toMatchObject({ notes: [], nativeOffline: false });
    expect(selected.settings.runtime).toMatchObject({ backend: 'rust', compute: 'auto' });
    expect(resolveCompute(selected.settings.runtime!.compute, { webgpu }).compute).toBe(webgpu ? 'gpu' : 'cpu');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([dev, published])('silently normalizes restored native engines, neural sources and overrides on $hostname', async location => {
    vi.stubGlobal('window', { location });
    const settings = nativeSettings(); settings.generation = 'neural'; settings.runtime!.source = 'neural';
    settings.urban = { backend: 'native' }; settings.terrain!.generationCompute = 'native' as never;
    const saved = structuredClone(settings), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(runtimeNeedsProbe(settings, caps())).toBe(false);
    const selected = await runtimeForRun(settings, caps({ native: true, python: true }), 'all');
    expect(selected).toMatchObject({ notes: [], nativeOffline: false });
    expect(selected.settings.runtime).toMatchObject({ backend: 'rust', source: 'neural-wasm' });
    expect(selected.settings.urban!.backend).toBe('rust');
    expect(selected.settings.terrain!.generationCompute).toBeUndefined();
    expect(settings).toEqual(saved);
    expect(normalizeRuntime(settings).runtime).toMatchObject({ backend: 'rust', source: 'neural-wasm' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('web choices are WebGPU and CPU and never fall back to Python automatically', () => {
    vi.stubGlobal('window', { location: dev });
    const settings = automatic();
    setRuntimeChoice(settings, 'engine', 'gpu');
    expect(runtimeValues(settings)).toMatchObject({ engine: 'gpu', compute: 'gpu' });
    setRuntimeChoice(settings, 'engine', 'cpu');
    expect(runtimeValues(settings)).toMatchObject({ engine: 'cpu', compute: 'cpu' });
    setRuntimeChoice(settings, 'engine', 'auto');
    expect(runtimeValues(settings)).toMatchObject({ engine: 'auto', compute: 'auto' });
    settings.generation = 'neural'; settings.runtime!.source = 'neural-wasm';
    expect(fallbackRuntime(settings, caps({ webgpu: false, python: true }))).toEqual([]);
    expect(settings.runtime!.source).toBe('neural-wasm');
    expect(runtimeChoiceStates(settings, { ...caps(), servicesChecked: false }).engine.native.enabled).toBe(false);
    setRuntimeChoice(settings, 'neural', 'python');
    expect(settings.runtime!.source).toBe('neural-python');
  });
  it.each([true, false])('web engine choice offers Automatic, WebGPU and CPU; explicit CPU neural is kept and refused (WebGPU=%s)', async webgpu => {
    vi.stubGlobal('window', { location: dev }); vi.stubGlobal('fetch', vi.fn());
    const settings = automatic(); settings.generation = 'neural'; normalizeRuntime(settings);
    const engine = runtimeChoiceStates(settings, caps({ webgpu })).engine;
    expect(engine.auto.enabled).toBe(true);
    expect(engine.gpu).toEqual(webgpu ? { enabled: true } : { enabled: false, reason: expect.stringMatching(/WebGPU/) });
    expect(engine.cpu).toMatchObject({ enabled: true, reason: expect.stringMatching(/GPU/) });
    expect(runtimeChoiceStates(defaultSettings(), caps({ webgpu })).engine.cpu).toEqual({ enabled: true });
    setRuntimeChoice(settings, 'engine', 'cpu');
    expect(runtimeValues(settings)).toMatchObject({ engine: 'cpu', compute: 'cpu' });
    expect(settings.runtime).not.toHaveProperty('autoBackend');
    const selected = await runtimeForRun(settings, caps({ webgpu }), 'terrain');
    expect(selected.settings.runtime).toMatchObject({ backend: 'rust', compute: 'cpu', source: 'neural-wasm' });
    expect(() => assertNeuralCompute(true, selected.settings.runtime!.compute)).toThrow(/WebGPU/);
  });
  it('web hardware inspection never probes native services or unconfigured Python', async () => {
    vi.stubGlobal('window', { location: dev });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const selected = await detectPlatform();
    expect(selected.local.available).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(runtimeWorkerOptions({ name: 'engine threads=off' }).name).toBe('engine threads=off profile=web');
  });
  it('local Automatic uses reachable native, while neural remains browser WebGPU', async () => {
    const settings = automatic(); settings.generation = 'neural';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(statusResponse));
    const selected = await runtimeForRun(settings, caps(), 'all', local);
    expect(selected).toMatchObject({ notes: [], nativeOffline: false });
    expect(selected.settings.runtime).toMatchObject({ backend: 'native', source: 'neural-wasm' });
    expect(runtimeWorkerOptions().name).toContain('profile=local');
    setRuntimeChoice(settings, 'engine', 'native');
    expect(settings.runtime!.source).toBe('neural');
  });
  it.each([
    [{ python: true }, 'neural-python'], [{ python: false }, 'neural-wasm'], [{ python: true, nativeNeural: true }, 'neural'],
  ] as const)('local native engine: neural source follows the probed services %o, the engine stays native', async (services, source) => {
    const settings = nativeSettings(); settings.generation = 'neural'; settings.runtime!.source = 'neural';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(statusResponse));
    const selected = await runtimeForRun(settings, { ...caps({ native: true }), ...services }, 'all', local);
    expect(selected.settings.runtime).toMatchObject({ backend: 'native', source });
    expect(selected.nativeOffline).toBe(false);
    // The worker normalizes again: the chosen source survives with the native engine.
    expect(normalizeRuntime(structuredClone(selected.settings), local).runtime).toMatchObject({ backend: 'native', source });
  });
  it.each([true, false])('local probe of the native neural service drives the Automatic neural source (answers=%s)', async answers => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('http://127.0.0.1:8792/')) { if (!answers) throw new TypeError('ECONNREFUSED'); return new Response(JSON.stringify({ service: 'magna-urbis-neural' })); }
      if (url.startsWith('http://127.0.0.1:8793/')) return new Response(JSON.stringify({ backend: 'python-cuda', loaded: false }));
      return statusResponse();
    });
    vi.stubGlobal('fetch', fetch);
    const platform = await detectPlatform({ profile: 'local', probePython: true });
    expect(platform.nativeNeural.available).toBe(answers);
    const settings = nativeSettings(); settings.runtime!.autoBackend = true; settings.generation = 'neural'; settings.runtime!.source = 'neural-wasm';
    const selected = await runtimeForRun(settings, { checked: true, servicesChecked: true, webgpu: true, native: platform.local.available,
      python: platform.python.available, nativeNeural: platform.nativeNeural.available }, 'all', local);
    expect(selected.settings.runtime).toMatchObject({ backend: 'native', source: answers ? 'neural' : 'neural-python' });
  });
  it('Settings automatic neural never selects the unprobed native neural service', () => {
    const settings = nativeSettings(); settings.generation = 'neural'; settings.runtime!.source = 'neural';
    expect(setRuntimeChoice(settings, 'neural', 'auto', caps({ native: true, python: true })).runtime).toMatchObject({ backend: 'native', source: 'neural-wasm' });
    expect(setRuntimeChoice(settings, 'neural', 'auto', { ...caps({ native: true }), nativeNeural: true }).runtime!.source).toBe('neural');
  });
  it('local Automatic silently uses the browser when native does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')));
    const selected = await runtimeForRun(automatic(), caps(), 'all', local);
    expect(selected).toMatchObject({ notes: [], nativeOffline: true });
    expect(selected.settings.runtime!.backend).toBe('rust');
  });
  it('workers preserve the local profile without relying on their bundled script URL', () => {
    vi.stubGlobal('window', undefined); vi.stubGlobal('name', 'engine threads=off profile=local');
    expect(runtimeOptions().profile).toBe('local');
    expect(normalizeRuntime(nativeSettings()).runtime!.backend).toBe('native');
  });
});

describe('transport failures during a native stage', () => {
  it('optional service failures do not report the selected native engine as offline', async () => {
    const settings = nativeSettings(), fallback = vi.fn();
    const optionalServer = 'http://127.0.0.1:8792';
    expect(isSelectedNativeServer(settings, optionalServer)).toBe(false);
    expect(isSelectedNativeServer(settings, settings.runtime!.localServer!)).toBe(true);
    const stage = vi.fn().mockRejectedValue(new NativeConnectionError(optionalServer));
    await expect(retryNativeStage(settings, stage, fallback)).rejects.toMatchObject({ server: optionalServer });
    expect(stage).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('does not retry a browser-selected stage on a native transport marker', async () => {
    const fallback = vi.fn(), stage = vi.fn().mockRejectedValue(new NativeConnectionError('http://127.0.0.1:8791'));
    await expect(retryNativeStage(defaultSettings(), stage, fallback)).rejects.toBeInstanceOf(NativeConnectionError);
    expect(stage).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('retries a connection failure once in the browser and leaves the native preference intact', async () => {
    vi.useFakeTimers();
    const settings = nativeSettings(), fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') await nativeRequest(execution(effective), '/settlements', '{}');
      return effective.runtime!.backend;
    });
    const result = retryNativeStage(settings, stage, fallback);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toBe('rust');
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
  it('a page stalled past the health timeout still sees a reply that arrived (no false offline notice)', async () => {
    const settings = nativeSettings();
    // Real timers: the page blocks after sending /status, so the timeout is overdue when the reply's task runs.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const end = Date.now() + 300; while (Date.now() < end) { /* synchronous WASM/render work */ }
      return new Promise((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        setImmediate(() => resolve(statusResponse()));
      });
    }));
    const response = await nativeFetch(execution(settings), '/status', {}, 100);
    expect((await response.json()).backend).toBe('rust-native');
  });
  it.each(['/terrain/stage', '/urban'])('absorbs an engine restart on %s: waits for /status, resends once, stays native', async path => {
    vi.useFakeTimers();
    const settings = nativeSettings(), fallback = vi.fn(), restartedAt = Date.now() + 3000;
    let refused = true;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/status')) { if (Date.now() < restartedAt) throw new TypeError('ECONNREFUSED'); return statusResponse(); }
      if (refused) { refused = false; throw new TypeError('ECONNRESET'); }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') await (await nativeRequest(execution(effective), path, '{}')).json();
      return effective.runtime!.backend;
    });
    const result = retryNativeStage(settings, stage, fallback);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe('native');
    expect(fallback).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith(path))).toHaveLength(2);
  });
  it('falls back silently to the browser when the engine does not come back within the wait', async () => {
    vi.useFakeTimers();
    const settings = nativeSettings(), fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')));
    const stage = vi.fn(async (effective: typeof settings) => {
      if (effective.runtime!.backend === 'native') await nativeRequest(execution(effective), '/terrain/stage', '{}');
      return effective.runtime!.backend;
    });
    const result = retryNativeStage(settings, stage, fallback);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toBe('rust');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it('(a) a failed status probe never marks the engine down or notifies running actions', async () => {
    const settings = nativeSettings(), listener = vi.fn(), stop = onNativeConnectionFailure(listener);
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetch);
    await expect(nativeFetch(execution(settings), '/status', {}, 1500, false)).rejects.toBeInstanceOf(NativeConnectionError);
    stop();
    expect(listener).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('(b) a request on a stale kept-alive socket is resent at once and stays native, without notifying', async () => {
    const settings = nativeSettings(), listener = vi.fn(), stop = onNativeConnectionFailure(listener);
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('ERR_CONNECTION_RESET')).mockImplementation(() => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    const response = await nativeFetch(execution(settings), '/urban', { method: 'POST', body: '{}' });
    stop();
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/urban', '/urban']);
    expect(listener).not.toHaveBeenCalled();
  });
  it('(c) a broken reply body is a stage failure, not an engine-down signal', async () => {
    const settings = nativeSettings(), listener = vi.fn(), stop = onNativeConnectionFailure(listener);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError('network error')); } }))));
    const response = await nativeFetch(execution(settings), '/urban', { method: 'POST', body: '{}' });
    await expect(response.text()).rejects.toBeInstanceOf(NativeConnectionError);
    stop();
    expect(listener).not.toHaveBeenCalled();
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
