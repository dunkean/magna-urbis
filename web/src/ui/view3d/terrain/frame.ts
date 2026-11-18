/**
 * The frame loop of a 3D terrain view: one draw per requested animation frame, which selects the tree, starts mesh and
 * tile work, advances the LOD morphs, stitches the drawn pieces, hands the patch draws to the backend and trims the
 * cache. It also keeps what was drawn (picking grids, LOD statistics) and says when the view is settled.
 */
import { displayQualityUniform } from '../../../render/displayQuality';
import { reportRenderStats } from '../../../render/renderMode';
import { stitchTerrainPieces, type TerrainStitchedPiece } from '../../terrain3dStitch';
import type { TerrainPickGrid } from '../../terrain3dPicking';
import { GRID, MORPH_MS, TERRAIN_3D_MAX_SCALE, clamp } from './policy';
import { sameSurface, SKIRT_FLOATS, seamDiffers, skirtCorrection } from './patchSeams';
import type { TerrainViewContext } from './context';
import type { FrameGeometry, Node, Patch, PatchDraw, RenderPiece, Terrain3dTile } from './contract';
import type { TerrainParts } from './parts';

export type TerrainLod = { tiles: number; ready: number; pending: number; level: number; metresPerTexel: number; metresPerVertex: number; maxScale: number; scale: number };

export class TerrainFrameLoop {
  /** Terrain grids of the patches drawn last frame, as seen (morphs and seams included): picking reads them. */
  displayedGrids: TerrainPickGrid[] = [];
  private displayedPieces: TerrainStitchedPiece[] = [];
  private stitchUpdated = 0;
  private frame = 0;
  private lod: TerrainLod = { tiles: 0, ready: 0, pending: 0, level: 0, metresPerTexel: 0, metresPerVertex: 0, maxScale: TERRAIN_3D_MAX_SCALE, scale: 0 };

  constructor(
    private readonly context: TerrainViewContext,
    private readonly parts: TerrainParts,
    /** The backend draws sky, patches, buildings and instances; returns whether buildings are still preparing. */
    private readonly render: (frame: FrameGeometry, width: number, height: number, draws: PatchDraw[]) => boolean,
    private readonly onRender?: () => void,
  ) {}

