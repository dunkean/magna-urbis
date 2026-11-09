import { describe, expect, it } from 'vitest';
import type { World, River, Vec2 } from '../src/gen/types';
import type { RiverLine, RiverNetwork } from '../src/ui/riverVectors';
import type { RoadOutput, RoadSegment } from '../../rust/bridge/settlements';
import { forCellsNearPolyline } from '../src/gen/core/field';
import { addRoad, deleteRiver, deleteRoad, planRiverDeletion, roadAt, roadCrossings, setRoadClass, setRoadPath, translateRoad } from '../src/v2/networkEdits';

const N = 40, CELL = 5, SIZE = N * CELL;
type Spec = { points: number[]; width: number; id?: number; joins?: number };
const line = (s: Spec): RiverLine => ({ points: s.points, area: s.points.filter((_, i) => i % 2 === 0).map(() => 1e6), level: s.points.filter((_, i) => i % 2 === 0).map(() => 0),
  kind: s.points.filter((_, i) => i % 2 === 0).map(() => 0), id: s.id, joins: s.joins });
const pathOf = (points: number[]): Vec2[] => Array.from({ length: points.length / 2 }, (_, j) => ({ x: points[j * 2], y: points[j * 2 + 1] }));
const cellAt = (x: number, y: number): number => Math.floor(y / CELL) * N + Math.floor(x / CELL);

