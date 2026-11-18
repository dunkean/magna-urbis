/**
 * Which squares of the map a tilted frame draws, and how finely (contract.ts): a quadtree walk bounded to a few
 * hundred steps, no geometry. Called by the draped ground once per frame whose camera changed.
 *
 * The map is a quadtree: the node of level `levels - 1` is the whole map, each level below halves the side, and a
 * node is drawn as a grid of 2 * LATTICE cells per side. A node of level l is refined while it reaches within
 * `ratio` times its side of the eye, so a cell covers about the same number of pixels at every distance. What is
 * drawn is always a quarter of a node, a square of LATTICE cells (one instance of the grid mesh): the four quarters
 * of a node drawn whole, or the quarters of a refined node that its children do not cover.
 *
 * No stitching and no skirt: the vertex shader moves the odd vertices of a level onto the grid of the level above
 * over the far part of its range (from `morphStart` of the range to its end), with the distance used here. Where two
 * levels meet, the finer side is at the end of its range (fully on the coarser grid) and the coarser side is before
 * the start of its morph, so their edges coincide. That holds because the distance is horizontal plus the height of
 * the eye over the target (it varies by at most the length of the way between two points), the range doubles with
 * the level, and `morphStart` leaves room for the diagonal of a node: 0.5 + 0.71 / ratio at least.
 */
import type { FrameCamera } from './contract';

/** What the walk reads of a camera. */
export type PatchCamera = Pick<FrameCamera, 'eye' | 'target' | 'right' | 'up' | 'forward'>;

/** Cells along the side of a drawn square. Even, so the squares of a level share its grid parity. */
export const LATTICE = 32;
/** Squares a frame may draw. A level in view holds 20 to 70 of them. */
export const MAX_PATCHES = 768;
/** CSS pixels a cell covers at the far end of its level's range, when the ratio is not clamped. */
const CELL_PIXELS = 6;
/** The range of a level, in sides of its nodes: at least 3 (the morph needs room), at most 5 (the squares of a level
 * grow with its square). */
const MIN_RATIO = 3,
  MAX_RATIO = 5;

/** Range of a level over the side of its nodes, for a focal length in CSS pixels (the mesh is as fine on every
 * pixel ratio: the relief has no detail a denser screen would show). */
export const patchRatio = (focal: number, quality: 'full' | 'light'): number => (quality === 'light' ? MIN_RATIO : Math.max(MIN_RATIO, Math.min(MAX_RATIO, focal / (2 * LATTICE * CELL_PIXELS))));
/** Share of a level's range from which its vertices move to the grid of the level above. */
export const morphStart = (ratio: number): number => 0.5 + 0.8 / ratio;
/** Levels of the quadtree for a control grid of n x n heights: the finest cells are half a height cell, below which
 * the spline surface has nothing more to show. */
export const patchLevels = (n: number): number => Math.max(1, Math.ceil(Math.log2(n / LATTICE)) + 1);

export interface PatchQuery {
  /** Side of the map in metres. */
  mapSize: number;
  levels: number;
  ratio: number;
  /** Lowest and highest ground as this frame draws it (metres). */
  low: number;
  high: number;
  /** Tangents of half the horizontal and vertical fields of view. */
  tanX: number;
  tanY: number;
}

/** Height of the eye over the target as the distances of the walk and of the morph count it: never zero. */
export function lodEyeHeight(camera: PatchCamera): number {
  const { eye, target } = camera;
  return Math.max(eye[2] - target[2], Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]) * 1e-3);
}

/** The squares of a frame. Square i is the cell (ix, iy) of the grid of 2^tier x 2^tier squares over the map; its
 * cells are those of the level `levels - tier`. */
export class PatchList {
  count = 0;
  /** The budget ran out: part of the map is drawn coarser than asked. */
  overflow = false;
  readonly tier = new Uint8Array(MAX_PATCHES);
  readonly ix = new Uint16Array(MAX_PATCHES);
  readonly iy = new Uint16Array(MAX_PATCHES);
  /** Depth along the view axis of the nearest corner of the square (metres): what its footprint on screen follows. */
  readonly depth = new Float32Array(MAX_PATCHES);
}

