import { afterEach, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { beginUrbanBuildingStage, importUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { downloadColdBuildings } from '../src/ui/urbanColdDownloads';
import { ColdTestBackend } from './helpers/urbanBuildingColdTestBackend';

afterEach(() => vi.unstubAllGlobals());
it('opens the picker synchronously and streams every exact chunk plus city transform metadata', async () => {
  const backend = new ColdTestBackend(), stage = await beginUrbanBuildingStage(backend, { sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (const chunk of fixture.chunks) await stage.append(await archivePlanBatch(chunk.delta as unknown as PlacementBatch), chunk.progress);
  const manifest = await stage.commit(), parts: Uint8Array[] = [], close = vi.fn();
  const picker = vi.fn(async () => ({ createWritable: async () => ({ write: async (part: Uint8Array) => { parts.push(part); }, close }) }));
  vi.stubGlobal('window', { showSaveFilePicker: picker });
  const task = downloadColdBuildings(Promise.resolve(backend), { store: { format: manifest.format, sceneId: manifest.sceneId,
    fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
  counts: { schema_version: '1', generator_version: manifest.generator_version, buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces },
  cityKey: 'city', offset: { x: 42, y: -9 } });
  expect(picker).toHaveBeenCalledTimes(1); await task; expect(close).toHaveBeenCalledTimes(1);
  expect(parts).toHaveLength(5); const first = JSON.parse(new TextDecoder().decode(parts[0]));
  expect(first.city).toEqual({ format: 'native-city-transform-1', cityKey: 'city', offset: { x: 42, y: -9 } });
  const independent = new ColdTestBackend();
  const restored = await importUrbanBuildingChunks(independent, (async function* () { yield* parts; })());
  expect(restored.fingerprint).toBe(manifest.fingerprint);
  for (let i = 0; i < 3; i++) expect(await independent.chunk(restored.sceneId, i)).toEqual(await backend.chunk(manifest.sceneId, i));
});
it('consumes backend failure even when the user cancels the picker before storage is awaited', async () => {
  const abort = new DOMException('cancelled', 'AbortError');
  vi.stubGlobal('window', { showSaveFilePicker: vi.fn(async () => { throw abort; }) });
  await expect(downloadColdBuildings(Promise.reject(new Error('Database unavailable')), {
    store: { format: 'urban-building-chunks-1', sceneId: 'unused', fingerprint: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64) },
    counts: { schema_version: '1', generator_version: 'plans', buildings: 0, refusals: 0, open_spaces: 0 },
  })).rejects.toBe(abort);
  await new Promise<void>(resolve => setImmediate(resolve));
});
