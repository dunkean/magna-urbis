import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import { decodeDecor, encodeDecor, type Decor } from '../src/ui/decor';
import { readDecorFile } from '../src/ui/decorFile';
import { encodeDecorFileBytes } from '../src/ui/decorFileBytes';
import { createTerrainDecorExports } from '../src/ui/terrainDecorExport';
import { decodeRecipe, encodeRecipe } from '../src/ui/recipe';
import { portableRecipe, restoreRecipe } from '../src/ui/recipeSharing';
import { readHistory } from '../src/ui/benchHistory';
import { beginUrbanBuildingStage, type BuildingChunkManifest } from '../src/ui/urbanBuildingChunkStore';
import { ColdTestBackend, deferred } from './helpers/urbanBuildingColdTestBackend';

const history = new Map<string, { entry: { id: string }; bytes: Uint8Array }>();
let chunks: PlacementBatch[];
beforeAll(async () => {
  chunks = await Promise.all(fixture.chunks.map(chunk => archivePlanBatch(chunk.delta as unknown as PlacementBatch)));
  const db = { createObjectStore() {}, transaction() {
    const tx = { oncomplete: undefined as (() => void) | undefined, objectStore: () => ({
      get(id: string) { const request = { result: undefined as unknown }; queueMicrotask(() => { request.result = structuredClone(history.get(id)); tx.oncomplete?.(); }); return request; },
      put(record: { entry: { id: string }; bytes: Uint8Array }) { const request = { result: record.entry.id }; queueMicrotask(() => { history.set(record.entry.id, structuredClone(record)); tx.oncomplete?.(); }); return request; },
    }) }; return tx;
  } };
  vi.stubGlobal('indexedDB', { open() {
    const request = { result: db, onsuccess: undefined as (() => void) | undefined, onupgradeneeded: undefined as (() => void) | undefined };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request;
  } });
});
afterAll(() => vi.unstubAllGlobals());
async function commit(backend: ColdTestBackend, sceneId: string) {
  const stage = await beginUrbanBuildingStage(backend, { sceneId, sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  return stage.commit();
}
function decor(manifest?: BuildingChunkManifest): Decor {
  const snapshot: Decor = { raster: { n: 2, width: 160, height: new Float32Array(4).fill(30), water: new Uint8Array(4), waterLevel: new Float32Array(4).fill(30),
    riverWidth: new Float32Array(4), riverIds: new Int32Array(4), geometry: { land: [], water: [] } },
  meta: { format: 'magna-decor', version: 1, id: manifest ? 'cold-recipe-C' : 'legacy-recipe', label: 'Recipe', tags: {}, seed: 'C', width: 160,
    query: '', created: '', settlements: [], roadConfig: null, roads: null, waterSvg: '', stats: { land: 1, minHeight: 30, maxHeight: 30, riverKm: 0, roadKm: 0 } } };
  if (manifest) snapshot.meta.pipeline = { stage: 'urban', urban: {
    layouts: [{ key: 'C/site', culture: 'javanese', center: { x: 80, y: 80 }, quarters: [], streets: [], blocks: [], warnings: [] }],
    partitions: [], layoutConfig: defaultLayoutConfig(), parcelConfig: defaultParcelConfig(), quarterSeed: 'q', parcelSeed: 'p',
    buildingState: { seed: 'b', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, cold: {
      store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
      counts: { schema_version: '1', generator_version: manifest.generator_version, buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces },
      offset: { x: -120.25, y: 65.5 }, cityKey: 'C/site' } } } };
  return snapshot;
}

it('standalone MU code retains ALL real C chunks and crop offset through independent native storage and local history', async () => {
  const source = new ColdTestBackend(), manifest = await commit(source, 'source'), snapshot = decor(manifest);
  snapshot.meta.regeneration = { query: 'seed=would-regenerate', crops: [] };
  const portable = await portableRecipe('urban', 'artifact=cold-recipe-C&workshop=would-regenerate', snapshot, { backend: source });
  expect(portable.terrain).toBeUndefined(); expect(new URLSearchParams(portable.query).has('workshop')).toBe(false);
  expect(new TextDecoder().decode(portable.decor!.subarray(0, 45))).toContain('magna-cold-decor-1');
  const wire = decodeRecipe(encodeRecipe(portable)), target = new ColdTestBackend();
  const restored = await restoreRecipe(wire, undefined, { backend: target });
  const saved = await readHistory(new URLSearchParams(restored.query).get('artifact')!), cold = saved.meta.pipeline!.urban!.buildingState!.cold!;
  expect(cold.store.sceneId).not.toBe('source'); expect(cold.store.fingerprint).toBe(manifest.fingerprint);
  expect(cold.offset).toEqual({ x: -120.25, y: 65.5 }); expect(cold.cityKey).toBe('C/site');
  expect(cold.counts).toMatchObject({ buildings: 6, refusals: 3, open_spaces: 0 });
  expect(target.stages.get(cold.store.sceneId)!.chunks).toEqual(source.stages.get('source')!.chunks);
  expect(new URLSearchParams(restored.query).get('decor')).toBe(saved.meta.id);
  expect(decodeDecor(history.get(saved.meta.id)!.bytes).meta).toEqual(saved.meta); // history stores gzip metadata, not NDJSON
  expect(snapshot.meta.pipeline!.urban!.buildingState!.cold!.store.sceneId).toBe('source');
});

it('rejects a recipe/header artifact mismatch before native staging or publication', async () => {
  const source = new ColdTestBackend(), snapshot = decor(await commit(source, 'source'));
  const portable = await portableRecipe('urban', '', snapshot, { backend: source }); portable.query = 'artifact=wrong&decor=wrong';
  const target = new ColdTestBackend(); await commit(target, 'previous');
  await expect(restoreRecipe(portable, undefined, { backend: target })).rejects.toThrow('ne correspond pas');
  expect(target.activeId).toBe('previous'); expect([...target.stages.keys()]).toEqual(['previous']);
});

it('aborting a cold recipe import at its commit gate preserves the previous active generation', async () => {
  const source = new ColdTestBackend(), snapshot = decor(await commit(source, 'source'));
  const portable = await portableRecipe('urban', '', snapshot, { backend: source });
  const target = new ColdTestBackend(); await commit(target, 'previous');
  const gate = { started: deferred(), release: deferred() }; target.commitGate = gate;
  const controller = new AbortController(), importing = restoreRecipe(portable, controller.signal, { backend: target });
  const rejected = expect(importing).rejects.toMatchObject({ name: 'AbortError' });
  await gate.started.promise; controller.abort(); await rejected;
  expect(target.activeId).toBe('previous'); expect([...target.stages.keys()]).toEqual(['previous']); gate.release.resolve();
});

it('keeps legacy recipe gzip and synchronous automation identical, and offers complete async cold hooks', async () => {
  const legacy = decor(), old = encodeDecor(legacy), portable = await portableRecipe('urban', '', legacy);
  expect(portable.decor).toEqual(old);
  const restored = await restoreRecipe(decodeRecipe(encodeRecipe(portable)));
  expect((await readHistory(new URLSearchParams(restored.query).get('artifact')!)).meta).toEqual(legacy.meta);
  const legacyHooks = createTerrainDecorExports(() => legacy);
  expect(legacyHooks.capture().bytes).toEqual(old); expect((await legacyHooks.captureAsync()).bytes).toEqual(old);
  expect(legacyHooks.export('old.decor').base64).toBe(btoa(String.fromCharCode(...old)));
  const source = new ColdTestBackend(), cold = decor(await commit(source, 'source'));
  const hooks = createTerrainDecorExports(() => cold, { backend: source });
  expect(() => hooks.capture()).toThrow('captureAsync/exportAsync'); expect(() => hooks.export('cold.decor')).toThrow('captureAsync/exportAsync');
  const encoded = await hooks.exportAsync('cold.decor'), bytes = Uint8Array.from(atob(encoded.base64), c => c.charCodeAt(0));
  const target = new ColdTestBackend(), imported = await readDecorFile(new Blob([bytes]), { backend: target });
  expect(imported.meta.pipeline!.urban!.buildingState!.cold!.offset).toEqual(cold.meta.pipeline!.urban!.buildingState!.cold!.offset);
  expect(target.stages.get(target.activeId!)!.chunks).toEqual(source.stages.get('source')!.chunks);
});

it('fails a bounded complete-file byte capture explicitly rather than returning local references or a partial city', async () => {
  const source = new ColdTestBackend(), snapshot = decor(await commit(source, 'source'));
  await expect(encodeDecorFileBytes(snapshot, { backend: source, maxBytes: 1024 })).rejects.toThrow('partage .decor');
  await expect(encodeDecorFileBytes(snapshot, { backend: source, maxBytes: 65 * 1024 * 1024 })).rejects.toThrow('byte budget');
});

it('rejects an actually oversized native frame at the cold-code24MiB budget with a streaming decor direction', async () => {
  const oversized = structuredClone(chunks[0]);
  // Synthetic diagnostic padding tests the encoded-size boundary; geometry and
  // archived native plans are the unchanged real C fixture records.
  oversized.buildings[0].diagnostics.push('x'.repeat(24 * 1024 * 1024));
  const source = new ColdTestBackend(), stage = await beginUrbanBuildingStage(source, { sceneId: 'large', sourceFingerprint: fixture.cliSha256, totalRequests: 3 });
  await stage.append(oversized, { start: 0, completed: 3, total: 3 });
  const snapshot = decor(await stage.commit());
  await expect(portableRecipe('urban', '', snapshot, { backend: source })).rejects.toThrow('budget 24 Mio');
  expect(source.activeId).toBe('large');
});

it('never hides a remaining cold draft in a procedural terrain recipe', async () => {
  const source = new ColdTestBackend(), snapshot = decor(await commit(source, 'source'));
  snapshot.meta.regeneration = { query: 'seed=procedural', crops: [] };
  snapshot.meta.pipeline!.urbanDraft = snapshot.meta.pipeline!.urban;
  snapshot.meta.pipeline!.urban = undefined;
  const recipe = await portableRecipe('settlements', '', snapshot, { backend: source });
  expect(recipe.terrain).toBeUndefined(); expect(recipe.decor).toBeDefined();
  const target = new ColdTestBackend(); await restoreRecipe(recipe, undefined, { backend: target });
  expect(target.stages.get(target.activeId!)!.chunks).toEqual(source.stages.get('source')!.chunks);
});
