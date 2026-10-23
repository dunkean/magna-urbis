/** Owns its readers exclusively. Exactly one physical reader operation at once;
 * camera/selection/generation changes replace the pending request, never queue it. */
import type { HouseMaterial } from '../../../rust/bridge/housesContract';
import type { BuildingChunkRead, ChunkBounds, openUrbanBuildingChunks } from './urbanBuildingChunkStore';
import { projectNativeBuildingRecords, type NativeBuildingProjectionScene } from './urbanBuildingProjection';

export type NativeBuildingReader = Pick<Awaited<ReturnType<typeof openUrbanBuildingChunks>>,
  'manifest' | 'readBuilding' | 'readVisible' | 'pinBuilding' | 'clearCache'>;
export type NativeVisibleReadLimits = Parameters<NativeBuildingReader['readVisible']>[1];
export type NativeBuildingSelection = { state: 'none' } | { state: 'missing'; id: string }
  | { state: 'ready'; id: string; value: BuildingChunkRead };
export interface NativeBuildingViewSnapshot {
  generation: string; sceneId: string; fingerprint: string; revision: number; viewport: ChunkBounds;
  scene: NativeBuildingProjectionScene; selection: NativeBuildingSelection;
  /** Only these counts are city-wide. Viewport metrics belong to scene.metrics. */
  totals: { buildings: number; refusals: number; openSpaces: number; totalRequests: number };
  read: { chunkIndices: number[]; encodedBytes: number; candidatesRead: number; truncated: boolean };
}
export interface NativeBuildingReadError { generation: string; revision: number; error: unknown; rolledBack: boolean }
const generation = (reader: NativeBuildingReader) => `${reader.manifest.sceneId}/${reader.manifest.fingerprint}`;
function viewport(value: ChunkBounds): ChunkBounds {
  if (value.length !== 4 || !value.every(Number.isFinite) || value[0] > value[2] || value[1] > value[3]) throw new Error('Invalid native building viewport.');
  return [...value];
}

export class UrbanBuildingReadController {
  private desired: NativeBuildingReader | undefined;
  private active: NativeBuildingReader | undefined;
  private working: NativeBuildingReader | undefined;
  private view: ChunkBounds;
  private selectedId: string | undefined;
  private readonly limits: NativeVisibleReadLimits;
  private publish: ((snapshot: NativeBuildingViewSnapshot) => void) | undefined;
  private error: ((error: NativeBuildingReadError) => void) | undefined;
  private revision = 0;
  private pending = false;
  private draining = false;
  private disposed = false;
  private pin = new WeakMap<NativeBuildingReader, { id: string | undefined }>();
  private waiters: (() => void)[] = [];
  private snapshot: NativeBuildingViewSnapshot | undefined;
  private lastError: NativeBuildingReadError | undefined;
  private discarded = 0;

