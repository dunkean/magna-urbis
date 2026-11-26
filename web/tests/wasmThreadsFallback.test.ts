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
