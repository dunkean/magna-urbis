import { describe, expect, it, vi } from 'vitest';
import { decodeSurfaceBinary, encodeSurfaceBinary, isSurfaceBinary } from '../src/surface/binary';
import { hydrateSurfaceWorld } from '../src/surface/compiler';
import { unpackCandidateColumns } from '../src/surface/candidateColumns';
import { validateSurfacePacket } from '../src/surface/packet';
import type { TerrainGrid } from '../src/surface/model';
import { SurfaceCompilerClient, type SurfaceCompilerWorker } from '../src/surface/workerClient';
import { createSurfaceWorkerProcessor } from '../src/surface/workerProcessor';
import { SURFACE_WORKER_PROTOCOL, type PreparedSurfaceWorkerSource, type SurfaceWorkerInitialization, type SurfaceWorkerJob, type SurfaceWorkerPacket, type SurfaceWorkerRequest, type SurfaceWorkerResponse } from '../src/surface/workerProtocol';

function terrain(n = 9, spacing = 10): TerrainGrid {
  return { width: n, height: n, originX: spacing / 2, originZ: spacing / 2, spacingM: spacing,
    heights: new Float32Array(n * n).fill(100), source: { id: 'source', version: 'generation-1', sourceLOD: -3, sourceLODKnown: true, nativeSpacingM: spacing } };
}
function source(): PreparedSurfaceWorkerSource { return { input: { seed: 1, terrain: terrain() }, providerId: 'provider', urban: { buildings: [] }, sourceMetadata: { label: 'worker fixture' } }; }
function initialization(): SurfaceWorkerInitialization { return { sourceEpoch: 'source-epoch-1', sceneEpoch: 'scene-epoch-1', payload: source() }; }
function job(id = 1): SurfaceWorkerJob { return { kind: 'compile', protocol: SURFACE_WORKER_PROTOCOL, requestId: id, sessionId: 'session', sourceEpoch: 'source-epoch-1', sceneEpoch: 'scene-epoch-1',
  terrain: terrain(18, 5), region: { x: 0, y: 0, extent: 90, resolution: 18 } }; }
const initialize = { kind: 'initialize' as const, protocol: SURFACE_WORKER_PROTOCOL, sessionId: 'session', ...initialization() };

class TestWorker implements SurfaceCompilerWorker {
  onmessage: SurfaceCompilerWorker['onmessage'] = null;
  onerror: SurfaceCompilerWorker['onerror'] = null;
  terminated = false;
  messages: SurfaceWorkerRequest[] = [];
  transfers: Transferable[][] = [];
  readonly processor = createSurfaceWorkerProcessor(value => value as PreparedSurfaceWorkerSource);
  postMessage(message: SurfaceWorkerRequest, transfer: Transferable[] = []): void {
    if (this.terminated) throw new Error('Worker is terminated');
    this.transfers.push(transfer);
    this.messages.push(structuredClone(message, { transfer }));
  }
  terminate(): void { this.terminated = true; }
  run(): void {
    while (this.messages.length && !this.terminated) {
      const response = this.processor.handle(this.messages.shift()!);
      const transferred = structuredClone(response, { transfer: response.kind === 'compiled' ? [response.binary] : [] });
      this.onmessage?.({ data: transferred } as MessageEvent<SurfaceWorkerResponse>);
    }
  }
}

