import { describe, expect, it } from 'vitest';
import { decodeSurfaceBinary, encodeSurfaceBinary, isSurfaceBinary } from '../src/surface/binary';
import { hydrateSurfaceWorld } from '../src/surface/compiler';
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

  it('physically terminates aborted work and reinitializes source/context for the next request', async () => {
    const workers: TestWorker[] = [], client = new SurfaceCompilerClient(initialization(), () => { const w = new TestWorker(); workers.push(w); return w; });
    const aborter = new AbortController(), pending = client.compile(job(), aborter.signal).catch(error => error);
    aborter.abort(); expect(workers[0].terminated).toBe(true); expect(await pending).toMatchObject({ name: 'AbortError' });
    const next = client.compile(job(2)); expect(workers).toHaveLength(2); expect(workers[1].messages[0].kind).toBe('initialize');
    workers[1].run(); expect((await next).canonicalBuildCount).toBe(1); client.dispose();
  });

  it('terminates superseded jobs and ignores their queued success/error callbacks', async () => {
    const workers: TestWorker[] = [], client = new SurfaceCompilerClient(initialization(), () => { const w = new TestWorker(); workers.push(w); return w; });
    const first = client.compile(job()).catch(error => error), staleMessage = workers[0].onmessage!, staleError = workers[0].onerror!;
    const oldJob = workers[0].messages[1] as SurfaceWorkerJob;
    const second = client.compile(job(2)); expect(workers[0].terminated).toBe(true);
    const bytes = encodeSurfaceBinary({ stale: true });
    staleMessage({ data: { ...oldJob, kind: 'compiled', binary: bytes.buffer as ArrayBuffer, contextId: 'stale', environmentVersion: 'stale', canonicalBuildCount: 1 } } as MessageEvent<SurfaceWorkerResponse>);
    staleError({ message: 'old worker crash' } as ErrorEvent);
    workers[1].run(); expect((await second).contextId).not.toBe('stale'); expect(await first).toMatchObject({ name: 'AbortError' }); client.dispose();
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
