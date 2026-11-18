/**
 * The quadtree of a 3D terrain view: patches by tile key (bounds, mesh and material handles), the visible tree chosen
 * each frame by screen-space error with split/merge hysteresis, the tiles wanted and kept, and the bounded patch cache.
 * The frame loop selects and trims it; meshes, tile materials and morphs read and fill its patches.
 */
import { FOV, GRID, TILE_PIXELS, MAX_LEAVES, MERGE_ERROR, SPLIT_ERROR, CACHE_BYTES, MAX_CACHE } from './policy';
import type { TerrainViewContext } from './context';
import type { FrameGeometry, Node, Patch, TerrainResources, Vec3 } from './contract';
import type { TerrainCameraRig } from './camera';
import type { TerrainSurface } from './surface';

export class PatchTree {
  patches = new Map<string, Patch>();
  root?: Node;
  /** Leaves wanted this frame, nearest first: tile loads follow this order. */
  desired: Patch[] = [];
  /** Tiles drawn or needed as a fallback this frame: the cache never evicts them. */
  kept = new Set<string>();
  /** Cache clock: a patch's `used` is the last frame that needed it. */
  clock = 0;
  /** Nodes split last frame: they merge back only below the lower error (hysteresis). */
  private splits = new Set<string>();

  constructor(
    private readonly context: TerrainViewContext,
    private readonly surface: TerrainSurface,
    private readonly rig: TerrainCameraRig,
    private readonly resources: TerrainResources,
    /** Releases a material tile with its raised, water and semantic companions (tile materials). */
    private readonly releaseMaterial: (texture: WebGLTexture) => void,
    /** Whether tiles carry their own height grids (a patch is covered only once it has them). */
    private readonly requireHeights: () => boolean,
  ) {}

  /** Releases every patch and forgets the tree (the surface changed). */
  clear(): void {
    for (const patch of this.patches.values()) this.releasePatch(patch);
    this.patches.clear();
    this.root = undefined;
    this.desired = [];
    this.kept.clear();
    this.splits.clear();
  }

  /** A lost WebGL context took the patches' objects with it. */
  forget(): void {
    this.patches.clear();
    this.root = undefined;
  }