describe('surface compiler worker protocol', () => {
  it('publishes complete canonical tree pages outside a tiny fine source without extruding its edge height',()=>{
    const retained=source();retained.input.terrain=terrain(51,80);
    const processor=createSurfaceWorkerProcessor(value=>value as PreparedSurfaceWorkerSource);
    expect(processor.handle({...initialize,payload:retained}).kind).toBe('initialized');
    const request=job();request.region={x:1980,y:1980,extent:40,resolution:64};
    request.terrain={...terrain(64,.625),originX:1980.3125,originZ:1980.3125,heights:new Float32Array(4096).fill(900)};
    const result=processor.handle(request);expect(result.kind).toBe('compiled');if(result.kind!=='compiled')throw new Error(JSON.stringify(result));
    const packet=decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(result.binary));
    expect(packet.candidatePages?.tree).toMatchObject({complete:true,limitedBy:'none',bounds:{minX:1760,minZ:1760,maxX:2240,maxZ:2240}});
    expect(packet.candidateBounds).toEqual({minX:1980,minZ:1980,maxX:2020,maxZ:2020});
    const trees=unpackCandidateColumns(packet.candidateColumns!).filter(c=>c.family==='tree');
    const outside=trees.filter(c=>c.x<1980.3125||c.x>2019.6875||c.z<1980.3125||c.z>2019.6875);
    expect(outside.length).toBeGreaterThan(100);expect(outside.every(c=>c.y===100)).toBe(true);
    expect(packet.candidatePages?.support.parentSampleCount).toBeGreaterThan(100);
    packet.candidatePages!.support.canonicalContextId='stale-context';
    expect(()=>validateSurfacePacket(packet)).toThrow(/context\/source/);
  });
  it('keeps canonical context cached between normal jobs and transfers binary context once', () => {
    const processor = createSurfaceWorkerProcessor(value => value as PreparedSurfaceWorkerSource);
    expect(processor.handle(initialize).kind).toBe('initialized');
    const first = processor.handle(job()); expect(first.kind).toBe('compiled');
    if (first.kind !== 'compiled') throw new Error('expected compile');
    const packet = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(first.binary));
    expect(packet.world.canonicalContext).toBeDefined(); expect(first.canonicalBuildCount).toBe(1);
    const next = job(2); next.terrain = terrain(30, 3); next.region.knownContextId = first.contextId;
    const second = processor.handle(next); expect(second.kind).toBe('compiled');
    if (second.kind !== 'compiled') throw new Error('expected compile');
    const fine = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(second.binary));
    expect(second.canonicalBuildCount).toBe(1); expect(second.contextId).toBe(first.contextId);
    expect(second.environmentVersion).toBe(first.environmentVersion); expect(fine.world.canonicalContext).toBeUndefined();
    expect(fine.world.canonicalContextRef).toEqual(packet.world.canonicalContextRef);
    expect(hydrateSurfaceWorld(packet.world).fields.sand).toBeInstanceOf(Float32Array);
  });

  it('rejects stale scene/source epochs and source mismatches before accepting a compile', () => {
    const processor = createSurfaceWorkerProcessor(value => value as PreparedSurfaceWorkerSource); processor.handle(initialize);
    expect(processor.handle({ ...job(), sourceEpoch: 'stale' })).toMatchObject({ kind: 'error', error: { name: 'AbortError' } });
    expect(processor.handle({ ...job(), sceneEpoch: 'stale' })).toMatchObject({ kind: 'error', error: { name: 'AbortError' } });
    const different = job(); different.terrain.source.version = 'different';
    expect(processor.handle(different)).toMatchObject({ kind: 'error', error: { message: expect.stringContaining('registered source') } });
  });

  it('surfaces preparation/encoding errors as routed protocol errors', () => {
    const broken = createSurfaceWorkerProcessor(() => { throw new Error('invalid retained source'); });
    expect(broken.handle(initialize)).toMatchObject({ kind: 'error', sourceEpoch: 'source-epoch-1', error: { message: 'invalid retained source' } });
    const processor = createSurfaceWorkerProcessor(value => value as PreparedSurfaceWorkerSource); processor.handle(initialize);
    expect(processor.handle({ ...job(), binaryBudgetBytes: 1 })).toMatchObject({ kind: 'error', requestId: 1 });
  });
});

