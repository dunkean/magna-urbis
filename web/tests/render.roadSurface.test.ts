import { describe, expect, it } from 'vitest';
import { coveredEnds, roadSurface, type SurfaceStreet } from '../src/render/roadSurface';

const street = (pts: [number, number][], w: number, rank = 2, role = 'street'): SurfaceStreet =>
  ({ path: pts.map(([x, y]) => ({ x, y })), widths: pts.map(() => w), role, rank });
const area = (r: { x: number; y: number }[]): number => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j].x * r[i].y - r[i].x * r[j].y; return s / 2; };
const points = (pieces: ReturnType<typeof roadSurface>, street?: number) => pieces.filter(p => street === undefined || p.street === street).flatMap(p => p.ring);

describe('road surface', () => {
  // Main street along x (6 m), a 3 m lane leaving it at the origin towards +y.
  const tee = [street([[-40, 0], [0, 0], [40, 0]], 6, 1), street([[0, 0], [0, 30]], 3, 3, 'lane')];

  it('stops a lane at the road it joins: nothing past the far edge, curb returns on its side', () => {
    const pieces = roadSurface(tee);
    for (const p of points(pieces)) expect(p.y).toBeGreaterThanOrEqual(-3 - 1e-6);
    // The curb returns widen the mouth on the lane side only, within the lane's reach.
    const mouth = points(pieces).filter(p => p.y > 3.05 && p.y < 4.5);
    expect(Math.max(...mouth.map(p => Math.abs(p.x)))).toBeGreaterThan(1.5 + 0.2);
    expect(Math.max(...points(pieces).filter(p => p.y > 3).map(p => Math.abs(p.x)))).toBeLessThan(1.5 + 0.55 * 3 + 1e-6);
  });

  it('rounds a loose end and keeps every ring counter-clockwise', () => {
    const pieces = roadSurface(tee, { extra: 0.9 });
    const lane = points(pieces, 1);
    expect(Math.max(...lane.map(p => p.y))).toBeCloseTo(30 + 1.5 + 0.9, 1);
    for (const p of pieces) { expect(area(p.ring)).toBeGreaterThan(0); for (const q of p.ring) expect(Number.isFinite(q.x + q.y)).toBe(true); }
  });

  it('casing runs parallel to the fill at a junction (same curb centre, grown by the edge)', () => {
    const fill = roadSurface(tee), casing = roadSurface(tee, { extra: 1 });
    const reach = (ps: { x: number; y: number }[]) => Math.max(...ps.filter(p => p.y > 4).map(p => Math.abs(p.x)));
    expect(reach(points(casing)) - reach(points(fill))).toBeLessThan(1.2);
    for (const p of points(casing)) expect(p.y).toBeGreaterThanOrEqual(-4 - 1e-6);
  });

  it('treats a loose end on another street\'s segment as a junction (no cap past the road)', () => {
    const pieces = roadSurface([street([[-40, 0], [40, 0]], 6, 1), street([[5, 0], [5, 30]], 3, 3)]);
    for (const p of points(pieces)) expect(p.y).toBeGreaterThanOrEqual(-3 - 1e-6);
  });

  it('stops square the ends a road at least as wide covers, and both ends of a straight continuation', () => {
    const ends = coveredEnds([...tee, street([[40, 0], [80, 0]], 4, 2), street([[-40, 0], [-60, 20]], 4, 2)]);
    expect(ends[1]).toEqual([true, false]);
    expect(ends[0]).toEqual([false, true]);
    expect(ends[2]).toEqual([true, false]);
    // A bend between two streets keeps the wider one round (its cap is the joint).
    expect(ends[3]).toEqual([true, false]);
  });
});
