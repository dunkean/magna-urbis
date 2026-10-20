import { describe, it, expect } from 'vitest';
import { generate } from '../src/gen/pipeline';
import { makeOptions, SizeName } from '../src/gen/options';
import type { Polygon, UrbanBuilding } from '../src/gen/types';
import { coverage } from './coverage';
import { compactFootprintExceptions, isCompactFinalFootprint } from './compactFootprint';

// Burgage-cycle density (built area / block area, area-weighted per phase): oldest phase 85–95 %, second 70–85 %,
// younger 50–70 %; faubourgs 35–60 % near the gate (≤ 150 m) and fading further out (rows → gaps → scattered
// houses → fields). Ordinary footprints retain the 4.5 m / aspect 3 rule. The final room pass can preserve
// smaller whole rooms; those must satisfy its bounded compact-room contract and stay inside their owner.
describe('urban density per phase', () => {
  for (const size of ['town', 'city'] as SizeName[]) for (const seed of ['1', '2', '3', '4', '5', '6']) {
    it(`${size} seed ${seed}`, () => {
      const world = generate(makeOptions({ seed, size })), r = coverage(world);
      for (const [id, v] of r.byPhase) {
        if (v.zone === 'faubourg') continue;
        const c = v.built / v.area;
        // (oldest phase from 0.78: every building is reached from the street, so dense plots give up a 1.6 m
        // gateway or a shared side passage to their rear ranges — about 6–10 % of the core's built area)
        const [lo, hi] = v.zone === 'faubourg' ? [0.35, 0.55] : id === 1 ? [0.78, 0.95] : id === 2 ? [0.7, 0.85] : [0.5, 0.7];
        expect.soft(c, `phase ${id} (${v.zone}) coverage`).toBeGreaterThanOrEqual(lo);
        expect.soft(c, `phase ${id} (${v.zone}) coverage`).toBeLessThanOrEqual(hi);
      }
      if (!Number.isNaN(r.faubNear)) {
        expect.soft(r.faubNear, 'faubourg coverage near the gate').toBeGreaterThanOrEqual(0.35);
        expect.soft(r.faubNear, 'faubourg coverage near the gate').toBeLessThanOrEqual(0.6);
        if (!Number.isNaN(r.faubFar)) expect.soft(r.faubFar, 'the faubourg fades out').toBeLessThan(r.faubNear);
      }
      const compact = compactFootprintExceptions(world);
      expect(compact.buildings.length, 'exercises completed compact rooms').toBeGreaterThan(0);
      expect(r.buildings - compact.buildings.length, 'also exercises ordinary footprints').toBeGreaterThan(0);
      expect.soft(r.narrow - compact.narrow, 'ordinary footprints narrower than 4.5 m').toBe(0);
      expect.soft(r.long - compact.long, 'ordinary footprints with aspect > 3').toBe(0);
    });
  }
});

describe('bounded completed-room shape oracle', () => {
  const rect = (w: number, h: number): Polygon => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const owner = rect(30, 30);
  const room = (poly: Polygon, extra: Partial<UrbanBuilding> = {}): UrbanBuilding => ({ poly, kind: 'house', ...extra });

  it('accepts small whole rectangular and triangular rooms inside their owner', () => {
    expect(isCompactFinalFootprint(room(rect(3.5, 7)), owner)).toBe(true);
    expect(isCompactFinalFootprint(room([{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 7, y: 4 }]), owner)).toBe(true);
    const hexagon = Array.from({ length: 6 }, (_, i) => ({
      x: 5 + 2.5 * Math.cos(i * Math.PI / 3), y: 5 + 2.5 * Math.sin(i * Math.PI / 3),
    }));
    expect(isCompactFinalFootprint(room(hexagon), owner)).toBe(true);
    expect(isCompactFinalFootprint(room(rect(3.5, 7)), rect(3, 7))).toBe(false);
  });

  it('rejects undersized, oversized and elongated rooms instead of lowering the ordinary bounds', () => {
    expect(isCompactFinalFootprint(room(rect(3, 8)), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(rect(3.3, 3.3)), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(rect(4, 14)), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(rect(4, 11)), owner)).toBe(false);
  });

  it('rejects concave strips and acute triangles', () => {
    const bent: Polygon = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 3.2 },
      { x: 3.2, y: 3.2 }, { x: 3.2, y: 8 }, { x: 0, y: 8 }];
    expect(isCompactFinalFootprint(room(bent), owner)).toBe(false);
    expect(isCompactFinalFootprint(room([{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 0, y: 4 }]), owner)).toBe(false);
  });

  it('limits exceptions to the ordinary finalizer programmes', () => {
    const poly = rect(3.5, 7);
    expect(isCompactFinalFootprint(room(poly, { kind: 'barn', roof: 'gable' }), owner)).toBe(true);
    expect(isCompactFinalFootprint(room(poly, { kind: 'shed', roof: 'flat' }), owner)).toBe(true);
    expect(isCompactFinalFootprint(room(poly, { kind: 'barn', roof: 'conical' }), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(poly, { kind: 'hall' }), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(poly, { ring: true }), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(poly, { courtyards: [rect(1, 1)] }), owner)).toBe(false);
    expect(isCompactFinalFootprint(room(poly, { arch: 'longhouse' }), owner)).toBe(false);
  });
});
