import { describe, expect, it } from 'vitest';
import { city3dStairs, stairPieces, stairRiser, STAIR_FLIGHT_RISERS, STAIR_LANDING_M, STAIR_RISER_M, STAIR_TOLERANCE_M, type StairPiece } from '../src/render/city3dStairs';
import type { Layout } from '../../rust/bridge/urban';

const level = (p: StairPiece): boolean => p.z0 === p.z1;
/** Risers between consecutive pieces. */
const risers = (pieces: StairPiece[]): number[] =>
  pieces
    .slice(1)
    .map((p, i) => Math.abs(p.z0 - pieces[i].z1))
    .filter(d => d > 1e-6);

describe('stairPieces', () => {
  it('climbs a straight grade on level treads with risers in range, joining both ends', () => {
    const ground = (s: number): number => 100 + 0.4 * s,
      pieces = stairPieces(10, ground, [], 3);
    expect(pieces.every(level)).toBe(true);
    for (const r of risers(pieces)) {
      expect(r).toBeGreaterThanOrEqual(STAIR_RISER_M[0] - 1e-9);
      expect(r).toBeLessThanOrEqual(STAIR_RISER_M[1] + 1e-9);
    }
    expect(risers(pieces)[0]).toBeCloseTo(stairRiser(0.4), 1);
    // Top tread is the ground at the top end; the bottom tread is one riser above the bottom ground.
    expect(pieces[pieces.length - 1].z1).toBeCloseTo(ground(10), 6);
    expect(pieces[0].z0 - ground(0)).toBeGreaterThan(0);
    expect(pieces[0].z0 - ground(0)).toBeLessThanOrEqual(STAIR_RISER_M[1] + 1e-9);
    expect(pieces[0].s0).toBe(0);
    expect(pieces[pieces.length - 1].s1).toBe(10);
  });

  it('keeps every tread above the ground, and at most a riser over it within a flight', () => {
    const ground = (s: number): number => 50 + 0.3 * s + Math.sin(s / 3) * 0.6;
    // A landing on a slope must stand above the ground at its downhill end (its cheek shows there): the upper bound is
    // checked on a single flight, the lower bound on a long way with landings too.
    for (const length of [6, 24])
      for (const p of stairPieces(length, ground, [], 2.5))
        for (let s = p.s0; s <= p.s1; s += 0.05) {
          const z = p.z0 + ((p.z1 - p.z0) * (s - p.s0)) / Math.max(1e-9, p.s1 - p.s0);
          expect(z).toBeGreaterThanOrEqual(ground(s) - STAIR_TOLERANCE_M - 0.01);
          if (length === 6) expect(z).toBeLessThanOrEqual(ground(s) + STAIR_RISER_M[1] + STAIR_TOLERANCE_M + 0.01);
        }
  });

  it('breaks a long flight with landings and goes down as well as up', () => {
    const up = stairPieces(16, s => 0.45 * s, [], 3),
      down = stairPieces(16, s => 7.2 - 0.45 * s, [], 3);
    for (const pieces of [up, down]) {
      expect(pieces.some(p => p.s1 - p.s0 >= STAIR_LANDING_M - 1e-6)).toBe(true);
      let run = 0,
        longest = 0;
      for (let i = 1; i < pieces.length; i++) {
        run = pieces[i].s1 - pieces[i].s0 >= STAIR_LANDING_M - 1e-6 ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      expect(longest).toBeLessThanOrEqual(STAIR_FLIGHT_RISERS);
    }
    expect(down[0].z0).toBeCloseTo(7.2, 6);
  });

  it('turns on a level landing', () => {
    const pieces = stairPieces(20, s => 0.35 * s, [10], 3);
    const turn = pieces.find(p => p.s0 <= 10 && p.s1 >= 10)!;
    expect(level(turn)).toBe(true);
    expect(turn.s1 - turn.s0).toBeGreaterThanOrEqual(STAIR_LANDING_M);
  });

  it('builds one display flight per stepped street, with level treads first', () => {
    const layout = {
      key: 'a',
      culture: 'italian',
      center: { x: 0, y: 0 },
      quarters: [],
      blocks: [],
      warnings: [],
      streets: [
        {
          path: [
            { x: 0, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 10 },
          ],
          widths: [3, 3, 3],
          rank: 3,
          role: 'stairs',
        },
        {
          path: [
            { x: 0, y: 0 },
            { x: 0, y: 20 },
          ],
          widths: [5, 5],
          rank: 2,
          role: 'lane',
        },
      ],
    } as Layout;
    const [flight, ...rest] = city3dStairs([layout], (x, y) => 0.4 * (x + y));
    expect(rest).toHaveLength(0);
    const volume = flight.volumes[0],
      mesh = volume.roof_mesh,
      treads = mesh.faces.findIndex(face => face.normal[2] <= 0.99);
    expect(treads).toBeGreaterThan(0);
    expect(mesh.faces.length).toBeGreaterThan(treads * 2);
    // From afar the painted street is the whole of it.
    expect((volume as unknown as { overview_faces?: [number, number] }).overview_faces).toBeUndefined();
    expect(flight.id.startsWith('city3d-stairs')).toBe(true);
    // Treads and sides in the street's colour, risers a darker tone of the same hue, no stone edge.
    const [painted] = city3dStairs(
      [layout],
      (x, y) => 0.4 * (x + y),
      () => 'rgb(160, 120, 80)',
    );
    const faces = painted.volumes[0].roof_mesh.faces,
      tone = (m: string): number[] => [0, 2, 4].map(i => parseInt(m.split('@')[1].slice(i, i + 2), 16));
    expect(faces[0].material).toBe('city3d:road:stairs@a07850');
    const riser = faces.find(f => f.material.startsWith('city3d:road:stairs@') && f.material !== faces[0].material)!.material,
      [r, g, b] = tone(riser);
    expect(r).toBeLessThan(160);
    expect(r / b).toBeCloseTo(2, 0);
    expect(g).toBeLessThan(120);
    expect(faces.every(f => f.material.startsWith('city3d:road:stairs@'))).toBe(true);
  });
});
