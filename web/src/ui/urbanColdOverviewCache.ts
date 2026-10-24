/** B3 disposable authenticated overview, never native/export/edit capability.
 * One fixed count buffer + one fixed raster, streaming original child chunks.
 * Raster backend must really draw (browser OffscreenCanvas or host test painter).
 * Stable native record order; actual roof contours/holes/material painter reused. */
import type { BuildingChunkBackend, ChunkBounds } from './urbanBuildingChunkStore';
import type { ColdOverview, DerivedReader } from './urbanColdOverview';
import { UrbanBuildingLodRenderer, urbanOverviewInkPadding } from '../render/urbanBuildingLod';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import type { NativeBuildingProjection } from './urbanBuildingProjection';
import type { HouseMaterial } from '../../../rust/bridge/housesContract';

export const COLD_OVERVIEW_VERSION = 'native-contour-overview-1';
export const COLD_OVERVIEW_MAX_BYTES = 16 * 1024 * 1024;
export const COLD_OVERVIEW_PAINTER = 'urban-lod-cartographic-native-order-1';
export interface StoredColdOverview {
  version: typeof COLD_OVERVIEW_VERSION; sceneId: string; key: string;
  parentFingerprint: string; derivedFingerprint: string; sourceFingerprint: string;
  buildings: number; resolution: number; bounds: ChunkBounds;
  countsLE: Uint8Array;
  appearance?: UrbanBuildingAppearance; painted?: boolean;
  contour?: { bounds: ChunkBounds; pixels: number; painter: typeof COLD_OVERVIEW_PAINTER; png: Uint8Array };
  fingerprint: string;
}
export interface ColdOverviewBackend {
  read(sceneId: string, key: string): Promise<StoredColdOverview | undefined>;
  /** Atomic compare both current native AND current committed derived fingerprint. */
  commit(value: StoredColdOverview, options?: { signal?: AbortSignal }): Promise<void>;
}
export interface OverviewRaster {
  context: CanvasRenderingContext2D;
  png(): Promise<Uint8Array>;
  dispose(): void;
  /** Optional bounded headless host flush after each <=64-record source chunk. */
  flush?(): Promise<void>;
}
export type OverviewRasterFactory = (pixels: number) => OverviewRaster;
export interface ContourPreview { bounds: Readonly<ChunkBounds>; pixels: number; png: Uint8Array; painter: typeof COLD_OVERVIEW_PAINTER;
  appearance?: UrbanBuildingAppearance; painted?: boolean }
export interface LoadedColdOverview {
  overview: ColdOverview; contour?: ContourPreview;
  fingerprint: string;
  cacheStatus: 'hit' | 'built' | 'built-uncached'; cacheReason?: string;
}
const validBounds = (v: readonly number[]) => v.length === 4 && v.every(Number.isFinite) && v[0] <= v[2] && v[1] <= v[3];
function check(ok: unknown, msg: string): asserts ok { if (!ok) throw new Error(msg); }
const hashPattern = /^[0-9a-f]{64}$/;
const defaultAppearance: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' };
const keyOf = (resolution: number, a: UrbanBuildingAppearance, p: boolean) => `${COLD_OVERVIEW_VERSION}:${COLD_OVERVIEW_PAINTER}:${resolution}`
  + (a.style === 'cartographic' && a.diagnostic === 'none' && !p ? '' : `:${a.style}:${a.diagnostic}:${Number(p)}`);
