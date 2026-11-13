import { describe, expect, it } from 'vitest';
import type { PathGeometry } from '../src/render/gpu/displayList';
import {
  DISC_STRIDE, JOIN_STRIDE, SEGMENT_STRIDE, STROKE_CLOSED, STROKE_DOT, STROKE_END, STROKE_START,
  fillFans, strokeSegments, type StrokeOptions,
} from '../src/render/gpu/tessellate';

function geometry(points: number[], starts: number[], closed: number[]): PathGeometry {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]); y0 = Math.min(y0, points[i + 1]);
    x1 = Math.max(x1, points[i]); y1 = Math.max(y1, points[i + 1]);
  }
  return { points: new Float32Array(points), starts: new Uint32Array(starts), closed: new Uint8Array(closed), bbox: [x0, y0, x1, y1] };
}
const options: StrokeOptions = { width: 2, cap: 'butt', join: 'round', miterLimit: 10 };
function signedArea(fans: Float32Array): number {
  let area = 0;
  for (let i = 0; i < fans.length; i += 6) area += ((fans[i + 2] - fans[i]) * (fans[i + 5] - fans[i + 1]) - (fans[i + 3] - fans[i + 1]) * (fans[i + 4] - fans[i])) / 2;
  return area;
}

describe('GPU stencil fans', () => {
  it('preserves signed winding of a square and its hole, even for open subpaths', () => {
    const g = geometry([0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 3, 7, 7, 7, 7, 3], [0, 4, 8], [0, 1]);
    const fans = fillFans(g);
    expect(fans).toBeInstanceOf(Float32Array);
    expect(fans.length).toBe(4 * 6);
    expect(Array.from(fans.slice(0, 12))).toEqual([0, 0, 10, 0, 10, 10, 0, 0, 10, 10, 0, 10]);
    expect(signedArea(fans)).toBe(100 - 16);
    expect(signedArea(fans.slice(12))).toBe(-16);
  });
  it('ignores subpaths with fewer than three points', () => {
    expect(fillFans(geometry([1, 2, 3, 4, 5, 6], [0, 0, 1, 3], [0, 0, 0])).length).toBe(0);
    expect(fillFans(geometry([], [0], [])).length).toBe(0);
  });
});

describe('GPU stroke geometry', () => {
  it('records open endpoints, cumulative lengths and one round interior join', () => {
    const mesh = strokeSegments(geometry([0, 0, 3, 0, 3, 4], [0, 3], [0]), options);
    expect(mesh.segments.length).toBe(2 * SEGMENT_STRIDE);
    expect(Array.from(mesh.segments)).toEqual([0, 0, 3, 0, 0, STROKE_START, 3, 0, 3, 4, 3, STROKE_END]);
    expect(mesh.discs.length).toBe(DISC_STRIDE);
    expect(Array.from(mesh.discs)).toEqual([3, 0, 3, 0]);
    expect(mesh.triangles.length).toBe(0);
  });
  it('closes rings without endpoint caps and joins every vertex, including the seam', () => {
    const mesh = strokeSegments(geometry([0, 0, 3, 0, 3, 4, 0, 0], [0, 4], [1]), options);
    expect(mesh.segments.length).toBe(3 * SEGMENT_STRIDE);
    expect([mesh.segments[4], mesh.segments[10], mesh.segments[16]]).toEqual([0, 3, 7]);
    expect([mesh.segments[5], mesh.segments[11], mesh.segments[17]]).toEqual([STROKE_CLOSED, STROKE_CLOSED, STROKE_CLOSED]);
    expect(mesh.discs.length).toBe(3 * DISC_STRIDE);
    expect(Array.from(mesh.segments.slice(12, 16))).toEqual([3, 4, 0, 0]);
    expect(Array.from(mesh.discs.slice(0, 4))).toEqual([0, 0, 0, STROKE_CLOSED]);
  });
  it('starts dash distance at zero for each subpath and collapses duplicate points', () => {
    const mesh = strokeSegments(geometry([0, 0, 0, 0, 3, 0, 10, 10, 10, 14], [0, 3, 5], [0, 0]), options);
    expect(mesh.segments.length).toBe(2 * SEGMENT_STRIDE);
    expect([mesh.segments[4], mesh.segments[10]]).toEqual([0, 0]);
    expect([mesh.segments[5], mesh.segments[11]]).toEqual([STROKE_START | STROKE_END, STROKE_START | STROKE_END]);
    expect(mesh.discs.length).toBe(0);
  });
  it('builds a miter wedge and falls back to a bevel when the limit is exceeded', () => {
    const g = geometry([0, 0, 3, 0, 3, 4], [0, 3], [0]);
    const miter = strokeSegments(g, { ...options, join: 'miter', miterLimit: 2 });
    const fallback = strokeSegments(g, { ...options, join: 'miter', miterLimit: 1 });
    const bevel = strokeSegments(g, { ...options, join: 'bevel' });
    expect(miter.joins.length).toBe(JOIN_STRIDE);
    expect(miter.triangles.length).toBe(18); // two triangles, x,y,length
    expect(Array.from(miter.triangles.slice(6, 9))).toEqual([4, -1, 3]);
    expect(fallback.triangles.length).toBe(9);
    expect(Array.from(fallback.triangles)).toEqual(Array.from(bevel.triangles));
    expect(Array.from(fallback.triangles)).toEqual([3, 0, 3, 3, -1, 3, 4, 0, 3]);
  });
  it('chooses the exterior wedge for either turn direction', () => {
    const left = strokeSegments(geometry([0, 0, 3, 0, 3, -4], [0, 3], [0]), { ...options, join: 'miter' });
    expect(Array.from(left.triangles.slice(6, 9))).toEqual([4, 1, 3]);
    expect(Array.from(left.triangles).every(Number.isFinite)).toBe(true);
  });
  it('represents round and square zero-length cap dots and omits butt dots', () => {
    const g = geometry([5, 6, 5, 6], [0, 2], [0]);
    const round = strokeSegments(g, { ...options, cap: 'round' });
    const square = strokeSegments(g, { ...options, cap: 'square' });
    const butt = strokeSegments(g, options);
    expect(round.segments.length).toBe(0);
    expect(Array.from(round.discs)).toEqual([5, 6, 0, STROKE_DOT]);
    expect(Array.from(square.segments)).toEqual([5, 6, 5, 6, 0, STROKE_START | STROKE_END | STROKE_DOT]);
    expect(square.discs.length).toBe(0);
    expect(butt.segments.length + butt.discs.length + butt.triangles.length).toBe(0);
  });
  it('emits no geometry for empty paths or invalid widths', () => {
    const g = geometry([], [0], []);
    expect(strokeSegments(g, options).segments.length).toBe(0);
    expect(strokeSegments(geometry([0, 0, 1, 1], [0, 2], [0]), { ...options, width: 0 }).segments.length).toBe(0);
  });
});
