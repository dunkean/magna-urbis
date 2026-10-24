/** First executable B1 consumer, intentionally not connected to terrainUrban.
 * Replaces renderer records AND its caches on every camera update. Whole-city
 * density remains drawable during IO/caps; never draws a detail prefix as a city.
 * Own this facade exclusively; callers must release old returned snapshots. */
import { openUrbanBuildingChunks, type ChunkBounds, type BuildingChunkBackend } from './urbanBuildingChunkStore';
import { openColdVisualWindow } from './urbanColdVisualWindow';
import { UrbanBuildingLodRenderer, type BuildingDrawOptions, type BuildingViewport } from '../render/urbanBuildingLod';
import type { NativeBuildingProjection } from './urbanBuildingProjection';
import type { ContourPreview } from './urbanColdOverviewCache';
import { translateBuilding } from './urbanSnapshot';

export interface DecodedContourImage { source: CanvasImageSource; width: number; height: number; close(): void }
export type ContourDecoder = (preview: ContourPreview) => Promise<DecodedContourImage>;
export async function decodeBrowserContour(preview: ContourPreview): Promise<DecodedContourImage> {
  if (typeof createImageBitmap === 'undefined') throw new Error('Architectural overview pending: image decoder unavailable.');
  const bytes = new ArrayBuffer(preview.png.byteLength); new Uint8Array(bytes).set(preview.png);
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  return { source: image, width: image.width, height: image.height, close: () => image.close() };
}

