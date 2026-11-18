/**
 * Index buffers of a patch grid with its skirts, whole or clipped to a quadrant (an ancestor's mesh drawn for a loading
 * child). Both backends build their index buffers from these.
 */
import { GRID, clamp } from './policy';
import { Terrain3dTile } from './contract';

/** Vertex of edge `edge` (0 top, 1 bottom, 2 left, 3 right), step `i`, in a patch grid. */
export function gridEdgeVertex(edge: number, i: number): number {
  const side = GRID + 1;
  return edge === 0 ? i : edge === 1 ? GRID * side + i : edge === 2 ? i * side : i * side + GRID;
}

/** Triangles of a whole patch: the grid, then the four skirts. */
export function fullPatchIndices(): Uint16Array {
  const side = GRID + 1,
    surfaceVertices = side * side,
    count = GRID * GRID * 6 + GRID * 4 * 6;
  const indices = new Uint16Array(count);
  let at = 0;
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const a = y * side + x,
        b = a + 1,
        c = a + side,
        d = c + 1;
      indices.set([a, c, b, b, c, d], at);
      at += 6;
    }
  for (let edge = 0; edge < 4; edge++)
    for (let i = 0; i < GRID; i++) {
      const a = gridEdgeVertex(edge, i),
        b = gridEdgeVertex(edge, i + 1);
      const sa = surfaceVertices + edge * side + i,
        sb = sa + 1;
      indices.set([a, sa, b, b, sa, sb], at);
      at += 6;
    }
  return indices;
}

/** The cell rectangle of `clip` inside `tile`'s grid (cache key), or undefined when it covers the whole tile. */
export function patchClipKey(tile: Terrain3dTile, clip: Terrain3dTile): string | undefined {
  if (clip === tile || (clip.x === tile.x && clip.y === tile.y && clip.width === tile.width)) return undefined;
  const step = tile.width / GRID;
  const x0 = clamp(Math.round((clip.x - tile.x) / step), 0, GRID),
    y0 = clamp(Math.round((clip.y - tile.y) / step), 0, GRID);
  const x1 = clamp(Math.round((clip.x + clip.width - tile.x) / step), x0, GRID),
    y1 = clamp(Math.round((clip.y + clip.width - tile.y) / step), y0, GRID);
  return `${x0}/${y0}/${x1}/${y1}`;
}

/** Triangles of a clipped patch (patchClipKey): its cells, and only the real source-boundary skirts. */
export function clippedPatchIndices(key: string): Uint16Array {
  const [x0, y0, x1, y1] = key.split('/').map(Number),
    side = GRID + 1;
  const indices: number[] = [],
    count = side * side;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const a = y * side + x,
        b = a + 1,
        c = a + side,
        d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  // Keep only real source-boundary skirts. Interior fallback boundaries are
  // actual triangle edges, welded to their neighbours by the geometry pass.
  for (let edge = 0; edge < 4; edge++) {
    if (!(edge === 0 ? y0 === 0 : edge === 1 ? y1 === GRID : edge === 2 ? x0 === 0 : x1 === GRID)) continue;
    const first = edge < 2 ? x0 : y0,
      last = edge < 2 ? x1 : y1;
    for (let i = first; i < last; i++) {
      const a = gridEdgeVertex(edge, i),
        b = gridEdgeVertex(edge, i + 1),
        sa = count + edge * side + i,
        sb = sa + 1;
      indices.push(a, sa, b, b, sa, sb);
    }
  }
  return new Uint16Array(indices);
}
