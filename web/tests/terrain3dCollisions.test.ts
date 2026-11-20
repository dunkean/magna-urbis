import { describe, expect, it } from 'vitest';
import type { Surface } from '../../rust/bridge/housesContract';
import type { Enclosure } from '../../rust/bridge/urban';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Building3dVisual } from '../src/render/urbanBuildingGeometry';
import { city3dWalls, silhouetteBuilding } from '../src/render/city3dMeshes';
import { projectNativeBuilding } from '../src/ui/urbanBuildingProjection';
import { Terrain3dCollisions, WALK_RADIUS } from '../src/render/world/terrain3dCollisions';

const rect = (x: number, y: number, w: number, h: number): Surface => [
  {
    outer: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    holes: [],
  },
];
function house(footprint = rect(0, 0, 10, 10), id = 'house'): PlacedBuilding {
  return silhouetteBuilding(
    { id, recipe_id: 'silhouette', ground_z_m: 0, footprint, roof_footprint: footprint, volumes: [], circulation: [], entrance: footprint[0].outer[0], useful_area_m2: 0, domestic_units: 1, culture: { culture: 'european-organic' } } as unknown as PlacedBuilding,
    () => 0,
  );
}
const world = (...buildings: Building3dVisual[]) => new Terrain3dCollisions({ buildings });