  patch(level: number, ix: number, iy: number): Patch {
    const layer = this.surface.layer!,
      key = `${level}/${ix}/${iy}`;
    let patch = this.patches.get(key);
    if (!patch) {
      const width = layer.width / 2 ** level,
        x = layer.x + ix * width,
        y = layer.y + iy * width;
      const centre = this.surface.surface(x + width / 2, y + width / 2, width / TILE_PIXELS, false);
      let low = centre,
        high = centre;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const height = this.surface.surface(x + u * width, y + v * width, width / TILE_PIXELS, false);
        low = Math.min(low, height);
        high = Math.max(high, height);
      }
      // Keep selection bounds independent of whether a mesh has been built or
      // evicted. Changing them during preparation makes adjacent LODs oscillate.
      const padding = Math.min(this.surface.heightRange, this.surface.maxSlope * width * 0.6 + this.surface.heightRange * 0.003);
      low -= padding;
      high += padding;
      patch = {
        tile: { key, x, y, width, level, pixels: TILE_PIXELS },
        textureBytes: 0,
        meshBytes: 0,
        heightOrigin: centre,
        minHeight: low,
        maxHeight: high,
        used: this.clock,
        status: 'idle',
        revision: 0,
        textureFadeStart: 0,
        textureProgress: 0,
        textureUpdated: 0,
        hasHeight: false,
        coherentReady: false,
        pendingTextureBytes: 0,
      };
      this.patches.set(key, patch);
    }
    patch.used = this.clock;
    return patch;
  }

  private nodeError(patch: Patch, frame: FrameGeometry): number {
    const tile = patch.tile,
      c = this.rig.camera;
    const x = tile.x + tile.width / 2 - c.x,
      y = ((patch.minHeight + patch.maxHeight) / 2) * c.exaggeration - frame.targetHeight;
    const z = tile.y + tile.width / 2 - c.y;
    const relative: Vec3 = [x - frame.eye[0], y - frame.eye[1], z - frame.eye[2]];
    const dot = (v: Vec3): number => relative[0] * v[0] + relative[1] * v[1] + relative[2] * v[2];
    const half = tile.width / 2,
      vertical = ((patch.maxHeight - patch.minHeight) * c.exaggeration) / 2;
    const extent = (plane: Vec3): number => Math.abs(plane[0]) * half + Math.abs(plane[1]) * vertical + Math.abs(plane[2]) * half;
    const tan = Math.tan(FOV / 2);
    const outside = (axis: Vec3, tangent: number, sign: number): boolean => {
      const plane: Vec3 = [axis[0] * sign - frame.forward[0] * tangent, axis[1] * sign - frame.forward[1] * tangent, axis[2] * sign - frame.forward[2] * tangent];
      return dot(plane) > extent(plane);
    };
    const aspect = this.context.width / this.context.height;
    // AABB/plane support tests avoid the very loose overlapping spheres that
    // consume the leaf budget around a quadtree junction at close zoom.
    if (dot(frame.forward) + extent(frame.forward) <= 0.02 || outside(frame.right, tan * aspect, 1) || outside(frame.right, tan * aspect, -1) || outside(frame.up, tan, 1) || outside(frame.up, tan, -1)) return -1;
    const ex = c.x + frame.eye[0],
      ey = c.y + frame.eye[2];
    const dx = Math.max(tile.x - ex, 0, ex - tile.x - tile.width),
      dz = Math.max(tile.y - ey, 0, ey - tile.y - tile.width);
    const eyeHeight = frame.targetHeight + frame.eye[1];
    const dy = Math.max(patch.minHeight * c.exaggeration - eyeHeight, 0, eyeHeight - patch.maxHeight * c.exaggeration);
    const distance = Math.max(c.distance * 0.12, Math.hypot(dx, dz, dy));
    return ((tile.width / GRID) * frame.focal) / distance;
  }

  /** Chooses the visible tree of this frame and reconciles it with the previous one (morph state is kept). */
  select(frame: FrameGeometry): void {
    ++this.clock;
    const layer = this.surface.layer!,
      maxScale = this.rig.maxScale();
    const maxLevel = Math.max(0, Math.ceil(Math.log2(layer.width / (TILE_PIXELS / (maxScale * this.rig.dpr())))), Math.ceil(Math.log2(layer.width / ((GRID * 2) / maxScale))));
    const now = this.context.now;
    const make = (patch: Patch, error: number): Node => ({ patch, error, wantsSplit: false, blend: 0, updated: now, ready: false, visible: true, moving: false, birth: 1, birthUpdated: 0 });
    const rootPatch = this.patch(0, 0, 0),
      wanted = make(rootPatch, this.nodeError(rootPatch, frame));
    const leaves: Node[] = [wanted],
      splits = new Set<string>();
    while (leaves.length < MAX_LEAVES - 3) {
      let candidate: Node | undefined,
        priority = 0;
      for (const node of leaves) {
        const threshold = this.splits.has(node.patch.tile.key) ? MERGE_ERROR : SPLIT_ERROR;
        const score = node.error / threshold;
        if (score > 1 && node.patch.tile.level < maxLevel && score > priority) {
          candidate = node;
          priority = score;
        }
      }
      if (!candidate) break;
      const tile = candidate.patch.tile,
        [ix, iy] = tile.key.split('/').slice(1).map(Number),
        children: Node[] = [];
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const patch = this.patch(tile.level + 1, ix * 2 + x, iy * 2 + y),
            error = this.nodeError(patch, frame);
          if (error >= 0) children.push(make(patch, error));
        }
      if (!children.length) {
        candidate.error = 0;
        continue;
      }
      candidate.children = children;
      candidate.wantsSplit = true;
      splits.add(tile.key);
      leaves.splice(leaves.indexOf(candidate), 1, ...children);
    }
    const close = (node: Node): void => {
      node.wantsSplit = false;
      node.error = this.nodeError(node.patch, frame);
      node.visible = node.error >= 0;
      node.children?.forEach(close);
    };
    const reconcile = (next: Node, previous?: Node): Node => {
      if (!previous || previous.patch !== next.patch) return next;
      if (!previous.visible) {
        previous.birth = 0;
        previous.birthUpdated = 0;
      }
      previous.error = next.error;
      previous.visible = true;
      previous.wantsSplit = !!next.children;
      if (next.children) {
        const old = new Map(previous.children?.map(child => [child.patch.tile.key, child]));
        previous.children = next.children.map(child => {
          const oldChild = old.get(child.patch.tile.key),
            result = reconcile(child, oldChild);
          if (result !== oldChild && previous.blend > 0) {
            result.birth = 0;
            result.birthUpdated = 0;
          }
          return result;
        });
      } else previous.children?.forEach(close);
      return previous;
    };
    const c = this.rig.camera;
    this.root = reconcile(wanted, this.root);
    this.splits = splits;
    this.desired = leaves.filter(node => node.error >= 0).map(node => node.patch);
    this.desired.sort((a, b) => Math.hypot(a.tile.x + a.tile.width / 2 - c.x, a.tile.y + a.tile.width / 2 - c.y) - Math.hypot(b.tile.x + b.tile.width / 2 - c.x, b.tile.y + b.tile.width / 2 - c.y));
    this.kept = new Set(this.desired.map(p => p.tile.key));
    this.kept.add(rootPatch.tile.key);
  }

  /** Whether `patch` is drawn in the current tree. */
  containsLivePatch(patch: Patch): boolean {
    const visit = (node: Node): boolean => node.visible && (node.patch === patch || !!node.children?.some(visit));
    return !!this.root && visit(this.root);
  }

  /** Whether the drawn subtree of `node` shows tile textures of its own, with no stretched fallback. */
  subtreeTextured(node: Node): boolean {
    if (!node.visible || (node.patch.texture && node.patch.vao)) return true;
    return !!node.children?.length && node.blend >= 1 && node.children.every(child => this.subtreeTextured(child));
  }

  /** Whether the drawn subtree of `node` has every mesh it needs (and its heights, when tiles carry them). */
  covered(node: Node): boolean {
    return !node.visible || (!!node.patch.vao && (!this.requireHeights() || node.patch.tile.level === 0 || (node.patch.hasHeight && node.patch.coherentReady))) || (!!node.children?.length && node.children.every(child => this.covered(child)));
  }

  private releasePatch(patch: Patch, preserveMesh = false): void {
    if (!preserveMesh) this.resources.releaseMesh(patch);
    if (patch.texture) this.releaseMaterial(patch.texture);
    if (patch.pendingTexture) this.releaseMaterial(patch.pendingTexture);
  }

  /** Evicts the least recently used patches beyond the cache budget; current ancestors keep their mesh. */
  trim(): void {
    let bytes = 0;
    for (const patch of this.patches.values()) bytes += patch.textureBytes + patch.pendingTextureBytes + patch.meshBytes;
    const current = new Set<string>(),
      retain = (node: Node): void => {
        current.add(node.patch.tile.key);
        node.children?.forEach(retain);
      };
    if (this.root) retain(this.root);
    const old = [...this.patches.values()].filter(patch => !this.kept.has(patch.tile.key) && patch.status !== 'loading').sort((a, b) => a.used - b.used);
    for (const patch of old) {
      if (bytes <= CACHE_BYTES && this.patches.size <= MAX_CACHE) break;
      const keepMesh = current.has(patch.tile.key);
      bytes -= patch.textureBytes + patch.pendingTextureBytes + (keepMesh ? 0 : patch.meshBytes);
      this.releasePatch(patch, keepMesh);
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
      } else this.patches.delete(patch.tile.key);
    }
  }
}
