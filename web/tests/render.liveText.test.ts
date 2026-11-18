import { describe, expect, it } from 'vitest';
import type { KindStyle } from '../src/render/labelStyles';
import type { PlacedMapLabel } from '../src/render/mapLabels';
import type { View } from '../src/render/view';
import { liveGlyphAnchor, liveSymbolAnchor, type LiveGlyphAnchor } from '../src/render/live/textLayer';
import { GLYPH_ATLAS_SIZE, ShelfPacker, type ShelfRect } from '../src/render/live/glyphAtlas';

const source = { view: { cx: 260, cy: 410, scale: .8 }, w: 900, h: 650 };
const style: KindStyle = {
  shape: 'point', italic: false, bold: false, caps: 'none', spacing: 0, stretch: 0,
  color: '#223344', sizeM: 12, minPx: 10, maxPx: 20, minScale: 0, maxScale: 100, priority: 1,
};
function placement(extra: Partial<PlacedMapLabel> = {}): PlacedMapLabel {
  return {
    label: { id: 'label', kind: 'town', text: 'AB', x: 310, y: 455, st: style },
    size: 15, spacing: 1, cx: 512, cy: 349, width: 22,
    glyphs: [
      { ch: 'A', x: 506, y: 349, a: 0, size: 15, w: 10 },
      { ch: 'B', x: 518, y: 349, a: 0, size: 15, w: 10 },
    ],
    ...extra,
  };
}

/** The Canvas movedPlacement formula; kept independent of the retained anchor representation. */
function movedPixel(x: number, y: number, next: View): [number, number] {
  const k = next.scale / source.view.scale;
  return [
    (x - source.w / 2) * k + (source.view.cx - next.cx) * next.scale + source.w / 2,
    (y - source.h / 2) * k + (source.view.cy - next.cy) * next.scale + source.h / 2,
  ];
}
/** Emulates the vertex shader's anchor + CSS offset at a device-pixel ratio. */
function project(anchor: LiveGlyphAnchor, next: View, dpr: number): [number, number] {
  return [
    ((anchor.worldX - next.cx) * next.scale + source.w / 2 + anchor.offsetX) * dpr,
    ((anchor.worldY - next.cy) * next.scale + source.h / 2 + anchor.offsetY) * dpr,
  ];
}
const views: View[] = [source.view, { cx: 300, cy: 370, scale: .8 }, { cx: 410, cy: 510, scale: 2.3 }, { cx: 100, cy: 200, scale: .17 }];

describe('live text movement', () => {
  it('keeps straight point and area glyph offsets constant about the map anchor', () => {
    for (const shape of ['point', 'area'] as const) {
      const pl = placement(); pl.label = { ...pl.label, st: { ...style, shape } };
      const ax = (pl.label.x - source.view.cx) * source.view.scale + source.w / 2;
      const ay = (pl.label.y - source.view.cy) * source.view.scale + source.h / 2;
      for (const glyph of pl.glyphs) {
        const anchor = liveGlyphAnchor(source, pl, glyph);
        expect(anchor.worldX).toBe(pl.label.x); expect(anchor.worldY).toBe(pl.label.y);
        for (const next of views) for (const dpr of [1, 1.25, 2, 3]) {
          const moved = movedPixel(ax, ay, next), actual = project(anchor, next, dpr);
          expect(actual[0]).toBeCloseTo((glyph.x + moved[0] - ax) * dpr, 8);
          expect(actual[1]).toBeCloseTo((glyph.y + moved[1] - ay) * dpr, 8);
        }
      }
    }
  });

  it('moves a symbol and its straight text around the symbol screen anchor', () => {
    // A deliberately displaced symbol catches using label.x/y instead of the placed symbol position.
    const symbol = { x: 477, y: 363, r: 3.9 }, pl = placement({ symbol });
    for (const next of views) for (const dpr of [1, 1.5, 2]) {
      const expected = movedPixel(symbol.x, symbol.y, next), actual = project(liveSymbolAnchor(source, symbol), next, dpr);
      expect(actual[0]).toBeCloseTo(expected[0] * dpr, 8); expect(actual[1]).toBeCloseTo(expected[1] * dpr, 8);
      for (const glyph of pl.glyphs) {
        const projected = project(liveGlyphAnchor(source, pl, glyph), next, dpr);
        expect(projected[0]).toBeCloseTo((glyph.x + expected[0] - symbol.x) * dpr, 8);
        expect(projected[1]).toBeCloseTo((glyph.y + expected[1] - symbol.y) * dpr, 8);
      }
    }
  });

  it('anchors every curved/path glyph independently and preserves its angle', () => {
    for (const path of [undefined, [[480, 350], [550, 370]] as [number, number][]]) {
      const pl = placement({ path });
      pl.glyphs = pl.glyphs.map((g, i) => ({ ...g, y: g.y + i * 3, a: path ? 0 : i * .21 }));
      for (const glyph of pl.glyphs) {
        const anchor = liveGlyphAnchor(source, pl, glyph);
        expect(anchor.offsetX).toBe(0); expect(anchor.offsetY).toBe(0); expect(anchor.angle).toBe(glyph.a);
        for (const next of views) for (const dpr of [1, 1.25, 2]) {
          const expected = movedPixel(glyph.x, glyph.y, next), actual = project(anchor, next, dpr);
          expect(actual[0]).toBeCloseTo(expected[0] * dpr, 8); expect(actual[1]).toBeCloseTo(expected[1] * dpr, 8);
        }
      }
    }
  });
});

