import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, loopbackServer, resolveCompute, runtimeOptions } from '../src/v2/platform';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('V2 execution capability boundaries', () => {
  it('does not contact local services in the full web version', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', {});
    const caps = await detectPlatform({ profile: 'web' });
    expect(fetch).not.toHaveBeenCalled(); expect(caps.cpu).toBe(true); expect(caps.webgpu).toBe(false);
    expect(caps.local.available).toBe(false); expect(caps.python.available).toBe(false);
  });
  it('requires successful adapter and device creation before advertising GPU', async () => {
    const destroy = vi.fn();
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({ destroy }), info: { description: 'Test GPU' } }) } });
    const caps = await detectPlatform({ profile: 'web' });
    expect(caps.webgpu).toBe(true); expect(caps.adapterName).toBe('Test GPU'); expect(destroy).toHaveBeenCalledOnce();
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => { throw Error('device rejected'); } }) } });
    expect((await detectPlatform({ profile: 'web' })).webgpu).toBe(false);
  });
  it('validates Rust and Python identities and preserves model loading state', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('8791')
      ? { service: 'magna-urbis-local', backend: 'rust-native', capabilities: ['urban.programme', 42] }
      : { backend: 'python-cuda', loaded: false, state: 'loading', message: 'Chargement des poids CUDA' } })));
    const events: unknown[] = [];
    const caps = await detectPlatform({ profile: 'local', onProgress: value => events.push(value) });
    expect(caps.local.available).toBe(true); expect(caps.local.capabilities).toEqual(['urban.programme']);
    expect(caps.python.available).toBe(true); expect(caps.python.loaded).toBe(false); expect(caps.python.backend).toBe('python-cuda');
    expect(events).toContainEqual({ phase: 'loading', source: 'python', message: 'Chargement des poids CUDA' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ backend: 'unrelated' }) })));
    const invalid = await detectPlatform({ profile: 'local' });
    expect(invalid.local.available).toBe(false); expect(invalid.python.available).toBe(false);
  });
  it('does not silently turn a forced GPU request into CPU', () => {
    expect(resolveCompute('auto', { webgpu: false })).toEqual({ compute: 'cpu', reason: 'WebGPU indisponible · repli CPU' });
    expect(() => resolveCompute('gpu', { webgpu: false })).toThrow('WebGPU indisponible');
    expect(resolveCompute('cpu', { webgpu: true })).toEqual({ compute: 'cpu' });
    expect(resolveCompute('auto', { webgpu: true })).toEqual({ compute: 'gpu' });
  });
  it('keeps runtime addresses outside project data and restricts services to loopback', () => {
    expect(runtimeOptions({ hostname: 'localhost', search: '' }).profile).toBe('web');
    expect(runtimeOptions({ hostname: 'tauri.localhost', search: '?profile=local&localServer=http://127.0.0.1:2345' }).localServer).toBe('http://127.0.0.1:2345');
    expect(loopbackServer('http://localhost:8791')).toBe('http://localhost:8791');
    for (const value of ['https://localhost:8791', 'http://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'http://localhost:8791/x', 'http://localhost:8791/?x=1']) expect(() => loopbackServer(value)).toThrow();
  });
});
