import { afterEach, describe, expect, it, vi } from 'vitest';
import { wasmThreadCount, wasmWorkerFailed, wasmWorkerOptions } from '../../rust/bridge/wasmThreads';

describe('WASM worker fallback', () => {
  it('starts later workers on the single-thread package after a worker death and records why', () => {
    expect(wasmWorkerOptions('magna-v2').name).toBe('magna-v2 threads=auto');
    wasmWorkerFailed('Module terminated');
    expect(wasmWorkerOptions('magna-v2').name).toBe('magna-v2 threads=off');
    const info = (globalThis as { magnaWasmThreads?: { mode: string; reason?: string } }).magnaWasmThreads;
    expect(info?.mode).toBe('single');
    expect(info?.reason).toContain('Module terminated');
  });
});

describe('remembered Rayon startup failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries a transient timeout on a later visit and retains the fallback for a broken package', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k), setItem: (k: string, v: string) => saved.set(k, v) });
    const visit = async () => {
      vi.resetModules();
      return import('../../rust/bridge/wasmThreads');
    };
    const first = await visit();
    first.publishWasmThreads({ setting: 'auto', mode: 'single', threads: 1, reason: 'threads package failed to start: rayon pool of 4 workers did not start within 15 s' });
    expect((await visit()).wasmWorkerOptions().name).toContain('threads=off');
    vi.mocked(Date.now).mockReturnValue(now + 11 * 60_000);
    expect(first.wasmWorkerOptions().name).toContain('threads=off');
    const later = await visit();
    expect(later.wasmWorkerOptions().name).toContain('threads=auto');
    later.publishWasmThreads({ setting: 'auto', mode: 'single', threads: 1, reason: 'threads package failed to start: invalid module' });
    vi.mocked(Date.now).mockReturnValue(now + 24 * 3600_000);
    expect((await visit()).wasmWorkerOptions().name).toContain('threads=off');
  });
});

describe('wasmThreadCount', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps a desktop at cores - 1 and a handheld at min(4, cores - 2), fewer on a 4 GB device', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 });
    expect(wasmThreadCount(false)).toBe(7);
    expect(wasmThreadCount(true)).toBe(4);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 4 });
    expect(wasmThreadCount(false)).toBe(3);
    expect(wasmThreadCount(true)).toBe(2);
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    expect(wasmThreadCount(true)).toBe(1);
  });
});
