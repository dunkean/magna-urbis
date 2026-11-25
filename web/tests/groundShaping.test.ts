import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Partition } from '../../rust/bridge/urban';
import { GROUND_SHAPE, UrbanGroundShape, groundShapeLots, groundShapePads, type GroundShapeLot, type GroundShapePad } from '../src/ui/urbanGroundShape';
import { CITY3D_PLINTH_M, silhouetteBuilding } from '../src/render/city3dMeshes';
import { buildingSeats } from '../src/render/city3d/scene';

// A 30 % slope rising to the east.
const slope = (x: number): number => 50 + 0.3 * x;
const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];
const pad = (x: number, y: number, w: number, d: number, seat = slope(x) + CITY3D_PLINTH_M): GroundShapePad => ({ ring: rect(x, y, w, d), seat, low: slope(x), high: slope(x + w), shaped: true });
/** Two lots side by side across the slope (x 0..12 and 12..24), each with a house; a street runs along x < 0. */
const lots: GroundShapeLot[] = [
  { ring: rect(0, 0, 12, 15), pads: [pad(2, 3, 8, 6)] },
  { ring: rect(12, 0, 12, 15), pads: [pad(14, 3, 8, 6)] },
];
const shapeOf = (list: readonly GroundShapeLot[], natural: (x: number, y: number) => number) => new UrbanGroundShape(list, natural);
const shaped = (s: UrbanGroundShape, natural: (x: number, y: number) => number) => (x: number, y: number) => s.shape(x, y, natural(x, y));
const house = (footprint: { outer: ReturnType<typeof rect>; holes: [] }[]): PlacedBuilding =>
  ({
    id: 'h',
    parcel_id: 'p',
    recipe_id: 'silhouette',
    function: 'domestic',
    culture: { culture: 'any' },
    ground_z_m: 0,
    footprint,
    roof_footprint: footprint,
    volumes: [],
    structural_features: [],
    programme: { massing: [{ floors: 1, eave_m: 3, rise_m: 2, roof: 'hip', cover: 'thatch', wall: 'stone', tone: 0.5, volumes: [{ ring: footprint[0].outer.map(p => [p.x, p.y]), eave_m: 3, rise_m: 2, roof: 'hip', cover: 'thatch', wall: 'stone', tone: 0.5 }] }] },
  }) as unknown as PlacedBuilding;

