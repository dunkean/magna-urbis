import { describe, expect, it } from 'vitest';
import { renderRoadStrokes, roadStrokeWidth, splitAtCrossings } from '../src/render/roadPaintRender';

describe('painted road preset', () => {
  it('cuts a road at its crossings so the bridge span is exact and the pieces join', () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }];
    const pieces = splitAtCrossings(path, [{ kind: 'bridge' as const, path: [{ x: 40, y: 1 }, { x: 60, y: -1 }] }]);
    expect(pieces.map(p => p.crossing ?? null)).toEqual([null, 'bridge', null]);
    expect(pieces[1].path).toEqual([{ x: 40, y: 0 }, { x: 60, y: 0 }]);
    expect(pieces[0].path.at(-1)).toEqual(pieces[1].path[0]);
    expect(pieces[1].path.at(-1)).toEqual(pieces[2].path[0]);
    expect(pieces[2].path.at(-1)).toEqual({ x: 200, y: 50 });
    expect(splitAtCrossings(path, [])).toEqual([{ path }]);
  });

  it('keeps a screen floor and the true width', () => {
    const fill = renderRoadStrokes('main', 'paved').find(s => s.layer === 'fill')!;
    expect(roadStrokeWidth(fill, 3.2, 6)).toBe('max(3.2px, calc(var(--road-k, 0) * 6px))');
  });
});