// Main river 0 runs south along x = 100. Tributary 1 joins it from the west (y = 50); 2 feeds 1; 4 reaches 1 through a lake (link);
// 3 is an independent stream to the east edge. Braid and oxbow belong to 1, the distributary to 0.
const SPECS = {
  main: { points: [100, 0, 100, 100, 100, 200], width: 8, id: 0, joins: -1 },
  trib: { points: [20, 50, 60, 50, 99, 50], width: 4, id: 1, joins: 0 },
  sub: { points: [20, 10, 20, 50], width: 3, id: 2, joins: 1 },
  other: { points: [150, 160, 199, 160], width: 5, id: 3, joins: -1 },
  inflow: { points: [0, 95, 30, 85], width: 3, id: 4, joins: -1 },
  braid: { points: [40, 46, 60, 45, 80, 46], width: 2, id: 1 },
  delta: { points: [100, 180, 120, 199], width: 3, id: 0 },
  oxbow: { points: [50, 58, 60, 62, 70, 58], width: 2 },
  link: { points: [30, 85, 40, 70, 60, 51], width: 2, joins: 1 },
};
function fixture(options: { native?: 'vector' | 'hydrology' | 'none' } = {}): World {
  const mode = options.native ?? 'vector';
  const mains = [SPECS.main, SPECS.trib, SPECS.sub, SPECS.other, SPECS.inflow];
  const network: RiverNetwork = { rivers: mains.map(line), braids: [line(SPECS.braid)], distributaries: [line(SPECS.delta)], oxbows: [line(SPECS.oxbow)],
    lakeLinks: [line(SPECS.link)], meanderRuns: 0, lengthKm: 1, meanderKm: 0, braidedKm: 0, avulsions: 0, deltas: 1, ms: 0 };
  const projected: River[] = (mode === 'vector' ? [...mains, SPECS.braid, SPECS.delta, SPECS.oxbow] : mains).map((s:Spec, index) => ({ path: pathOf(s.points), width: pathOf(s.points).map(() => s.width),
    id: s.id ?? 100 + index, host: s.joins !== undefined && s.joins >= 0 ? s.joins : undefined, main: s.width >= 8 }));
  const water = new Uint8Array(N * N);
  for (const river of projected) for (let j = 1; j < river.path.length; j++)
    forCellsNearPolyline([river.path[j - 1], river.path[j]], N, N, CELL, Math.max(CELL * .6, river.width[j] / 2), i => { if (!water[i]) water[i] = 3; });
  let native: unknown;
  if (mode === 'vector') native = { water: { rivers: network, hydro: { n: N, width: SIZE, sea: new Uint8Array(N * N) }, lake: new Uint8Array(N * N) } };
  if (mode === 'hydrology') {
    const points: number[] = [], offsets = [0], meta: number[] = [];
    for (const s of mains) { for (const p of pathOf(s.points)) points.push(p.x, p.y, s.width, 0); offsets.push(points.length / 4); meta.push(s.id!, 0, 0, s.joins! >= 0 ? s.joins! + 1 : 0, 0, 0); }
    native = { hydrology: { riverPoints: Float32Array.from(points), riverOffsets: Uint32Array.from(offsets), riverMeta: Uint32Array.from(meta), riverCount: mains.length } };
  }
  const road = [{ x: 40, y: 130 }, { x: 170, y: 130 }];
  const terrain = { height: { w: N, h: N, cell: CELL, data: new Float32Array(N * N).fill(10) }, slope: { w: N, h: N, cell: CELL, data: new Float32Array(N * N) },
    flow: { w: N, h: N, cell: CELL, data: new Float32Array(N * N) }, water, seaLevel: 0, seaFraction: 0, coastline: [], lakes: [], rivers: projected,
    receiver: new Int32Array(N * N).fill(-1), filled: new Float32Array(N * N), downSide: 'S', seaSide: null,
    ...(native ? { v2NativeTerrain: native } : {}), v2CityGround: { retained: true } } as unknown as World['terrain'];
  const crossings = roadCrossings(terrain, road, 'main');
  const segment: RoadSegment = { class: 'main', surface: 'gravel', profile: 'medieval', width: 5, a: 0, b: 1, path: road, crossings, length: 130, grade: 0, importance: 40 };
  const output: RoadOutput = { segments: [segment], junctions: [{ point: road[0], degree: 1, site: 'main' }, { point: road[1], degree: 1, site: 'village:0' }],
    warnings: [], unreachable: [], routes: 1, lengthByClass: { main: 130 }, lengthBySurface: { gravel: 130 }, ms: 0,
    nodes: [{ id: 'inn', x: 140, y: 133, access: { x: 140, y: 130 } } as unknown as NonNullable<RoadOutput['nodes']>[number]] };
  const base = crossings.filter(c => c.kind === 'bridge').map(c => ({ a: c.path[0], b: c.path[c.path.length - 1], width: 5 }));
  const town = { a: { x: 94, y: 185 }, b: { x: 106, y: 185 }, width: 4 };
  return {
    seed: 'test', options: {} as World['options'], mapSize: SIZE, terrain,
    roads: [{ path: road, kind: 'major', width: 5 }], bridges: [...base, town],
    settlements: [{ key: 'main', main: true, center: road[0] }, { key: 'village:0', center: road[1] }] as unknown as World['settlements'],
    landuse: { areas: [], farmsteads: [], reserve: [], forestCorridors: [{ path: road, half: 5 }] },
    names: { family: 'english', town: 'Test', entries: [
      { id: 'r', kind: 'road', text: 'Old Road', rank: 1, anchor: { x: 105, y: 130 }, path: road.map(p => ({ ...p })) },
      { id: 'trib', kind: 'river', text: 'Brook', rank: 3, anchor: { x: 60, y: 50 }, path: pathOf(SPECS.trib.points) },
      { id: 'main', kind: 'river', text: 'Great River', rank: 1, anchor: { x: 100, y: 100 }, path: pathOf(SPECS.main.points) },
    ] },
    site: { fields: { riverMask: Uint8Array.from(water, v => v === 3 ? 2 : 0), bridgeZone: new Uint8Array(N * N), dWater: new Float32Array(N * N), dSea: new Float32Array(N * N).fill(1e9),
      dMain: new Float32Array(N * N), hab: new Float32Array(N * N), slopeS: new Float32Array(N * N) } } as unknown as World['site'],
    debug: { v2RustRegion: { placement: { settlements: [] }, roads: output }, v2BaseBridges: base, v2TownBridges: { main: [town] } },
    stats: { 'v2.terrainKey': 'k' },
  };
}
const region = (w: World): RoadOutput => (w.debug!.v2RustRegion as { roads: RoadOutput }).roads;

