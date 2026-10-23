import type { BuildingChunkBackend, BuildingChunkIndex, BuildingChunkManifest, StoredBuildingChunk } from '../../src/ui/urbanBuildingChunkStore';
export function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
/** Tests only: no IndexedDB/browser or native-work claim. */
export class ColdTestBackend implements BuildingChunkBackend {
  stages = new Map<string, { chunks: StoredBuildingChunk[]; entries: Map<string, BuildingChunkIndex>; manifest?: BuildingChunkManifest }>();
  activeId: string | null = null;
  block?: { index: number; started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
  failRead = false; reads: number[] = [];
  failAppend = false; failCommit = false;
  appendGate?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
  commitGate?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
  async begin(id: string) { if (this.stages.has(id)) throw new Error('Duplicate stage'); this.stages.set(id, { chunks: [], entries: new Map() }); }
  async append(id: string, chunk: StoredBuildingChunk, entries: BuildingChunkIndex[]) {
    if (this.appendGate) { const gate = this.appendGate; this.appendGate = undefined; gate.started.resolve(); await gate.release.promise; }
    if (this.failAppend) throw new Error('QuotaExceededError');
    const stage = this.stages.get(id)!, ids = new Set<string>();
    if (stage.manifest || chunk.index !== stage.chunks.length) throw new Error('Invalid stage');
    for (const entry of entries) { if (stage.entries.has(entry.id) || ids.has(entry.id)) throw new Error('Duplicate ID'); ids.add(entry.id); }
    stage.chunks.push(structuredClone(chunk)); for (const entry of entries) stage.entries.set(entry.id, structuredClone(entry));
  }
  async commit(manifest: BuildingChunkManifest, expected: string | null, options?: { signal?: AbortSignal }) {
    options?.signal?.throwIfAborted();
    if (this.commitGate) {
      const gate = this.commitGate; this.commitGate = undefined; gate.started.resolve();
      await new Promise<void>((resolve, reject) => {
        const signal = options?.signal, aborted = () => { cleanup(); reject(signal?.reason); };
        const cleanup = () => signal?.removeEventListener('abort', aborted);
        signal?.addEventListener('abort', aborted, { once: true });
        gate.release.promise.then(() => { cleanup(); resolve(); });
      });
    }
    options?.signal?.throwIfAborted(); if (this.failCommit) throw new Error('Commit failed');
    if (this.activeId !== expected) throw new Error('Generation changed');
    this.stages.get(manifest.sceneId)!.manifest = structuredClone(manifest); this.activeId = manifest.sceneId;
  }
  async active() { return this.activeId ? this.manifest(this.activeId) : undefined; }
  async manifest(id: string) { return structuredClone(this.stages.get(id)?.manifest); }
  async chunk(id: string, index: number) {
    this.reads.push(index); if (this.failRead) throw new Error('Cold chunk read failed');
    const blocked = this.block;
    if (blocked?.index === index) { this.block = undefined; blocked.started.resolve(); await blocked.release.promise; }
    return structuredClone(this.stages.get(id)?.chunks[index]);
  }
  async building(id: string, building: string) { return structuredClone(this.stages.get(id)?.entries.get(building)); }
  async tile(id: string, tile: string, limit: number) {
    const entries = [...this.stages.get(id)!.entries.values()].filter(entry => entry.tiles.includes(tile));
    return { entries: structuredClone(entries.slice(0, limit)), truncated: entries.length > limit };
  }
  async discard(id: string) { if (this.stages.get(id)?.manifest) throw new Error('Committed scene'); this.stages.delete(id); }
}