  constructor(options: { reader: NativeBuildingReader; viewport: ChunkBounds; limits: NativeVisibleReadLimits;
    selectedId?: string; onPublish(snapshot: NativeBuildingViewSnapshot): void; onError?(error: NativeBuildingReadError): void }) {
    this.desired = options.reader; this.view = viewport(options.viewport); this.selectedId = options.selectedId;
    if (this.selectedId !== undefined && !this.selectedId.length) throw new Error('Invalid selected building identity.');
    this.limits = Object.freeze({ maxTiles: options.limits.maxTiles, maxCandidates: options.limits.maxCandidates,
      maxBuildings: options.limits.maxBuildings, maxChunks: options.limits.maxChunks, maxBytes: options.limits.maxBytes });
    this.publish = options.onPublish; this.error = options.onError;
    if (!['maxTiles', 'maxCandidates', 'maxBuildings', 'maxChunks', 'maxBytes'].every(key => {
      const value = this.limits[key as keyof NativeVisibleReadLimits]; return Number.isSafeInteger(value) && value > 0;
    })) throw new Error('Invalid native building read limits.');
    this.request();
  }
  setViewport(bounds: ChunkBounds): void {
    this.assertLive(); const next = viewport(bounds); if (next.every((value, i) => value === this.view[i])) return;
    this.view = next; this.request();
  }
  /** Explicit retry; an unchanged camera does not create a publication/read loop. */
  refresh(): void { this.assertLive(); this.request(); }
  select(id?: string): void {
    this.assertLive(); if (id !== undefined && !id.length) throw new Error('Invalid selected building identity.');
    if (id === this.selectedId) return; this.selectedId = id; this.request();
  }
  /** New committed reader is tentative until its viewport AND selection succeed.
   * Failed activation retains the last published generation, then refreshes it. */
  setGeneration(reader: NativeBuildingReader): void {
    this.assertLive(); if (reader === this.desired) return;
    const previous = this.desired; this.desired = reader;
    if (previous && previous !== this.active && previous !== this.working) this.release(previous);
    this.request();
  }
  whenIdle(): Promise<void> { return !this.draining && !this.pending ? Promise.resolve() : new Promise(resolve => this.waiters.push(resolve)); }
  get state() {
    return { disposed: this.disposed, loading: this.draining || this.pending, revision: this.revision,
      generation: this.snapshot?.generation, requestedGeneration: this.desired && generation(this.desired),
      published: this.snapshot, error: this.lastError, discarded: this.discarded, activeReads: this.working ? 1 : 0 };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.revision++; this.pending = false;
    const owned = new Set([this.desired, this.active]); this.desired = this.active = undefined;
    this.snapshot = undefined; this.lastError = undefined; this.selectedId = undefined; this.publish = this.error = undefined;
    for (const reader of owned) if (reader && reader !== this.working) this.release(reader);
    if (!this.draining) this.idle();
  }
  private assertLive(): void { if (this.disposed) throw new Error('Native building read controller is disposed.'); }
  private release(reader: NativeBuildingReader): void { reader.clearCache(); this.pin.delete(reader); }
  private current(reader: NativeBuildingReader, revision: number): boolean {
    return !this.disposed && this.desired === reader && this.revision === revision;
  }
  private request(): void {
    this.revision++; this.pending = true;
    if (this.draining) return;
    this.draining = true; queueMicrotask(() => { void this.drain(); });
  }
  private idle(): void { const waiters = this.waiters; this.waiters = []; waiters.forEach(resolve => resolve()); }
  private report(event: NativeBuildingReadError): void {
    this.lastError = event;
    try { this.error?.(event); } catch { /* Host error handlers must not stop physical reads from draining. */ }
  }
  private async selection(reader: NativeBuildingReader, revision: number, id: string | undefined): Promise<NativeBuildingSelection | undefined> {
    const old = this.active === reader ? this.snapshot?.selection : undefined, pin = this.pin.get(reader);
    if (id === undefined) {
      if (!pin || pin.id !== undefined) { await reader.pinBuilding(); this.pin.set(reader, { id: undefined }); }
      return this.current(reader, revision) ? Object.freeze({ state: 'none' }) : undefined;
    }
    if (pin && old?.state === 'ready' && old.id === id && pin.id === id) return old;
    if (pin && old?.state === 'missing' && old.id === id && pin.id === undefined) return old;
    const found = await reader.readBuilding(id); if (!this.current(reader, revision)) return undefined;
    if (!found) {
      await reader.pinBuilding(); this.pin.set(reader, { id: undefined });
      return this.current(reader, revision) ? Object.freeze({ state: 'missing', id }) : undefined;
    }
    const value = await reader.pinBuilding(id); this.pin.set(reader, { id });
    if (!value) throw new Error('Selected native building disappeared during pin.');
    return this.current(reader, revision) ? Object.freeze({ state: 'ready', id,
      value: Object.freeze({ building: value.building, scene: value.scene, chunkIndex: value.chunkIndex }) }) : undefined;
  }
  private async drain(): Promise<void> {
    try {
      while (this.pending && !this.disposed) {
        this.pending = false;
        const reader = this.desired!, revision = this.revision, bounds = [...this.view] as ChunkBounds, id = this.selectedId;
        this.working = reader;
        try {
          const selection = await this.selection(reader, revision, id);
          if (!selection || !this.current(reader, revision)) { this.discarded++; continue; }
          const visible = await reader.readVisible(bounds, this.limits);
          if (!this.current(reader, revision)) { this.discarded++; continue; }
          // Drop all complete viewport records here. Callbacks receive only the
          // allowlisted projection plus, at most, one genuine selected building.
          const catalogues = new Set(visible.buildings.map(read => read.scene.materials).filter((value): value is HouseMaterial[] => !!value));
          const scene = projectNativeBuildingRecords(visible.buildings.map(read => read.building), [...catalogues].flat());
          const manifest = reader.manifest, previous = this.active; Object.freeze(bounds);
          const chunkIndices = [...visible.chunkIndices]; Object.freeze(chunkIndices);
          const snapshot: NativeBuildingViewSnapshot = Object.freeze({ generation: generation(reader), sceneId: manifest.sceneId,
            fingerprint: manifest.fingerprint, revision, viewport: bounds, scene, selection,
            totals: Object.freeze({ buildings: manifest.buildings, refusals: manifest.refusals, openSpaces: manifest.openSpaces, totalRequests: manifest.totalRequests }),
            read: Object.freeze({ chunkIndices, encodedBytes: visible.bytes, candidatesRead: visible.candidatesRead, truncated: visible.truncated }) });
          this.active = reader; this.snapshot = snapshot; this.lastError = undefined;
          try { this.publish?.(snapshot); }
          catch (error) { this.report({ generation: snapshot.generation, revision, error, rolledBack: false }); }
          if (previous && previous !== reader && previous !== this.desired) this.release(previous);
        } catch (error) {
          if (!this.current(reader, revision)) { this.discarded++; continue; }
          const rolledBack = !!this.active && this.active !== reader;
          if (rolledBack) { this.desired = this.active; this.revision++; this.pending = true; }
          this.report({ generation: generation(reader), revision, error, rolledBack });
        } finally {
          this.working = undefined;
          if (reader !== this.active && reader !== this.desired || this.disposed) this.release(reader);
        }
      }
    } finally {
      this.draining = false; this.idle();
    }
  }
}
