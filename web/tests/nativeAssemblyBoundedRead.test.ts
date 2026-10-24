import { expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage } from '../src/ui/urbanBuildingChunkStore';
import { readBoundedAssemblyNeighbors } from '../src/ui/nativeAssemblyNeighbors';
import { ColdTestBackend } from './helpers/urbanBuildingColdTestBackend';
import { DerivedTestBackend } from './helpers/urbanDerivedTestBackend';
import { openDerivedCache, type DerivedBackend } from '../src/ui/urbanBuildingDerivedCache';
async function setup(cache: 'hit' | 'miss' = 'miss') {
  // The full derived test backend owns BOTH the native parent stages and its
  // .derived child API. A separate backend nested in .derived has no parent.
  const backend: ColdTestBackend & { derived?: DerivedBackend } = cache === 'hit' ? new DerivedTestBackend() : new ColdTestBackend();
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'bounded-assembly',
    sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (const chunk of fixture.chunks) {
    const native: PlacementBatch = JSON.parse(JSON.stringify(chunk.delta));
    await stage.append(await archivePlanBatch(native), chunk.progress);
  }
  const m = await stage.commit(); backend.reads.length = 0;
  const child = await backend.derived?.manifest(m.sceneId);
  if (cache === 'hit') {
    expect(child).toBeDefined(); expect(child?.parentFingerprint).toBe(m.fingerprint);
    const opened = await openDerivedCache(backend, m); expect(opened.manifest.fingerprint).toBe(child!.fingerprint);
  } else expect(child).toBeUndefined();
  const state = { store: { format: m.format, sceneId: m.sceneId, fingerprint: m.fingerprint, sourceFingerprint: m.sourceFingerprint },
    counts: { schema_version: m.schema_version, generator_version: m.generator_version, buildings: m.buildings, refusals: m.refusals, open_spaces: m.openSpaces } };
  return { backend, state };
}
for (const cache of ['hit', 'miss'] as const) it(`reads only the actual neighboring native chunk with a derived cache ${cache}, never a global session/repair`, async () => {
  const { backend, state } = await setup(cache), derivedAccess = vi.fn(() => { throw new Error('Forbidden global/derived read'); });
  Object.defineProperty(backend, 'derived', { get: derivedAccess });
  const values = await readBoundedAssemblyNeighbors(backend, state, [9060, 10779, 9076, 10800]);
  expect(values).toHaveLength(1); expect(values[0].id).toBe(fixture.chunks[0].delta.buildings[0].id);
  expect(backend.reads).toEqual([0]); expect(derivedAccess).not.toHaveBeenCalled();
});
it('rejects a stale native revision before any chunk decode and never recovers by loading the city', async () => {
  const { backend, state } = await setup(); state.counts.buildings++;
  await expect(readBoundedAssemblyNeighbors(backend, state, [9060, 10779, 9076, 10800])).rejects.toThrow('révision');
  expect(backend.reads).toEqual([]);
});