describe('glyph atlas shelves', () => {
  it('uses 2048-square pages by default and reserves a texel at all edges', () => {
    const packer = new ShelfPacker();
    expect(packer.pages).toBe(0); expect(packer.size).toBe(GLYPH_ATLAS_SIZE);
    expect(packer.allocate(2046, 2046)).toEqual({ page: 0, x: 1, y: 1, w: 2046, h: 2046 });
    expect(packer.allocate(1, 1)).toEqual({ page: 1, x: 1, y: 1, w: 1, h: 1 });
    expect(packer.pages).toBe(2);
  });

  it('wraps to the tallest shelf and then to the next page', () => {
    const packer = new ShelfPacker(16);
    expect(packer.allocate(6, 3)).toEqual({ page: 0, x: 1, y: 1, w: 6, h: 3 });
    expect(packer.allocate(6, 5)).toEqual({ page: 0, x: 9, y: 1, w: 6, h: 5 });
    expect(packer.allocate(10, 6)).toEqual({ page: 0, x: 1, y: 8, w: 10, h: 6 });
    expect(packer.allocate(2, 6)).toEqual({ page: 0, x: 13, y: 8, w: 2, h: 6 });
    expect(packer.allocate(1, 1)).toEqual({ page: 1, x: 1, y: 1, w: 1, h: 1 });
  });

  it('never overlaps padded rectangles or crosses page boundaries', () => {
    const packer = new ShelfPacker(64), rectangles: ShelfRect[] = [];
    for (let i = 0; i < 140; i++) {
      const rect = packer.allocate(1 + i * 7 % 25, 1 + i * 11 % 19);
      expect(rect.x).toBeGreaterThanOrEqual(1); expect(rect.y).toBeGreaterThanOrEqual(1);
      expect(rect.x + rect.w + 1).toBeLessThanOrEqual(64); expect(rect.y + rect.h + 1).toBeLessThanOrEqual(64);
      for (const old of rectangles) if (old.page === rect.page) {
        expect(rect.x + rect.w + 1 <= old.x - 1 || old.x + old.w + 1 <= rect.x - 1
          || rect.y + rect.h + 1 <= old.y - 1 || old.y + old.h + 1 <= rect.y - 1).toBe(true);
      }
      rectangles.push(rect);
    }
  });

  it('rejects invalid/oversized requests without consuming a shelf', () => {
    const packer = new ShelfPacker(16);
    for (const [w, h] of [[15, 1], [1, 15], [0, 1], [-1, 2], [1.5, 2], [NaN, 2]]) expect(() => packer.allocate(w, h)).toThrow(RangeError);
    expect(packer.pages).toBe(0); expect(packer.allocate(14, 14)).toEqual({ page: 0, x: 1, y: 1, w: 14, h: 14 });
    expect(() => new ShelfPacker(2, 1)).toThrow(RangeError);
  });
});
