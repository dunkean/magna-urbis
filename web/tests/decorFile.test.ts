import { beforeAll, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import { decodeDecor, decodeDecorBounded, encodeDecor, encodeDecorAsync, type Decor } from '../src/ui/decor';
import { downloadDecorFile, exportDecorFile, readDecorFile, type DecorSavePicker } from '../src/ui/decorFile';
import { beginUrbanBuildingStage, type BuildingChunkBackend, type BuildingChunkIndex, type BuildingChunkManifest, type StoredBuildingChunk } from '../src/ui/urbanBuildingChunkStore';

class MemoryBackend implements BuildingChunkBackend {
  stages = new Map<string, { chunks: StoredBuildingChunk[]; entries: Map<string, BuildingChunkIndex>; manifest?: BuildingChunkManifest }>();
  activeId: string | null = null;
  async begin(id: string) { if (this.stages.has(id)) throw new Error('Duplicate stage'); this.stages.set(id, { chunks: [], entries: new Map() }); }
  async append(id: string, chunk: StoredBuildingChunk, entries: BuildingChunkIndex[]) {
    const stage = this.stages.get(id)!;
    if (stage.manifest || chunk.index !== stage.chunks.length || entries.some(entry => stage.entries.has(entry.id))) throw new Error('Invalid append');
    stage.chunks.push(structuredClone(chunk)); for (const entry of entries) stage.entries.set(entry.id, structuredClone(entry));
  }
  async commit(manifest: BuildingChunkManifest, expected: string | null) {
    const stage = this.stages.get(manifest.sceneId)!;
    if (this.activeId !== expected || stage.manifest || stage.chunks.length !== manifest.chunks.length) throw new Error('Active generation changed');
    stage.manifest = structuredClone(manifest); this.activeId = manifest.sceneId;
  }
  async active() { return this.activeId ? this.manifest(this.activeId) : undefined; }
  async manifest(id: string) { return this.stages.get(id)?.manifest; }
  async chunk(id: string, index: number) { return this.stages.get(id)?.chunks[index]; }
  async building(id: string, building: string) { return this.stages.get(id)?.entries.get(building); }
  async tile(id: string, tile: string, limit: number) {
    const entries = [...this.stages.get(id)!.entries.values()].filter(entry => entry.tiles.includes(tile));
    return { entries: entries.slice(0, limit), truncated: entries.length > limit };
  }
  async discard(id: string) { if (this.stages.get(id)?.manifest) throw new Error('Committed stage'); this.stages.delete(id); }
}
let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(chunk => archivePlanBatch(chunk.delta as unknown as PlacementBatch))); });
async function committed(backend: MemoryBackend, sceneId: string) {
  const stage = await beginUrbanBuildingStage(backend, { sceneId, sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  return stage.commit();
}
function terrain(): Decor {
  return { meta: { format: 'magna-decor', version: 1, id: 'C', label: 'Ville C', tags: {}, seed: 'C', width: 160, query: '', created: '',
    settlements: [], roadConfig: null, roads: null, waterSvg: '', stats: { land: 1, minHeight: 30, maxHeight: 30, riverKm: 0, roadKm: 0 } },
  raster: { n: 2, width: 160, height: new Float32Array(4).fill(30), water: new Uint8Array(4), waterLevel: new Float32Array(4).fill(30),
    riverWidth: new Float32Array(4), riverIds: new Int32Array(4), geometry: { land: [], water: [] } } };
}
function coldDecor(manifest: BuildingChunkManifest): Decor {
  const decor = terrain();
  const urban = { layoutConfig: defaultLayoutConfig(), parcelConfig: defaultParcelConfig(), quarterSeed: 'q', parcelSeed: 'p',
    buildingState: { seed: 'b', visible: true, appearance: { style: 'cartographic' as const, diagnostic: 'none' as const },
      cold: { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
        counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version,
          buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces }, offset: { x: -123.25, y: 456.5 }, cityKey: 'C/site' } } };
  decor.meta.pipeline = { stage: 'urban', urban, urbanDraft: structuredClone(urban) };
  return decor;
}
async function collect(source: AsyncIterable<Uint8Array>) { const parts: Uint8Array[] = []; for await (const part of source) parts.push(part); return parts; }
function file(parts: Uint8Array[]): Blob { return new Blob(parts.map(part => new Uint8Array(part))); }
/** Fail if the importer tries to materialize the complete cold file. */
class StreamingOnlyBlob extends Blob {
  override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole-file arrayBuffer is forbidden'); }
}
function header(decor: Decor): Uint8Array {
  const bytes = encodeDecor(decor, { localReferences: true });
  return new TextEncoder().encode(JSON.stringify({ format: 'magna-cold-decor-1', decor: btoa(String.fromCharCode(...bytes)) }) + '\n');
}

it('exports ALL exact real C native chunks and imports into an independent new generation, preserving crop metadata', async () => {
  const source = new MemoryBackend(), manifest = await committed(source, 'original'), decor = coldDecor(manifest);
  const parts = await collect(exportDecorFile(decor, { backend: source }));
  expect(parts).toHaveLength(6); // header, manifest, three real chunks, footer
  const target = new MemoryBackend(), imported = await readDecorFile(new StreamingOnlyBlob(parts.map(part => new Uint8Array(part))), { backend: target });
  const active = (await target.active())!, cold = imported.meta.pipeline!.urban!.buildingState!.cold!;
  expect(active.sceneId).not.toBe(manifest.sceneId);
  expect(cold.store).toEqual({ ...decor.meta.pipeline!.urban!.buildingState!.cold!.store, sceneId: active.sceneId });
  expect(cold.offset).toEqual({ x: -123.25, y: 456.5 }); expect(cold.cityKey).toBe('C/site');
  expect(imported.meta.pipeline!.urbanDraft!.buildingState!.cold).toEqual(cold);
  expect(active.sourceFingerprint).toBe(fixture.cliSha256);
  expect([active.buildings, active.refusals, active.openSpaces]).toEqual([6, 3, 0]);
  expect(target.stages.get(active.sceneId)!.chunks).toEqual(source.stages.get('original')!.chunks);
  expect(imported.raster).toEqual(decor.raster);
  expect(decor.meta.pipeline!.urban!.buildingState!.cold!.store.sceneId).toBe('original');
});

it('does not publish after a complete footer until true stream EOF', async () => {
  const source = new MemoryBackend(), manifest = await committed(source, 'original');
  const parts = await collect(exportDecorFile(coldDecor(manifest), { backend: source }));
  const target = new MemoryBackend(); await committed(target, 'previous');
  let release!: () => void, waiting!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { waiting = resolve; });
  class PausedBlob extends StreamingOnlyBlob {
    override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
      let index = 0;
      return new ReadableStream({ async pull(controller) {
        if (index < parts.length) { controller.enqueue(new Uint8Array(parts[index++])); return; }
        waiting(); await gate; controller.close();
      } });
    }
  }
  const importing = readDecorFile(new PausedBlob(parts.map(part => new Uint8Array(part))), { backend: target });
  await reached; expect(target.activeId).toBe('previous'); release(); await importing;
  expect(target.activeId).not.toBe('previous');
});

