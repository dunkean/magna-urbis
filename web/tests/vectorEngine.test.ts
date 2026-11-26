import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Engine = typeof import('../src/render/vectorEngine');
let engine: Engine,
  clock = 0;
beforeEach(async () => {
  vi.resetModules();
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  engine = await import('../src/render/vectorEngine');
});
afterEach(() => vi.restoreAllMocks());
const gpuTiles = (n: number, record: number, raster: number, synced = true): void => {
  for (let i = 0; i < n; i++) engine.noteGpuTile(record, raster, synced);
};
const cpuTiles = (n: number, ms: number): void => {
  for (let i = 0; i < n; i++) engine.noteCpuTile(ms);
};
const demoted = (): string | undefined => engine.vectorEngineStats().demoted;

describe('vector engine policy', () => {
  it('notifies tile policy changes after the running paint can be cancelled', async () => {
    let notified = 0;
    const paint = (function* () {
      gpuTiles(8, 10, 60);
      yield;
    })();
    const off = engine.onVectorEngineChange(() => {
      notified++;
      paint.return();
    });
    expect(() => paint.next()).not.toThrow();
    expect(notified).toBe(0);
    expect(demoted()).toMatch(/slow GPU tiles/);
    await Promise.resolve();
    expect(notified).toBe(1);
    expect(paint.next().done).toBe(true);
    off();
  });
  it('coalesces tile failure and promotion notifications without delaying the engine decision', async () => {
    const listener = vi.fn();
    const off = engine.onVectorEngineChange(listener);
    gpuTiles(8, 10, 60);
    cpuTiles(8, 100);
    expect(demoted()).toBeUndefined();
    engine.noteGpuFailure(new Error('context lost'));
    expect(demoted()).toBe('context lost');
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
  it('counts only the replays that waited for the graphics process', () => {
    gpuTiles(40, 10, 500, false);
    expect(demoted()).toBeUndefined();
    gpuTiles(7, 10, 60);
    expect(demoted()).toBeUndefined();
    gpuTiles(1, 10, 60);
    expect(demoted()).toMatch(/slow GPU tiles \(median 60 ms\)/);
  });
  it('gives the map back to the GPU when the processor is not faster, and does not try it again', () => {
    gpuTiles(8, 10, 60);
    cpuTiles(7, 100);
    expect(demoted()).toBeDefined();
    cpuTiles(1, 100);
    expect(demoted()).toBeUndefined();
    // GPU tiles of 70 ms against processor tiles of 100 ms: no new trial.
    gpuTiles(16, 10, 60);
    expect(demoted()).toBeUndefined();
    // Far slower than the processor was: a new trial.
    gpuTiles(8, 10, 400);
    expect(demoted()).toMatch(/slow GPU tiles/);
  });
  it('keeps the processor when it wins, then tries the GPU again after a while, with a longer wait each time', () => {
    gpuTiles(8, 10, 60);
    cpuTiles(8, 12);
    expect(demoted()).toBeDefined();
    clock += 29000;
    cpuTiles(1, 12);
    expect(demoted()).toBeDefined();
    clock += 2000;
    cpuTiles(1, 12);
    expect(demoted()).toBeUndefined();
    // Second trial lost by the GPU: the wait doubles.
    gpuTiles(8, 10, 60);
    cpuTiles(8, 12);
    clock += 45000;
    cpuTiles(1, 12);
    expect(demoted()).toBeDefined();
    clock += 20000;
    cpuTiles(1, 12);
    expect(demoted()).toBeUndefined();
  });
  it('gives the map back as soon as the processor tiles stop being faster', () => {
    // Light tiles first (a view at rest), then a heavy style: the comparison follows the last tiles.
    gpuTiles(8, 10, 60);
    cpuTiles(8, 12);
    expect(demoted()).toBeDefined();
    cpuTiles(3, 300);
    expect(demoted()).toBeDefined();
    cpuTiles(2, 300);
    expect(demoted()).toBeUndefined();
    // The GPU is then judged against those heavy processor tiles.
    gpuTiles(16, 10, 150);
    expect(demoted()).toBeUndefined();
  });
  it('keeps the processor for the page after a failure, also during a trial', () => {
    gpuTiles(8, 10, 60);
    engine.noteGpuFailure(new Error('context lost'));
    expect(demoted()).toBe('context lost');
    cpuTiles(20, 500);
    clock += 600000;
    cpuTiles(2, 500);
    expect(demoted()).toBe('context lost');
  });
  it('warns about a forced choice that is wrong for the machine, never on auto', async () => {
    const raster = { software: true, lost: false, renderer: 'test' };
    vi.resetModules();
    vi.doMock('../src/render/gpu/tileRasterizer', () => ({ sharedGpuRasterizer: () => raster }));
    vi.stubGlobal('document', {});
    try {
      const policy = await import('../src/render/vectorEngine');
      expect(policy.vectorEngineWarning()).toBeUndefined();
      policy.setVectorEnginePreference('gpu');
      expect(policy.vectorEngineWarning()).toBe('gpu-software');
      raster.software = false;
      expect(policy.vectorEngineWarning()).toBeUndefined();
      policy.setVectorEnginePreference('cpu');
      expect(policy.vectorEngineWarning()).toBe('cpu-forced');
      policy.setVectorEnginePreference('auto');
      expect(policy.vectorEngineWarning()).toBeUndefined();
    } finally {
      vi.doUnmock('../src/render/gpu/tileRasterizer');
      vi.unstubAllGlobals();
      delete (globalThis as unknown as Record<string, unknown>).__muVectorEngine;
    }
  });
});
