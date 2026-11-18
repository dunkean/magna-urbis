/**
 * Quadtree morph progression and draw-piece collection, called by terrainFrame.
 * Reads/writes: Reads selected nodes and material readiness; writes node blends, seam/picking draw data, protected keys and animation demand on the supplied context.
 */
import { type TerrainStitchedPiece } from '../terrain3dStitch';
import { Node, RenderPiece, Patch, Terrain3dTile, PatchDraw } from './terrainTypes';
import { clamp, MORPH_MS, GRID } from './terrainPolicy';
import { skirtCorrection } from './patchSeams';
import type { Terrain3dContext } from './terrainContext';

export function advanceMorphs(context: Terrain3dContext, node: Node, incomingFull: boolean): void {
  if (!node.visible) {
    node.blend = 0;
    node.children = undefined;
    node.updated = context.now;
    node.moving = false;
    return;
  }
  const replacingHeights = node.children?.some(child => !!child.patch.pendingHeights);
  const allowed = incomingFull && node.wantsSplit && !replacingHeights,
    closed = node.blend === 0;
  for (const child of node.children ?? []) {
    if (!allowed) child.wantsSplit = false;
    context.advanceMorphs(child, allowed && node.blend >= 1 && child.birth >= 1);
  }
  const childrenReady = !!node.children?.length && node.children.every(child => context.covered(child) && (!closed || !node.patch.seamSnapshot || child.patch.parentSeam === node.patch.seamSnapshot));
  const raw = clamp((node.error - 2.15) / (3.6 - 2.15), 0, 1);
  let target = allowed && childrenReady && !replacingHeights ? raw * raw * (3 - 2 * raw) : 0;
  const descendantsOpen = node.children?.some(child => child.blend > 0);
  // Map ground, zooming out: the finer tiles already on the GPU stay drawn until the coarser tile has its own texture,
  // instead of merging onto a stretched far ancestor or the whole-map fallback (blank squares).
  const awaitsOwn = target < node.blend && !context.groundSettings && !!context.tileLoader && node.patch.tile.level > 0 && !node.patch.texture && node.patch.status !== 'failed' && !!node.children?.length && node.children.every(child => context.subtreeTextured(child));
  if (target < node.blend && (descendantsOpen || !node.patch.vao || awaitsOwn || context.materialFor(node.patch).blend < 1)) target = node.blend;
  if (childrenReady && !node.ready) {
    node.ready = true;
    node.updated = context.now;
  }
  let dt = context.now - node.updated;
  if (dt > 100 && !node.moving) dt = 0;
  node.updated = context.now;
  const delta = Math.min(50, Math.max(0, dt)) / MORPH_MS;
  if (Math.abs(target - node.blend) <= 0.001) {
    node.blend = target;
    node.moving = false;
  } else {
    node.blend += clamp(target - node.blend, -delta, delta);
    node.moving = true;
    context.animating = true;
  }
  // Mesh preparation refreshes the parent endpoint before opening a branch.
  // Keep its coarse surface visible while those rows are being prepared.
  if (node.blend === 0 && replacingHeights && !descendantsOpen) {
    for (const child of node.children ?? []) if (child.patch.pendingHeights) context.installHeights(child.patch, child.patch.pendingHeights);
    node.ready = false;
    node.updated = context.now;
    context.animating = true;
  }
  if (node.children && !node.wantsSplit && node.blend === 0 && !descendantsOpen) node.children = undefined;
  if (node.children && node.blend < 1) context.protected.add(node.patch.tile.key);
}

export function collectPieces(context: Terrain3dContext, node: Node, pieces: RenderPiece[], incomingMorph: number, ancestor?: { patch: Patch; morph: number }): void {
  if (!node.visible) return;
  if (node.patch.vao && incomingMorph > 0 && node.birth < 1) {
    if (!node.birthUpdated) node.birthUpdated = context.now;
    node.birth = Math.min(1, node.birth + Math.min(50, context.now - node.birthUpdated) / MORPH_MS);
    node.birthUpdated = context.now;
    context.animating ||= node.birth < 1;
  }
  const morph = incomingMorph * node.birth;
  const fallback = node.patch.vao ? { patch: node.patch, morph } : ancestor;
  if (node.children?.length && node.blend > 0) {
    // A new visible quadrant may still be loading. Keep all ready siblings
    // and clip the nearest coarse mesh to that quadrant alone; falling back
    // the entire ancestor for one missing child is a one-frame global pop.
    node.children.forEach(child => context.collectPieces(child, pieces, node.blend, fallback));
    return;
  }
  const selected = node.patch.vao ? { patch: node.patch, morph } : fallback;
  if (!selected?.patch.field) return;
  const { patch, morph: amount } = selected,
    tile = patch.tile,
    field = patch.field!;
  pieces.push({
    ...tile,
    patch,
    morph: amount,
    field,
    heightOrigin: patch.heightOrigin,
    clip: node.patch.tile,
    cells: GRID,
    key: `${tile.key}:${node.patch.tile.key}`,
    vertex: (x, y) => {
      const at = (y * (GRID + 1) + x) * 6;
      return [patch.heightOrigin + field[at + 3] + (field[at] - field[at + 3]) * amount, field[at + 4] + (field[at + 1] - field[at + 4]) * amount, field[at + 5] + (field[at + 2] - field[at + 5]) * amount];
    },
    read: (x, y, out) => {
      const at = (y * (GRID + 1) + x) * 6;
      out[0] = patch.heightOrigin + field[at + 3] + (field[at] - field[at + 3]) * amount;
      out[1] = field[at + 4] + (field[at + 1] - field[at + 4]) * amount;
      out[2] = field[at + 5] + (field[at + 2] - field[at + 5]) * amount;
    },
  });
}

/** The backend-independent part of a patch draw: material blend, picking grid and seam corrections. */
export function patchDraw(context: Terrain3dContext, patch: Patch, drawn: Patch[], incomingMorph: number, clip: Terrain3dTile, stitched: TerrainStitchedPiece): PatchDraw | undefined {
  if (!patch.vao) return undefined;
  const material = context.materialFor(patch, incomingMorph),
    c = context.camera;
  context.protected.add(patch.tile.key);
  patch.used = context.clock;
  drawn.push(patch);
  const tile = patch.tile;
  context.displayedGrids.push({
    ...tile,
    clip,
    cells: GRID,
    height: (x, y) => {
      return stitched.vertex(x, y)[0] * c.exaggeration;
    },
  });
  return { patch, morph: incomingMorph, clip, material, textureRect: context.textureRect(material.to, tile), previousRect: context.textureRect(material.from, tile), correction: skirtCorrection(stitched) };
}
