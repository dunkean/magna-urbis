import { cityWallStrokes } from '../src/render/cityWalls';
import { CellPageMesh, type MeshCell } from '../src/render/city/gl/cellMesh';
import { RetainedYardRuns, yardRuns } from '../src/render/yardStyle';
import type { YardBoundary } from '../src/render/cityLotEnclosures';
import { cityCanopy, LiveCrownCells } from '../src/render/cityGrove';
import { buildCityBuildings, buildCityScene } from '../src/render/cityCanvas';
import { mergePlanGeometrySteps } from '../src/render/city/gl/mergePlan';
import type { Layout } from '../../rust/bridge/urban';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { describe, expect, it } from 'vitest';
import { CityGlPacker, triangulatePolygons, buildFillMeshSync, packPlan, visibleFillRanges } from '../src/render/cityGlBuild';
import { gridKey, planEditCells, CITY_EDIT_CELL, concatPolygons, samePlanPage, splitPlanSteps, splitTriangulation } from '../src/render/city/gl/pages';
import type { CityScene } from '../src/render/city/model/contract';

const square = (x: number, y: number, s: number) => ({
  outer: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  holes: [],
});
const run = <T>(steps: Generator<void, T>): T => {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
};
const scene = (blocks: ReturnType<typeof square>[]): CityScene =>
  ({ layouts: [], blocks: blocks.map((shape, i) => ({ shape, layout: 0, kind: 'house', id: `b${i}` })), parcels: [], streets: [], walls: [], districts: [], landmarks: [], footprint: [], quays: [], extent: { minX: 0, minY: 0, maxX: 5000, maxY: 100 } }) as unknown as CityScene;

describe('GPU town pages', () => {
  it('splits by page and keeps only the pages whose elements are the same', () => {
    const a = [square(10, 10, 20), square(100, 10, 20), square(3000, 10, 20)];
    const before = run(splitPlanSteps(scene(a)));
    expect(before.size).toBe(2);
    // An edit of the far block: the near page holds merged copies of the same elements.
    const edited = run(splitPlanSteps(scene([a[0], a[1], square(3000, 10, 25)])));
    const near = [...before.keys()][0],
      far = [...before.keys()][1];
    expect(samePlanPage(before.get(near)!, edited.get(near)!)).toBe(true);
    expect(samePlanPage(before.get(far)!, edited.get(far)!)).toBe(false);
  });
  it('triangulates several pages in one run and gives each its own triangulation back', () => {
    const pack = (shapes: ReturnType<typeof square>[]) => {
      const packer = new CityGlPacker({ x: 0, y: 0 });
      shapes.forEach((shape, i) => packer.add(shape, i));
      return packer.done();
    };
    const list = [pack([square(0, 0, 10), square(20, 0, 10)]), pack([square(50, 0, 5)])];
    const parts = splitTriangulation(triangulatePolygons(concatPolygons(list)), list);
    expect(parts).toEqual(list.map(p => triangulatePolygons(p)));
  });
});

