import { describe, expect, it, vi } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import * as work from '../src/render/workCount';
import { buildCityScene } from '../src/render/cityCanvas';
import { buildYardEnclosures, type YardHouse } from '../src/render/cityLotEnclosures';
import { city3dLotEnclosures } from '../src/render/city3dMeshes';
import { yardRuns, yardStyle } from '../src/render/yardStyle';
import { UrbanBuildingPass, type Batch } from '../src/ui/urbanBuilding3d';
import type { Layout, Partition, Point, Shape } from '../../rust/bridge/urban';
import { polygonContains } from '../src/gen/core/geom';
import { softenRuralGround } from '../src/render/countryside';
import { ruralDetails, type RuralRenderLayer } from '../src/render/ruralDetails';
import { farmRidges } from '../src/render/farms';
import { farmPlacedBuildings } from '../src/render/farmRoofs';
import type { Farmstead } from '../src/gen/types';
import { cultureEnclosure } from '../src/render/hedges';

const rect = (x: number, y: number, w: number, h: number): Shape => ({
  outer: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
  holes: [],
});
/** One 100 x 50 m block south of a street (y < 0); `n` plots of 20 m; houses on the first plots, set back `setback` m. */
function fixture(culture = 'chinese', houses = [0, 1, 2, 3], setback = 3, plot = 1) {
  const layout = {
    key: 'yard-test',
    culture,
    center: { x: 50, y: 20 },
    quarters: [],
    warnings: [],
    enclosures: [],
    blocks: [{ shape: rect(0, 0, 100, 50), quarter: 0, kind: 'block', zone: 'faubourg', axis: { x: 1, y: 0 } }],
    streets: [
      {
        path: [
          { x: -10, y: -3 },
          { x: 110, y: -3 },
        ],
        widths: [5, 5],
        rank: 1,
        role: 'street',
      },
    ],
  } as unknown as Layout;
  const part = {
    key: layout.key,
    warnings: [],
    enclosure: { plot, field: 0, material: 'wall', fieldMaterial: 'hedge', front: 1, side: 1, back: 1 },
    parcels: [0, 1, 2, 3, 4].map(i => ({
      id: `p${i}`,
      block: 0,
      use: 'plot',
      shape: rect(i * 20, 0, 20, 50),
      front: [
        { x: i * 20, y: 0 },
        { x: i * 20 + 20, y: 0 },
      ],
      axis: { x: 1, y: 0 },
      rank: 1,
    })),
  } as Partition;
  const list: YardHouse[] = houses.map(i => ({ parcel_id: `p${i}`, footprint: [rect(20 * i + 4 + (i % 2), setback, 11, 9)] }));
  return { scene: buildCityScene([layout], [part]), houses: list };
}
const edges = (r: ReturnType<typeof buildYardEnclosures>): [Point, Point][] => r.enclosures.flatMap(e => e.path.slice(1).map((b, i) => [e.path[i], b] as [Point, Point]));
const inside = (s: Shape, p: Point): boolean => polygonContains(s.outer, p);
/** Yards are unions of cells: one owner per parcel. */
const owners = (r: ReturnType<typeof buildYardEnclosures>): number => new Set(r.yards.map(y => y.parcel)).size;

