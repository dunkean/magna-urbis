/**
 * Seam snapshot comparison and skirt correction used by terrain mesh/frame preparation.
 * Reads/writes: Reads stitched pieces; extends their correction buffers to skirts and caches those views in a weak map.
 */
import { type TerrainStitchedPiece, type TerrainStitchPiece } from '../terrain3dStitch';
import { GRID } from './terrainPolicy';
import { gridEdgeVertex } from './patchIndices';
import { RenderPiece } from './terrainTypes';

/** Seam corrections of a stitched piece, copied onto its skirt vertices (vertex attribute 5): the
 * stitch leaves room for them after the surface vertices, in the same buffer. */
export const SKIRT_FLOATS = 4 * (GRID + 1) * 3;

const skirtCorrections = new WeakMap<Float32Array, Float32Array>();

export function skirtCorrection(stitched: TerrainStitchedPiece): Float32Array {
  const cached = skirtCorrections.get(stitched.correction);
  if (cached) return cached;
  const side = GRID + 1,
    count = side * side,
    correction = new Float32Array(stitched.correction.buffer);
  for (let edge = 0; edge < 4; edge++)
    for (let i = 0; i < side; i++) {
      const from = gridEdgeVertex(edge, i) * 3,
        to = (count + edge * side + i) * 3;
      correction[to] = correction[from];
      correction[to + 1] = correction[from + 1];
      correction[to + 2] = correction[from + 2];
    }
  skirtCorrections.set(stitched.correction, correction);
  return correction;
}

/** A stitched source that still draws the same surface: its join can be kept. */
export function sameSurface(a: TerrainStitchPiece, b: TerrainStitchPiece): boolean {
  const before = a as RenderPiece,
    after = b as RenderPiece;
  return before.patch === after.patch && before.field === after.field && before.heightOrigin === after.heightOrigin && before.morph === after.morph;
}

/** Whether two seam snapshots differ beyond what a mesh could show. Only the listed vertices of each (the stitch's
 * `touched`) can hold a correction; every other value is zero in both, so the comparison reads those alone. */
export function seamDiffers(a: Float32Array, aTouched: readonly number[], b: Float32Array, bTouched: readonly number[] | undefined): boolean {
  if (!bTouched) {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-7) return true;
    return false;
  }
  for (const list of [aTouched, bTouched])
    for (const vertex of list) {
      const at = vertex * 3;
      if (Math.abs(a[at] - b[at]) > 1e-7 || Math.abs(a[at + 1] - b[at + 1]) > 1e-7 || Math.abs(a[at + 2] - b[at + 2]) > 1e-7) return true;
    }
  return false;
}
