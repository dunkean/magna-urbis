/**
 * Visible quadtree selection with split/merge hysteresis, called once per terrain frame.
 * Reads/writes: Reads camera geometry, height bounds and previous splits; writes root, desired/protected patches, split keys and cache clock on the supplied context.
 */
import { Patch, FrameGeometry, Vec3, Node } from './terrainTypes';
import { FOV, GRID, TILE_PIXELS, MAX_LEAVES, MERGE_ERROR, SPLIT_ERROR } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

export function nodeError(context: Terrain3dContext, patch: Patch, frame: FrameGeometry): number {
  const tile = patch.tile,
    c = context.camera;
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
  // AABB/plane support tests avoid the very loose overlapping spheres that
  // consume the leaf budget around a quadtree junction at close zoom.
  if (dot(frame.forward) + extent(frame.forward) <= 0.02 || outside(frame.right, (tan * context.width) / context.height, 1) || outside(frame.right, (tan * context.width) / context.height, -1) || outside(frame.up, tan, 1) || outside(frame.up, tan, -1)) return -1;
  const ex = c.x + frame.eye[0],
    ey = c.y + frame.eye[2];
  const dx = Math.max(tile.x - ex, 0, ex - tile.x - tile.width),
    dz = Math.max(tile.y - ey, 0, ey - tile.y - tile.width);
  const eyeHeight = frame.targetHeight + frame.eye[1];
  const dy = Math.max(patch.minHeight * c.exaggeration - eyeHeight, 0, eyeHeight - patch.maxHeight * c.exaggeration);
  const distance = Math.max(c.distance * 0.12, Math.hypot(dx, dz, dy));
  return ((tile.width / GRID) * frame.focal) / distance;
}

export function select(context: Terrain3dContext, frame: FrameGeometry): void {
  ++context.clock;
  const maxLevel = Math.max(0, Math.ceil(Math.log2(context.layer!.width / (TILE_PIXELS / (context.maxScale() * context.dpr())))), Math.ceil(Math.log2(context.layer!.width / ((GRID * 2) / context.maxScale()))));
  const make = (patch: Patch, error: number): Node => ({ patch, error, wantsSplit: false, blend: 0, updated: context.now, ready: false, visible: true, moving: false, birth: 1, birthUpdated: 0 });
  const rootPatch = context.patch(0, 0, 0),
    wanted = make(rootPatch, context.nodeError(rootPatch, frame));
  const leaves: Node[] = [wanted],
    splits = new Set<string>();
  while (leaves.length < MAX_LEAVES - 3) {
    let candidate: Node | undefined,
      priority = 0;
    for (const node of leaves) {
      const threshold = context.splits.has(node.patch.tile.key) ? MERGE_ERROR : SPLIT_ERROR;
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
        const patch = context.patch(tile.level + 1, ix * 2 + x, iy * 2 + y),
          error = context.nodeError(patch, frame);
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
    node.error = context.nodeError(node.patch, frame);
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
  context.root = reconcile(wanted, context.root);
  context.splits = splits;
  context.desired = leaves.filter(node => node.error >= 0).map(node => node.patch);
  context.desired.sort((a, b) => Math.hypot(a.tile.x + a.tile.width / 2 - context.camera.x, a.tile.y + a.tile.width / 2 - context.camera.y) - Math.hypot(b.tile.x + b.tile.width / 2 - context.camera.x, b.tile.y + b.tile.width / 2 - context.camera.y));
  context.protected = new Set(context.desired.map(p => p.tile.key));
  context.protected.add(rootPatch.tile.key);
}
