import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUrbanPool, ranges, type PoolMessage } from '../../rust/bridge/urbanPool';
import type { SettlementRaster } from '../../rust/bridge/settlements';

/** Fake pool worker: answers jobs asynchronously, in a scrambled order. */
function fakeWorkers(behaviour: (message: Extract<PoolMessage, { type: 'job' }>) => { json?: string; error?: string }) {
  const seen: PoolMessage[][] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: unknown;
    received: PoolMessage[] = [];
    constructor() { seen.push(this.received); }
    postMessage(message: PoolMessage) {
      this.received.push(message);
      if (message.type !== 'job') return;
      setTimeout(() => this.onmessage?.({ data: { id: message.id, ...behaviour(message) } }), Math.random() * 5);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  return seen;
}
const raster = { width: 1, n: 1, height: new Float32Array(1), water: new Uint8Array(1), waterLevel: new Float32Array(1), riverWidth: new Float32Array(1), riverIds: new Int32Array(1) } as SettlementRaster;
const slice = (a: Record<string, string | undefined>) => `[${a.start}-${a.end}]`;

afterEach(() => { vi.unstubAllGlobals(); });

describe('urban worker pool', () => {
  it('splits into contiguous non-empty ranges', () => {
    expect(ranges(10, 3)).toEqual([[0, 3], [3, 6], [6, 10]]);
    expect(ranges(2, 8)).toEqual([[0, 1], [1, 2]]);
    expect(ranges(0, 4)).toEqual([]);
  });

  it('merges pool and local slices in job order and sends context once per worker', async () => {
    const seen = fakeWorkers(m => ({ json: slice(m.args) }));
    const pool = createUrbanPool(4, {} as WebAssembly.Module);
    pool.setRaster(raster);
    const jobs = ranges(100, 12).map(([a, b]) => ({ start: String(a), end: String(b) }));
    const local = vi.fn(slice);
    const out = await pool.run('sites', jobs, { seed: 's' }, local);
    expect(out).toEqual(jobs.map(slice));
    expect(local).toHaveBeenCalled();
    for (const messages of seen) {
      expect(messages[0].type).toBe('init');
      expect(messages.filter(m => m.type === 'raster')).toHaveLength(1);
      expect(messages.filter(m => m.type === 'job' && m.shared)).toHaveLength(messages.some(m => m.type === 'job') ? 1 : 0);
    }
    pool.dispose();
  });

  it('re-runs failed pool slices locally and rejects with the first serial error', async () => {
    fakeWorkers(() => ({ error: 'worker lost its terrain' }));
    const pool = createUrbanPool(3, {} as WebAssembly.Module);
    pool.setRaster(raster);
    const jobs = ranges(30, 6).map(([a, b]) => ({ start: String(a), end: String(b) }));
    expect(await pool.run('sites', jobs, {}, slice)).toEqual(jobs.map(slice));
    const failing = (a: Record<string, string | undefined>) => { if (Number(a.start) >= 10) throw `bad site ${a.start}`; return slice(a); };
    await expect(pool.run('sites', jobs, {}, failing)).rejects.toBe('bad site 10');
  });
});
