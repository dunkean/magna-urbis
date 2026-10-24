/** Fixed raster, two SERIAL child-only passes. No source archive decode/native
 * generation and no city-sized projection/renderer index. Built asynchronously. */
import type { ParentChunkBackend, ParentSceneManifest } from './urbanParentChunkStore';
import type { ParentBounds } from '../../../rust/bridge/nativeParentOccupation';
import { decodeParentVisual } from './urbanParentVisualCache';
import { UrbanBuildingLodRenderer, urbanOverviewInkPadding } from '../render/urbanBuildingLod';
import type { ParentMemberVisual } from './urbanParentVisual';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import { browserOverviewRasterFactory, type OverviewRasterFactory } from './urbanColdOverviewCache';
import { paintParentContexts } from './urbanParentPaint';
export interface ParentOverview { version: 'parent-native-contours-1'; sourceFingerprint: string; manifestFingerprint: string;
  bounds: ParentBounds; pixels: number; png: Uint8Array; members: number; parents: number; contexts: number;
  appearance: UrbanBuildingAppearance; painted: boolean }
export async function buildParentOverview(backend: ParentChunkBackend, manifest: ParentSceneManifest, options: {
  signal?: AbortSignal; pixels?: number; appearance: UrbanBuildingAppearance; painted?: boolean;
  rasterFactory?: OverviewRasterFactory; yieldControl?(): Promise<void>; progress?(pass: 1 | 2, completed: number, total: number): void;
}): Promise<ParentOverview> {
  const pixels = options.pixels ?? 2048, factory = options.rasterFactory ?? browserOverviewRasterFactory();
  if (!factory || !backend.visualChunk) throw new Error('Native parent overview raster is unavailable. Exact close-up remains available.');
  if (!Number.isSafeInteger(pixels) || pixels < 128 || pixels > 2048) throw new Error('Invalid parent overview raster budget.');
  const bounds: ParentBounds = [Infinity, Infinity, -Infinity, -Infinity]; let members = 0, parents = 0, contexts = 0;
  const point = (x: number, y: number) => { if (![x, y].every(Number.isFinite)) throw new Error('Nonfinite parent overview point.');
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y); };
  for (const descriptor of manifest.chunks) {
    options.signal?.throwIfAborted(); const chunk = await backend.visualChunk(manifest.sceneId, descriptor.index);
    if (!chunk) throw new Error(`Parent overview child chunk${descriptor.index} missing; explicit repair required.`);
    const data = await decodeParentVisual(chunk, descriptor.sha256); options.signal?.throwIfAborted();
    members += data.members.length; parents += data.parents.length; contexts += data.contexts.length;
    for (const s of [...data.members.flatMap(m => [m.footprint, m.roof_footprint]), ...data.contexts.map(c => c.surface)])
      for (const polygon of s) for (const ring of [polygon.outer, ...polygon.holes]) for (const p of ring) point(p.x, p.y);
    options.progress?.(1, descriptor.progress.completed, manifest.totalRequests); await options.yieldControl?.();
  }
  if (members !== manifest.counts.physical_members || parents !== manifest.counts.admitted_parents) throw new Error('Parent overview omitted native members/parents.');
  if (!members && !contexts) bounds.splice(0, 4, 0, 0, 1, 1);
  const padding = urbanOverviewInkPadding(!!options.painted, options.appearance.diagnostic === 'access');
  const mpp = (Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1) + 2 * padding.world) / (pixels - 2 * padding.pixels);
  const extent = mpp * pixels, cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  const rasterBounds: ParentBounds = [cx - extent / 2, cy - extent / 2, cx + extent / 2, cy + extent / 2];
  const raster = factory(pixels), renderer = new UrbanBuildingLodRenderer<ParentMemberVisual>({ buildings: [] }, { raster: false }); let paintedMembers = 0;
  try {
    raster.context.setTransform(1 / mpp, 0, 0, 1 / mpp, -rasterBounds[0] / mpp, -rasterBounds[1] / mpp);
    for (const descriptor of manifest.chunks) {
      options.signal?.throwIfAborted(); const chunk = await backend.visualChunk(manifest.sceneId, descriptor.index);
      if (!chunk) throw new Error('Parent overview cache changed during painting.');
      const data = await decodeParentVisual(chunk, descriptor.sha256); options.signal?.throwIfAborted();
      paintParentContexts(raster.context, data.contexts, data.materials);
      for (const member of data.members) {
        // Preserve native source order; do not build a global renderer index.
        renderer.replaceScene({ buildings: [member], materials: data.materials });
        const metrics = renderer.draw(raster.context, { viewport: { minX: rasterBounds[0], minY: rasterBounds[1], maxX: rasterBounds[2], maxY: rasterBounds[3] },
          metresPerPixel: mpp, appearance: options.appearance, painted: options.painted, useDetails: false });
        if (metrics.visibleBuildings !== 1) throw new Error('Parent overview painter omitted a real member.'); paintedMembers++;
      }
      await raster.flush?.(); options.progress?.(2, descriptor.progress.completed, manifest.totalRequests); await options.yieldControl?.();
    }
    if (paintedMembers !== members) throw new Error('Partial parent overview cannot be published.');
    const png = await raster.png(); options.signal?.throwIfAborted();
    if (!(png instanceof Uint8Array) || png.byteLength > 16 * 1024 * 1024 || png.byteLength < 24) throw new Error('Invalid/oversized parent overview PNG.');
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => png[i] === n) || header.getUint32(16, false) !== pixels || header.getUint32(20, false) !== pixels) throw new Error('Parent overview raster dimensions mismatch.');
    return { version: 'parent-native-contours-1', sourceFingerprint: manifest.sourceFingerprint, manifestFingerprint: manifest.fingerprint,
      bounds: rasterBounds, pixels, png, members, parents, contexts, appearance: { ...options.appearance }, painted: !!options.painted };
  } finally { renderer.replaceScene({ buildings: [] }); raster.dispose(); }
}