describe('interruptible surface compiler client', () => {
  it('uses one worker for normal jobs and preserves retained buffers while transferring only fine copies', async () => {
    const workers: TestWorker[] = [], init = initialization();
    const client = new SurfaceCompilerClient(init, () => { const w = new TestWorker(); workers.push(w); return w; });
    const firstJob = job(), original = firstJob.terrain.heights;
    const first = client.compile(firstJob); workers[0].run(); const result = await first;
    expect(isSurfaceBinary(new Uint8Array(result.binary))).toBe(true); expect(result.canonicalBuildCount).toBe(1);
    expect(original.byteLength).toBe(18 * 18 * 4);
    expect((init.payload as PreparedSurfaceWorkerSource).input.terrain.heights.byteLength).toBe(9 * 9 * 4);
    expect(workers[0].transfers[0]).toHaveLength(0); expect(workers[0].transfers[1]).toHaveLength(1);
    const next = client.compile({ ...job(2), region: { ...job().region, knownContextId: result.contextId } }); workers[0].run();
    expect((await next).canonicalBuildCount).toBe(1); expect(workers).toHaveLength(1); expect(workers[0].terminated).toBe(false);
    client.dispose(); expect(workers[0].terminated).toBe(true);
  });

  it('rejects aborted output but finishes the durable canonical build for the next request', async () => {
    const workers: TestWorker[] = [], client = new SurfaceCompilerClient(initialization(), () => { const w = new TestWorker(); workers.push(w); return w; });
    const aborter = new AbortController(), pending = client.compile(job(), aborter.signal).catch(error => error);
    aborter.abort(); expect(workers[0].terminated).toBe(false); expect(await pending).toMatchObject({ name: 'AbortError' });
    const next = client.compile(job(2)); expect(workers).toHaveLength(1);
    workers[0].run(); expect((await next).canonicalBuildCount).toBe(1); client.dispose();
  });

  it('coalesces five requests during the initial build and publishes only the latest result', async () => {
    const workers: TestWorker[] = [], client = new SurfaceCompilerClient(initialization(), () => { const w = new TestWorker(); workers.push(w); return w; });
    vi.useFakeTimers();
    try {
      const obsolete: Promise<unknown>[] = [];
      for (let i = 1; i < 5; i++) { obsolete.push(client.compile(job(i)).catch(error => error)); vi.advanceTimersByTime(200); }
      const latest = client.compile(job(5));
      expect(workers).toHaveLength(1); expect(workers[0].messages).toHaveLength(2);
      workers[0].run(); expect((await latest).canonicalBuildCount).toBe(1);
      for (const result of await Promise.all(obsolete)) expect(result).toMatchObject({ name: 'AbortError' });
      expect(workers[0].terminated).toBe(false);
    } finally { client.dispose(); vi.useRealTimers(); }
  });

  it('retains the canonical cache after a routed validation error and bounds cancellation grace', async () => {
    const workers: TestWorker[] = [], client = new SurfaceCompilerClient(initialization(), () => { const w = new TestWorker(); workers.push(w); return w; }, 100);
    const invalid = client.compile({ ...job(), binaryBudgetBytes: 1 }).catch(error => error); workers[0].run();
    expect(await invalid).toMatchObject({ name: 'RangeError' }); expect(workers[0].terminated).toBe(false);
    const next = client.compile(job(2)); workers[0].run(); expect((await next).canonicalBuildCount).toBe(1);
    vi.useFakeTimers();
    try {
      const pending = client.compile(job(3)).catch(error => error); client.cancel();
      expect(await pending).toMatchObject({ name: 'AbortError' });
      vi.advanceTimersByTime(101); expect(workers[0].terminated).toBe(true);
    } finally { client.dispose(); vi.useRealTimers(); }
  });

  it('invalidates scene epochs, rejects pre-cancelled work without creating a worker, and propagates current crashes', async () => {
    const workers: TestWorker[] = [], client = new SurfaceCompilerClient(initialization(), () => { const w = new TestWorker(); workers.push(w); return w; });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(client.compile(job(), cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(workers).toHaveLength(0);
    const first = client.compile(job()).catch(error => error);
    client.invalidate({ ...initialization(), sceneEpoch: 'scene-epoch-2' }); expect(workers[0].terminated).toBe(true); expect(await first).toMatchObject({ name: 'AbortError' });
    const next = client.compile(job(2)).catch(error => error); expect(workers[1].messages[0].sceneEpoch).toBe('scene-epoch-2');
    workers[1].onerror!({ message: 'current worker crash' } as ErrorEvent);
    expect(await next).toMatchObject({ message: 'current worker crash' }); expect(workers[1].terminated).toBe(true);
    client.dispose(); await expect(client.compile(job(3))).rejects.toThrow(/disposed/);
  });
});
