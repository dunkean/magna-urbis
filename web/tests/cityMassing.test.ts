import { describe, expect, it } from 'vitest';
import { pieceRoof, pieceShadow, readMassing, roofLight, type MassingPiece } from '../src/render/cityMassing';

const rect = (w: number, d: number) => ({ outer: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], holes: [] });

describe('city massing roofs', () => {
  it('lofts a gable to its ridge: two sloped pans and two vertical gable ends', () => {
    const piece: MassingPiece = { floors: 2, eave_m: 6, rise_m: 3, roof: 'gable', ridges: [[0, 4, 10, 4]], cover: 'tile', wall: 'brick' };
    const faces = pieceRoof(rect(10, 8), piece, 0);
    const pans = faces.filter(f => f.normal[2] > 0.08), ends = faces.filter(f => f.normal[2] <= 0.08);
    expect(pans).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(Math.max(...faces.flatMap(f => f.points.map(p => p.z)))).toBeCloseTo(9);
    // Opposite pans are lit differently.
    expect(roofLight(pans[0].normal)).not.toBeCloseTo(roofLight(pans[1].normal));
  });

  it('reads massing only when it is aligned with the footprint, and casts a longer shadow for a taller piece', () => {
    const shape = rect(6, 6), piece: MassingPiece = { floors: 1, eave_m: 3, rise_m: 0, roof: 'flat', ridges: [], cover: 'earth', wall: 'earth' };
    expect(readMassing({ massing: [piece] }, [shape])).toHaveLength(1);
    expect(readMassing({ massing: [piece, piece] }, [shape])).toBeUndefined();
    const area = (h: number) => { const s = pieceShadow(shape, h)!; return Math.abs(s.outer.reduce((a, p, i) => { const n = s.outer[(i + 1) % s.outer.length]; return a + p.x * n.y - n.x * p.y; }, 0)) / 2; };
    expect(area(12)).toBeGreaterThan(area(4));
  });
});