function pngMatches(png: Uint8Array, pixels: number): boolean {
  if (!(png instanceof Uint8Array) || png.length < 33) return false;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return png.slice(0, 8).every((n, i) => n === [137, 80, 78, 71, 13, 10, 26, 10][i])
    && png.slice(12, 16).every((n, i) => n === [73, 72, 68, 82][i])
    && view.getUint32(8, false) === 13 && view.getUint32(16, false) === pixels && view.getUint32(20, false) === pixels;
}
function countsBytes(counts: Uint32Array) {
  const bytes = new Uint8Array(counts.length * 4), view = new DataView(bytes.buffer);
  counts.forEach((n, i) => view.setUint32(i * 4, n, true)); return bytes;
}
async function fingerprint(v: StoredColdOverview): Promise<string> {
  const header = { version: v.version, sceneId: v.sceneId, key: v.key, parentFingerprint: v.parentFingerprint,
    derivedFingerprint: v.derivedFingerprint, sourceFingerprint: v.sourceFingerprint, buildings: v.buildings,
    resolution: v.resolution, bounds: v.bounds, contour: v.contour ? { bounds: v.contour.bounds, pixels: v.contour.pixels, painter: v.contour.painter } : null,
    appearance: v.appearance, painted: v.painted };
  const text = new TextEncoder().encode(JSON.stringify(header)), png = v.contour?.png ?? new Uint8Array();
  const bytes = new Uint8Array(text.length + v.countsLE.byteLength + png.byteLength);
  bytes.set(text); bytes.set(v.countsLE, text.length); bytes.set(png, text.length + v.countsLE.byteLength);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function memoryBytes(v: StoredColdOverview) { return v.countsLE.byteLength + (v.contour ? v.contour.png.byteLength + v.contour.pixels ** 2 * 4 : 0); }
function hydrate(v: StoredColdOverview): LoadedColdOverview {
  const view = new DataView(v.countsLE.buffer, v.countsLE.byteOffset, v.countsLE.byteLength), counts = new Uint32Array(v.resolution ** 2);
  for (let i = 0; i < counts.length; i++) counts[i] = view.getUint32(i * 4, true);
  check(counts.reduce((a, b) => a + b, 0) === v.buildings, 'Incomplete cached overview coverage.');
  return { fingerprint: v.fingerprint, overview: Object.freeze({ kind: 'accepted-plan-anchor-density-1', parentFingerprint: v.parentFingerprint, derivedFingerprint: v.derivedFingerprint,
    bounds: Object.freeze([...v.bounds] as ChunkBounds), resolution: v.resolution, buildings: v.buildings, counts }),
    ...(v.contour ? { contour: Object.freeze({ ...v.contour, appearance: v.appearance, painted: v.painted,
      bounds: Object.freeze([...v.contour.bounds] as ChunkBounds) }) } : {}), cacheStatus: 'hit' };
}
export function browserOverviewRasterFactory(): OverviewRasterFactory | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  return pixels => {
    const canvas = new OffscreenCanvas(pixels, pixels), context = canvas.getContext('2d'); check(context, 'No native overview canvas context.');
    return { context: context as unknown as CanvasRenderingContext2D,
      png: async () => new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()),
      dispose() { canvas.width = canvas.height = 1; } };
  };
}
export async function loadColdOverview(backend: BuildingChunkBackend, reader: DerivedReader, options: {
  resolution?: number; signal?: AbortSignal; maxChunkBytes?: number; requireContour?: boolean; rasterFactory?: OverviewRasterFactory;
  progress?(value: { pass: 1 | 2; completed: number; total: number }): void;
  yieldControl?(): Promise<void>;
  appearance?: UrbanBuildingAppearance; painted?: boolean;
} = {}): Promise<LoadedColdOverview> {
  const resolution = options.resolution ?? 1024, signal = options.signal, m = reader.manifest;
  check(Number.isSafeInteger(resolution) && resolution >= 1 && resolution <= 1024 && (!options.requireContour || resolution >= 4), 'Invalid persistent overview resolution.');
  const appearance: UrbanBuildingAppearance = { style: options.appearance?.style ?? 'cartographic', diagnostic: options.appearance?.diagnostic ?? 'none' }, painted = options.painted ?? false;
  check(['cartographic', 'silhouette', 'geometric'].includes(appearance.style) && ['none', 'uses', 'height', 'access'].includes(appearance.diagnostic), 'Invalid overview appearance.');
  const key = keyOf(resolution, appearance, painted); let cacheReason: string | undefined;
  signal?.throwIfAborted();
  try {
    const value = await backend.overview?.read(m.sceneId, key); signal?.throwIfAborted();
    check(value && value.version === COLD_OVERVIEW_VERSION && value.sceneId === m.sceneId && value.key === key
      && value.parentFingerprint === m.parentFingerprint && value.derivedFingerprint === m.fingerprint && value.sourceFingerprint === m.sourceFingerprint
      && value.buildings === m.buildings && value.resolution === resolution && validBounds(value.bounds)
      && JSON.stringify(value.appearance ?? defaultAppearance) === JSON.stringify(appearance) && (value.painted ?? false) === painted
      && value.countsLE instanceof Uint8Array && value.countsLE.byteLength === resolution ** 2 * 4
      && (!value.contour || pngMatches(value.contour.png, resolution)
        && value.contour.pixels === resolution && value.contour.painter === COLD_OVERVIEW_PAINTER && validBounds(value.contour.bounds))
      && (!options.requireContour || value.contour) && memoryBytes(value) <= COLD_OVERVIEW_MAX_BYTES
      && hashPattern.test(value.fingerprint) && await fingerprint(value) === value.fingerprint, 'Missing/stale/corrupt native overview.');
    signal?.throwIfAborted(); return hydrate(value);
  } catch (e) { signal?.throwIfAborted(); cacheReason = String(e); }
  const factory = options.rasterFactory ?? (options.requireContour ? browserOverviewRasterFactory() : undefined);
  check(!options.requireContour || factory, 'Architectural overview pending: raster backend unavailable; density is diagnostic only.');
  const bounds: ChunkBounds = [Infinity, Infinity, -Infinity, -Infinity], ink: ChunkBounds = [...bounds]; let total = 0;
  const anchor = (b: NativeBuildingProjection) => b.footprint.find(s => s.outer.length)?.outer[0] ?? b.roof_footprint.find(s => s.outer.length)?.outer[0];
  const add = (box: ChunkBounds, x: number, y: number) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); };
  let pass: 1 | 2 = 1;
  const each = async (body: (b: NativeBuildingProjection, materials: HouseMaterial[]) => void, afterChunk?: () => Promise<void>) => {
    for (const chunk of m.chunks) {
      signal?.throwIfAborted(); check(chunk.bytes <= (options.maxChunkBytes ?? 32 * 1024 * 1024), 'Overview chunk exceeds decode budget.');
      const payload = await reader.chunk(chunk.index, signal);
      for (const building of payload.projection.buildings) { signal?.throwIfAborted(); body(building, payload.projection.materials ?? []); }
      await afterChunk?.(); signal?.throwIfAborted();
      options.progress?.({ pass, completed: chunk.progress.completed, total: m.totalRequests });
      await options.yieldControl?.(); signal?.throwIfAborted();
    }
  };
  await each(b => {
    const p = anchor(b); check(p, 'Accepted plan has no overview anchor.'); total++; add(bounds, p.x, p.y);
    for (const s of b.roof_footprint.length ? b.roof_footprint : b.footprint) for (const q of s.outer) add(ink, q.x, q.y);
    if (appearance.diagnostic === 'access' && b.entrance) add(ink, b.entrance.x, b.entrance.y);
  });
  check(total === m.buildings && total <= 0xffffffff, 'Incomplete overview traversal.');
  if (!total) { bounds.splice(0, 4, 0, 0, 0, 0); ink.splice(0, 4, 0, 0, 1, 1); }
  check(validBounds(ink), 'Invalid native overview ink bounds.');
  const padding = urbanOverviewInkPadding(painted, appearance.diagnostic === 'access');
  check(!factory || resolution > 2 * padding.pixels, 'Raster resolution too small for exact painter support.');
  const mpp = (Math.max(ink[2] - ink[0], ink[3] - ink[1], 1) + 2 * padding.world) / Math.max(1, resolution - 2 * padding.pixels), extent = mpp * resolution;
  const cx = (ink[0] + ink[2]) / 2, cy = (ink[1] + ink[3]) / 2;
  const rasterBounds: ChunkBounds = [cx - extent / 2, cy - extent / 2, cx + extent / 2, cy + extent / 2];
  const raster = factory?.(resolution), counts = new Uint32Array(resolution ** 2);
  const renderer = raster ? new UrbanBuildingLodRenderer<NativeBuildingProjection>({ buildings: [] }, { raster: false }) : undefined;
  let assigned = 0;
  try {
    pass = 2;
    raster?.context.setTransform(1 / mpp, 0, 0, 1 / mpp, -rasterBounds[0] / mpp, -rasterBounds[1] / mpp);
    await each((b, materials) => {
      const p = anchor(b)!;
      const cell = (x: number, lo: number, hi: number) => hi === lo ? 0 : Math.min(resolution - 1, Math.floor((x - lo) / (hi - lo) * resolution));
      const x = cell(p.x, bounds[0], bounds[2]), y = cell(p.y, bounds[1], bounds[3]);
      check(x >= 0 && y >= 0 && x < resolution && y < resolution, 'Overview bounds changed.'); counts[y * resolution + x]++; assigned++;
      if (raster && renderer) {
        // Singleton batches intentionally preserve source order across chunks and
        // different material groups. No global scene/index or reordered colours.
        renderer.replaceScene({ buildings: [b], materials });
        const metrics = renderer.draw(raster.context, { viewport: { minX: rasterBounds[0], minY: rasterBounds[1], maxX: rasterBounds[2], maxY: rasterBounds[3] },
          metresPerPixel: mpp, appearance, painted });
        check(metrics.visibleBuildings === 1, 'Native overview painter omitted a source building.');
      }
    }, raster?.flush ? () => raster.flush!() : undefined);
    signal?.throwIfAborted(); check(assigned === total, 'Partial overview cannot be committed.');
    const png = await raster?.png(); signal?.throwIfAborted();
    check(!raster || png && pngMatches(png, resolution), 'Raster backend did not produce the requested bounded PNG.');
    const value: StoredColdOverview = { version: COLD_OVERVIEW_VERSION, sceneId: m.sceneId, key, parentFingerprint: m.parentFingerprint,
      derivedFingerprint: m.fingerprint, sourceFingerprint: m.sourceFingerprint, buildings: total, resolution, bounds,
      countsLE: countsBytes(counts), ...(appearance.style !== 'cartographic' || appearance.diagnostic !== 'none' || painted ? { appearance, painted } : {}),
      ...(png ? { contour: { bounds: rasterBounds, pixels: resolution, painter: COLD_OVERVIEW_PAINTER, png } } : {}), fingerprint: '' };
    check(memoryBytes(value) <= COLD_OVERVIEW_MAX_BYTES, 'Native overview exceeds fixed buffer budget.');
    value.fingerprint = await fingerprint(value); signal?.throwIfAborted();
    let saved = false;
    try { if (backend.overview) { await backend.overview.commit(value, { signal }); saved = true; } }
    catch (e) { signal?.throwIfAborted(); cacheReason = String(e); }
    signal?.throwIfAborted();
    // Even quota failure returns the complete freshly painted image; native data
    // never changes. Warm open only trusts a fully authenticated persisted record.
    return { ...hydrate(value), cacheStatus: saved ? 'built' : 'built-uncached', cacheReason };
  } finally { renderer?.replaceScene({ buildings: [] }); raster?.dispose(); }
}
