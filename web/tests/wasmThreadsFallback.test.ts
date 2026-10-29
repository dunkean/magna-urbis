import { describe, expect, it } from 'vitest';
import { wasmWorkerFailed, wasmWorkerOptions } from '../../rust/bridge/wasmThreads';

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