describe('V2 regional road edits', () => {
  it('keeps the fixture road bridged over the main river', () => {
    const w = fixture();
    expect(region(w).segments[0].crossings.map(c => c.kind)).toEqual(['bridge']);
    expect(roadAt(w, { x: 120, y: 131 }, 2)?.index).toBe(0);
  });
  it('adds a road with a T junction, crossings, bridges and aligned native segments, leaving the source world intact', () => {
    const w = fixture(), before = structuredClone({ roads: w.roads, out: region(w) });
    const { world, road } = addRoad(w, [{ x: 70, y: 10 }, { x: 70, y: 129 }], { snap: 4, cls: 'track' });
    const out = region(world);
    expect(world.roads!.length).toBe(3); expect(out.segments.length).toBe(3); expect(road).toBe(2);
    // The old road is split at the T: the bridge stays on the half that spans the river.
    expect(world.roads![0].path.at(-1)).toEqual({ x: 70, y: 130 }); expect(world.roads![1].path[0]).toEqual({ x: 70, y: 130 });
    expect(out.segments[0].crossings).toEqual([]); expect(out.segments[1].crossings.map(c => c.kind)).toEqual(['bridge']);
    const tee = out.junctions.findIndex(j => j.point.x === 70 && j.point.y === 130);
    expect(out.junctions[tee].degree).toBe(3); expect(out.segments[2].b).toBe(tee);
    // The new track crosses the tributary and its braid.
    expect(out.segments[2].crossings.length).toBeGreaterThan(0);
    expect(out.segments[2].class).toBe('track'); expect(world.roads![2].kind).toBe('track');
    expect(world.bridges!.at(-1)).toEqual({ a: { x: 94, y: 185 }, b: { x: 106, y: 185 }, width: 4 });
    expect(world.debug!.v2BaseBridges).toEqual(out.segments.flatMap(s => s.crossings.filter(c => c.kind === 'bridge').map(c => ({ a: c.path[0], b: c.path.at(-1), width: s.width }))));
    expect(world.stats['v2.regionalRoads']).toBe(3);
    expect({ roads: w.roads, out: region(w) }).toEqual(before);
    expect(world.terrain).toBe(w.terrain); expect(world.landuse).not.toBe(w.landuse);
  });
  it('snaps a new road end to a settlement junction', () => {
    const w = fixture();
    const { world } = addRoad(w, [{ x: 168, y: 127 }, { x: 180, y: 20 }], { snap: 6 });
    const out = region(world), segment = out.segments.at(-1)!;
    expect(world.roads!.at(-1)!.path[0]).toEqual({ x: 170, y: 130 });
    expect(out.junctions[segment.a].site).toBe('village:0'); expect(out.junctions[segment.a].degree).toBe(2);
  });
  it('moves a road, re-derives its crossings, corridor, label and network nodes', () => {
    const w = fixture();
    const { world } = translateRoad(w, 0, 0, -100);
    const moved = world.roads![0].path;
    expect(moved).toEqual([{ x: 40, y: 30 }, { x: 170, y: 30 }]);
    expect(region(world).segments[0].crossings.map(c => c.kind)).toEqual(['bridge']);
    expect(world.landuse!.forestCorridors).toEqual([{ path: moved, half: 5 / 2 + 2.5 }]);
    const label = world.names!.entries.find(e => e.id === 'r')!;
    expect(label.path).toEqual(moved); expect(label.anchor).toEqual({ x: 105, y: 30 });
    expect(region(world).nodes).toEqual([]);
    // Both ends moved: settlement junctions stay (degree 0), the road gets free ends.
    expect(region(world).junctions.filter(j => j.site).map(j => j.degree)).toEqual([0, 0]);
    expect(w.roads![0].path[0]).toEqual({ x: 40, y: 130 });
  });
  it('reshapes, reclassifies and deletes a road, pruning free junctions', () => {
    const w = fixture();
    const reshaped = setRoadPath(w, 0, [{ x: 40, y: 130 }, { x: 105, y: 150 }, { x: 170, y: 130 }]).world;
    expect(region(reshaped).segments[0].a).toBe(0); expect(region(reshaped).segments[0].b).toBe(1);
    expect(region(reshaped).segments[0].path.length).toBe(3);
    const trail = setRoadClass(reshaped, 0, 'trail').world;
    expect(region(trail).segments[0].class).toBe('trail'); expect(trail.roads![0].kind).toBe('track');
    const added = addRoad(trail, [{ x: 10, y: 190 }, { x: 60, y: 190 }]).world;
    expect(region(added).junctions.length).toBe(4);
    const removed = deleteRoad(added, 1).world;
    expect(region(removed).junctions.length).toBe(2); expect(removed.roads!.length).toBe(1);
    expect(region(removed).lengthByClass.trail).toBeCloseTo(region(trail).segments[0].length);
  });
});

