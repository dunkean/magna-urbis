import { describe, expect, it } from 'vitest';
import { createSurfaceWorkerProcessor } from '../src/surface/workerProcessor';
import { SURFACE_WORKER_PROTOCOL, type PreparedSurfaceWorkerSource, type SurfaceWorkerJob, type SurfaceWorkerPacket } from '../src/surface/workerProtocol';
import { archiveSurfaceSource, restoreSurfaceSource } from '../src/surface/adapters/sourceArchive';
import { encodeSurfaceBinary, decodeSurfaceBinary } from '../src/surface/binary';
import { magnaSurfacePresentation } from '../src/surface/presentation';

const authored = magnaSurfacePresentation('style=parchment'), override = magnaSurfacePresentation('style=blueprint', 'cartographic');
function fixture(sourceMetadata: Record<string, unknown>, presentation = authored) {
  const prepared: PreparedSurfaceWorkerSource = { input: { seed: 7, terrain: { width: 9, height: 9, originX: 5, originZ: 5,
    spacingM: 10, heights: new Float32Array(81).fill(100), source: { id: 'authored-source', version: '1', sourceLOD: 0, nativeSpacingM: 10 } } },
    providerId: 'authored-provider', sourceMetadata, presentation, urban: { authoredScene: true }, urbanId: 'authored-opaque-scene' };
  const processor = createSurfaceWorkerProcessor(() => prepared);
  const epochs = { protocol: SURFACE_WORKER_PROTOCOL, sessionId: 'review', sourceEpoch: 'source-1', sceneEpoch: 'scene-1' };
  const initialized = processor.handle({ ...epochs, kind: 'initialize', payload: null });
  if(initialized.kind !== 'initialized') throw Error(JSON.stringify(initialized));
  const job: SurfaceWorkerJob = { ...epochs, kind: 'compile', requestId: 1, region: { x: 20, y: 20, extent: 40, resolution: 8 },
    terrain: { ...prepared.input.terrain, width: 8, height: 8, spacingM: 5, originX: 22.5, originZ: 22.5, heights: new Float32Array(64).fill(101) } };
  const wire = (request: SurfaceWorkerJob) => {
    const response = processor.handle(request); expect(response.kind).toBe('compiled');
    if (response.kind !== 'compiled') throw Error(JSON.stringify(response));
    return decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(response.binary));
  };
  return { prepared, processor, job, wire };
}
function withoutStyle(packet: SurfaceWorkerPacket) { const { presentation: _, ...rest } = packet; return encodeSurfaceBinary(rest); }

describe('independent source-presentation archive review', () => {
  it('keeps nested attachment parents and typed opaque source values while job styles change independently', () => {
    const original = { presentation: { editor: 'private-layout', memo: 'source-only'.repeat(1800), typed: new Uint16Array([4, 65535]) },
      geometry: { water: 'original-source-outline' }, record: new Float64Array([1, -0, 1e9]) };
    const source = archiveSurfaceSource(original), snapshot = structuredClone(source);
    expect(source.$surfaceSourceArchive?.attachments.some(a => JSON.stringify(a.path) === JSON.stringify(['presentation', 'memo']))).toBe(true);
    const { prepared, job, wire } = fixture(source);
    const first = wire(job), changed = wire({ ...job, requestId: 2, presentation: override });
    expect(first.presentation).toStrictEqual(authored); expect(changed.presentation).toStrictEqual(override);
    expect(withoutStyle(changed)).toStrictEqual(withoutStyle(first));
    for (const packet of [first, changed]) {
      const restored = restoreSurfaceSource(packet.source);
      for (const key of Object.keys(original)) expect(restored[key]).toStrictEqual(original[key as keyof typeof original]);
      expect(packet.source.presentation).toStrictEqual(source.presentation);
      expect(packet.source.$surfaceSourceArchive).toStrictEqual(source.$surfaceSourceArchive);
      expect(packet.source.compilation).toStrictEqual({ canonicalBuildCount: 1 });
    }
    expect(prepared.sourceMetadata).toStrictEqual(snapshot);
    expect(original.presentation.memo).toBe('source-only'.repeat(1800));
  });

  it('retains legacy valid source-style fallback in full, matching compact and unmatched scene handshakes', () => {
    const oldStyle = magnaSurfacePresentation('style=blueprint'), source = { presentation: oldStyle, provenance: { sourceRecord: 'legacy-adapter' } };
    const { prepared, job, wire } = fixture(source);
    delete prepared.presentation;
    const first = wire(job);
    expect(first.presentation).toStrictEqual(oldStyle);
    const compact = wire({ ...job, requestId: 2, region: { ...job.region, knownContextId: first.world.canonicalContextRef!.id, knownSceneContextId: first.source.sceneContextId as string } });
    expect(compact.presentation).toStrictEqual(oldStyle);
    expect(compact.source).not.toHaveProperty('presentation'); expect(compact.source).not.toHaveProperty('provenance');
    const joined = restoreSurfaceSource({ ...first.source, ...compact.source });
    expect(joined.presentation).toStrictEqual(oldStyle); expect(joined.provenance).toStrictEqual(source.provenance);
    const unknown = wire({ ...job, requestId: 3, region: { ...job.region, knownContextId: first.world.canonicalContextRef!.id, knownSceneContextId: 'different-scene' } });
    expect(unknown.source.presentation).toStrictEqual(oldStyle); expect(unknown.source.provenance).toStrictEqual(source.provenance);
    expect(unknown.urban).toStrictEqual(prepared.urban);
    expect(unknown.world.id).toBe(first.world.id); expect(unknown.world.versions).toStrictEqual(first.world.versions);
  });

  it('preserves null slots in compact joins and never repairs occupied historical targets', () => {
    const original = { presentation: { memo: 'source-large'.repeat(400) }, raw: { notes: 'water-original'.repeat(900) } };
    const source = archiveSurfaceSource(original), { job, wire } = fixture(source);
    expect(source.presentation).toBeNull();
    const first = wire({ ...job, presentation: override });
    const compact = wire({ ...job, requestId: 2, region: { ...job.region, knownContextId: first.world.canonicalContextRef!.id, knownSceneContextId: first.source.sceneContextId as string } });
    expect(compact.presentation).toStrictEqual(authored); // Default survives a prior override.
    const joined = restoreSurfaceSource({ ...first.source, ...compact.source });
    expect(joined.presentation).toStrictEqual(original.presentation); expect(joined.raw).toStrictEqual(original.raw);
    for (const occupied of [override, false, 0, '', undefined]) expect(() => restoreSurfaceSource({ ...source, presentation: occupied })).toThrow('Source attachment target is not an empty slot');
    expect(() => restoreSurfaceSource(compact.source)).not.toThrow(); // Deliberately partial; no invented original source.
    expect(restoreSurfaceSource(compact.source)).not.toHaveProperty('raw');
  });
});
