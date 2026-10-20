import { describe, expect, it } from 'vitest';
import { sampleTerrainPiece, stitchTerrainPieces, type TerrainStitchPiece, type TerrainStitchedPiece } from '../src/ui/terrain3dStitch';

function patch(key: string, x: number, y: number, width: number, cells: number, morph: number, offset = 0): TerrainStitchPiece {
  return { key, x, y, width, cells, clip: { x, y, width }, vertex: (ix, iy) => {
    const wx = x + ix * width / cells, wy = y + iy * width / cells;
    // Deliberately non-coplanar independent decoder/morph fields.
    return [30 + Math.sin(wx * 7) * Math.cos(wy * 5) * morph + offset,
      7 * Math.cos(wx * 7) * Math.cos(wy * 5) * morph,
      -5 * Math.sin(wx * 7) * Math.sin(wy * 5) * morph];
  } };
}
function join(a: TerrainStitchedPiece, b: TerrainStitchedPiece, x0: number, y0: number, x1: number, y1: number): void {
  for (let i = 0; i <= 64; i++) {
    const x = x0 + (x1 - x0) * i / 64, y = y0 + (y1 - y0) * i / 64;
    const aa = sampleTerrainPiece(a, x, y), bb = sampleTerrainPiece(b, x, y);
    for (let k = 0; k < 3; k++) expect(aa[k]).toBeCloseTo(bb[k], 5);
  }
}

describe('terrain LOD geometric joins', () => {
  it('welds fine T junctions to the actual coarse morphed triangle edge', () => {
    for (const morph of [0, .17, .63, 1]) {
      const [a, b, c] = stitchTerrainPieces([
        patch('coarse', 0, 0, 1, 8, morph),
        patch('fine-north', 1, 0, .5, 8, 1 - morph, .3),
        patch('fine-south', 1, .5, .5, 8, .7, -.2),
      ]);
      join(a, b, 1, 0, 1, .5); join(a, c, 1, .5, 1, 1); join(b, c, 1, .5, 1.5, .5);
    }
  });

  it('shares a stable owner between equal LOD decoder tiles with different heights', () => {
    const [a, b] = stitchTerrainPieces([patch('a', 0, 0, 1, 8, .4, 2), patch('b', 1, 0, 1, 8, 1, -3)]);
    join(a, b, 1, 0, 1, 1);
    expect(a.correction.every(value => value === 0)).toBe(true);
  });

  it('keeps all four corner heights and normals identical with different LODs', () => {
    const result = stitchTerrainPieces([
      patch('north-west', 0, 0, 1, 4, .2), patch('north-east', 1, 0, 1, 8, .7, .2),
      patch('south-west', 0, 1, 1, 16, .9, -.3), patch('south-east', 1, 1, 1, 8, .5, .1),
    ]);
    join(result[0], result[1], 1, 0, 1, 1); join(result[0], result[2], 0, 1, 1, 1);
    join(result[1], result[3], 1, 1, 2, 1); join(result[2], result[3], 1, 1, 1, 2);
    const corner = result.map(piece => sampleTerrainPiece(piece, 1, 1));
    for (const value of corner) for (let k = 0; k < 3; k++) expect(value[k]).toBeCloseTo(corner[0][k], 5);
  });

  it('does not depend on render traversal or asynchronous completion order', () => {
    const source = [patch('a', 0, 0, 1, 8, .2), patch('b', 1, 0, .5, 8, .8, 1), patch('c', 1, .5, .5, 8, .4, -1)];
    const forward = stitchTerrainPieces(source), reverse = stitchTerrainPieces([...source].reverse());
    for (const piece of forward) expect(piece.correction).toEqual(reverse.find(other => other.source.key === piece.source.key)!.correction);
  });

  it('hands ownership over continuously when a coarse neighbour refines, then becomes idle', () => {
    const neighbour = patch('neighbour', 1, 0, 1, 8, .8, 2);
    let previous = stitchTerrainPieces([patch('coarse', 0, 0, 1, 4, .2), neighbour]);
    const before = sampleTerrainPiece(previous[1], 1, .5);
    const split = [patch('refined', 0, 0, 1, 16, .5), neighbour];
    previous = stitchTerrainPieces(split, previous, 0);
    expect(sampleTerrainPiece(previous[1], 1, .5)).toEqual(before);
    for (let frame = 0; frame < 5; frame++) {
      previous = stitchTerrainPieces(split, previous, 50);
      join(previous[0], previous[1], 1, 0, 1, 1);
    }
    expect(previous.some(piece => piece.releasing)).toBe(false);
    expect(previous[1].correction.every(value => value === 0)).toBe(true);
  });
});
