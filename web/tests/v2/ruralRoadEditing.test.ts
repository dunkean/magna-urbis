import { describe, it, expect } from 'vitest';
import type { World } from '../../src/gen/types';
import { editableRuralRoads } from '../../src/v2/ruralRoadEditing';
import { roadAt } from '../../src/v2/networkEdits';
import { fixedRoadEndpoint, roadEndpointPeers } from '../../src/v2/roadEditing';
import { defaultSettings } from '../../src/v2/settings';
import { regionalPopulation } from '../../src/v2/regionalPopulation';

function fixture(): World {
  const p = (x: number, y: number) => ({ x, y }),
    path = [p(10, 50), p(190, 50)],
    grid = { w: 20, h: 20, cell: 10, data: new Float32Array(400).fill(20) };
  const road = { a: 0, b: 1, class: 'main', surface: 'gravel', profile: 'medieval', width: 5, path, crossings: [], length: 180, grade: 0, importance: 100 };
  return {
    seed: 'rural',
    mapSize: 200,
    options: {},
    stats: {},
    roads: [{ path, kind: 'major', width: 5 }],
    bridges: [],
    terrain: { height: grid, slope: grid, flow: grid, water: new Uint8Array(400), filled: grid.data, rivers: [], lakes: [], coastline: [], seaLevel: 0 },
    landuse: { areas: [], reserve: [], farmsteads: [{ pos: p(100, 100), gate: p(100, 100), drive: [p(100, 50), p(100, 100)], buildings: [], yard: [], angle: 0 }], ways: [[p(20, 50), p(20, 180)]] },
    debug: {
      v2RustRegion: {
        roads: {
          segments: [road],
          junctions: [
            { point: path[0], site: 'main', degree: 1 },
            { point: path[1], site: 'east', degree: 1 },
          ],
          exits: [],
          routes: 1,
          warnings: [],
          unreachable: [],
          lengthByClass: {},
          lengthBySurface: {},
          ms: 0,
        },
      },
      v2BaseBridges: [],
      v2TownBridges: {},
    },
  } as unknown as World;
}
describe('small rural paths in the road editor', () => {
  it('allocates more than 999 residents per requested village without adding places or losing inhabitants', () => {
    const settings = defaultSettings();
    settings.extent = 10000;
    settings.region = { demography: { population: 10000, counts: { city: 0, town: 0, village: 2, hamlet: 0, farmstead: 0 } } };
    const plan = regionalPopulation(settings);
    expect(plan.counts.village).toBe(2);
    expect(plan.places).toHaveLength(2);
    expect(plan.allocatedPopulation).toBe(10000);
    expect(plan.unallocated).toBe(0);
    expect(plan.places.every(p => p.population > 999)).toBe(true);
  });
  it('exposes farm drives and field ways to picking with real connected T junctions', () => {
    const source = fixture(),
      before = structuredClone(source),
      world = editableRuralRoads(source);
    const farm = roadAt(world, { x: 100, y: 85 }, 2),
      field = roadAt(world, { x: 20, y: 130 }, 2);
    expect(farm).toBeDefined();
    expect(field).toBeDefined();
    expect(world.roads![farm!.index].kind).toBe('track');
    expect(roadEndpointPeers(world, farm!.index, 0)).toHaveLength(2);
    expect(fixedRoadEndpoint(world, farm!.index, 1)).toBe(true);
    expect(world.landuse!.farmsteads[0].drive).toEqual([]);
    expect(world.landuse!.ways).toEqual([]);
    expect(source).toEqual(before);
    expect(editableRuralRoads(source)).toBe(world);
    expect(editableRuralRoads(world)).toBe(world);
  });
});