export async function openColdWindowLod(backend: BuildingChunkBackend, sceneId: string,
  options: Parameters<typeof openColdVisualWindow>[2] & { decodeContour?: ContourDecoder } = {}) {
  options = { ...options, ...(options.offset ? { offset: { ...options.offset } } : {}) };
  const window = await openColdVisualWindow(backend, sceneId, options);
  let contourImage: DecodedContourImage | undefined;
  if (options.overviewMode === 'architectural') {
    try {
      if (!window.contourPreview) throw new Error('Architectural overview pending: no complete native contours.');
      contourImage = await (options.decodeContour ?? decodeBrowserContour)(window.contourPreview);
      if (contourImage.width !== window.contourPreview.pixels || contourImage.height !== window.contourPreview.pixels) throw new Error('Overview image dimensions mismatch.');
      options.signal?.throwIfAborted();
    } catch (e) { contourImage?.close(); window.dispose(); throw e; }
  }
  const renderer = new UrbanBuildingLodRenderer<NativeBuildingProjection>({ buildings: [] }, { raster: false });
  let epoch = 0, disposed = false;
  let nativeReader: Awaited<ReturnType<typeof openUrbanBuildingChunks>> | undefined, inspecting = false;
  const overview = window.overview, [x0, y0, x1, y1] = overview.bounds, size = overview.resolution;
  // A count-cell is a density symbol, never an invented occupied footprint.
  const width = (x1 - x0 || 1) / size, height = (y1 - y0 || 1) / size;
  let maxCount = 0; for (const n of overview.counts) maxCount = Math.max(maxCount, n);
  function density(ctx: CanvasRenderingContext2D, viewport: BuildingViewport) {
    const clamp = (n: number) => Math.max(0, Math.min(size - 1, n));
    const ax = clamp(Math.floor((viewport.minX - x0) / width)), bx = clamp(Math.floor((viewport.maxX - x0) / width));
    const ay = clamp(Math.floor((viewport.minY - y0) / height)), by = clamp(Math.floor((viewport.maxY - y0) / height));
    let cellsDrawn = 0;
    ctx.save(); ctx.beginPath(); ctx.rect(viewport.minX, viewport.minY, viewport.maxX - viewport.minX, viewport.maxY - viewport.minY); ctx.clip();
    try {
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
        const n = overview.counts[y * size + x]; if (!n) continue;
        ctx.fillStyle = `rgba(60,75,90,${0.2 + 0.8 * Math.log1p(n) / Math.log1p(maxCount)})`;
        ctx.fillRect(x0 + x * width, y0 + y * height, width, height); cellsDrawn++;
      }
    } finally { ctx.restore(); }
    return cellsDrawn;
  }
  return {
    overview, contourPreview: window.contourPreview, overviewCacheStatus: window.overviewCacheStatus,
    manifest: window.manifest, originBinding: window.originBinding,
    async update(viewport: ChunkBounds, signal?: AbortSignal) {
      if (disposed) throw new DOMException('Visual facade disposed', 'AbortError');
      if (viewport.length !== 4 || !viewport.every(Number.isFinite) || viewport[0] > viewport[2] || viewport[1] > viewport[3]) throw new Error('Invalid visual viewport.');
      const mine = ++epoch;
      const pending = window.request(viewport, signal);
      if (!inspecting) nativeReader?.clearCache();
      // Releasing the old renderer also releases detail bases, maps, sector grid,
      // identities, raster/vector/history caches; no monotonically growing index.
      renderer.replaceScene({ buildings: [] });
      const result = await pending;
      if (disposed || mine !== epoch) throw new DOMException('Visual facade replaced', 'AbortError');
      // Partial exact data stays inspectable as pending, but is not rendered as a
      // complete near view. Complete density is the visual fallback.
      if (result.complete) renderer.replaceScene({ buildings: result.buildings, materials: result.materials });
      return result;
    },
    /** Existing caller world-to-screen transform; no DOM/browser needed. */
    draw(ctx: CanvasRenderingContext2D, draw: BuildingDrawOptions) {
      if (disposed) throw new DOMException('Visual facade disposed', 'AbortError');
      const b = window.snapshot?.viewport, v = draw.viewport;
      if (![v.minX, v.minY, v.maxX, v.maxY].every(Number.isFinite) || v.minX > v.maxX || v.minY > v.maxY
        || !Number.isFinite(draw.metresPerPixel) || draw.metresPerPixel <= 0) throw new Error('Invalid cold visual draw viewport.');
      const exact = !disposed && window.snapshot?.complete && b && b[0] <= v.minX && b[1] <= v.minY && b[2] >= v.maxX && b[3] >= v.maxY;
      if (exact) return { coverage: 'exact' as const, totalBuildings: window.manifest.buildings, metrics: renderer.draw(ctx, draw) };
      if (options.overviewMode === 'architectural') {
        const p = window.contourPreview, painted = draw.painted ?? globalThis.document?.documentElement.dataset.cityBackground === 'render';
        if (!contourImage || !p || draw.appearance.style !== 'cartographic' || draw.appearance.diagnostic !== 'none' || painted)
          return { coverage: 'architectural-preview-pending' as const, totalBuildings: window.manifest.buildings, reason: 'Cached overview appearance differs; density is diagnostic only.' };
        ctx.save();
        try { ctx.beginPath(); ctx.rect(v.minX, v.minY, v.maxX - v.minX, v.maxY - v.minY); ctx.clip();
          ctx.drawImage(contourImage.source, 0, 0, p.pixels, p.pixels, p.bounds[0], p.bounds[1], p.bounds[2] - p.bounds[0], p.bounds[3] - p.bounds[1]);
        } finally { ctx.restore(); }
        return { coverage: 'complete-native-contours' as const, totalBuildings: window.manifest.buildings, painter: p.painter };
      }
      return { coverage: 'complete-plan-density' as const, totalBuildings: window.manifest.buildings,
        cellsDrawn: density(ctx, v), legend: 'Accepted native plans per anchor cell; not occupied surfaces or population.' };
    },
    pick: window.pick, selected: window.selected,
    /** Only explicit selected inspection touches a native archive. Its retained
     * context contains one building/archive; current source identity gates return.
     * This is data inspection, NOT an original live-query/editing capability. */
    async inspect(id: string) {
      const base = window.selected(id);
      if (disposed || !window.snapshot?.complete || !base) throw new Error('Exact selected inspection is pending/unavailable.');
      if (inspecting) throw new Error('One native selected inspection is already active.');
      inspecting = true;
      try {
        nativeReader ??= await openUrbanBuildingChunks(backend, sceneId, { maxCachedChunks: 1, maxCacheBytes: 8 * 1024 * 1024 });
        if (disposed || window.selected(id) !== base) throw new DOMException('Inspection source replaced', 'AbortError');
        if (nativeReader.manifest.fingerprint !== window.manifest.fingerprint) throw new Error('Inspection native parent changed.');
        const read = await nativeReader.readBuilding(id);
        if (disposed || window.selected(id) !== base) throw new DOMException('Inspection source replaced', 'AbortError');
        if (!read || read.building.parcel_id !== base.parcel_id) throw new Error('Inspection native identity changed.');
        const dx = options.offset?.x ?? 0, dy = options.offset?.y ?? 0, building = dx || dy ? translateBuilding(read.building, dx, dy) : read.building;
        return { base, building, scene: { ...read.scene, buildings: [building] as [typeof building] },
          chunkIndex: read.chunkIndex, parentFingerprint: window.manifest.fingerprint, originBinding: 'unbound' as const };
      } finally { inspecting = false; if (disposed || window.selected(id) !== base) nativeReader?.clearCache(); }
    },
    get stats() { return { ...window.stats, decodedContourBytes: contourImage ? contourImage.width * contourImage.height * 4 : 0,
      nativeInspection: { active: inspecting, chunks: nativeReader?.stats.chunks ?? 0, bytes: nativeReader?.stats.bytes ?? 0 } }; },
    get snapshot() { return window.snapshot; },
    dispose() { disposed = true; epoch++; renderer.replaceScene({ buildings: [] }); window.dispose(); contourImage?.close(); contourImage = undefined;
      if (!inspecting) nativeReader?.clearCache(); },
  };
}

/** Architectural mode never substitutes diagnostic density for a missing painter,
 * incomplete image, unavailable decoder or incompatible requested appearance. */
export function openColdArchitecturalWindow(backend: BuildingChunkBackend, sceneId: string,
  options: Parameters<typeof openColdWindowLod>[2] = {}) {
  return openColdWindowLod(backend, sceneId, { ...options, overviewMode: 'architectural' });
}
