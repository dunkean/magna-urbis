import { encodeSurfaceBinary } from './binary';
import { compileSurfaceWorld, retargetSurfaceWorld } from './compiler';
import { generateSurfaceCandidates } from './population';
import type { SurfaceWorld } from './model';
import { SURFACE_WORKER_PROTOCOL, assertSurfaceWorkerRouting, surfaceWorkerBounds,
  type PreparedSurfaceWorkerSource, type SurfaceWorkerInit, type SurfaceWorkerJob, type SurfaceWorkerPacket,
  type SurfaceWorkerRequest, type SurfaceWorkerResponse } from './workerProtocol';

/** Synchronous work belongs inside a dedicated Worker. Terminating the Worker interrupts every phase, including binary encoding. */
export function createSurfaceWorkerProcessor(prepare: (payload: unknown) => PreparedSurfaceWorkerSource) {
  let session: SurfaceWorkerInit | undefined, prepared: PreparedSurfaceWorkerSource | undefined;
  let canonical: SurfaceWorld | undefined, canonicalBuildCount = 0;
  const packetFor = (job: SurfaceWorkerJob): SurfaceWorkerPacket => {
    if (!session || !prepared || session.sessionId !== job.sessionId || session.sourceEpoch !== job.sourceEpoch || session.sceneEpoch !== job.sceneEpoch) throw new DOMException('Stale surface source or scene epoch', 'AbortError');
    const bounds = surfaceWorkerBounds(job.region), input = prepared.input, t = input.terrain, half = t.spacingM / 2;
    const footprint = { minX: t.originX - half, minZ: t.originZ - half, maxX: t.originX + (t.width - .5) * t.spacingM, maxZ: t.originZ + (t.height - .5) * t.spacingM };
    if (bounds.minX < footprint.minX || bounds.minZ < footprint.minZ || bounds.maxX > footprint.maxX || bounds.maxZ > footprint.maxZ) throw new RangeError('Live request extends outside the retained world context');
    if (!canonical || canonical.terrain.source.id !== job.terrain.source.id || canonical.terrain.source.version !== job.terrain.source.version) {
      const original = input.terrain.source;
      if (!prepared.registeredSourceBinding && (original.id !== job.terrain.source.id || original.version !== job.terrain.source.version)) throw new Error('Surface worker refinement differs from the registered source identity/version');
      const source = { ...original, id: job.terrain.source.id, version: job.terrain.source.version,
        provenance: `${original.provenance ?? ''}; registered retained field lineage=${job.terrain.source.id}` };
      canonical = compileSurfaceWorld({ ...input, terrain: { ...input.terrain, source } }, { ...prepared.compileOptions, memoryBudgetBytes: job.memoryBudgetBytes ?? prepared.compileOptions?.memoryBudgetBytes });
      canonicalBuildCount++;
    }
    const world = retargetSurfaceWorld(canonical, job.terrain, { memoryBudgetBytes: job.memoryBudgetBytes });
    const b = world.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, radius = Math.min(240, job.region.extent / 2);
    const candidateBounds = { minX: Math.max(b.minX, cx - radius), maxX: Math.min(b.maxX, cx + radius), minZ: Math.max(b.minZ, cz - radius), maxZ: Math.min(b.maxZ, cz + radius) };
    const candidates = generateSurfaceCandidates(world, candidateBounds, { maxCandidates: job.maxCandidates ?? 100000, maxCheckedSlots: job.maxCheckedSlots });
    const contextId = world.canonicalContextRef!.id;
    return { format: 'magna-surface-packet', version: 1,
      world: { ...world, canonicalContext: job.region.knownContextId === contextId ? undefined : world.canonicalContext },
      urban: prepared.urban ?? {}, candidates, candidateBounds,
      source: { ...prepared.sourceMetadata, originalSource: input.terrain.source, live: true, provider: prepared.providerId,
        canonicalContextId: contextId, sourceEpoch: job.sourceEpoch, sceneEpoch: job.sceneEpoch, request: { ...job.region } } };
  };
  return {
    /** Object result is exposed only for explicit synchronous Node/offline compatibility. */
    packetFor,
    handle(message: SurfaceWorkerRequest): SurfaceWorkerResponse {
      try {
        assertSurfaceWorkerRouting(message);
        if (message.kind === 'initialize') {
          const next = prepare(message.payload);
          prepared = next; session = message; canonical = undefined; canonicalBuildCount = 0;
          return { protocol: SURFACE_WORKER_PROTOCOL, kind: 'initialized', sessionId: message.sessionId, sourceEpoch: message.sourceEpoch, sceneEpoch: message.sceneEpoch };
        }
        if (message.kind !== 'compile' || !Number.isSafeInteger(message.requestId) || message.requestId < 1) throw new Error('Invalid surface worker job');
        const packet = packetFor(message), bytes = encodeSurfaceBinary(packet, { maxBytes: message.binaryBudgetBytes ?? 256 * 1024 * 1024 });
        return { protocol: SURFACE_WORKER_PROTOCOL, kind: 'compiled', sessionId: message.sessionId, sourceEpoch: message.sourceEpoch,
          sceneEpoch: message.sceneEpoch, requestId: message.requestId, binary: bytes.buffer as ArrayBuffer,
          contextId: packet.world.canonicalContextRef!.id, environmentVersion: packet.world.versions.environment, canonicalBuildCount };
      } catch (error) {
        return { protocol: SURFACE_WORKER_PROTOCOL, kind: 'error', sessionId: message.sessionId, sourceEpoch: message.sourceEpoch,
          sceneEpoch: message.sceneEpoch, requestId: message.kind === 'compile' ? message.requestId : undefined,
          error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } };
      }
    },
  };
}
