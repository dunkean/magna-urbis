/**
 * Drape tile requests, invalidation and material transitions, called by terrain inputs and frames.
 * Reads/writes: Reads tile demand, loader and capture mode; writes tile jobs, texture/mask/semantic caches, revision/fade state and frame demand on the supplied context.
 */
import { projectedTexturePixels } from '../terrain3dTextureSize';
import { terrain3dRaisedTexture } from '../terrain3dBillboards';
import { Terrain3dTile, Terrain3dTileContent, Patch, MaterialRef, PatchMaterial } from './terrainTypes';
import { TILE_PIXELS, TEXTURE_FADE_MS } from './terrainPolicy';
import { materialBytes, materialSize, paddedMaterial } from './materialImages';
import type { Terrain3dContext } from './terrainContext';

export function setTileLoader(context: Terrain3dContext, loader: ((tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>) | undefined, requireHeights: boolean): void {
  if (context.requireHeights !== requireHeights) {
    context.requireHeights = requireHeights;
    context.clearPatches();
  }
  if (context.tileLoader === loader) return;
  context.tileLoader = loader;
  context.invalidateTiles();
}

/** Repaint the ground textures: all of them, the tiles overlapping a world `region`, or one tile by its key.
 * A tile keeps showing its current texture until the replacement is built and uploaded (swap on ready). */
export function invalidateTiles(context: Terrain3dContext, region?: { minX: number; minY: number; maxX: number; maxY: number } | string): void {
  if (region === undefined) context.staleTiles = 'all';
  else if (!context.staleTiles) context.staleTiles = [region];
  else if (context.staleTiles !== 'all') context.staleTiles.push(region);
  context.request();
}

export function applyStaleTiles(context: Terrain3dContext): void {
  const stale = context.staleTiles;
  if (!stale) return;
  context.staleTiles = undefined;
  // A material revision cancels tile work through patch.revision below. Geometry jobs,
  // height grids and tree placement belong to the surface epoch, which stays intact.
  // Without a loader nothing would replace them: the whole-map material takes over at once.
  const drop = !context.tileLoader;
  for (const patch of context.patches.values()) {
    const t = patch.tile;
    if (stale !== 'all' && !stale.some(r => (typeof r === 'string' ? r === t.key : t.x < r.maxX && t.x + t.width > r.minX && t.y < r.maxY && t.y + t.width > r.minY))) continue;
    ++patch.revision;
    if (patch.pendingTexture) context.releaseMaterial(patch.pendingTexture);
    patch.pendingTexture = undefined;
    patch.pendingTextureBytes = 0;
    patch.pendingHeights = undefined;
    patch.status = 'idle';
    if (drop) {
      if (patch.texture) context.releaseMaterial(patch.texture);
      patch.texture = undefined;
      patch.textureBytes = 0;
      patch.textureFadeStart = 0;
      patch.textureProgress = 0;
      patch.materialParent = undefined;
    }
  }
}

export function loadTiles(context: Terrain3dContext): void {
  if (!context.tileLoader || !context.active || context.contextLost()) return;
  const queue = context.requireHeights ? [...new Set([...context.geometryNeeded, ...context.desired])] : context.desired;
  let started = 0;
  for (const patch of queue) {
    if (context.jobs.size >= (context.options.tileJobsConcurrent ?? 2) || started >= (context.options.tileJobsPerFrame ?? 2)) break;
    if (patch.tile.level === 0) continue;
    const preview = (context.useMapShader || !!context.lookSettings.paperMap) && context.frameInteracting && !context.requireHeights;
    const footprint = (patch.tile.width * context.frameGeometry().focal) / Math.max(context.camera.distance, 1);
    const pixels = projectedTexturePixels(TILE_PIXELS, footprint, context.dpr(), context.captureMode || context.requireHeights);
    // A moving preview never displaces a completed full tile.
    if (patch.status === 'ready' && ((patch.preview && !preview) || (context.captureMode && !patch.exact) || (!preview && (patch.texturePixels ?? 0) < pixels))) patch.status = 'idle';
    if (patch.status !== 'idle') continue;
    // Map ground: while the view moves, a tile with a loaded ancestor keeps showing that ancestor stretched. A preview
    // only holds the 2D raster tiles cached so far and showed paper (white squares) wherever they were missing.
    if (preview && !context.groundSettings && !patch.texture && context.texturedAncestor(patch)) continue;
    const job = {},
      epoch = context.epoch,
      revision = patch.revision,
      loader = context.tileLoader,
      exact = context.captureMode;
    const current = (): boolean => epoch === context.epoch && revision === patch.revision && !context.disposed && context.patches.get(patch.tile.key) === patch;
    patch.status = 'loading';
    context.jobs.add(job);
    ++started;
    // In its own task: a synchronous tile paint must not hold back the frame that asked for it.
    void new Promise<void>(resolve => setTimeout(resolve))
      .then(() => {
        if (epoch !== context.epoch || revision !== patch.revision || context.disposed) throw new Error('Tuile abandonnée.');
        return loader({ ...patch.tile, pixels, preview, exact, prepare: work => context.preparation.run(work, current, () => patch.tile.level * 1e9 + Math.hypot(patch.tile.x + patch.tile.width / 2 - context.camera.x, patch.tile.y + patch.tile.width / 2 - context.camera.y)) });
      })
      .then(async result => {
        const content = typeof result === 'object' && result !== null && 'texture' in result ? (result as Terrain3dTileContent) : { texture: result as TexImageSource };
        const source = content.texture;
        if (!current() || context.contextLost()) {
          if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
          return;
        }
        if (context.requireHeights && !content.height) throw new Error('Tuile de relief 3D sans grille d’altitude.');
        let deferred = false;
        if (content.height) {
          const heights = await context.preparation.run(context.decodedGrid(patch.tile, content.height), current, patch.tile.level * 1e9);
          const unchanged = patch.hasHeight && patch.heights?.every((value, i) => Math.abs(value - heights[i]) < 0.0001);
          if (!unchanged) {
            if (patch.heights && context.containsLivePatch(patch)) {
              patch.pendingHeights = heights;
              deferred = true;
            } else context.installHeights(patch, heights);
          }
        }
        if (!current() || context.contextLost()) {
          if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
          return;
        }
        const gutter = Math.max(0, Math.min(8, Math.round(content.gutter ?? 0)));
        const texture = context.uploadTexture(source);
        let textureBytes = materialBytes(source);
        const raised = terrain3dRaisedTexture(source);
        if (raised) {
          context.raisedMaterials.set(texture, context.uploadTexture(raised));
          textureBytes += materialBytes(raised);
        }
        if (content.semantic || content.ground) {
          const size = Math.max(content.semantic ? materialSize(content.semantic).width : 0, content.ground ? materialSize(content.ground).width : 0);
          const semanticGutter = (gutter * size) / materialSize(source).width;
          let overlay = content.semantic!;
          if (content.ground) {
            // Two independently padded squares reuse one sampler: physical albedo on the left, ink on the right.
            const atlas = document.createElement('canvas');
            atlas.width = 2 * (size + 2);
            atlas.height = size + 2;
            const target = atlas.getContext('2d')!;
            for (const [source, x] of [
              [content.ground, 0],
              [content.semantic, size + 2],
            ] as const) {
              if (!source) continue;
              const square = document.createElement('canvas');
              square.width = square.height = size;
              square.getContext('2d')!.drawImage(source as CanvasImageSource, 0, 0, size, size);
              target.drawImage(paddedMaterial(square), x, 0);
            }
            overlay = atlas;
          }
          context.semanticTiles.set(texture, { texture: context.uploadTexture(overlay), pixels: size - 2 * semanticGutter, gutter: semanticGutter, atlas: !!content.ground, semantic: !!content.semantic });
          textureBytes += materialBytes(overlay);
        }
        if (content.water) {
          const water = content.water,
            mask = context.uploadWaterMask(water);
          context.waterMasks.set(texture, { texture: mask, rect: [water.x, water.y, water.width], bytes: water.alpha.byteLength, water });
          context.waterMaskChanged(water.x, water.y, water.width);
          textureBytes += water.alpha.byteLength;
        }
        if (deferred) {
          patch.pendingTexture = texture;
          patch.pendingTextureBytes = textureBytes;
          patch.pendingTextureGutter = gutter;
          patch.pendingTexturePixels = materialSize(source).width - 2 * gutter;
        } else {
          // A replacement swaps in at once: no fade through the parent tile, which read as a flicker.
          const replaced = !!patch.texture;
          if (patch.texture) context.releaseMaterial(patch.texture);
          patch.texture = texture;
          patch.textureBytes = textureBytes;
          patch.textureFadeStart = 0;
          patch.textureProgress = replaced ? 1 : 0;
          if (replaced) patch.materialParent = undefined;
          patch.textureGutter = gutter;
          patch.texturePixels = materialSize(source).width - 2 * gutter;
        }
        patch.status = 'ready';
        patch.preview = preview;
        patch.exact = exact;
        if (patch.hasHeight && patch.texture) patch.coherentReady = true;
        if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
      })
      .catch(error => {
        if (epoch !== context.epoch || revision !== patch.revision || context.disposed) return;
        if ((error as { name?: string })?.name === 'AbortError') {
          patch.status = 'idle';
          return;
        }
        patch.status = 'failed';
        console.warn(`Terrain 3D tile ${patch.tile.key}:`, error);
      })
      .finally(() => {
        context.jobs.delete(job);
        // A new frame selects the current view before requesting more work.
        // In particular, a cancelled generation must not spin a promise loop.
        if (!context.disposed) context.request();
      });
  }
}

export function closestTexture(context: Terrain3dContext, patch: Patch): { texture: WebGLTexture; rect: [number, number, number, number]; texel: number; ready: boolean } {
  const tile = patch.tile,
    layer = context.layer!;
  let [level, ix, iy] = tile.key.split('/').map(Number);
  while (level >= 0) {
    const parent = context.patches.get(`${level}/${ix}/${iy}`);
    if (parent?.texture) {
      parent.used = context.clock;
      context.protected.add(parent.tile.key);
      const width = parent.tile.width;
      return {
        texture: parent.texture,
        rect: [(tile.x - parent.tile.x) / width, (tile.y - parent.tile.y) / width, tile.width / width, tile.width / width],
        texel: width / (parent.texturePixels ?? TILE_PIXELS),
        ready: parent === patch && patch.status !== 'idle' && patch.status !== 'loading',
      };
    }
    --level;
    ix = Math.floor(ix / 2);
    iy = Math.floor(iy / 2);
  }
  return { texture: context.material, rect: [(tile.x - layer.x) / layer.width, (tile.y - layer.y) / layer.width, tile.width / layer.width, tile.width / layer.width], texel: layer.width / context.fallbackPixels, ready: !context.tileLoader || tile.level === 0 };
}

/** Whether a loaded tile texture (not the whole-map fallback) covers `patch` through one of its ancestors. */
export function texturedAncestor(context: Terrain3dContext, patch: Patch): boolean {
  let [level, ix, iy] = patch.tile.key.split('/').map(Number);
  while (--level > 0) {
    ix = Math.floor(ix / 2);
    iy = Math.floor(iy / 2);
    if (context.patches.get(`${level}/${ix}/${iy}`)?.texture) return true;
  }
  return false;
}

export function protectMaterial(context: Terrain3dContext, ref: MaterialRef): void {
  if (!ref.tile) return;
  const owner = context.patches.get(ref.tile.key);
  if (owner?.texture === ref.texture) {
    context.protected.add(ref.tile.key);
    owner.used = context.clock;
  }
}

export function materialFor(context: Terrain3dContext, patch: Patch, geometryBlend: number, depth: number): PatchMaterial {
  if (patch.materialParent) {
    const ref = patch.materialParent;
    const retained = ref.tile ? context.patches.get(ref.tile.key)?.texture === ref.texture : context.material === ref.texture;
    // A completed, no-longer-drawn branch may outlive an ancestor's cached
    // material. It must never bind that deleted texture when merging later.
    if (!retained) patch.materialParent = undefined;
  }
  const own: MaterialRef | undefined = patch.texture ? { texture: patch.texture, tile: patch.tile, pixels: patch.texturePixels ?? TILE_PIXELS, gutter: patch.textureGutter } : undefined;
  const progress = patch.textureProgress;
  // Only an ancestor tile is a geometry-morph partner. The whole-map fallback is another medium (no land use, roads or
  // plan inked at tile scale): a node held part-way through its split would show its children as a pale, blurred rectangle.
  const morphs = (ref: MaterialRef | undefined): number => (ref && !ref.tile ? 1 : geometryBlend);
  if (own && progress >= 1 && morphs(patch.materialParent) >= 1) {
    patch.materialParent = undefined;
    context.protectMaterial(own);
    return { from: own, to: own, blend: 1, ready: true };
  }
  let fallback: PatchMaterial;
  if (patch.materialParent) {
    const ref = patch.materialParent;
    context.protectMaterial(ref);
    fallback = { from: ref, to: ref, blend: 1, ready: true };
  } else {
    const [level, x, y] = patch.tile.key.split('/').map(Number);
    let parent: Patch | undefined,
      ix = x,
      iy = y;
    for (let l = level - 1; l >= 0; l--) {
      ix = Math.floor(ix / 2);
      iy = Math.floor(iy / 2);
      const candidate = context.patches.get(`${l}/${ix}/${iy}`);
      if (candidate?.texture) {
        parent = candidate;
        break;
      }
    }
    if (parent && depth < 32) fallback = context.materialFor(parent, 1, depth + 1);
    else {
      const base = { texture: context.material, pixels: context.fallbackPixels, gutter: context.fallbackGutter };
      fallback = { from: base, to: base, blend: 1, ready: !context.tileLoader || level === 0 };
    }
  }
  if (!own || fallback.blend < 1) return fallback;
  if (!patch.textureFadeStart) {
    patch.textureFadeStart = context.now;
    patch.textureUpdated = context.now;
  }
  patch.materialParent ??= fallback.to;
  const t = (patch.textureProgress = Math.min(1, patch.textureProgress + Math.min(50, Math.max(0, context.now - patch.textureUpdated)) / TEXTURE_FADE_MS));
  patch.textureUpdated = context.now;
  const blend = t * t * (3 - 2 * t) * morphs(patch.materialParent);
  if (t < 1) context.animating = true;
  context.protectMaterial(own);
  context.protectMaterial(patch.materialParent);
  return { from: patch.materialParent, to: own, blend, ready: true };
}

export function textureRect(context: Terrain3dContext, ref: MaterialRef, tile: Terrain3dTile): [number, number, number, number] {
  const source = ref.tile ?? context.layer!,
    pixels = ref.pixels,
    gutter = 1 + (ref.gutter ?? 0),
    total = pixels + 2 * gutter;
  const x = (tile.x - source.x) / source.width,
    y = (tile.y - source.y) / source.width,
    size = tile.width / source.width;
  return [(gutter + x * pixels) / total, (gutter + y * pixels) / total, (size * pixels) / total, (size * pixels) / total];
}

export function overlayRect(context: Terrain3dContext, ref: MaterialRef, tile: Terrain3dTile, ground: boolean): [number, number, number, number] {
  const overlay = context.semanticTiles.get(ref.texture);
  if (!overlay) return [0, 0, 0, 0];
  const r = context.textureRect({ ...ref, pixels: overlay.pixels, gutter: overlay.gutter }, tile);
  if (!overlay.atlas) return ground ? [0, 0, 0, 0] : r;
  const side = overlay.pixels + 2 * overlay.gutter + 2,
    w = 2 * side + 2,
    h = side + 2;
  return [(1 + (ground ? 0 : side) + r[0] * side) / w, (1 + r[1] * side) / h, (r[2] * side) / w, (r[3] * side) / h];
}

export function releaseMaterial(context: Terrain3dContext, texture: WebGLTexture): void {
  const raised = context.raisedMaterials.get(texture);
  if (raised) {
    context.deleteTexture(raised);
    context.raisedMaterials.delete(texture);
  }
  const mask = context.waterMasks.get(texture);
  if (mask) {
    context.deleteTexture(mask.texture);
    context.waterMasks.delete(texture);
    context.waterMaskChanged(...mask.rect);
  }
  const semantic = context.semanticTiles.get(texture);
  if (semantic) {
    context.deleteTexture(semantic.texture);
    context.semanticTiles.delete(texture);
  }
  context.deleteTexture(texture);
}
