/**
 * Frame scheduling and backend-independent terrain orchestration, called by Terrain3d owners and animation callbacks.
 * Reads/writes: Reads active/capture state and camera; writes frame timing, draw demand, stitched/picking pieces and LOD statistics on the supplied context. Calls preparation and backend hooks in their original order.
 */
import { displayQualityUniform } from '../../render/displayQuality';
import { stitchTerrainPieces } from '../terrain3dStitch';
import { reportRenderStats } from '../../render/renderMode';
import { Patch, PatchDraw, RenderPiece, Terrain3dTile } from './terrainTypes';
import { sameSurface, SKIRT_FLOATS, seamDiffers } from './patchSeams';
import { GRID } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

export function setActive(context: Terrain3dContext, active: boolean): void {
  context.active = active;
  if (active) context.request();
  else {
    context.stopWalking();
    cancelAnimationFrame(context.frame);
    context.frame = 0;
    clearTimeout(context.settleTimer);
    context.cameraMovedAt = -Infinity;
    context.pointers.clear();
    context.gesture = undefined;
    context.element.classList.remove('drag');
  }
}

export function resize(context: Terrain3dContext, width: number, height: number): void {
  context.width = Math.max(1, width);
  context.height = Math.max(1, height);
  context.limitCamera();
  context.request();
}

export function request(context: Terrain3dContext): void {
  if (!context.active || context.frame || context.disposed || context.contextLost()) return;
  context.frame = requestAnimationFrame(() => {
    context.frame = 0;
    context.draw();
  });
}

export function draw(context: Terrain3dContext, fullQuality: boolean): void {
  if (!context.layer || !context.active || context.contextLost()) return;
  context.fullQualityCapture = fullQuality;
  try {
    context.drawFrame();
  } finally {
    context.fullQualityCapture = false;
  }
}

export function drawFrame(context: Terrain3dContext): void {
  if (!context.layer) return;
  context.frameQuality = displayQualityUniform(!context.fullQualityCapture);
  context.frameInteracting = context.interacting();
  const dpr = context.dpr(),
    w = Math.max(1, Math.floor(context.width * dpr)),
    h = Math.max(1, Math.floor(context.height * dpr));
  if (context.canvas.width !== w || context.canvas.height !== h) {
    context.canvas.width = w;
    context.canvas.height = h;
  }
  context.now = performance.now();
  context.animating = false;
  context.applyStaleTiles();
  const frame = context.frameGeometry();
  context.select(frame);
  const preparing = context.prepareMeshes();
  context.loadTiles();
  if (context.root) context.advanceMorphs(context.root);
  const drawn: Patch[] = [],
    draws: PatchDraw[] = [];
  context.displayedGrids = [];
  const pieces: RenderPiece[] = [];
  if (context.root) context.collectPieces(context.root, pieces);
  const unchanged =
    pieces.length === context.displayedPieces.length &&
    pieces.every((piece, i) => {
      const previous = context.displayedPieces[i];
      return !previous.releasing && piece.key === previous.source.key && sameSurface(previous.source, piece);
    });
  if (!unchanged) {
    context.displayedPieces = stitchTerrainPieces(pieces, context.displayedPieces, context.now - context.stitchUpdated, { same: sameSurface, tail: SKIRT_FLOATS });
  }
  context.stitchUpdated = context.now;
  context.animating ||= context.displayedPieces.some(piece => piece.releasing);
  for (const stitched of context.displayedPieces) {
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
    const draw = context.patchDraw(patch, drawn, source.morph, source.clip as Terrain3dTile, stitched);
    if (draw) draws.push(draw);
  }
  let finest = context.layer.width,
    texel = context.layer.width / context.fallbackPixels,
    ready = 0,
    level = 0;
  const buildingPreparing = context.renderFrame(frame, w, h, draws);
  reportRenderStats({ buildings3d: context.buildings.lastDraw });
  for (const patch of drawn) {
    const material = context.closestTexture(patch);
    finest = Math.min(finest, patch.tile.width / GRID);
    texel = Math.min(texel, material.texel);
    level = Math.max(level, patch.tile.level);
    if (material.ready) ++ready;
  }
  context.lod = { tiles: drawn.length, ready, pending: context.jobs.size, level, metresPerTexel: texel, metresPerVertex: finest, maxScale: context.maxScale(), scale: frame.focal / context.camera.distance };
  context.trim();
  context.onRender?.();
  if (preparing || buildingPreparing || context.animating) context.request();
}

/** Whether the displayed frame is complete: every drawn tile has its own material and the ground
 * variant is ready (a backend switch waits for it before showing the new view). */
export function isSettled(context: Terrain3dContext): boolean {
  const lod = context.getLodInfo();
  return !!context.layer && !context.staleTiles && lod.tiles > 0 && lod.pending === 0 && lod.ready === lod.tiles && !context.frameInteracting && !context.billboardDirty && context.billboardsReady() && (context.useMapShader || context.status.groundVariant !== 'pending');
}
