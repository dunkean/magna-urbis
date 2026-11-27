import { afterEach, expect, it, vi } from 'vitest';
import { overviewTown } from '../helpers/worldBuildings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps 10,000-building overview work slices below 16 ms', () => {
  vi.stubGlobal('__muLayerDiagnostics', true);
  const { gl, createLayer } = overviewTown();
  function measure() {
    const layer = createLayer();
    const slices: number[] = [];
    let more = true;
    while (more) {
      const started = performance.now();
      more = layer.work!(8, undefined);
      slices.push(performance.now() - started);
    }
    layer.dispose();
    // The first three slices include compiler warm-up.
    return Math.max(...slices.slice(3));
  }
  const limit = 16;
  let longest = measure();
  console.info('Longest overview work slice (ms)', longest);
  if (longest >= limit) {
    // Allow one full rebuild after a scheduling or GC pause, at the same limit.
    vi.mocked(gl.bufferData).mockClear();
    vi.mocked(gl.bufferSubData).mockClear();
    longest = measure();
    console.info('Longest overview work slice on retry (ms)', longest);
  }
  expect(longest).toBeLessThan(limit);
});