describe('V2 river deletion', () => {
  it('plans the selected course with every upstream tributary, its braid, oxbow and lake-fed inflow', () => {
    const w = fixture(), trib = w.terrain.rivers.findIndex(r => r.id === 1 && r.host === 0);
    const plan = planRiverDeletion(w, trib);
    const removed = plan.rivers.map(i => w.terrain.rivers[i]);
    expect(plan.source).toBe('vector'); expect(plan.streams.sort()).toEqual([1, 2, 4]);
    expect(removed.map(r => r.path[0])).toEqual(expect.arrayContaining([{ x: 20, y: 50 }, { x: 20, y: 10 }, { x: 0, y: 95 }, { x: 40, y: 46 }, { x: 50, y: 58 }]));
    expect(removed.some(r => r.id === 0 || r.id === 3)).toBe(false);
    expect(planRiverDeletion(w, trib, { throughLakes: false }).streams.sort()).toEqual([1, 2]);
  });
  it('rewrites projected and native water, masks, site fields and names; the source world stays pristine', () => {
    const w = fixture(), trib = w.terrain.rivers.findIndex(r => r.id === 1 && r.host === 0), water = w.terrain.water.slice();
    const { world, plan } = deleteRiver(w, trib);
    const native = (world.terrain as unknown as { v2NativeTerrain: { water: { rivers: RiverNetwork } } }).v2NativeTerrain.water.rivers;
    expect(native.rivers.map(l => l.id)).toEqual([0, 3]); expect(native.braids).toEqual([]); expect(native.oxbows).toEqual([]);
    expect(native.lakeLinks).toEqual([]); expect(native.distributaries.length).toBe(1);
    expect(world.terrain.rivers.length).toBe(w.terrain.rivers.length - plan.rivers.length);
    expect(world.terrain.water[cellAt(40, 50)]).toBe(0); expect(world.terrain.water[cellAt(100, 50)]).toBe(3); expect(world.terrain.water[cellAt(100, 150)]).toBe(3);
    expect(world.site!.fields.riverMask[cellAt(40, 50)]).toBe(0); expect(world.site!.fields.riverMask[cellAt(100, 150)]).toBe(2);
    expect(world.names!.entries.map(e => e.id)).toEqual(['r', 'main']);
    expect('v2CityGround' in world.terrain).toBe(false);
    expect(world.stats['v2.waterEditRevision']).toBe(1); expect(world.stats['v2.terrainKey']).toBe('k');
    expect(region(world).segments[0].crossings.length).toBe(1); expect(world.bridges!.length).toBe(2);
    expect(w.terrain.water).toEqual(water); expect(w.terrain.rivers.length).toBe(8);
    expect((w.terrain as unknown as { v2NativeTerrain: { water: { rivers: RiverNetwork } } }).v2NativeTerrain.water.rivers.rivers.length).toBe(5);
  });
  it('drops the crossings and bridges of a deleted main river, regional and urban', () => {
    const w = fixture(), main = w.terrain.rivers.findIndex(r => r.id === 0 && r.path[0].y === 0);
    const { world, plan } = deleteRiver(w, main);
    expect(plan.streams.sort()).toEqual([0, 1, 2, 4]);
    expect(world.terrain.rivers.map(r => r.id)).toEqual([3]);
    expect(region(world).segments[0].crossings).toEqual([]);
    expect(world.bridges).toEqual([]); expect(world.debug!.v2TownBridges).toEqual({ main: [] });
    expect(world.names!.entries.map(e => e.id)).toEqual(['r']);
  });
  it('filters the packed native hydrology by host', () => {
    const w = fixture({ native: 'hydrology' }), trib = w.terrain.rivers.findIndex(r => r.id === 1);
    const { world, plan } = deleteRiver(w, trib);
    const h = (world.terrain as unknown as { v2NativeTerrain: { hydrology: { riverOffsets: Uint32Array; riverMeta: Uint32Array; riverCount: number } } }).v2NativeTerrain.hydrology;
    expect(plan.source).toBe('hydrology'); expect(plan.streams.sort()).toEqual([1, 2]);
    expect(h.riverCount).toBe(3); expect(Array.from(h.riverOffsets)).toEqual([0, 3, 5, 7]);
    expect([0, 1, 2].map(r => h.riverMeta[r * 6])).toEqual([0, 3, 4]);
  });
  it('uses projected ids and hosts without a native network', () => {
    const w = fixture({ native: 'none' }), trib = w.terrain.rivers.findIndex(r => r.id === 1);
    expect(deleteRiver(w, trib).world.terrain.rivers.map(r => r.id)).toEqual([0, 3, 4]);
  });
});