it.each(['count', 'source', 'fingerprint', 'draft-count'] as const)('rejects %s header mismatch before atomic publication', async kind => {
  const source = new MemoryBackend(), manifest = await committed(source, 'source'), decor = coldDecor(manifest);
  const parts = await collect(exportDecorFile(decor, { backend: source }));
  const state = (kind === 'draft-count' ? decor.meta.pipeline!.urbanDraft : decor.meta.pipeline!.urban)!.buildingState!.cold!;
  if (kind.endsWith('count')) state.counts.buildings++;
  else if (kind === 'source') state.store.sourceFingerprint = '0'.repeat(64);
  else state.store.fingerprint = '0'.repeat(64);
  parts[0] = header(decor);
  const target = new MemoryBackend(); await committed(target, 'previous');
  await expect(readDecorFile(file(parts), { backend: target })).rejects.toThrow('metadata does not match');
  expect(target.activeId).toBe('previous'); expect([...target.stages.keys()]).toEqual(['previous']);
});

it.each(['corrupt', 'truncated', 'trailing', 'incomplete-line'] as const)('rolls back %s native stream and preserves previous active scene', async kind => {
  const source = new MemoryBackend(), manifest = await committed(source, 'source');
  const parts = await collect(exportDecorFile(coldDecor(manifest), { backend: source }));
  if (kind === 'corrupt') { const frame = JSON.parse(new TextDecoder().decode(parts[2])); frame.chunk.json += ' '; parts[2] = new TextEncoder().encode(JSON.stringify(frame) + '\n'); }
  if (kind === 'truncated') parts.pop();
  if (kind === 'trailing') parts.push(new TextEncoder().encode('{}\n'));
  if (kind === 'incomplete-line') parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1);
  const target = new MemoryBackend(); await committed(target, 'previous');
  await expect(readDecorFile(file(parts), { backend: target })).rejects.toThrow();
  expect(target.activeId).toBe('previous'); expect([...target.stages.keys()]).toEqual(['previous']);
});