describe('walk exterior collisions', () => {
  it('stops at facades with body clearance, from both directions, even across a long step', () => {
    const collisions = world(house());
    expect(collisions.move(-5, 5, 100, 0)[0]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(collisions.move(15, 5, -100, 0)[0]).toBeCloseTo(10 + WALK_RADIUS, 4);
    expect(collisions.move(5, -5, 0, 100)[1]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(collisions.move(5, 15, 0, -100)[1]).toBeCloseTo(10 + WALK_RADIUS, 4);
    expect(collisions.move(-5, -5, -2, 3)).toEqual([-7, -2]);
  });

  it('slides along facades, including on subsequent frames, and backs away freely', () => {
    const collisions = world(house());
    const first = collisions.move(-2, 2, 4, 3);
    expect(first[0]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(first[1]).toBeCloseTo(5);
    const second = collisions.move(...first, 2, 2);
    expect(second[0]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(second[1]).toBeCloseTo(7);
    expect(collisions.move(...second, -2, 0)[0]).toBeCloseTo(-WALK_RADIUS - 2, 4);
  });

  it('blocks diagonal corner entry and simultaneous contact with two buildings', () => {
    const collisions = world(house());
    const corner = collisions.move(-2, -2, 10, 10);
    expect(corner[0]).toBeCloseTo(-WALK_RADIUS / Math.SQRT2, 4);
    expect(corner[1]).toBeCloseTo(-WALK_RADIUS / Math.SQRT2, 4);
    const angle = world(house(rect(0, -10, 10, 20)), house(rect(-10, 0, 20, 10), 'second'));
    const stopped = angle.move(-2, -2, 10, 10);
    expect(stopped[0]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(stopped[1]).toBeCloseTo(-WALK_RADIUS, 4);
  });

  it('uses rotated outlines and retains courtyard holes instead of blocking their bounding box', () => {
    const diamond: Surface = [
      {
        outer: [
          { x: 0, y: 5 },
          { x: 5, y: 0 },
          { x: 10, y: 5 },
          { x: 5, y: 10 },
        ],
        holes: [],
      },
    ];
    expect(world(house(diamond)).move(-1, -1, 3, 0)).toEqual([2, -1]);
    const footprint = rect(0, 0, 10, 10);
    footprint[0].holes = [rect(3, 3, 4, 4)[0].outer];
    const courtyard = world(house(footprint));
    expect(courtyard.move(5, 5, 1, 0)).toEqual([6, 5]);
    expect(courtyard.move(5, 5, 10, 0)[0]).toBeCloseTo(7 - WALK_RADIUS, 4);
  });

  it('recovers an initial camera inside a house or exactly on a facade', () => {
    const collisions = world(house());
    expect(collisions.move(1, 5, 0, 0)[0]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(collisions.move(0, 5, 0, 0)[0]).toBeCloseTo(-WALK_RADIUS, 4);
    expect(collisions.move(-0.1, 5, -1, 0)[0]).toBeCloseTo(-WALK_RADIUS - 1, 4);
  });

  it('updates compact and detailed exteriors by id without retaining their old geometry', () => {
    const original = { ...house(), simplification: 'architectural_plan' as const };
    const compact = projectNativeBuilding(original),
      collisions = world(compact);
    expect(collisions.move(-5, 5, 10, 0)[0]).toBeCloseTo(-WALK_RADIUS, 4);
    collisions.replace(house(rect(20, 0, 10, 10)));
    expect(collisions.move(-5, 5, 10, 0)).toEqual([5, 5]);
    expect(collisions.move(15, 5, 10, 0)[0]).toBeCloseTo(20 - WALK_RADIUS, 4);
    collisions.replace(compact);
    expect(collisions.move(15, 5, 10, 0)).toEqual([25, 5]);
    expect(world().move(-5, 5, 10, 0)).toEqual([5, 5]);
  });

  it('leaves open envelopes, elevated bodies and bridge decks passable', () => {
    const open = house();
    open.volumes.forEach(v => {
      v.envelope = 'open';
      v.foundation.z_max_m = v.foundation.z_min_m;
    });
    const raised = house();
    raised.volumes.forEach(v => {
      v.levels.forEach(l => {
        l.z_m += 8;
      });
      v.foundation.z_max_m = v.foundation.z_min_m;
    });
    const bridge = { ...house(), recipe_id: 'city3d-bridge' };
    for (const building of [open, raised, bridge]) expect(world(building).move(-5, 5, 20, 0)).toEqual([15, 5]);
    const elevated = { ...projectNativeBuilding({ ...house(), simplification: 'architectural_plan' }), ground_z_m: 10, height_m: 3 };
    expect(world(elevated).move(-5, 5, 20, 0)).toEqual([15, 5]);
    for (const exaggeration of [1, 3]) expect(world(elevated).move(-5, 5, 20, 0, () => 10, exaggeration)[0]).toBeCloseTo(-WALK_RADIUS, 4);
  });

  it('cannot cross a thin palisade or get stuck while moving through a usable alley', () => {
    expect(world(house(rect(0, 0, 0.05, 10))).move(-10, 5, 50, 0)[0]).toBeCloseTo(-WALK_RADIUS, 4);
    const alley = world(house(rect(0, -10, 10, 20)), house(rect(-11, -10, 10, 20), 'second'));
    expect(alley.move(-0.5, -15, 0, 30)).toEqual([-0.5, 15]);
  });

  it('blocks real curtain and gatehouse masses but walks under their lintels, also on raised terrain', () => {
    const enclosure = {
      kind: 'wall',
      path: rect(0, 0, 100, 100)[0].outer,
      gates: [{ x: 50, y: 0 }],
      height_m: 9,
      curtain_width_m: 3,
      gatehouses: [
        {
          gate: 0,
          kind: 'tower',
          passage: [
            { x: 50, y: -5 },
            { x: 50, y: 5 },
          ],
          passage_width_m: 6,
          height_m: 12,
          shape: rect(43, -4, 14, 8)[0],
          masses: [rect(43, -4, 4, 8)[0], rect(53, -4, 4, 8)[0]],
        },
      ],
    } as unknown as Enclosure;
    for (const ground of [0, 20])
      for (const exaggeration of [1, 3]) {
        const walls = city3dWalls([enclosure], () => ground),
          collisions = world(...walls);
        const move = (x: number) => collisions.move(x, -10, 0, 20, () => ground, exaggeration);
        expect(move(50)).toEqual([50, 10]);
        expect(move(45)[1]).toBeCloseTo(-4 - WALK_RADIUS, 4);
        const curtain = move(20);
        expect(curtain[1]).toBeLessThan(-WALK_RADIUS);
        expect(curtain[1]).toBeGreaterThan(-5);
        const gateOnly = world(...walls.filter(b => b.id.includes(':gate:')));
        expect(gateOnly.move(50, -10, 0, 20, () => ground + 6, exaggeration)[1]).toBeLessThan(-4);
      }
  });
});