  request(): void {
    const context = this.context;
    if (!context.active || this.frame || context.disposed || context.contextLost()) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Drops a requested frame (the view stops, or its GL context is lost). */
  cancel(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** The surface changed: nothing drawn is kept. */
  clear(): void {
    this.displayedGrids = [];
    this.displayedPieces = [];
    this.stitchUpdated = 0;
  }

  /** Draws now; `fullQuality` builds every stream exactly (a capture). */
  draw(fullQuality = false): void {
    const context = this.context;
    if (!this.parts.surface.layer || !context.active || context.contextLost()) return;
    context.fullQualityCapture = fullQuality;
    try {
      this.drawFrame();
    } finally {
      context.fullQualityCapture = false;
    }
  }

  private drawFrame(): void {
    const context = this.context,
      { surface, rig, tree, meshes, tiles, buildings } = this.parts,
      layer = surface.layer;
    if (!layer) return;
    context.frameQuality = displayQualityUniform(!context.fullQualityCapture);
    context.frameInteracting = rig.interacting();
    const dpr = rig.dpr(),
      w = Math.max(1, Math.floor(context.width * dpr)),
      h = Math.max(1, Math.floor(context.height * dpr));
    if (context.canvas.width !== w || context.canvas.height !== h) {
      context.canvas.width = w;
      context.canvas.height = h;
    }
    context.now = performance.now();
    context.animating = false;
    tiles.applyStale();
    const frame = rig.frameGeometry();
    tree.select(frame);
    const preparing = meshes.prepare();
    tiles.load();
    if (tree.root) this.advanceMorphs(tree.root);
    const drawn: Patch[] = [],
      draws: PatchDraw[] = [];
    this.displayedGrids = [];
    const pieces: RenderPiece[] = [];
    if (tree.root) this.collectPieces(tree.root, pieces);
    const unchanged =
      pieces.length === this.displayedPieces.length &&
      pieces.every((piece, i) => {
        const previous = this.displayedPieces[i];
        return !previous.releasing && piece.key === previous.source.key && sameSurface(previous.source, piece);
      });
    if (!unchanged) {
      this.displayedPieces = stitchTerrainPieces(pieces, this.displayedPieces, context.now - this.stitchUpdated, { same: sameSurface, tail: SKIRT_FLOATS });
    }
    this.stitchUpdated = context.now;
    context.animating ||= this.displayedPieces.some(piece => piece.releasing);
    for (const stitched of this.displayedPieces) {
      const source = stitched.source as RenderPiece,
        patch = source.patch;
      if (source.morph === 1 && source.clip === patch.tile) {
        const old = patch.seamSnapshot,
          next = stitched.correction;
        if (!old || (patch.seamCompared !== next && seamDiffers(next, stitched.touched, old, patch.seamTouched))) {
          patch.seamSnapshot = next;
          patch.seamTouched = stitched.touched;
        }
        patch.seamCompared = next;
      }
      const draw = this.patchDraw(patch, drawn, source.morph, source.clip as Terrain3dTile, stitched);
      if (draw) draws.push(draw);
    }
    let finest = layer.width,
      texel = layer.width / tiles.fallbackPixels,
      ready = 0,
      level = 0;
    const buildingPreparing = this.render(frame, w, h, draws);
    reportRenderStats({ buildings3d: buildings.pass.lastDraw });
    for (const patch of drawn) {
      const material = tiles.closestTexture(patch);
      finest = Math.min(finest, patch.tile.width / GRID);
      texel = Math.min(texel, material.texel);
      level = Math.max(level, patch.tile.level);
      if (material.ready) ++ready;
    }
    this.lod = { tiles: drawn.length, ready, pending: tiles.jobs.size, level, metresPerTexel: texel, metresPerVertex: finest, maxScale: rig.maxScale(), scale: frame.focal / rig.camera.distance };
    tree.trim();
    this.onRender?.();
    if (preparing || buildingPreparing || context.animating) this.request();
  }

  /** Advances the split/merge morph of `node` and its children toward their wanted state. */
  private advanceMorphs(node: Node, incomingFull = true): void {
    const context = this.context,
      { tree, tiles, meshes } = this.parts,
      now = context.now;
    if (!node.visible) {
      node.blend = 0;
      node.children = undefined;
      node.updated = now;
      node.moving = false;
      return;
    }
    const replacingHeights = node.children?.some(child => !!child.patch.pendingHeights);
    const allowed = incomingFull && node.wantsSplit && !replacingHeights,
      closed = node.blend === 0;
    for (const child of node.children ?? []) {
      if (!allowed) child.wantsSplit = false;
      this.advanceMorphs(child, allowed && node.blend >= 1 && child.birth >= 1);
    }
    const childrenReady = !!node.children?.length && node.children.every(child => tree.covered(child) && (!closed || !node.patch.seamSnapshot || child.patch.parentSeam === node.patch.seamSnapshot));
    const raw = clamp((node.error - 2.15) / (3.6 - 2.15), 0, 1);
    let target = allowed && childrenReady && !replacingHeights ? raw * raw * (3 - 2 * raw) : 0;
    const descendantsOpen = node.children?.some(child => child.blend > 0);
    // Map ground, zooming out: the finer tiles already on the GPU stay drawn until the coarser tile has its own texture,
    // instead of merging onto a stretched far ancestor or the whole-map fallback (blank squares).
    const awaitsOwn = target < node.blend && !context.ground && !!tiles.loader && node.patch.tile.level > 0 && !node.patch.texture && node.patch.status !== 'failed' && !!node.children?.length && node.children.every(child => tree.subtreeTextured(child));
    if (target < node.blend && (descendantsOpen || !node.patch.vao || awaitsOwn || tiles.materialFor(node.patch).blend < 1)) target = node.blend;
    if (childrenReady && !node.ready) {
      node.ready = true;
      node.updated = now;
    }
    let dt = now - node.updated;
    if (dt > 100 && !node.moving) dt = 0;
    node.updated = now;
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
      for (const child of node.children ?? []) if (child.patch.pendingHeights) meshes.installHeights(child.patch, child.patch.pendingHeights);
      node.ready = false;
      node.updated = now;
      context.animating = true;
    }
    if (node.children && !node.wantsSplit && node.blend === 0 && !descendantsOpen) node.children = undefined;
    if (node.children && node.blend < 1) tree.kept.add(node.patch.tile.key);
  }

  /** The pieces drawn for `node`: its own mesh, its opening children, or the nearest ancestor clipped to it. */
  private collectPieces(node: Node, pieces: RenderPiece[], incomingMorph = 1, ancestor?: { patch: Patch; morph: number }): void {
    if (!node.visible) return;
    const now = this.context.now;
    if (node.patch.vao && incomingMorph > 0 && node.birth < 1) {
      if (!node.birthUpdated) node.birthUpdated = now;
      node.birth = Math.min(1, node.birth + Math.min(50, now - node.birthUpdated) / MORPH_MS);
      node.birthUpdated = now;
      this.context.animating ||= node.birth < 1;
    }
    const morph = incomingMorph * node.birth;
    const fallback = node.patch.vao ? { patch: node.patch, morph } : ancestor;
    if (node.children?.length && node.blend > 0) {
      // A new visible quadrant may still be loading. Keep all ready siblings
      // and clip the nearest coarse mesh to that quadrant alone; falling back
      // the entire ancestor for one missing child is a one-frame global pop.
      node.children.forEach(child => this.collectPieces(child, pieces, node.blend, fallback));
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
  private patchDraw(patch: Patch, drawn: Patch[], incomingMorph: number, clip: Terrain3dTile, stitched: TerrainStitchedPiece): PatchDraw | undefined {
    if (!patch.vao) return undefined;
    const { tiles, tree, rig } = this.parts,
      material = tiles.materialFor(patch, incomingMorph),
      c = rig.camera;
    tree.kept.add(patch.tile.key);
    patch.used = tree.clock;
    drawn.push(patch);
    const tile = patch.tile;
    this.displayedGrids.push({
      ...tile,
      clip,
      cells: GRID,
      height: (x, y) => {
        return stitched.vertex(x, y)[0] * c.exaggeration;
      },
    });
    return { patch, morph: incomingMorph, clip, material, textureRect: tiles.textureRect(material.to, tile), previousRect: tiles.textureRect(material.from, tile), correction: skirtCorrection(stitched) };
  }

  /** LOD statistics of the last frame, with what is still pending and whether the drawn pieces all have meshes. */
  lodInfo(): TerrainLod & { covered: boolean } {
    const context = this.context,
      { tree, tiles, trees, forest } = this.parts;
    const missing = !!tiles.loader && tree.desired.some(p => p.tile.level > 0 && (p.status === 'idle' || p.status === 'loading' || (p.preview && !context.frameInteracting)));
    const covered = context.active && this.lod.tiles > 0 && this.displayedPieces.length > 0 && this.displayedPieces.every(piece => !!(piece.source as RenderPiece).patch.vao);
    return { ...this.lod, covered, pending: tiles.jobs.size + Math.max(0, context.preparation.pending - trees.jobs) + Number(missing) + Number(!!tiles.stale) + forest.merges };
  }

  /** Whether the displayed frame is complete: every drawn tile has its own material and the ground
   * variant is ready (a backend switch waits for it before showing the new view). */
  isSettled(): boolean {
    const { surface, tiles, billboards, status } = this.parts,
      lod = this.lodInfo();
    return !!surface.layer && !tiles.stale && lod.tiles > 0 && lod.pending === 0 && lod.ready === lod.tiles && !this.context.frameInteracting && !billboards.dirty && billboards.ready() && (this.context.useMapShader || status.get('groundVariant') !== 'pending');
  }
}
