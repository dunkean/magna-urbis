/**
 * Drape materials of a 3D terrain view: the whole-map material, the tiles the owner's loader paints for the patches
 * wanted (with their heights, semantic and ground overlays, water masks and raised companions), their invalidation,
 * the parent fallbacks and fades while a tile loads, and the texture rectangles the backends sample.
 */
import { projectedTexturePixels } from '../../terrain3dTextureSize';
import { terrain3dRaisedTexture } from '../../terrain3dBillboards';
import { TILE_PIXELS, TEXTURE_FADE_MS } from './policy';
import { materialBytes, materialSize, paddedMaterial } from './materialImages';
import type { TerrainViewContext } from './context';
import type { MaterialRef, Patch, PatchMaterial, Terrain3dTile, Terrain3dTileContent, TerrainResources } from './contract';
import type { TerrainCameraRig } from './camera';
import type { PatchMeshes } from './meshes';
import type { PatchTree } from './patchTree';
import type { TerrainSurface } from './surface';

type TileLoader = (tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>;
type Region = { minX: number; minY: number; maxX: number; maxY: number } | string;

export class TileMaterials {
  loader?: TileLoader;
  /** Tiles carry their own height grids: a patch is drawn only with its decoded heights. */
  requireHeights = false;
  /** Texture invalidations wait for the next frame, so several async completions coalesce into one pass. */
  stale: 'all' | Region[] | undefined;
  /** Tile loads in flight. */
  jobs = new Set<object>();
  /** The whole-map material: the fallback under every tile, and the ground without a loader. */
  material!: WebGLTexture;
  /** Width of the whole-map material in pixels (its texel size). */
  fallbackPixels = 1;
  /** Raised (illustrated relief) companion of a material tile. */
  readonly raised = new Map<WebGLTexture, WebGLTexture>();
  /** Semantic tile of a material tile: follows it through parent fallbacks and fades. */
  readonly semantic = new Map<WebGLTexture, { texture: WebGLTexture; pixels: number; gutter: number; atlas?: boolean; semantic: boolean }>();
  /** Water mask of a material tile: the canopy clears over water, the near trees and mushrooms avoid it. */
  readonly waterMasks = new Map<WebGLTexture, { texture: WebGLTexture; rect: readonly [number, number, number]; bytes: number; water?: NonNullable<Terrain3dTileContent['water']> }>();
  private fallbackGutter = 0;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly resources: TerrainResources,
    private readonly surface: TerrainSurface,
    private readonly rig: TerrainCameraRig,
    private readonly tree: PatchTree,
    private readonly meshes: () => PatchMeshes,
    /** A tile water mask came or went over this square (the near trees rebuild if it touches them). */
    private readonly waterMaskChanged: (x: number, y: number, width: number) => void,
    private readonly clearPatches: () => void,
  ) {}

  setLoader(loader: TileLoader | undefined, requireHeights: boolean): void {
    if (this.requireHeights !== requireHeights) {
      this.requireHeights = requireHeights;
      this.clearPatches();
    }
    if (this.loader === loader) return;
    this.loader = loader;
    this.invalidate();
  }

  /** Repaint the ground textures: all of them, the tiles overlapping a world `region`, or one tile by its key.
   * A tile keeps showing its current texture until the replacement is built and uploaded (swap on ready). */
  invalidate(region?: Region): void {
    if (region === undefined) this.stale = 'all';
    else if (!this.stale) this.stale = [region];
    else if (this.stale !== 'all') this.stale.push(region);
    this.context.request();
  }

  /** The whole-map material (a map texture given by the owner). */
  setWholeMap(source: TexImageSource): void {
    const dimensions = source as { width?: number; naturalWidth?: number; videoWidth?: number };
    this.fallbackPixels = dimensions.videoWidth || dimensions.naturalWidth || dimensions.width || 1;
    if (this.context.contextLost()) return;
    this.release(this.material);
    this.material = this.resources.uploadTexture(source);
    const raised = terrain3dRaisedTexture(source);
    if (raised) this.raised.set(this.material, this.resources.uploadTexture(raised));
    this.context.request();
  }

  /** Applies the invalidations of the last frames: stale tiles reload (the old texture stays until replaced). */
  applyStale(): void {
    const stale = this.stale;
    if (!stale) return;
    this.stale = undefined;
    // A material revision cancels tile work through patch.revision below. Geometry jobs,
    // height grids and tree placement belong to the surface epoch, which stays intact.
    // Without a loader nothing would replace them: the whole-map material takes over at once.
    const drop = !this.loader;
    for (const patch of this.tree.patches.values()) {
      const t = patch.tile;
      if (stale !== 'all' && !stale.some(r => (typeof r === 'string' ? r === t.key : t.x < r.maxX && t.x + t.width > r.minX && t.y < r.maxY && t.y + t.width > r.minY))) continue;
      ++patch.revision;
      if (patch.pendingTexture) this.release(patch.pendingTexture);
      patch.pendingTexture = undefined;
      patch.pendingTextureBytes = 0;
      patch.pendingHeights = undefined;
      patch.status = 'idle';
      if (drop) {
        if (patch.texture) this.release(patch.texture);
        patch.texture = undefined;
        patch.textureBytes = 0;
        patch.textureFadeStart = 0;
        patch.textureProgress = 0;
        patch.materialParent = undefined;
      }
    }
  }

  /** Starts the tile loads of this frame, nearest wanted first, within the concurrency and per-frame budgets. */
  load(): void {
    const context = this.context,
      tree = this.tree,
      meshes = this.meshes();
    if (!this.loader || !context.active || context.contextLost()) return;
    const queue = this.requireHeights ? [...new Set([...meshes.needed, ...tree.desired])] : tree.desired;
    let started = 0;
    for (const patch of queue) {
      if (this.jobs.size >= (context.options.tileJobsConcurrent ?? 2) || started >= (context.options.tileJobsPerFrame ?? 2)) break;
      if (patch.tile.level === 0) continue;
      const preview = (context.useMapShader || !!context.look.paperMap) && context.frameInteracting && !this.requireHeights;
      const footprint = (patch.tile.width * this.rig.frameGeometry().focal) / Math.max(this.rig.camera.distance, 1);
      const pixels = projectedTexturePixels(TILE_PIXELS, footprint, this.rig.dpr(), context.captureMode || this.requireHeights);
      // A moving preview never displaces a completed full tile.
      if (patch.status === 'ready' && ((patch.preview && !preview) || (context.captureMode && !patch.exact) || (!preview && (patch.texturePixels ?? 0) < pixels))) patch.status = 'idle';
      if (patch.status !== 'idle') continue;
      // Map ground: while the view moves, a tile with a loaded ancestor keeps showing that ancestor stretched. A preview
      // only holds the 2D raster tiles cached so far and showed paper (white squares) wherever they were missing.
      if (preview && !context.ground && !patch.texture && this.texturedAncestor(patch)) continue;
      const job = {},
        epoch = context.epoch,
        revision = patch.revision,
        loader = this.loader,
        exact = context.captureMode;
      const current = (): boolean => epoch === context.epoch && revision === patch.revision && !context.disposed && tree.patches.get(patch.tile.key) === patch;
      patch.status = 'loading';
      this.jobs.add(job);
      ++started;
      // In its own task: a synchronous tile paint must not hold back the frame that asked for it.
      void new Promise<void>(resolve => setTimeout(resolve))
        .then(() => {
          if (epoch !== context.epoch || revision !== patch.revision || context.disposed) throw new Error('Tuile abandonnée.');
          return loader({
            ...patch.tile,
            pixels,
            preview,
            exact,
            prepare: work => context.preparation.run(work, current, () => patch.tile.level * 1e9 + Math.hypot(patch.tile.x + patch.tile.width / 2 - this.rig.camera.x, patch.tile.y + patch.tile.width / 2 - this.rig.camera.y)),
          });
        })
        .then(async result => {
          const content = typeof result === 'object' && result !== null && 'texture' in result ? (result as Terrain3dTileContent) : { texture: result as TexImageSource };
          const source = content.texture;
          if (!current() || context.contextLost()) {
            if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
            return;
          }
          if (this.requireHeights && !content.height) throw new Error('Tuile de relief 3D sans grille d’altitude.');
          let deferred = false;
          if (content.height) {
            const heights = await context.preparation.run(meshes.decodedGrid(patch.tile, content.height), current, patch.tile.level * 1e9);
            const unchanged = patch.hasHeight && patch.heights?.every((value, i) => Math.abs(value - heights[i]) < 0.0001);
            if (!unchanged) {
              if (patch.heights && tree.containsLivePatch(patch)) {
                patch.pendingHeights = heights;
                deferred = true;
              } else meshes.installHeights(patch, heights);
            }
          }
          if (!current() || context.contextLost()) {
            if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
            return;
          }
          this.install(patch, content, deferred, preview, exact);
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
          this.jobs.delete(job);
          // A new frame selects the current view before requesting more work.
          // In particular, a cancelled generation must not spin a promise loop.
          if (!context.disposed) context.request();
        });
    }
  }

  /** Uploads a painted tile with its companions; it replaces the patch's texture at once, or waits for its heights. */
  private install(patch: Patch, content: Terrain3dTileContent, deferred: boolean, preview: boolean, exact: boolean): void {
    const source = content.texture,
      resources = this.resources;
    const gutter = Math.max(0, Math.min(8, Math.round(content.gutter ?? 0)));
    const texture = resources.uploadTexture(source);
    let textureBytes = materialBytes(source);
    const raised = terrain3dRaisedTexture(source);
    if (raised) {
      this.raised.set(texture, resources.uploadTexture(raised));
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
      this.semantic.set(texture, { texture: resources.uploadTexture(overlay), pixels: size - 2 * semanticGutter, gutter: semanticGutter, atlas: !!content.ground, semantic: !!content.semantic });
      textureBytes += materialBytes(overlay);
    }
    if (content.water) {
      const water = content.water,
        mask = resources.uploadWaterMask(water);
      this.waterMasks.set(texture, { texture: mask, rect: [water.x, water.y, water.width], bytes: water.alpha.byteLength, water });
      this.waterMaskChanged(water.x, water.y, water.width);
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
      if (patch.texture) this.release(patch.texture);
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
  }

  /** The finest loaded texture covering `patch` (its own, an ancestor's, or the whole map), for the LOD statistics. */
  closestTexture(patch: Patch): { texture: WebGLTexture; rect: [number, number, number, number]; texel: number; ready: boolean } {
    const tile = patch.tile,
      layer = this.surface.layer!;
    let [level, ix, iy] = tile.key.split('/').map(Number);
    while (level >= 0) {
      const parent = this.tree.patches.get(`${level}/${ix}/${iy}`);
      if (parent?.texture) {
        parent.used = this.tree.clock;
        this.tree.kept.add(parent.tile.key);
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
    return { texture: this.material, rect: [(tile.x - layer.x) / layer.width, (tile.y - layer.y) / layer.width, tile.width / layer.width, tile.width / layer.width], texel: layer.width / this.fallbackPixels, ready: !this.loader || tile.level === 0 };
  }

  /** Whether a loaded tile texture (not the whole-map fallback) covers `patch` through one of its ancestors. */
  private texturedAncestor(patch: Patch): boolean {
    let [level, ix, iy] = patch.tile.key.split('/').map(Number);
    while (--level > 0) {
      ix = Math.floor(ix / 2);
      iy = Math.floor(iy / 2);
      if (this.tree.patches.get(`${level}/${ix}/${iy}`)?.texture) return true;
    }
    return false;
  }

  private protect(ref: MaterialRef): void {
    if (!ref.tile) return;
    const owner = this.tree.patches.get(ref.tile.key);
    if (owner?.texture === ref.texture) {
      this.tree.kept.add(ref.tile.key);
      owner.used = this.tree.clock;
    }
  }

  /** The material a patch draws with: its own tile fading in over its parent's, or the nearest fallback. */
  materialFor(patch: Patch, geometryBlend = 1, depth = 0): PatchMaterial {
    if (patch.materialParent) {
      const ref = patch.materialParent;
      const retained = ref.tile ? this.tree.patches.get(ref.tile.key)?.texture === ref.texture : this.material === ref.texture;
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
      this.protect(own);
      return { from: own, to: own, blend: 1, ready: true };
    }
    let fallback: PatchMaterial;
    if (patch.materialParent) {
      const ref = patch.materialParent;
      this.protect(ref);
      fallback = { from: ref, to: ref, blend: 1, ready: true };
    } else {
      const [level, x, y] = patch.tile.key.split('/').map(Number);
      let parent: Patch | undefined,
        ix = x,
        iy = y;
      for (let l = level - 1; l >= 0; l--) {
        ix = Math.floor(ix / 2);
        iy = Math.floor(iy / 2);
        const candidate = this.tree.patches.get(`${l}/${ix}/${iy}`);
        if (candidate?.texture) {
          parent = candidate;
          break;
        }
      }
      if (parent && depth < 32) fallback = this.materialFor(parent, 1, depth + 1);
      else {
        const base = { texture: this.material, pixels: this.fallbackPixels, gutter: this.fallbackGutter };
        fallback = { from: base, to: base, blend: 1, ready: !this.loader || level === 0 };
      }
    }
    if (!own || fallback.blend < 1) return fallback;
    const now = this.context.now;
    if (!patch.textureFadeStart) {
      patch.textureFadeStart = now;
      patch.textureUpdated = now;
    }
    patch.materialParent ??= fallback.to;
    const t = (patch.textureProgress = Math.min(1, patch.textureProgress + Math.min(50, Math.max(0, now - patch.textureUpdated)) / TEXTURE_FADE_MS));
    patch.textureUpdated = now;
    const blend = t * t * (3 - 2 * t) * morphs(patch.materialParent);
    if (t < 1) this.context.animating = true;
    this.protect(own);
    this.protect(patch.materialParent);
    return { from: patch.materialParent, to: own, blend, ready: true };
  }

  /** Where `tile` lies in the texture of `ref`, inside its gutter and one-texel border. */
  textureRect(ref: MaterialRef, tile: Terrain3dTile): [number, number, number, number] {
    const source = ref.tile ?? this.surface.layer!,
      pixels = ref.pixels,
      gutter = 1 + (ref.gutter ?? 0),
      total = pixels + 2 * gutter;
    const x = (tile.x - source.x) / source.width,
      y = (tile.y - source.y) / source.width,
      size = tile.width / source.width;
    return [(gutter + x * pixels) / total, (gutter + y * pixels) / total, (size * pixels) / total, (size * pixels) / total];
  }

  /** Where `tile` lies in the semantic overlay of `ref` (ink), or in its ground half of the atlas (`ground`). */
  overlayRect(ref: MaterialRef, tile: Terrain3dTile, ground = false): [number, number, number, number] {
    const overlay = this.semantic.get(ref.texture);
    if (!overlay) return [0, 0, 0, 0];
    const r = this.textureRect({ ...ref, pixels: overlay.pixels, gutter: overlay.gutter }, tile);
    if (!overlay.atlas) return ground ? [0, 0, 0, 0] : r;
    const side = overlay.pixels + 2 * overlay.gutter + 2,
      w = 2 * side + 2,
      h = side + 2;
    return [(1 + (ground ? 0 : side) + r[0] * side) / w, (1 + r[1] * side) / h, (r[2] * side) / w, (r[3] * side) / h];
  }

  /** Releases a material tile with its raised, water and semantic companions. */
  release(texture: WebGLTexture): void {
    const raised = this.raised.get(texture);
    if (raised) {
      this.resources.deleteTexture(raised);
      this.raised.delete(texture);
    }
    const mask = this.waterMasks.get(texture);
    if (mask) {
      this.resources.deleteTexture(mask.texture);
      this.waterMasks.delete(texture);
      this.waterMaskChanged(...mask.rect);
    }
    const semantic = this.semantic.get(texture);
    if (semantic) {
      this.resources.deleteTexture(semantic.texture);
      this.semantic.delete(texture);
    }
    this.resources.deleteTexture(texture);
  }

  /** Displayed water cover at a point from the finest tile water mask holding it (nearest texel). */
  waterAt(x: number, y: number): number {
    let best: NonNullable<Terrain3dTileContent['water']> | undefined;
    for (const mask of this.waterMasks.values()) {
      const w = mask.water;
      if (w && x >= w.x && y >= w.y && x < w.x + w.width && y < w.y + w.width && (!best || w.width < best.width)) best = w;
    }
    if (!best) return 0;
    const i = Math.min(best.n - 1, Math.floor(((x - best.x) / best.width) * best.n)),
      j = Math.min(best.n - 1, Math.floor(((y - best.y) / best.width) * best.n));
    return best.alpha[j * best.n + i] / 255;
  }
}
