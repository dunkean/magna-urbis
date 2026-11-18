import { describe, expect, it } from 'vitest';
import type { DrapeTile } from '../src/render/world/contract';
import { TilePyramid } from '../src/render/world/tilePyramid';

const tile = (): DrapeTile => ({ page: 0, layer: 0, u0: 0, v0: 0, span: 1 });
/** Bakes whatever `next` names until nothing is left or no layer is free; returns the tiles baked, in order. */
function bakeAll(pyramid: TilePyramid, finest: number): string[] {
  const baked: string[] = [];
  while (pyramid.next(finest)) {
    const slot = pyramid.slotFor(pyramid.tier, pyramid.ix, pyramid.iy);
    if (slot < 0) break;
    pyramid.baked(pyramid.tier, pyramid.ix, pyramid.iy, slot);
    baked.push(`${pyramid.tier}/${pyramid.ix}/${pyramid.iy}`);
  }
  return baked;
}

describe('tile pyramid of the map drape', () => {
  it('bakes tier 0 first, then what the frame wants nearest first, then the coarse tiers', () => {
    const pyramid = new TilePyramid(2);
    pyramid.reset(16);
    const out = tile();
    pyramid.begin();
    expect(pyramid.resolve(3, 5, 2, 900, out)).toBe(false);
    expect(pyramid.resolve(3, 4, 2, 300, out)).toBe(false);
    expect(bakeAll(pyramid, 8)).toEqual(['0/0/0', '3/4/2', '3/5/2', '1/0/0', '1/1/0', '1/0/1', '1/1/1']);
    expect(pyramid.pending(8)).toBe(0);
  });

  it('shows a missing tile by the matching part of its nearest baked ancestor', () => {
    const pyramid = new TilePyramid(2);
    pyramid.reset(16);
    const out = tile();
    pyramid.baked(0, 0, 0, pyramid.slotFor(0, 0, 0));
    pyramid.baked(2, 3, 1, pyramid.slotFor(2, 3, 1));
    pyramid.begin();
    // Tile (4, 13, 6) lies in (2, 3, 1): its quarter of a quarter, at (1/4, 2/4) of it.
    expect(pyramid.resolve(4, 13, 6, 1, out)).toBe(true);
    expect(out).toMatchObject({ page: 0, layer: 1, u0: 0.25, v0: 0.5, span: 0.25 });
    // Elsewhere only tier 0 holds it.
    expect(pyramid.resolve(4, 2, 9, 1, out)).toBe(true);
    expect(out).toMatchObject({ layer: 0, u0: 2 / 16, v0: 9 / 16, span: 1 / 16 });
  });

  it('keeps showing stale tiles and bakes them again in place', () => {
    const pyramid = new TilePyramid(1);
    pyramid.reset(4);
    const out = tile();
    pyramid.begin();
    pyramid.resolve(2, 1, 1, 10, out);
    bakeAll(pyramid, 8);
    const revision = pyramid.revision;
    pyramid.stale();
    expect(pyramid.revision).toBeGreaterThan(revision);
    expect(pyramid.needs(2, 1, 1)).toBe(true);
    pyramid.begin();
    expect(pyramid.resolve(2, 1, 1, 10, out)).toBe(true);
    const layer = out.layer;
    expect(out.span).toBe(1);
    expect(bakeAll(pyramid, 8)).toEqual(['0/0/0', '2/1/1']);
    pyramid.begin();
    pyramid.resolve(2, 1, 1, 10, out);
    expect(out.layer).toBe(layer);
    expect(pyramid.size).toBe(2);
  });

  it('evicts the least recently shown tile, never a coarse one nor one the last frame shows', () => {
    const pyramid = new TilePyramid(1);
    pyramid.reset(3);
    const out = tile();
    // Frame 1 shows (3, 0, 0), frame 2 shows (3, 1, 0): the table is full with tier 0.
    pyramid.begin();
    pyramid.resolve(3, 0, 0, 1, out);
    bakeAll(pyramid, 8);
    pyramid.begin();
    pyramid.resolve(3, 1, 0, 1, out);
    bakeAll(pyramid, 8);
    expect(pyramid.size).toBe(3);
    // Frame 3 shows (3, 1, 0) and wants two more: one takes the layer of (3, 0, 0), the other finds none.
    pyramid.begin();
    pyramid.resolve(3, 1, 0, 1, out);
    pyramid.resolve(3, 2, 0, 2, out);
    pyramid.resolve(3, 3, 0, 3, out);
    expect(bakeAll(pyramid, 8)).toEqual(['3/2/0']);
    expect(pyramid.needs(3, 0, 0)).toBe(true);
    expect(pyramid.needs(3, 1, 0)).toBe(false);
    expect(pyramid.needs(0, 0, 0)).toBe(false);
    expect(pyramid.slotFor(3, 3, 0)).toBe(-1);
  });
});