describe('house yards', () => {
  it('keeps the parcel graph across house edits and rebuilds it when a clipped boundary moves', () => {
    const { scene, houses } = fixture();
    const clippedRing = structuredClone(scene.parcels[3].shape);
    scene.parcels[3].ground = [clippedRing];
    const counter = vi.spyOn(work, 'countWork');
    const builds = () => counter.mock.calls.filter(([name]) => name === 'town.yardBoundaryGraph').length;
    const ground = (x: number, y: number) => Math.sin(x / 20) + y / 5;
    const fresh = (edited: YardHouse[]) => buildYardEnclosures({ ...scene, layouts: [...scene.layouts] }, edited);
    const check = (yards: ReturnType<typeof buildYardEnclosures>, reference: typeof yards) => {
      expect(yards).toStrictEqual(reference);
      expect(isDeepStrictEqual(city3dLotEnclosures(yards.enclosures, ground), city3dLotEnclosures(reference.enclosures, ground))).toBe(true);
    };
    try {
      const original = buildYardEnclosures(scene, houses);
      expect(builds()).toBe(1);
      // The house now interrupts the west fence. The same parcel graph produces a different public outline.
      const moved = [{ ...houses[0], footprint: [rect(-2, 7, 14, 20)] }, ...houses.slice(1)];
      const edited = buildYardEnclosures(scene, moved);
      expect(builds()).toBe(1);
      expect(edited.enclosures).not.toEqual(original.enclosures);
      check(edited, fresh(moved));
      expect(builds()).toBe(2);
      // A change outside that house's lot, with the same owner, number of rings and number of vertices.
      clippedRing.outer[2].y = 36;
      clippedRing.outer[3].y = 36;
      const clipped = buildYardEnclosures(scene, moved);
      expect(builds()).toBe(3);
      expect(clipped.enclosures).not.toEqual(edited.enclosures);
      check(clipped, fresh(moved));
    } finally {
      counter.mockRestore();
    }
  });
  it('partition the block: neighbours share one line, no strip between them', () => {
    const f = fixture(),
      r = buildYardEnclosures(f.scene, f.houses);
    expect(owners(r)).toBe(4);
    // between two neighbouring houses every point belongs to a yard (no unclaimed strip)
    for (let i = 0; i < 3; i++) for (let x = 20 * i + 16.5; x < 20 * (i + 1) + 4; x += 0.5) for (const y of [5, 10, 20]) expect(r.yards.some(y0 => inside(y0.shape, { x, y }))).toBe(true);
    // yards never overlap
    for (let x = 0.25; x < 80; x += 0.5) for (let y = 0.25; y < 50; y += 1) expect(r.yards.filter(y0 => inside(y0.shape, { x, y })).length).toBeLessThanOrEqual(1);
    // a shared side is drawn once: no two collinear overlapping runs
    const sides = edges(r)
      .filter(([a, b]) => Math.abs(a.x - b.x) < 0.01)
      .map(([a, b]) => ({ x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }));
    for (const s of sides) expect(sides.filter(o => o !== s && Math.abs(o.x - s.x) < 0.05 && o.lo < s.hi - 0.01 && s.lo < o.hi - 0.01)).toHaveLength(0);
    expect(buildYardEnclosures(f.scene, []).enclosures).toHaveLength(0);
  });
  it('never crosses a house, a street or the block edge, and keeps a gate on the street side', () => {
    const f = fixture('chinese', [0, 1, 2, 3], 0),
      r = buildYardEnclosures(f.scene, f.houses); // houses on the street line
    expect(r.yards.length).toBeGreaterThan(0);
    for (const [a, b] of edges(r))
      for (const t of [0.1, 0.5, 0.9]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        for (const h of f.houses) expect(inside(h.footprint[0], p)).toBe(false);
        expect(p.y).toBeGreaterThan(-0.05);
        expect(p.y).toBeLessThan(50.05);
      }
    const g = fixture(),
      fronts = edges(buildYardEnclosures(g.scene, g.houses)).filter(([a, b]) => a.y < 0.05 && b.y < 0.05);
    for (let i = 0; i < 4; i++) {
      // each walled front has its opening, between the plot ends
      const covered = fronts.filter(([a, b]) => Math.min(a.x, b.x) >= 20 * i - 6 && Math.max(a.x, b.x) <= 20 * i + 26).reduce((s, [a, b]) => s + Math.abs(b.x - a.x), 0);
      expect(covered).toBeGreaterThan(5);
    }
    const gaps = fronts.map(([a, b]) => [Math.min(a.x, b.x), Math.max(a.x, b.x)]).sort((a, b) => a[0] - b[0]);
    expect(gaps.slice(1).filter((s, i) => s[0] - gaps[i][1] > 1).length).toBeGreaterThanOrEqual(4);
  });
  it('yards follow the lots: merged neighbours lose their common chain, the culture decides the street front', () => {
    const sides = (r: ReturnType<typeof buildYardEnclosures>): number => edges(r).filter(([a, b]) => Math.abs(a.x - b.x) < 0.01 && a.x > 1 && a.x < 79).length;
    const f = fixture(),
      r = buildYardEnclosures(f.scene, f.houses);
    for (let i = 0; i < 4; i++) expect(r.yards.some(y => inside(y.shape, { x: 20 * i + 10, y: 40 }))).toBe(true); // the yard is the lot, to its back limit
    // culture yardMerge = 1: neighbours share a yard, their common chain is gone
    const m = fixture();
    Object.assign(m.scene.enclosureProfiles![0]!, { yardMerge: 1 });
    const shared = buildYardEnclosures(m.scene, m.houses);
    expect(owners(shared)).toBeLessThan(4);
    expect(sides(shared)).toBeLessThan(sides(r));
    // front 0 in town: no fence on the street, the whole front is an opening and the sides stop on it
    const o = fixture();
    o.scene.enclosureProfiles![0]!.front = 0;
    const open = buildYardEnclosures(o.scene, o.houses);
    expect(edges(open).some(([a, b]) => a.y < 0.05 && b.y < 0.05)).toBe(false);
    expect(open.gates.length).toBeGreaterThan(0);
    expect(open.gates.every(g => g.open)).toBe(true);
    // front 0 in the country: every yard stays closed, with a wide cart gate
    const v = fixture();
    v.scene.parcels.forEach(p => {
      p.zone = 'village';
    });
    v.scene.enclosureProfiles![0]!.front = 0;
    const country = buildYardEnclosures(v.scene, v.houses);
    expect(edges(country).some(([a, b]) => a.y < 0.05 && b.y < 0.05)).toBe(true);
    expect(country.gates.length).toBeGreaterThan(0);
    expect(country.gates.every(g => !g.open && Math.abs(Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) - 2.6) < 0.01)).toBe(true);
  });
  it('decides by row of lots, not lot by lot: no checkerboard', () => {
    for (let seed = 0; seed < 12; seed++) {
      const f = fixture('european-organic', [0, 1, 2, 3, 4]);
      f.scene.enclosureProfiles![0]!.plot = 0.5;
      f.scene.layouts = [{ ...f.scene.layouts[0], key: `row-${seed}` }];
      f.scene.parcels.forEach(p => {
        p.zone = 'core';
        p.peripheral = false;
      });
      expect([0, 5]).toContain(new Set(buildYardEnclosures(f.scene, f.houses).yards.map(y => y.parcel)).size);
    }
  });
  it('gardens and unbuilt plots join the built lot beside them', () => {
    const f = fixture('european-organic', [0, 3]);
    f.scene.enclosureProfiles![0]!.plot = 1;
    const r = buildYardEnclosures(f.scene, f.houses);
    expect(owners(r)).toBe(2);
    for (let x = 1; x < 99; x += 1) expect(r.yards.some(y => inside(y.shape, { x, y: 8 }))).toBe(true); // no strip left between them
  });
  it('a limit on a carriageway comes out to its edge: the outline stays closed, nothing is cut', () => {
    const f = fixture();
    f.scene.parcels[1].shape.outer[0] = { x: 20, y: -1.6 }; // a corner of p1 stands on the street
    const b = f.scene.parcels[0].shape.outer;
    b[1] = { x: 20, y: -1.6 };
    const r = buildYardEnclosures(f.scene, f.houses),
      runs = edges(r);
    for (const [a, c] of runs) for (const t of [0.25, 0.5, 0.75]) expect(a.y + (c.y - a.y) * t).toBeGreaterThan(-0.7); // street edge at -0.5, carriageway from -0.7
    for (const s of runs) for (const p of s) expect(runs.some(o => o !== s && o.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.3)) || r.gates.some(g => [g.a, g.b].some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.3))).toBe(true);
  });
  it('inset cultures: each lot has its own closed ring with its gate, a gap between neighbours, clear of the houses', () => {
    expect(cultureEnclosure('mongol-ordu').inset).toBeGreaterThan(0);
    for (const c of ['medina', 'european-organic', 'hanseatic']) expect(cultureEnclosure(c).inset).toBe(0);
    const f = fixture('mongol-ordu');
    f.scene.enclosureProfiles![0]!.plot = 1;
    Object.assign(f.scene.enclosureProfiles![0]!, { inset: 1.5 });
    const r = buildYardEnclosures(f.scene, f.houses),
      runs = edges(r);
    expect(r.enclosures).toHaveLength(4);
    expect(r.gates).toHaveLength(4);
    for (const e of r.enclosures) {
      // from one jamb round to the other
      const a = e.path[0],
        b = e.path[e.path.length - 1],
        gate = r.gates.find(g => [g.a, g.b].some(q => Math.hypot(q.x - a.x, q.y - a.y) < 0.01));
      expect(gate).toBeDefined();
      expect([gate!.a, gate!.b].some(q => Math.hypot(q.x - b.x, q.y - b.y) < 0.01)).toBe(true);
    }
    for (const [a, b] of runs)
      for (const t of [0.1, 0.5, 0.9]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        for (let i = 1; i < 5; i++) expect(Math.abs(p.x - 20 * i)).toBeGreaterThan(1.4); // never on a limit: two rings, a gap between them
        for (const h of f.houses) expect(inside(h.footprint[0], p)).toBe(false);
      }
    // a lot too narrow for a ring of its own stays unfenced
    const n = fixture('mongol-ordu', [0]);
    Object.assign(n.scene.enclosureProfiles![0]!, { plot: 1, inset: 1.5 });
    n.scene.parcels[0].shape = rect(0, 0, 2.2, 50);
    n.houses[0] = { parcel_id: 'p0', footprint: [rect(0.5, 3, 1.2, 4)] };
    expect(buildYardEnclosures(n.scene, n.houses).enclosures).toHaveLength(0);
  });
  it('every yard is a closed loop (gates and house walls only), with no doubled or crossing runs', () => {
    for (const f of [fixture(), fixture('european-organic', [0, 2, 3]), fixture('chinese', [0, 1, 2, 3], 0)]) {
      f.scene.enclosureProfiles![0]!.plot = 1;
      const r = buildYardEnclosures(f.scene, f.houses),
        runs = edges(r),
        ends = runs.flat();
      const onWall = (p: Point) =>
        f.houses.some(h =>
          h.footprint[0].outer.some((c, i, o) => {
            const d = o[(i + 1) % o.length],
              t = Math.max(0, Math.min(1, ((p.x - c.x) * (d.x - c.x) + (p.y - c.y) * (d.y - c.y)) / ((d.x - c.x) ** 2 + (d.y - c.y) ** 2)));
            return Math.hypot(p.x - c.x - t * (d.x - c.x), p.y - c.y - t * (d.y - c.y)) < 0.45;
          }),
        );
      const onRun = (p: Point, self: [Point, Point]) =>
        runs.some(
          s =>
            s !== self &&
            (() => {
              const [c, d] = s,
                t = Math.max(0, Math.min(1, ((p.x - c.x) * (d.x - c.x) + (p.y - c.y) * (d.y - c.y)) / ((d.x - c.x) ** 2 + (d.y - c.y) ** 2 || 1)));
              return Math.hypot(p.x - c.x - t * (d.x - c.x), p.y - c.y - t * (d.y - c.y)) < 0.25;
            })(),
        );
      const jamb = (p: Point) => r.gates.some(g => [g.a, g.b].some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.25));
      for (const s of runs) for (const p of s) expect(onRun(p, s) || onWall(p) || jamb(p)).toBe(true);
      expect(ends.length).toBeGreaterThan(0);
      // no two parallel runs closer than 1 m over the same stretch
      for (const s of runs)
        for (const t of runs)
          if (s !== t) {
            const [a, b] = s,
              [c, d] = t,
              L = Math.hypot(b.x - a.x, b.y - a.y),
              u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
            const par = Math.abs(u.x * (d.y - c.y) - u.y * (d.x - c.x)) / (Math.hypot(d.x - c.x, d.y - c.y) || 1) < 0.07,
              off = Math.abs((c.x - a.x) * -u.y + (c.y - a.y) * u.x);
            const t0 = (c.x - a.x) * u.x + (c.y - a.y) * u.y,
              t1 = (d.x - a.x) * u.x + (d.y - a.y) * u.y;
            if (par && off > 0.02 && off < 1) expect(Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1))).toBeLessThan(0.5);
          }
    }
  });
  it('stays linear: a 2000-house town (rows and farm clusters) builds its yards and 3D meshes in well under a second', () => {
    const blocks: unknown[] = [],
      streets: unknown[] = [],
      parcels: unknown[] = [],
      houses: YardHouse[] = [];
    for (let by = 0; by < 14; by++)
      for (let bx = 0; bx < 15; bx++) {
        const x0 = bx * 110,
          y0 = by * 70,
          b = blocks.length;
        blocks.push({ shape: rect(x0, y0, 100, 60), quarter: 0, kind: 'block', zone: bx % 3 ? 'faubourg' : 'core', axis: { x: 1, y: 0 } });
        streets.push({
          path: [
            { x: x0 - 5, y: y0 - 3 },
            { x: x0 + 105, y: y0 - 3 },
          ],
          widths: [5, 5],
          rank: 1,
          role: 'street',
        });
        for (let i = 0; i < 10; i++) {
          const id = `b${b}p${i}`,
            px = x0 + (i % 5) * 20,
            py = i < 5 ? y0 : y0 + 30,
            j = (b * 7 + i * 3) % 5;
          parcels.push({
            id,
            block: b,
            use: 'plot',
            shape: rect(px, py, 20, 30),
            front: [
              { x: px, y: py },
              { x: px + 20, y: py },
            ],
            axis: { x: 1, y: 0 },
            rank: 1,
          });
          houses.push({ parcel_id: id, footprint: [rect(px + 3 + j, py + 2, 10 - j, 8), ...(j === 0 ? [rect(px + 4, py + 16, 7, 6)] : [])], ...(j === 0 ? { programme: { farmstead: { farm: true } } } : {}) });
        }
      }
    const layout = { key: 'perf', culture: 'norse-ringfort', center: { x: 800, y: 500 }, quarters: [], warnings: [], enclosures: [], blocks, streets } as unknown as Layout;
    const part = { key: 'perf', warnings: [], enclosure: { plot: 1, field: 0, material: 'hedge', fieldMaterial: 'hedge', front: 1, side: 1, back: 1 }, parcels } as unknown as Partition;
    const scene = buildCityScene([layout], [part]);
    buildYardEnclosures(scene, houses.slice(0, 50)); // warm-up (JIT)
    const t0 = performance.now(),
      r = buildYardEnclosures(scene, houses),
      t1 = performance.now();
    const meshes = city3dLotEnclosures(r.enclosures, (x, y) => Math.sin(x / 40) + Math.cos(y / 50)),
      t2 = performance.now();
    expect(r.yards.length).toBeGreaterThan(1000);
    expect(t1 - t0).toBeLessThan(1000);
    expect(t2 - t1).toBeLessThan(1000);
    const tris = meshes.reduce((n, b) => n + b.volumes.reduce((m, v) => m + v.roof_mesh.faces.reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0);
    const metres = edges(r).reduce((n, [a, b]) => n + Math.hypot(b.x - a.x, b.y - a.y), 0);
    expect(tris / metres).toBeLessThan(5); // a few triangles per metre of hedge: a 10k town stays under ~300k
  });
  it('wraps a whole cluster in one yard and honours the farmstead hints', () => {
    const f = fixture();
    const farm = [
      { parcel_id: 'p0', footprint: [rect(6, 6, 12, 10)] },
      { parcel_id: 'p0', footprint: [rect(6, 20, 8, 6)] },
    ];
    const r = buildYardEnclosures(f.scene, farm);
    expect(owners(r)).toBe(1);
    for (const h of farm) for (const q of h.footprint[0].outer) expect(r.yards.some(y => polygonContains(y.shape.outer, q) || y.shape.outer.some(v => Math.hypot(v.x - q.x, v.y - q.y) < 0.2))).toBe(true);
    // no fence between the cells of one yard: the house and its barn stand in one court
    for (const [a, b] of edges(r)) expect(Math.min(a.y, b.y) > 16.2 && Math.max(a.y, b.y) < 19.8 && Math.min(a.x, b.x) > 6.2 && Math.max(a.x, b.x) < 13.8).toBe(false);
    expect(
      buildYardEnclosures(
        f.scene,
        farm.map(h => ({ ...h, programme: { farmstead: { farm: true, enclosure: 'none' } } })),
      ).yards,
    ).toHaveLength(0);
    const hedge = buildYardEnclosures(
      f.scene,
      farm.map(h => ({ ...h, enclosure: 'hedge' as const })),
    );
    expect(hedge.enclosures.length).toBeGreaterThan(0);
    expect(hedge.enclosures.every(e => e.material === 'hedge')).toBe(true);
  });
  it('a closed-court or round compound walls its own court (farmstead ring), not the whole lot', () => {
    const f = fixture('yoruba'),
      ring = rect(2, 4, 16, 20).outer;
    const compound = [{ parcel_id: 'p0', footprint: [rect(5, 6, 10, 5), rect(5, 16, 3, 3), rect(12, 16, 3, 3)], programme: { farmstead: { farm: true, enclosure: 'wall', layout: 'closed', ring } } }];
    const r = buildYardEnclosures(f.scene, compound);
    expect(r.yards).toHaveLength(1);
    expect(r.yards[0].shape.outer).toEqual(ring);
    expect(r.gates).toHaveLength(1); // one entrance, toward the street
    expect(Math.min(r.gates[0].a.y, r.gates[0].b.y)).toBeLessThan(4.01);
    for (const [a, b] of edges(r)) for (const q of [a, b]) expect(q.y).toBeLessThanOrEqual(24.01); // never on the far lot limit (y = 50)
    // any other farm type keeps the lot limits
    const plain = buildYardEnclosures(
      f.scene,
      compound.map(h => ({ ...h, programme: { farmstead: { ...h.programme.farmstead, layout: 'scattered' } } })),
    );
    expect(plain.yards.some(y => y.shape.outer.some(q => q.y > 49))).toBe(true);
  });
  it('culture data decides who fences: waterborne, elven and camp cultures have no yards', () => {
    for (const c of ['stilt-town', 'merfolk-tidal', 'lizardfolk-swamp', 'venetian-lagoon', 'pnw-plank-village', 'elven', 'nomad-camp']) {
      expect(cultureEnclosure(c).plot).toBe(0);
      expect(buildYardEnclosures(fixture(c).scene, fixture(c).houses).enclosures).toHaveLength(0);
    }
    expect(buildYardEnclosures(fixture('chinese', [0, 1], 3, 0).scene, fixture().houses).enclosures).toHaveLength(0);
    // water holes of the block are never fenced across
    const f = fixture();
    f.scene.blocks[0].shape = { ...rect(0, 0, 100, 50), holes: [rect(2, 18, 14, 10).outer] };
    for (const [a, b] of edges(buildYardEnclosures(f.scene, f.houses)))
      for (const t of [0.2, 0.5, 0.8]) {
        const x = a.x + (b.x - a.x) * t,
          y = a.y + (b.y - a.y) * t;
        expect(x > 2.01 && x < 15.99 && y > 18.01 && y < 27.99).toBe(false);
      }
  });
  it('softens raster steps only on vacant display ground, always inside the original land', () => {
    const source = {
      outer: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 30 },
        { x: 0, y: 30 },
      ],
      holes: [],
    };
    const copy = JSON.stringify(source),
      smooth = softenRuralGround(source);
    expect(JSON.stringify(source)).toBe(copy);
    expect(smooth.outer.length).toBeGreaterThan(source.outer.length);
    for (const p of smooth.outer) expect(p.x >= 0 && p.y >= 0 && p.x <= 40 && p.y <= 30 && !(p.x > 30.01 && p.y > 10.01) && !(p.x > 20.01 && p.y > 20.01)).toBe(true);
    expect(softenRuralGround(source)).toBe(smooth);
  });
  it('draws on a farm only what the farm holds and the 3D view raises: no unbuilt yard enclosure, ridges of the raised massing', () => {
    const house = rect(3, 13, 7, 6).outer,
      hut = rect(12, 13, 4, 4).outer,
      barn = rect(3, 3, 8, 5).outer,
      pen = rect(12, 3, 6, 6).outer;
    const farm: Farmstead = {
      pos: { x: 10, y: 10 },
      angle: 0,
      yard: rect(0, 0, 20, 20).outer,
      buildings: [house, hut, barn],
      gate: { x: 10, y: 0 },
      entry: { x: 10, y: 2 },
      drive: [],
      plots: [{ kind: 'pen', poly: pen }],
      parts: [
        { poly: house, use: 'house', arch: '', roof: 'gable', massing: [{ floors: 1, eave_m: 3, rise_m: 2, roof: 'hip', ridges: [[5, 16, 8, 16]], cover: 'tile', wall: 'plaster' }] },
        { poly: hut, use: 'hut', arch: '', roof: 'thatch-round' },
        { poly: barn, use: 'barn', arch: '', roof: 'gable', massing: [{ floors: 1, eave_m: 3, rise_m: 0, roof: 'flat', ridges: [], cover: 'earth', wall: 'earth' }] },
      ],
    };
    const lu: RuralRenderLayer = { areas: [], reserve: [], farmsteads: [farm] };
    // The yard holds no wall: nothing closes it, whatever the culture of the map.
    expect(ruralDetails(lu)).toEqual([]);
    // A pen's fence stands on the pen (the rail fence the 3D view raises there), never across the yard.
    lu.ruralDetails = { visiblePaddocks: true };
    const fences = ruralDetails(lu).filter(m => m.kind === 'fence');
    expect(fences.length).toBeGreaterThan(0);
    for (const m of fences) for (const p of m.line) expect(p.x >= 11.3 && p.x <= 18.7 && p.y >= 2.3 && p.y <= 9.7).toBe(true);
    const raised = farmPlacedBuildings([farm], () => 0);
    expect(raised.filter(b => (b as { sitePart?: { form?: string } }).sitePart?.form === 'farm-rail').length).toBeGreaterThan(0);
    // Ridges: the house's from the massing both views raise (not the plan's full gable), none on the round hut nor on
    // the barn whose massing is flat although its plan roof says gable.
    expect(farmRidges(farm)).toEqual([
      [
        { x: 5, y: 16 },
        { x: 8, y: 16 },
      ],
    ]);
    const pieces = raised.slice(0, 3).map(b => (b as unknown as { programme: { massing: { ridges: number[][] }[] } }).programme.massing[0].ridges);
    expect(pieces).toEqual([[[5, 16, 8, 16]], [], []]);
  });
  it('3D: a fence follows the slope under exaggeration, joins its corners, keeps a ribbon far away and its own colours', () => {
    class Capture extends UrbanBuildingPass {
      uploaded: Float32Array[] = [];
      constructor() {
        super(undefined);
      }
      protected upload(_b: Batch, v: Float32Array): void {
        this.uploaded.push(v);
      }
      protected releaseBatch(): void {}
      all(overview = false): void {
        for (const s of this.sectors) (this as unknown as { prepare(s: unknown, o: boolean): void }).prepare(s, overview);
      }
    }
    const enclosures = [
      {
        path: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        material: 'wall',
        side: 'front',
        culture: 'chinese',
        height: 2.2,
      },
      {
        path: [
          { x: 30, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 30 },
        ],
        material: 'wall',
        side: 'side',
        culture: 'chinese',
        height: 2.2,
      },
    ] as unknown as Parameters<typeof city3dLotEnclosures>[0];
    const relief = (x: number): number => 20 + x / 10,
      buildings = city3dLotEnclosures(enclosures, relief),
      E = 2;
    const scene = { buildings, materials: [] },
      near = new Capture(),
      far = new Capture(),
      red = new Capture();
    near.setScene(scene, { style: 'cartographic', diagnostic: 'none' });
    near.all();
    let worst = 0;
    for (const v of near.uploaded) for (let i = 0; i < v.length; i += 10) worst = Math.max(worst, Math.abs(v[i + 9] - relief(v[i]))); // the ground of each vertex is the terrain under it
    expect(worst).toBeLessThan(0.05 * E);
    far.setScene(scene, { style: 'cartographic', diagnostic: 'none' });
    far.all(true);
    const count = (c: Capture): number => c.uploaded.reduce((n, v) => n + v.length / 30, 0);
    expect(count(far)).toBeGreaterThan(0);
    expect(count(far)).toBeLessThanOrEqual(count(near));
    for (const v of far.uploaded) for (let i = 0; i < v.length; i += 10) expect(Math.abs(v[i + 9] - relief(v[i]))).toBeLessThan(0.05 * E);
    red.setScene(scene, { style: 'cartographic', diagnostic: 'none', colors: { building: '#ff0000' } });
    red.all();
    for (const v of red.uploaded) for (let i = 0; i < v.length; i += 10) expect(v[i + 6] > 0.9 && v[i + 7] < 0.1).toBe(false);
    // one run: the pieces of a corner are welded, the 90-degree turn is mitred and its two sides share their corner
    const { runs } = yardRuns(enclosures as never);
    expect(runs).toHaveLength(1);
    expect(runs[0].path).toHaveLength(4);
    const corner = buildings[0].volumes[0].roof_mesh.vertices.filter(p => Math.abs(p.x - 60) < 0.5 && Math.abs(p.y) < 0.5);
    expect(new Set(corner.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBeLessThanOrEqual(4);
  });
  it('one style for both renderers: culture tints, gates found between free ends', () => {
    expect(yardStyle('hedge', 'medina').color).not.toBe(yardStyle('hedge', 'european-organic').color);
    expect(yardStyle('wall', 'chinese').color).not.toBe(yardStyle('wall', 'medina').color);
    expect(yardStyle('fence', 'medina', 'parchment', 'wattle').color).not.toBe(yardStyle('fence', 'medina', 'terrain', 'wattle').color);
    const gap = [
      {
        path: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        material: 'hedge',
        side: 'front',
      },
      {
        path: [
          { x: 11.3, y: 0 },
          { x: 20, y: 0 },
        ],
        material: 'hedge',
        side: 'front',
      },
    ] as never;
    expect(yardRuns(gap).gates).toHaveLength(1);
    expect(yardRuns(gap).runs).toHaveLength(2);
  });
  it('emits a single wooden post at a loop seam and at each gate jamb', () => {
    const style = { material: 'fence', side: 'front' } as const;
    const meshes = city3dLotEnclosures([
      {
        ...style,
        path: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 6 },
          { x: 0, y: 6 },
          { x: 0, y: 0 },
        ],
      },
      {
        ...style,
        path: [
          { x: 20, y: 0 },
          { x: 26, y: 0 },
        ],
      },
      {
        ...style,
        path: [
          { x: 28, y: 0 },
          { x: 34, y: 0 },
        ],
      },
    ]);
    for (const x of [0, 26, 28]) {
      let postFaces = 0;
      for (const {
        volumes: [{ roof_mesh: mesh }],
      } of meshes)
        for (const face of mesh.faces) {
          const vertices = face.vertices.map(i => mesh.vertices[i]);
          if (vertices.some(p => p.z > 1.05) && vertices.every(p => Math.abs(p.x - x) < 0.1 && Math.abs(p.y) < 0.1)) postFaces++;
        }
      expect(postFaces).toBe(2); // the two crossed faces of one post
    }
  });
  it('3D: same gate gaps, low relief-following bands, few triangles per metre', () => {
    const enclosures = [
      {
        path: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
        ],
        material: 'fence',
        fenceStyle: 'plank',
        side: 'front',
      },
      {
        path: [
          { x: 12, y: 0 },
          { x: 20, y: 0 },
        ],
        material: 'wall',
        side: 'front',
        culture: 'chinese',
        height: 2.2,
      },
      {
        path: [
          { x: 0, y: 5 },
          { x: 30, y: 5 },
        ],
        material: 'hedge',
        side: 'back',
      },
      {
        path: [
          { x: 0, y: 9 },
          { x: 30, y: 9 },
        ],
        material: 'fence',
        fenceStyle: 'wattle',
        side: 'side',
      },
    ] as const;
    const meshes = city3dLotEnclosures(enclosures as unknown as Parameters<typeof city3dLotEnclosures>[0], x => x / 10);
    expect(meshes).toHaveLength(4);
    for (const b of meshes)
      for (const v of b.volumes)
        for (const p of v.roof_mesh.vertices) {
          if (Math.abs(p.y) < 1) expect(p.x < 8.2 || p.x > 11.8).toBe(true);
          expect(p.z - p.x / 10).toBeLessThanOrEqual(2.4);
          expect(p.z - p.x / 10).toBeGreaterThanOrEqual(-0.35); // starts under the ground, never floats
        }
    const tris = meshes.reduce((s, b) => s + b.volumes.reduce((t, v) => t + v.roof_mesh.faces.reduce((u, f) => u + f.vertices.length - 2, 0), 0), 0);
    expect(tris / (8 + 8 + 30 + 30)).toBeLessThan(25);
    const wall = meshes.find(b => b.variant_id === 'yard:wall')!,
      materials = new Set(wall.volumes[0].roof_mesh.faces.map(f => f.material));
    expect(materials.size).toBe(2); // body and coping, both culture-tinted
    expect([...materials].every(m => m.includes('@'))).toBe(true);
  });
});
