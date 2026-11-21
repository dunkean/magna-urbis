import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Partition } from '../../rust/bridge/urban';
import { GROUND_SHAPE, UrbanGroundShape, groundShapeLots, type GroundShapeLot } from '../src/ui/urbanGroundShape';
import { silhouetteBuilding } from '../src/render/city3dMeshes';

// A 30 % slope rising to the east.
const slope = (x: number): number => 50 + 0.3 * x;
const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];
/** Two lots side by side across the slope (x 0..12 and 12..24), each with a house; a street runs along x < 0. */
const lots: GroundShapeLot[] = [
  {
    ring: rect(0, 0, 12, 15),
    front: [
      { x: 0, y: 0 },
      { x: 0, y: 15 },
    ],
    footprints: [rect(2, 3, 8, 6)],
  },
  { ring: rect(12, 0, 12, 15), front: null, footprints: [rect(14, 3, 8, 6)] },
];
const shapeOf = (list: readonly GroundShapeLot[], natural: (x: number, y: number) => number) => new UrbanGroundShape(list, natural);
const shaped = (s: UrbanGroundShape, natural: (x: number, y: number) => number) => (x: number, y: number) => s.shape(x, y, natural(x, y));

describe('hillside lots levelled into the 3D ground', () => {
  const shape = shapeOf(lots, slope),
    ground = shaped(shape, slope);

  it('levels a lot on a 30 % slope inside and meets its street and neighbour by a bounded bank', () => {
    const level = shape.levelAt(6, 6)!;
    expect(level).toBeGreaterThan(slope(2));
    expect(level).toBeLessThan(slope(10));
    // Level under the house and through the yard past the bank.
    for (const [x, y] of [
      [2, 3],
      [10, 9],
      [6, 6],
      [5, 12],
      [8, 2.5],
    ])
      expect(ground(x, y)).toBeCloseTo(level, 9);
    // At the street and at the shared edge the ground is the natural ground: both lots meet on it.
    expect(ground(-0.5, 7)).toBe(slope(-0.5));
    expect(ground(0.001, 7)).toBeCloseTo(slope(0), 2);
    expect(ground(11.999, 7)).toBeCloseTo(slope(12), 2);
    expect(ground(12.001, 7)).toBeCloseTo(slope(12), 2);
    // The banks stay bounded: no step steeper than about 60° anywhere across the two lots.
    let steepest = 0;
    for (let x = -1; x < 25; x += 0.05) steepest = Math.max(steepest, Math.abs(ground(x + 0.05, 1.5) - ground(x, 1.5)) / 0.05);
    expect(steepest).toBeLessThan(1.8);
  });

  it('has no step where a house stands on its lot edge (the terrain grid would show a sawtooth)', () => {
    const edge: GroundShapeLot[] = [
      { ring: rect(0, 0, 12, 15), footprints: [rect(0, 3, 8, 6)] },
      { ring: rect(-12, 0, 12, 15), footprints: [] },
    ];
    const s = shapeOf(edge, slope),
      g = shaped(s, slope);
    let jump = 0;
    for (let y = 2; y < 10; y += 0.25) for (let x = -4; x < 4; x += 0.02) jump = Math.max(jump, Math.abs(g(x + 0.02, y) - g(x, y)));
    expect(jump).toBeLessThan(0.1);
  });

  it('leaves a flat lot, a lot at the water and the street untouched', () => {
    const flat = (): number => 20,
      wet = (x: number): number => -1 + 0.3 * x;
    expect(shapeOf(lots, flat).empty).toBe(true);
    expect(shapeOf(lots.slice(0, 1), wet).empty).toBe(true);
    for (let y = 0; y <= 15; y++) expect(ground(-1, y)).toBe(slope(-1));
  });

  it('bounds cut and fill on a steep lot', () => {
    const steep = (x: number): number => 50 + 0.6 * x,
      deep: GroundShapeLot[] = [{ ring: rect(0, 0, 20, 20), footprints: [rect(1, 1, 18, 18)] }];
    const s = shapeOf(deep, steep);
    expect(s.empty).toBe(false);
    for (let x = 0; x <= 20; x += 0.5)
      for (let y = 0; y <= 20; y += 2) {
        const d = s.shape(x, y, steep(x)) - steep(x);
        expect(d).toBeLessThanOrEqual(GROUND_SHAPE.maxFill + 1e-9);
        expect(d).toBeGreaterThanOrEqual(-GROUND_SHAPE.maxCut - 1e-9);
      }
  });

  it('never buries the door: the platform is raised to the ground at the street frontage', () => {
    // The street is uphill (east edge): the front corners of the house set the level.
    const uphill: GroundShapeLot[] = [
      {
        ring: rect(0, 0, 12, 15),
        front: [
          { x: 12, y: 0 },
          { x: 12, y: 15 },
        ],
        footprints: [rect(4, 3, 8, 6)],
      },
    ];
    expect(shapeOf(uphill, slope).levelAt(6, 6)).toBeCloseTo(slope(12), 9);
  });

  it('seats a house on its levelled lot: the floor stands at the platform level, nothing floats', () => {
    const footprint = [{ outer: rect(2, 3, 8, 6), holes: [] }];
    const building = {
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
    } as unknown as PlacedBuilding;
    const b = silhouetteBuilding(building, ground),
      level = shape.levelAt(6, 6)!;
    expect(b.ground_z_m).toBeCloseTo(level, 9);
    // Today on the natural slope the floor stood at the high corner, 2.4 m above the low one.
    expect(silhouetteBuilding(building, slope).ground_z_m).toBeCloseTo(slope(10), 9);
    for (const p of footprint[0].outer) {
      expect(b.ground_z_m).toBeGreaterThanOrEqual(ground(p.x, p.y) - 1e-9);
      for (const v of b.volumes) expect(v.foundation.z_min_m).toBeLessThan(ground(p.x, p.y));
    }
  });

  it('collects the shaped lots with the footprints standing in them', () => {
    const parcel = (ring: ReturnType<typeof rect>, use: string) => ({ shape: { outer: ring, holes: [] }, use, front: null, block: 0, axis: { x: 1, y: 0 }, rank: 0 });
    const partitions = [{ key: 'a', warnings: [], parcels: [parcel(rect(0, 0, 12, 15), 'plot'), parcel(rect(12, 0, 12, 15), 'market')] }] as unknown as Partition[];
    const found = groundShapeLots(partitions, [[{ outer: rect(2, 3, 8, 6), holes: [] }], [{ outer: rect(14, 3, 8, 6), holes: [] }]]);
    expect(found).toHaveLength(1);
    expect(found[0].footprints).toHaveLength(1);
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
