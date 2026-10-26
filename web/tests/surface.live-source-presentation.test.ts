import { describe, expect, it } from 'vitest';
import type { Decor } from '../src/ui/decor';
import type { TerrainProvider } from '../src/surface/provider';
import type { PreparedSurfaceWorkerSource, SurfaceWorkerPacket } from '../src/surface/workerProtocol';
import { SURFACE_WORKER_PROTOCOL } from '../src/surface/workerProtocol';
import { createSurfaceWorkerProcessor } from '../src/surface/workerProcessor';
import { prepareSurfaceDecorWorkerSource } from '../src/ui/surfaceWorkerSource';
import { createSurfaceLiveBinarySession } from '../src/ui/surfaceLiveSession';
import { decodeSurfaceBinary, encodeSurfaceBinary } from '../src/surface/binary';
import { restoreSurfaceSource } from '../src/surface/adapters/sourceArchive';
import { magnaSurfacePresentation } from '../src/surface/presentation';

function fixture(): Decor {
  const n = 8, heights = new Float32Array(n * n).fill(100);
  return { meta: { format: 'magna-decor', version: 1, id: 'source-style-archive', label: 'authored archive regression',
    tags: {}, seed: '42', width: 80, query: 'style=parchment&sourceMemo=' + 'x'.repeat(4000), created: '2026-10-24',
    settlements: [], roads: null, roadConfig: null, waterSvg: '<svg>' + 'retained-source-only'.repeat(1000) + '</svg>',
    stats: { land: 1, minHeight: 100, maxHeight: 100, riverKm: 0, roadKm: 0 } },
    raster: { n, width: 80, height: heights, water: new Uint8Array(n * n), waterLevel: heights.slice(),
      riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n),
      geometry: { land: [], water: [[[{ x: 22, y: 22 }, { x: 28, y: 22 }, { x: 28, y: 28 }, { x: 22, y: 28 }]]] } },
  } as Decor;
}
function provider(source: PreparedSurfaceWorkerSource): TerrainProvider {
  return { id: 'archive-fixture-provider', async request(request) {
    const width = Math.round((request.bounds.maxX - request.bounds.minX) / request.spacingM);
    return { width, height: width, originX: request.bounds.minX + request.spacingM / 2,
      originZ: request.bounds.minZ + request.spacingM / 2, spacingM: request.spacingM,
      heights: new Float32Array(width ** 2).fill(101), source: { ...source.input.terrain.source } };
  } };
}
const region = { x: 20, y: 20, extent: 40, resolution: 16 };
function expectedRestored(prepared: PreparedSurfaceWorkerSource, packet: SurfaceWorkerPacket) {
  const restored = { ...packet.source, ...restoreSurfaceSource(prepared.sourceMetadata!) };
  delete restored.$surfaceSourceArchive;
  // MUFSURF1 omits optional undefined metadata keys (for example an absent
  // registrationBinding); preserve the actual wire types/values otherwise.
  return decodeSurfaceBinary(encodeSurfaceBinary(restored));
}
describe('live mapper presentation remains outside original-source archive slots', () => {
  it('restores the complete binary live source while preserving a different per-job mapper style', async () => {
    const decor = fixture(), original = structuredClone(decor);
    const prepared = prepareSurfaceDecorWorkerSource({ decor, providerId: 'archive-fixture-provider' });
    // This is the actual decor adapter/archive threshold, not a hand-edited slot.
    expect(prepared.sourceMetadata!.presentation).toBeNull();
    const archive = prepared.sourceMetadata!.$surfaceSourceArchive;
    expect(archive).toMatchObject({ attachments: expect.arrayContaining([expect.objectContaining({ path: ['presentation'], encoding: 'json-utf8' })]) });
    const job = magnaSurfacePresentation('style=blueprint', 'cartographic');
    const session = createSurfaceLiveBinarySession(decor, undefined, provider(prepared), () => true,
      { execution: 'synchronous-node', presentation: () => job });
    try {
      const packet = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session(region, new AbortController().signal)));
      expect(packet.presentation).toStrictEqual(job);
      expect(packet.source.presentation).toBeNull();
      expect(packet.source.$surfaceSourceArchive).toStrictEqual(archive);
      const restored = restoreSurfaceSource(packet.source);
      expect(restored).toStrictEqual(expectedRestored(prepared, packet));
      expect(restored.presentation).toStrictEqual(magnaSurfacePresentation(decor.meta.query));
      expect(restored.meta).toStrictEqual(decor.meta);
      expect(restored.geometry).toStrictEqual(decor.raster.geometry);
      expect((restored.water as any).classes).toStrictEqual(decor.raster.water);
      expect((restored.water as any).levelM).toStrictEqual(decor.raster.waterLevel);
      expect(decor).toStrictEqual(original);
    } finally { session.dispose(); }
  });
  it('changes only packet.presentation across jobs, including the known-scene source merge', async () => {
    const decor = fixture(), prepared = prepareSurfaceDecorWorkerSource({ decor, providerId: 'archive-fixture-provider' });
    let presentation = magnaSurfacePresentation('style=blueprint');
    const session = createSurfaceLiveBinarySession(decor, undefined, provider(prepared), () => true,
      { execution: 'synchronous-node', presentation: () => presentation });
    try {
      const signal = new AbortController().signal;
      const first = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session(region, signal)));
      presentation = magnaSurfacePresentation('style=parchment', 'cartographic');
      const second = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session(region, signal)));
      const { presentation: _firstStyle, ...firstData } = first, { presentation: _secondStyle, ...secondData } = second;
      // All terrain, context, IDs, candidate/support columns, geometry, archive
      // bytes and source metadata are byte-identical; only the display job differs.
      expect(encodeSurfaceBinary(secondData)).toStrictEqual(encodeSurfaceBinary(firstData));
      expect(second.presentation).toStrictEqual(presentation);
      const compact = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session({ ...region,
        knownContextId: first.world.canonicalContextRef!.id, knownSceneContextId: first.source.sceneContextId as string }, signal)));
      expect(compact.source).not.toHaveProperty('presentation');
      expect(compact.source).not.toHaveProperty('$surfaceSourceArchive');
      expect(compact.presentation).toStrictEqual(presentation);
      expect(restoreSurfaceSource({ ...first.source, ...compact.source })).toStrictEqual(expectedRestored(prepared, compact));
    } finally { session.dispose(); }
  });
  it('retains the authored default even when that presentation was archived and no per-job override exists', async () => {
    const decor = fixture(), prepared = prepareSurfaceDecorWorkerSource({ decor, providerId: 'archive-fixture-provider' });
    const session = createSurfaceLiveBinarySession(decor, undefined, provider(prepared), () => true, { execution: 'synchronous-node' });
    try {
      const packet = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session(region, new AbortController().signal)));
      expect(packet.presentation).toStrictEqual(magnaSurfacePresentation(decor.meta.query));
      expect(() => restoreSurfaceSource(packet.source)).not.toThrow();
    } finally { session.dispose(); }
  });
  it('preserves an unarchived source presentation and keeps rejecting historical overwritten archive slots', () => {
    const decor = fixture(), prepared = prepareSurfaceDecorWorkerSource({ decor, providerId: 'archive-fixture-provider' });
    const opaqueSourcePresentation = { format: 'native-editor-private-presentation', opaque: 'keep-source-value' };
    const direct: PreparedSurfaceWorkerSource = { ...prepared, sourceMetadata: { presentation: opaqueSourcePresentation } };
    const processor = createSurfaceWorkerProcessor(() => direct);
    const epochs = { protocol: SURFACE_WORKER_PROTOCOL, sessionId: 'source-slot-test', sourceEpoch: 's', sceneEpoch: 'scene' };
    expect(processor.handle({ ...epochs, kind: 'initialize', payload: null }).kind).toBe('initialized');
    const packet = processor.packetFor({ ...epochs, kind: 'compile', requestId: 1, region, terrain: {
      ...prepared.input.terrain, width: 16, height: 16, originX: 21.25, originZ: 21.25, spacingM: 2.5,
      heights: new Float32Array(256).fill(101) }, presentation: magnaSurfacePresentation('style=blueprint') });
    expect(packet.source.presentation).toStrictEqual(opaqueSourcePresentation);
    expect(packet.presentation?.mapStyle).toBe('blueprint');
    const historical = { ...prepared.sourceMetadata, presentation: packet.presentation };
    expect(() => restoreSurfaceSource(historical)).toThrow('Source attachment target is not an empty slot');
    expect(() => restoreSurfaceSource({ ...historical, presentation: false })).toThrow('Source attachment target is not an empty slot');
  });
});
