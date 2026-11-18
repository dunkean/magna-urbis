/**
 * Patch identity, readiness and bounded cache lifetime, called by selection and frame preparation.
 * Reads/writes: Reads layer, view demand and job state; writes patch/cache maps, epochs, protected keys and readiness statistics on the supplied context.
 */
import { RenderPiece, Patch, Node } from './terrainTypes';
import { TILE_PIXELS, CACHE_BYTES, MAX_CACHE } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

export function getLodInfo(context: Terrain3dContext): Terrain3dContext['lod'] & { covered: boolean } {
  const missing = !!context.tileLoader && context.desired.some(p => p.tile.level > 0 && (p.status === 'idle' || p.status === 'loading' || (p.preview && !context.frameInteracting)));
  const covered = context.active && context.lod.tiles > 0 && context.displayedPieces.length > 0 && context.displayedPieces.every(piece => !!(piece.source as RenderPiece).patch.vao);
  return { ...context.lod, covered, pending: context.jobs.size + Math.max(0, context.preparation.pending - context.treeJobs) + Number(missing) + Number(!!context.staleTiles) + context.occupationMerges };
}

export function clearPatches(context: Terrain3dContext): void {
  ++context.epoch;
  context.preparation.clear();
  context.meshJobs.clear();
  context.treeKey = '';
  context.fungusKey = '';
  context.treeReadyKey = '';
  context.billboardDirty = true;
  context.geometryNeeded = [];
  for (const patch of context.patches.values()) context.releasePatch(patch);
  context.patches.clear();
  context.heightGrids.clear();
  context.root = undefined;
  context.desired = [];
  context.protected.clear();
  context.splits.clear();
  context.displayedGrids = [];
  context.displayedPieces = [];
  context.stitchUpdated = 0;
}

export function patch(context: Terrain3dContext, level: number, ix: number, iy: number): Patch {
  const layer = context.layer!,
    key = `${level}/${ix}/${iy}`;
  let patch = context.patches.get(key);
  if (!patch) {
    const width = layer.width / 2 ** level,
      x = layer.x + ix * width,
      y = layer.y + iy * width;
    const centre = context.surface(x + width / 2, y + width / 2, width / TILE_PIXELS, false);
    let low = centre,
      high = centre;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const height = context.surface(x + u * width, y + v * width, width / TILE_PIXELS, false);
      low = Math.min(low, height);
      high = Math.max(high, height);
    }
    // Keep selection bounds independent of whether a mesh has been built or
    // evicted. Changing them during preparation makes adjacent LODs oscillate.
    const padding = Math.min(context.heightRange, context.maxSlope * width * 0.6 + context.heightRange * 0.003);
    low -= padding;
    high += padding;
    patch = {
      tile: { key, x, y, width, level, pixels: TILE_PIXELS },
      textureBytes: 0,
      meshBytes: 0,
      heightOrigin: centre,
      minHeight: low,
      maxHeight: high,
      used: context.clock,
      status: 'idle',
      revision: 0,
      textureFadeStart: 0,
      textureProgress: 0,
      textureUpdated: 0,
      hasHeight: false,
      coherentReady: false,
      pendingTextureBytes: 0,
    };
    context.patches.set(key, patch);
  }
  patch.used = context.clock;
  return patch;
}

export function containsLivePatch(context: Terrain3dContext, patch: Patch): boolean {
  const visit = (node: Node): boolean => node.visible && (node.patch === patch || !!node.children?.some(visit));
  return !!context.root && visit(context.root);
}

/** Whether the drawn subtree of `node` shows tile textures of its own, with no stretched fallback. */
export function subtreeTextured(context: Terrain3dContext, node: Node): boolean {
  if (!node.visible || (node.patch.texture && node.patch.vao)) return true;
  return !!node.children?.length && node.blend >= 1 && node.children.every(child => context.subtreeTextured(child));
}

export function covered(context: Terrain3dContext, node: Node): boolean {
  return !node.visible || (!!node.patch.vao && (!context.requireHeights || node.patch.tile.level === 0 || (node.patch.hasHeight && node.patch.coherentReady))) || (!!node.children?.length && node.children.every(child => context.covered(child)));
}

export function releasePatch(context: Terrain3dContext, patch: Patch, preserveMesh: boolean): void {
  if (!preserveMesh) context.releaseMesh(patch);
  if (patch.texture) context.releaseMaterial(patch.texture);
  if (patch.pendingTexture) context.releaseMaterial(patch.pendingTexture);
}

export function trim(context: Terrain3dContext): void {
  let bytes = 0;
  for (const patch of context.patches.values()) bytes += patch.textureBytes + patch.pendingTextureBytes + patch.meshBytes;
  const current = new Set<string>(),
    retain = (node: Node): void => {
      current.add(node.patch.tile.key);
      node.children?.forEach(retain);
    };
  if (context.root) retain(context.root);
  const old = [...context.patches.values()].filter(patch => !context.protected.has(patch.tile.key) && patch.status !== 'loading').sort((a, b) => a.used - b.used);
  for (const patch of old) {
    if (bytes <= CACHE_BYTES && context.patches.size <= MAX_CACHE) break;
    const keepMesh = current.has(patch.tile.key);
    bytes -= patch.textureBytes + patch.pendingTextureBytes + (keepMesh ? 0 : patch.meshBytes);
    context.releasePatch(patch, keepMesh);
    if (current.has(patch.tile.key)) {
      // Current ancestors remain available for an aligned, immediate parent
      // fallback. Their textures can still be evicted independently.
      patch.texture = undefined;
      patch.textureBytes = 0;
      patch.status = 'idle';
      patch.textureFadeStart = 0;
      patch.textureProgress = 0;
      patch.materialParent = undefined;
      patch.pendingTexture = undefined;
      patch.pendingTextureBytes = 0;
    } else context.patches.delete(patch.tile.key);
  }
}
