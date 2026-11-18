import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDesktopNeuralServer, desktopNeuralModelsReady } from '../../src/v2/desktopNeural';
import { translate } from '../../src/v2/i18n';

afterEach(() => vi.unstubAllGlobals());
const server = 'http://127.0.0.1:8792';

describe('desktop native neural startup', () => {
  it('checks model availability without starting inference or downloading anything', async () => {
    const invoke = vi.fn().mockResolvedValue({ models: [{ present: true }, { present: true }, { present: true }] });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    expect(await desktopNeuralModelsReady()).toBe(true);
    invoke.mockResolvedValue({ models: [{ present: true }, { present: false }, { present: true }] });
    expect(await desktopNeuralModelsReady()).toBe(false);
    invoke.mockRejectedValue(new Error('Unavailable'));
    expect(await desktopNeuralModelsReady()).toBe(false);
    expect(invoke.mock.calls.every(([command]) => command === 'desktop_neural_status')).toBe(true);
  });
  it('leaves web generation and its existing errors to the worker', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await ensureDesktopNeuralServer(server, vi.fn())).toBe(server);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a reachable configured service without invoking Tauri', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ service: 'magna-urbis-neural', profile: 'coarse4-nf4-b75-t2-decoder' }) }));
    expect(await ensureDesktopNeuralServer(server, vi.fn())).toBe(server);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('starts on an unreachable endpoint and sends the returned dynamic port to generation', async () => {
    const invoke = vi.fn().mockResolvedValue('http://127.0.0.1:49152');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const progress = vi.fn();
    expect(await ensureDesktopNeuralServer(server, progress)).toBe('http://127.0.0.1:49152');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ensure_neural');
    expect(progress).toHaveBeenCalledWith('Starting the neural service…');
    expect(translate('Starting the neural service…', 'fr')).toBe('Démarrage du service neuronal…');
  });
  it('supports the public Tauri API and reports startup errors', async () => {
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: vi.fn().mockRejectedValue('Missing weights') } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(ensureDesktopNeuralServer(server, vi.fn())).rejects.toThrow('Could not start the neural service: Missing weights');
  });
  it('does not reuse an unrelated service returning HTTP 200', async () => {
    const invoke = vi.fn().mockResolvedValue('http://127.0.0.1:49152');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ service: 'other' }) }));
    expect(await ensureDesktopNeuralServer(server, vi.fn())).toBe('http://127.0.0.1:49152');
    expect(invoke).toHaveBeenCalledWith('ensure_neural');
  });
});
