import type { DerivedBackend, DerivedManifest, DerivedChunk, DerivedOrigin } from '../../src/ui/urbanBuildingDerivedCache';
import { ColdTestBackend } from './urbanBuildingColdTestBackend';
type Cache = { cacheId: string; chunks: Map<number, DerivedChunk>; origins: Map<string, DerivedOrigin>; manifest?: DerivedManifest };
/** Deterministic storage fault double; NOT IndexedDB/browser durability evidence. */
export class DerivedTestBackend extends ColdTestBackend {
  caches = new Map<string, Cache>(); derivedReads: number[] = []; originReads: string[] = [];
  derivedFail: 'begin' | 'append' | 'commit' | undefined;
  derived: DerivedBackend = {
    begin: async (sceneId, cacheId) => {
      if (this.derivedFail === 'begin') throw new Error('Cache quota begin');
      this.caches.set(sceneId, { cacheId, chunks: new Map(), origins: new Map() });
    },
    append: async (sceneId, cacheId, chunk, origins) => {
      if (this.derivedFail === 'append') throw new Error('Cache quota append');
      const cache = this.caches.get(sceneId);
      if (!cache || cache.cacheId !== cacheId || cache.manifest || cache.chunks.size !== chunk.index) throw new Error('Cache generation changed');
      const ids = new Set<string>();
      for (const entry of origins) { if (cache.origins.has(entry.id) || ids.has(entry.id)) throw new Error('Duplicate origin'); ids.add(entry.id); }
      cache.chunks.set(chunk.index, structuredClone(chunk)); for (const entry of origins) cache.origins.set(entry.id, structuredClone(entry));
    },
    commit: async (manifest, options) => {
      options?.signal?.throwIfAborted(); if (this.derivedFail === 'commit') throw new Error('Cache quota commit');
      const cache = this.caches.get(manifest.sceneId), parent = this.stages.get(manifest.sceneId)?.manifest;
      if (!cache || cache.cacheId !== manifest.cacheId || cache.manifest || cache.chunks.size !== manifest.chunks.length
        || parent?.fingerprint !== manifest.parentFingerprint || parent.sourceFingerprint !== manifest.sourceFingerprint) throw new Error('No committed matching parent/cache generation');
      cache.manifest = structuredClone(manifest);
    },
    manifest: async sceneId => structuredClone(this.caches.get(sceneId)?.manifest),
    chunk: async (sceneId, cacheId, index) => {
      this.derivedReads.push(index); const cache = this.caches.get(sceneId);
      return cache?.cacheId === cacheId ? structuredClone(cache.chunks.get(index)) : undefined;
    },
    origin: async (sceneId, cacheId, id) => {
      this.originReads.push(id); const cache = this.caches.get(sceneId);
      return cache?.cacheId === cacheId ? structuredClone(cache.origins.get(id)) : undefined;
    },
    discard: async (sceneId, cacheId) => {
      const cache = this.caches.get(sceneId); if (cache?.cacheId !== cacheId) return;
      if (cache.manifest) throw new Error('Committed derivative cannot be discarded'); this.caches.delete(sceneId);
    },
  };
}