it('keeps old terrain gzip compatible and rejects local-reference-only files/implicit legacy cold exports', async () => {
  const decor = terrain(), old = encodeDecor(decor);
  expect(await readDecorFile(file([old]))).toEqual(decodeDecor(old));
  expect(await collect(exportDecorFile(decor))).toEqual([old]);
  expect(() => decodeDecorBounded(old, 16)).toThrow('byte budget');
  const backend = new MemoryBackend(), cold = coldDecor(await committed(backend, 'C'));
  expect(() => encodeDecor(cold)).toThrow('blocs natifs');
  expect(() => encodeDecorAsync(cold)).toThrow('blocs natifs');
  await expect(readDecorFile(file([encodeDecor(cold, { localReferences: true })]), { backend })).rejects.toThrow('frames are missing');
});

it('fails missing retained source before emitting a misleading header', async () => {
  const source = new MemoryBackend(), decor = coldDecor(await committed(source, 'C'));
  const stream = exportDecorFile(decor, { backend: new MemoryBackend() });
  await expect(stream.next()).rejects.toThrow('cannot be exported portably');
});

it.each(['offset', 'cityKey', 'legacy-scene'] as const)('rejects invalid %s metadata before cold publication', async kind => {
  const source = new MemoryBackend(), decor = coldDecor(await committed(source, 'C'));
  const parts = await collect(exportDecorFile(decor, { backend: source }));
  const built = decor.meta.pipeline!.urban!.buildingState!;
  if (kind === 'offset') built.cold!.offset = { x: NaN, y: 1 };
  if (kind === 'cityKey') built.cold!.cityKey = '';
  if (kind === 'legacy-scene') built.scene = chunks[0];
  parts[0] = header(decor);
  const target = new MemoryBackend(); await committed(target, 'previous');
  await expect(readDecorFile(file(parts), { backend: target })).rejects.toThrow();
  expect(target.activeId).toBe('previous'); expect([...target.stages.keys()]).toEqual(['previous']);
});

it('requests disk picker synchronously before history resolves and closes only a complete stream', async () => {
  const source = new MemoryBackend(), decor = coldDecor(await committed(source, 'C'));
  const writes: Uint8Array[] = [], close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const picker = vi.fn<DecorSavePicker>(async () => ({ createWritable: async () => ({ write: async bytes => { writes.push(bytes); }, close, abort }) }));
  let resolve!: (decor: Decor) => void;
  const pending = new Promise<Decor>(done => { resolve = done; });
  const saving = downloadDecorFile(pending, 'C.decor', { backend: source, picker });
  expect(picker).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled(); resolve(decor); await saving;
  expect(close).toHaveBeenCalledTimes(1); expect(abort).not.toHaveBeenCalled();
  expect(writes).toEqual(await collect(exportDecorFile(decor, { backend: source })));
});

it('aborts a disk write on failure and keeps Blob compatibility downloads complete', async () => {
  const source = new MemoryBackend(), decor = coldDecor(await committed(source, 'C'));
  const abort = vi.fn(async () => {}), close = vi.fn(async () => {});
  const picker: DecorSavePicker = async () => ({ createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close, abort }) });
  await expect(downloadDecorFile(decor, 'C.decor', { backend: source, picker })).rejects.toThrow('disk full');
  expect(abort).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  let saved!: Blob;
  await downloadDecorFile(decor, 'C.decor', { backend: source, picker: null, saveBlob: blob => { saved = blob; } });
  const target = new MemoryBackend(); await readDecorFile(saved, { backend: target }); expect((await target.active())?.fingerprint).toBe((await source.active())?.fingerprint);
});