describe('ground shaped to the buildings of a hillside', () => {
  const shape = shapeOf(lots, slope),
    ground = shaped(shape, slope);

  it('cuts the ground to the floor under a house and behind it, and rises to the hill by a bank', () => {
    const floor = slope(2) + CITY3D_PLINTH_M;
    for (const [x, y] of [
      [6, 6],
      [9.9, 4],
      [10.5, 6],
    ])
      expect(ground(x, y)).toBeLessThan(floor);
    // At the street and at the shared edge the ground is the natural ground, the bank of the house apart.
    expect(ground(-0.5, 7)).toBe(slope(-0.5));
    expect(ground(0.001, 7)).toBeCloseTo(slope(0), 2);
    let steepest = 0;
    for (let x = -1; x < 25; x += 0.05) steepest = Math.max(steepest, Math.abs(ground(x + 0.05, 1.5) - ground(x, 1.5)) / 0.05);
    expect(steepest).toBeLessThan(1.8);
  });

  it('never fills a slope: the ground is raised by less than the plinth', () => {
    for (let x = -2; x < 26; x += 0.25) for (let y = -2; y < 17; y += 0.5) expect(ground(x, y) - slope(x)).toBeLessThanOrEqual(GROUND_SHAPE.maxFill + 1e-9);
  });

  it('keeps the profile of a street along the block, and cuts freely inside it', () => {
    const block = rect(-20, -20, 30.5, 60),
      free = shaped(shapeOf([{ pads: [pad(2, 3, 8, 6)] }], slope), slope),
      street = shaped(shapeOf([{ pads: [{ ...pad(2, 3, 8, 6), block }] }], slope), slope);
    expect(free(11, 6)).toBeLessThan(slope(11) - 1.5);
    expect(street(11.5, 6)).toBe(slope(11.5));
  });

  it('holds the ground at the downhill wall of a building standing higher in the same yard', () => {
    const yard = shaped(shapeOf([{ ring: rect(0, 0, 24, 24), pads: [pad(2, 3, 10, 10), pad(16, 14, 4, 4)] }], slope), slope);
    for (let y = 14; y <= 18; y += 0.5) expect(yard(15.5, y)).toBeGreaterThan(slope(16) - 0.25);
  });

  it('has no step where a house stands on its lot edge (the terrain grid would show a sawtooth)', () => {
    const g = shaped(
      shapeOf(
        [
          { ring: rect(0, 0, 12, 15), pads: [pad(0, 3, 8, 6)] },
          { ring: rect(-12, 0, 12, 15), pads: [] },
        ],
        slope,
      ),
      slope,
    );
    let jump = 0;
    for (let y = 2; y < 10; y += 0.25) for (let x = -4; x < 4; x += 0.02) jump = Math.max(jump, Math.abs(g(x + 0.02, y) - g(x, y)));
    expect(jump).toBeLessThan(0.1 + CITY3D_PLINTH_M);
  });

  it('leaves a flat lot, a lot at the water and the yard of a stilt house untouched', () => {
    const flat = (): number => 20,
      wet = (x: number): number => -1 + 0.3 * x;
    expect(shapeOf([{ ring: rect(0, 0, 12, 15), pads: [{ ...pad(2, 3, 8, 6), seat: 20, low: 20, high: 20 }] }], flat).empty).toBe(true);
    expect(shapeOf([{ ring: rect(0, 0, 12, 15), pads: [{ ...pad(2, 3, 8, 6), seat: 0, low: -1, high: 1.4 }] }], wet).empty).toBe(true);
    expect(shapeOf([{ ring: rect(0, 0, 12, 15), pads: [{ ...pad(2, 3, 8, 6), shaped: false }] }], slope).empty).toBe(true);
  });

  it('bounds cut and fill of a yard', () => {
    const steep = (x: number): number => 50 + 0.6 * x,
      s = shapeOf([{ ring: rect(0, 0, 20, 20), pads: [] }], steep);
    expect(s.empty).toBe(false);
    for (let x = 0; x <= 20; x += 0.5)
      for (let y = 0; y <= 20; y += 2) {
        const d = s.shape(x, y, steep(x)) - steep(x);
        expect(d).toBeLessThanOrEqual(GROUND_SHAPE.maxFill + 1e-9);
        expect(d).toBeGreaterThanOrEqual(-GROUND_SHAPE.maxCut - 1e-9);
      }
  });

  it('seats a house on the natural ground its pad is cut from: the same floor, nothing floats', () => {
    const footprint = [{ outer: rect(2, 3, 8, 6), holes: [] as [] }],
      building = house(footprint),
      natural = { at: slope, cut: true },
      [seat] = buildingSeats(building, natural),
      b = silhouetteBuilding(building, ground, undefined, false, true, natural);
    expect(b.ground_z_m).toBe(seat.seat);
    expect(groundShapePads(footprint, [seat])[0].seat).toBe(seat.seat);
    for (const p of footprint[0].outer) {
      expect(b.ground_z_m).toBeGreaterThanOrEqual(ground(p.x, p.y) - 1e-9);
      for (const v of b.volumes) expect(v.foundation.z_min_m).toBeLessThan(ground(p.x, p.y));
    }
  });

  it('collects the shaped lots with the footprints standing in them', () => {
    const parcel = (ring: ReturnType<typeof rect>, use: string) => ({ shape: { outer: ring, holes: [] }, use, front: null, block: 0, axis: { x: 1, y: 0 }, rank: 0 });
    const partitions = [{ key: 'a', warnings: [], parcels: [parcel(rect(0, 0, 12, 15), 'plot'), parcel(rect(12, 0, 12, 15), 'market')] }] as unknown as Partition[];
    const found = groundShapeLots(partitions, [pad(2, 3, 8, 6), pad(14, 3, 8, 6)]);
    expect(found.map(lot => [!!lot.ring, lot.pads.length])).toEqual([
      [true, 1],
      [false, 1],
    ]);
  });
});

describe('built terraces option', () => {
  const footprint = [{ outer: rect(0, 0, 10, 10), holes: [] }];
  const house = (terrace?: object) =>
    ({
      id: 'h',
      parcel_id: 'p',
      recipe_id: 'silhouette',
      function: 'domestic',
      culture: { culture: 'any' },
      ground_z_m: 0,
      footprint,
      roof_footprint: footprint,
      volumes: [],
      structural_features: [],
      programme: {
        massing: [
          {
            floors: 1,
            eave_m: 3,
            rise_m: 2,
            roof: 'hip',
            cover: 'thatch',
            wall: 'stone',
            tone: 0.5,
            ...(terrace ? { footing: { way: 'terrace', base_z_m: 0, low_z_m: 0, drop_m: 3, terrace } } : {}),
            volumes: [{ ring: footprint[0].outer.map(p => [p.x, p.y]), eave_m: 3, rise_m: 2, roof: 'hip', cover: 'thatch', wall: 'stone', tone: 0.5 }],
          },
        ],
      },
    }) as unknown as PlacedBuilding;
  const generator = {
    ring: [
      [-1.5, 0],
      [10, 0],
      [10, 10],
      [-1.5, 10],
    ],
    wall_m: 3,
  };

  it('keeps the generator terraces by default and drops them when off, the piece then on its own footing', () => {
    expect(silhouetteBuilding(house(generator), slope, undefined, false, true)).toEqual(silhouetteBuilding(house(generator), slope));
    expect(silhouetteBuilding(house(generator), slope).structural_foundations).toHaveLength(1);
    const off = silhouetteBuilding(house(generator), slope, undefined, false, false);
    expect(off.structural_foundations ?? []).toHaveLength(0);
    expect(off.volumes).toEqual(silhouetteBuilding(house(), slope).volumes);
  });
});