const origin = { x: 0, y: 0 };
function blocksInCells(shapes: ReturnType<typeof square>[]): MeshCell<null>[] {
  return [...run(splitPlanSteps(scene(shapes), CITY_EDIT_CELL)).values()].map(p => ({ key: p.key, order: p.order, part: null, mesh: buildFillMeshSync(packPlan(p.plan, origin)) }));
}
function drawn(mesh: ReturnType<typeof buildFillMeshSync>, stream: 'lines' | 'triangles') {
  return mesh.layers.blocks.chunks.flatMap(c => {
    const r = c[stream];
    return Array.from(mesh[stream].subarray(r.start, r.start + r.count))
      .filter(i => i !== 0xffffffff)
      .map(i => [mesh.positions[i * 2], mesh.positions[i * 2 + 1]]);
  });
}
it('patches one 256 m slot while interleaved neighbours retain their painter order and single draw', () => {
  const shapes = [square(1, 2, 7), square(301, 3, 8), square(24, 4, 9)],
    cells = blocksInCells(shapes),
    page = new CellPageMesh(cells);
  const changedShapes = [square(2, 2, 7), shapes[1], shapes[2]],
    next = blocksInCells(changedShapes);
  const dirty = { ...next[0], order: cells[0].order },
    clean = cells[1];
  const writes: { stream: string; offset: number; bytes: number }[] = [];
  expect(page.patch([dirty, clean], (stream, offset, data) => writes.push({ stream, offset, bytes: data.byteLength }))).toBe(true);
  expect(writes).toEqual([{ stream: 'positions', offset: 0, bytes: 28 }]);
  const fresh = buildFillMeshSync(packPlan(scene(changedShapes), origin));
  for (const stream of ['triangles', 'lines'] as const) expect(drawn(page.mesh, stream)).toEqual(drawn(fresh, stream));
  expect(visibleFillRanges(page.mesh.layers.blocks.chunks, scene(shapes).extent).triangles).toHaveLength(2);
  expect(
    page.patch([dirty, clean], () => {
      throw Error('clean buffer write');
    }),
  ).toBe(true);
});
it('relocates only indices when two clean cells change their interleaving and fits removals inside reserved slots', () => {
  const shapes = [square(1, 2, 7), square(301, 3, 8), square(24, 4, 9)],
    cells = blocksInCells(shapes),
    page = new CellPageMesh(cells);
  const clean = [
      { ...cells[0], order: [0, 1] },
      { ...cells[1], order: [2] },
    ],
    copies: string[] = [];
  expect(
    page.patch(
      clean,
      () => {
        throw Error('unexpected dirty vertex');
      },
      (stream, _, moves) => {
        expect(moves.every(m => m.from !== undefined)).toBe(true);
        copies.push(stream);
      },
    ),
  ).toBe(true);
  expect(copies).toEqual(['triangles', 'lines']);
  for (const stream of ['triangles', 'lines'] as const) expect(drawn(page.mesh, stream)).toEqual(drawn(buildFillMeshSync(packPlan(scene([shapes[0], shapes[2], shapes[1]]), origin)), stream));
  expect(page.patch([clean[1]], () => {})).toBe(true);
  for (const stream of ['triangles', 'lines'] as const) expect(drawn(page.mesh, stream)).toEqual(drawn(buildFillMeshSync(packPlan(scene([shapes[1]]), origin)), stream));
  const over = blocksInCells([...shapes, square(71, 2, 3), square(56, 2, 4)]);
  expect(
    page.patch(over, () => {
      throw Error('partial write on overflow');
    }),
  ).toBe(false);
});
it('retains unrelated yard runs while a gate across the 256 m line opens, closes and reopens', () => {
  const fence = (a: number, b: number) =>
    ({
      material: 'fence',
      path: [
        { x: a, y: 10 },
        { x: b, y: 10 },
      ],
    }) as YardBoundary;
  const retained = new RetainedYardRuns(),
    far = fence(700, 710),
    left = fence(244, 255);
  const first = retained.update([far, left, fence(258, 270)]);
  expect(first.gates).toHaveLength(1);
  for (const right of [fence(255, 270), fence(258, 270)]) {
    const list = [{ ...far }, left, right],
      current = retained.update(list);
    expect(current).toEqual(yardRuns(list));
    expect(current.runs[0]).toBe(first.runs[0]);
  }
});
it('recomputes grove crowns near an edited building and retains the neighbouring crop', () => {
  const layouts = [{ key: 'grove', culture: 'elven', quarters: [], streets: [], phases: [], enclosures: [], blocks: [square(180, 8, 155), square(720, 15, 90)].map(shape => ({ kind: 'urban', quarter: 0, axis: { x: 1, y: 0 }, shape })) }] as unknown as Layout[];
  const house = (x: number) => ({ id: 'home', function: 'domestic', footprint: [square(x, 40, 25)], roof_footprint: [] }) as unknown as PlacedBuilding;
  const grove = new LiveCrownCells(),
    plan = buildCityScene(layouts, []);
  const crop = (buildings: PlacedBuilding[], local = false) => grove.set(layouts, buildings, buildCityBuildings({ buildings }, plan, { roofs: false }), local ? [{ x0: 200, y0: 20, x1: 310, y1: 100 }] : undefined);
  const first = crop([house(214)]),
    homes = [house(259)],
    second = crop(homes, true);
  const far = first.find(c => c.trees.some(t => t.x > 700));
  expect(far).toBeDefined();
  expect(second).toContain(far);
  const sort = (trees: (typeof first)[number]['trees']) => trees.slice().sort((a, b) => a.seed - b.seed || a.x - b.x);
  expect(sort(second.flatMap(c => c.trees))).toEqual(sort(cityCanopy(layouts, homes).trees));
});
it('reuses merged columns, rebased records and per-town query indices across a multi-town edit', () => {
  const plan = (x: number) => buildCityScene([{ key: 'repeated-id', quarters: [], streets: [], enclosures: [], phases: [], blocks: [{ shape: square(x, 0, 8), kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } }] } as unknown as Layout], []);
  const a = plan(0),
    b = plan(3000),
    old = run(mergePlanGeometrySteps([a, b])),
    next = run(mergePlanGeometrySteps([plan(2), b], old));
  expect(next.plan.blocks[0]).not.toBe(old.plan.blocks[0]);
  expect(next.plan.blocks[1]).toBe(old.plan.blocks[1]);
  expect(next.plan.streets).toBe(old.plan.streets);
  expect(next.plan.bins.blocks.query({ minX: 3001, minY: 1, maxX: 3002, maxY: 2 })).toEqual([1]);
});

it('retains plain curtains in wall order when one wall moves', () => {
  const wall = (x: number) => ({
    kind: 'wall',
    pieces: [
      [
        { x, y: 0 },
        { x: x + 40, y: 0 },
      ],
    ],
    gates: [],
    gateTowers: [],
    towers: [],
  });
  const before = { ...scene([]), walls: [wall(2), wall(600)] },
    after = { ...before, walls: [wall(4), before.walls[1]] },
    first = cityWallStrokes(before, origin);
  const next = cityWallStrokes(after, origin, { scene: before, strokes: first });
  expect(next.parts![1]).toBe(first.parts![1]);
  expect(new Uint8Array(next.data)).toEqual(new Uint8Array(cityWallStrokes(after, origin).data));
});

it('covers houses at both ends of a wide parcel when only its allocation changes', () => {
  const parcel = { ...scene([]).parcels[0], shape: square(10, 5, 610), id: 'plot', layout: 0 },
    old = { ...scene([]), parcels: [parcel] },
    next = { ...old, parcels: [{ ...parcel, use: 'market' }] };
  const buildings = new Set<number>(),
    plan = planEditCells(old, next, buildings);
  expect(plan).toEqual(new Set([gridKey(1, 1)]));
  expect(buildings.has(gridKey(0, 0))).toBe(true);
  expect(buildings.has(gridKey(2, 2))).toBe(true);
});
