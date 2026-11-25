import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';
import { OPENING } from '../src/render/city3d/materials';
import { craftedIndianMassing } from '../src/render/craftedIndianMassing';
import type { BuildingTriangle, OverviewVolume } from '../src/render/urbanBuildingGeometry';

const shape = (x0: number, y0: number, x1: number, y1: number): Surface => [
  {
    outer: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    holes: [],
  },
];
function house(culture: string, clockwise = false) {
  const footprint = shape(0, 0, 12, 9);
  if (clockwise) footprint[0].outer.reverse();
  const vertices = [];
  for (const [left, right, bottom, top] of [
    [3, 4, 0.02, 2.1],
    [6, 7, 3.8, 5.0],
  ])
    for (const [x, z] of [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
    ])
      vertices.push({ x, y: -0.04, z });
  const volume = {
    footprint,
    z_m: 0,
    wall_height_m: 7,
    roof_height_m: 0,
    role: 'main',
    envelope: 'walled',
    displayRoofForm: 'flat',
    materials: { coating: 'city3d:wall:plaster', cladding: 'city3d:cover:plaster' },
    roof_mesh: { vertices, faces: [0, 4].map(i => ({ material: OPENING, vertices: [i, i + 1, i + 2, i + 3] })) },
  } as unknown as OverviewVolume;
  return { id: 'indian-house-3', culture: { culture }, function: 'domestic', volumes: [volume], footprint, entrance: { x: 3.5, y: -0.06 }, courtyards: [] } as unknown as PlacedBuilding;
}
function draw(b: PlacedBuilding) {
  const result: BuildingTriangle[] = [];
  for (const v of b.volumes) craftedIndianMassing(b, v, t => result.push(t));
  return result;
}
describe('Indian domestic massing', () => {
  it('attaches deep shaded thresholds and locally bracketed or projecting upper bays to their original openings', () => {
    for (const culture of ['dravidian-temple', 'indian-temple', 'rajput-fort', 'south-asian-metropolis']) {
      const b = house(culture),
        mesh = draw(b);
      expect(mesh).toEqual(draw(b));
      const outside = mesh.flatMap(t => t.points).filter(p => p[1] < -0.2);
      expect(outside.length).toBeGreaterThan(24);
      expect(Math.min(...outside.map(p => p[1]))).toBeLessThan(-0.98);
      expect(mesh.length).toBeLessThan(480);
      if (culture === 'dravidian-temple' || culture === 'indian-temple') {
        expect(mesh.some(t => t.material?.includes('cover:tile'))).toBe(true);
        expect(Math.min(...outside.map(p => p[2]))).toBeCloseTo(0);
      } else {
        expect(Math.min(...outside.map(p => p[2]))).toBeGreaterThan(2);
        expect(Math.max(...mesh.flatMap(t => t.points).map(p => p[2]))).toBeGreaterThan(9);
      }
      expect(mesh.every(t => Math.abs(Math.hypot(...t.normal) - 1) < 1e-6)).toBe(true);
    }
  });
  it('varies the porch construction on an identical facade in all four South Asian styles', () => {
    for (const culture of ['dravidian-temple', 'indian-temple', 'rajput-fort', 'south-asian-metropolis']) {
      const b = house(culture);
      b.volumes[0].roof_mesh.faces.splice(1); // Only the street door, so this volume gets the porch.
      const counts = new Set<number>();
      for (let i = 0; i < 48 && counts.size < 3; i++) {
        const mesh = draw({ ...b, id: 'terrace-lot-' + i });
        counts.add(mesh.filter(f => f.points.some(p => p[1] < -0.15 && p[2] < 4)).length);
      }
      expect(counts.size, culture).toBeGreaterThanOrEqual(3);
    }
  });
  it('keeps the profile outside the true frontage under reversed winding', () => {
    const b = house('dravidian-temple', true);
    expect(
      Math.min(
        ...draw(b)
          .flatMap(t => t.points)
          .map(p => p[1]),
      ),
    ).toBeLessThan(-1.6);
  });
  it('omits frontage occupied by a sibling, setback rooms intersecting a courtyard, and non-domestic sites', () => {
    const b = house('south-asian-metropolis');
    b.volumes.push({ ...b.volumes[0], role: 'minor', footprint: shape(0, -2.5, 12, 0) });
    b.courtyards = shape(0.5, 0.5, 11.5, 8.5);
    expect(draw(b)).toEqual([]);
    expect(draw({ ...house('dravidian-temple'), function: 'collective' })).toEqual([]);
  });
});