// The walk's state, set by selectPatches: one walk at a time, nothing allocated.
let list: PatchList, pose: PatchCamera, query: PatchQuery;
let top = 0,
  eyeHeight = 0,
  nearDepth = 0;

/** Distance from the eye to the nearest point of a square: horizontal, plus the height of the eye over the target. */
function reach(x: number, y: number, size: number): number {
  const eye = pose.eye,
    dx = Math.max(x - eye[0], 0, eye[0] - x - size),
    dy = Math.max(y - eye[1], 0, eye[1] - y - size);
  return Math.hypot(dx, dy, eyeHeight);
}

/** The box of a square, from the lowest to the highest ground, lies outside the view. */
function hidden(x: number, y: number, size: number): boolean {
  const { eye, right, up, forward } = pose,
    half = size / 2,
    tall = (query.high - query.low) / 2;
  const cx = x + half - eye[0],
    cy = y + half - eye[1],
    cz = query.low + tall - eye[2];
  const behind = (nx: number, ny: number, nz: number): boolean => nx * cx + ny * cy + nz * cz + Math.abs(nx) * half + Math.abs(ny) * half + Math.abs(nz) * tall < 0;
  const { tanX, tanY } = query;
  return (
    behind(forward[0], forward[1], forward[2]) ||
    behind(tanX * forward[0] + right[0], tanX * forward[1] + right[1], tanX * forward[2] + right[2]) ||
    behind(tanX * forward[0] - right[0], tanX * forward[1] - right[1], tanX * forward[2] - right[2]) ||
    behind(tanY * forward[0] + up[0], tanY * forward[1] + up[1], tanY * forward[2] + up[2]) ||
    behind(tanY * forward[0] - up[0], tanY * forward[1] - up[1], tanY * forward[2] - up[2])
  );
}

/** One square of the level `level`: the cell (ix, iy) of the level below. */
function emit(level: number, ix: number, iy: number): void {
  const size = query.mapSize / 2 ** (top - level + 1),
    x = ix * size,
    y = iy * size;
  if (hidden(x, y, size)) return;
  if (list.count >= MAX_PATCHES) {
    list.overflow = true;
    return;
  }
  const { eye, forward, target } = pose,
    i = list.count++;
  // The ground of the square taken at the height of the target: its nearest corner along the view axis.
  const along = (px: number, py: number): number => (px - eye[0]) * forward[0] + (py - eye[1]) * forward[1] + (target[2] - eye[2]) * forward[2];
  list.tier[i] = top - level + 1;
  list.ix[i] = ix;
  list.iy[i] = iy;
  list.depth[i] = Math.max(nearDepth, Math.min(along(x, y), along(x + size, y), along(x, y + size), along(x + size, y + size)));
}

/** Draws the node (level, ix, iy) or refines it. False: it is out of the range of its level, its parent draws it. */
function visit(level: number, ix: number, iy: number): boolean {
  const size = query.mapSize / 2 ** (top - level),
    x = ix * size,
    y = iy * size,
    distance = reach(x, y, size);
  if (level < top && distance > query.ratio * size) return false;
  if (hidden(x, y, size)) return true;
  // Whole: the finest level, a node out of the range of the level below, or a budget nearly spent.
  if (level === 0 || distance > (query.ratio * size) / 2 || list.count > MAX_PATCHES - 64) {
    for (let q = 0; q < 4; q++) emit(level, ix * 2 + (q & 1), iy * 2 + (q >> 1));
    return true;
  }
  for (let q = 0; q < 4; q++) {
    const cx = ix * 2 + (q & 1),
      cy = iy * 2 + (q >> 1);
    if (!visit(level - 1, cx, cy)) emit(level, cx, cy);
  }
  return true;
}

/** Fills `into` with the squares the camera of `from` sees of the map of `given`. */
export function selectPatches(into: PatchList, from: PatchCamera, given: PatchQuery): void {
  list = into;
  pose = from;
  query = given;
  top = given.levels - 1;
  eyeHeight = lodEyeHeight(from);
  nearDepth = Math.hypot(from.eye[0] - from.target[0], from.eye[1] - from.target[1], from.eye[2] - from.target[2]) * 0.05;
  into.count = 0;
  into.overflow = false;
  visit(top, 0, 0);
}
