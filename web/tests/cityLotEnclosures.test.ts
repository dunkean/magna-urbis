import { describe, expect, it } from 'vitest';
import { buildCityScene } from '../src/render/cityCanvas';
import { buildYardEnclosures, type YardHouse } from '../src/render/cityLotEnclosures';
import { city3dLotEnclosures } from '../src/render/city3dMeshes';
import type { Layout, Partition, Point, Shape } from '../../rust/bridge/urban';
import { polygonContains } from '../src/gen/core/geom';
import { softenRuralGround } from '../src/render/countryside';
import { ruralDetails } from '../src/render/ruralDetails';
import { cultureEnclosure } from '../src/render/hedges';

const rect = (x: number, y: number, w: number, h: number): Shape => ({ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] });
/** One 100 x 50 m block south of a street (y < 0); `n` plots of 20 m; houses on the first plots, set back `setback` m. */
function fixture(culture = 'chinese', houses = [0, 1, 2, 3], setback = 3, plot = 1) {
  const layout = { key: 'yard-test', culture, center: { x: 50, y: 20 }, quarters: [], warnings: [], enclosures: [],
    blocks: [{ shape: rect(0, 0, 100, 50), quarter: 0, kind: 'block', zone: 'faubourg', axis: { x: 1, y: 0 } }],
    streets: [{ path: [{ x: -10, y: -3 }, { x: 110, y: -3 }], widths: [5, 5], rank: 1, role: 'street' }] } as unknown as Layout;
  const part = { key: layout.key, warnings: [], enclosure: { plot, field: 0, material: 'wall', fieldMaterial: 'hedge', front: 1, side: 1, back: 1 },
    parcels: [0, 1, 2, 3, 4].map(i => ({ id: `p${i}`, block: 0, use: 'plot', shape: rect(i * 20, 0, 20, 50), front: [{ x: i * 20, y: 0 }, { x: i * 20 + 20, y: 0 }], axis: { x: 1, y: 0 }, rank: 1 })) } as Partition;
  const list: YardHouse[] = houses.map(i => ({ parcel_id: `p${i}`, footprint: [rect(20 * i + 4 + (i % 2), setback, 11, 9)] }));
  return { scene: buildCityScene([layout], [part]), houses: list };
}
const edges = (r: ReturnType<typeof buildYardEnclosures>): [Point, Point][] => r.enclosures.flatMap(e => e.path.slice(1).map((b, i) => [e.path[i], b] as [Point, Point]));
const inside = (s: Shape, p: Point): boolean => polygonContains(s.outer, p);
/** Yards are unions of cells: one owner per parcel. */
const owners = (r: ReturnType<typeof buildYardEnclosures>): number => new Set(r.yards.map(y => y.parcel)).size;

describe('house yards', () => {
  it('partition the block: neighbours share one line, no strip between them', () => {
    const f = fixture(), r = buildYardEnclosures(f.scene, f.houses);
    expect(owners(r)).toBe(4);
    // between two neighbouring houses every point belongs to a yard (no unclaimed strip)
    for (let i = 0; i < 3; i++) for (let x = 20 * i + 16.5; x < 20 * (i + 1) + 4; x += .5) for (const y of [5, 10, 20])
      expect(r.yards.some(y0 => inside(y0.shape, { x, y }))).toBe(true);
    // yards never overlap
    for (let x = .25; x < 80; x += .5) for (let y = .25; y < 50; y += 1) expect(r.yards.filter(y0 => inside(y0.shape, { x, y })).length).toBeLessThanOrEqual(1);
    // a shared side is drawn once: no two collinear overlapping runs
    const sides = edges(r).filter(([a, b]) => Math.abs(a.x - b.x) < .01).map(([a, b]) => ({ x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }));
    for (const s of sides) expect(sides.filter(o => o !== s && Math.abs(o.x - s.x) < .05 && o.lo < s.hi - .01 && s.lo < o.hi - .01)).toHaveLength(0);
    expect(buildYardEnclosures(f.scene, []).enclosures).toHaveLength(0);
  });
  it('never crosses a house, a street or the block edge, and keeps a gate on the street side', () => {
    const f = fixture('chinese', [0, 1, 2, 3], 0), r = buildYardEnclosures(f.scene, f.houses); // houses on the street line
    expect(r.yards.length).toBeGreaterThan(0);
    for (const [a, b] of edges(r)) for (const t of [.1, .5, .9]) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      for (const h of f.houses) expect(inside(h.footprint[0], p)).toBe(false);
      expect(p.y).toBeGreaterThan(-.05); expect(p.y).toBeLessThan(50.05);
    }
    const g = fixture(), fronts = edges(buildYardEnclosures(g.scene, g.houses)).filter(([a, b]) => a.y < .05 && b.y < .05);
    for (let i = 0; i < 4; i++) { // each walled front has its opening, between the plot ends
      const covered = fronts.filter(([a, b]) => Math.min(a.x, b.x) >= 20 * i - 6 && Math.max(a.x, b.x) <= 20 * i + 26).reduce((s, [a, b]) => s + Math.abs(b.x - a.x), 0);
      expect(covered).toBeGreaterThan(5);
    }
    const gaps = fronts.map(([a, b]) => [Math.min(a.x, b.x), Math.max(a.x, b.x)]).sort((a, b) => a[0] - b[0]);
    expect(gaps.slice(1).filter((s, i) => s[0] - gaps[i][1] > 1).length).toBeGreaterThanOrEqual(4);
  });
  it('sizes yards by house and seed: lone houses differ, shared yards and open fronts appear', () => {
    // sparse houses (every other plot): yards are not all the same box
    const f = fixture('european-organic', [0, 2, 4]); f.scene.enclosureProfiles![0]!.plot = 1;
    const sizes = buildYardEnclosures(f.scene, f.houses).yards.map(y => { const xs = y.shape.outer.map(p => p.x), ys = y.shape.outer.map(p => p.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); });
    expect(new Set(sizes.map(s => Math.round(s / 10))).size).toBeGreaterThan(1);
    // culture yardMerge = 1: neighbours share a yard
    const m = fixture(); Object.assign(m.scene.enclosureProfiles![0]!, { yardMerge: 1 });
    expect(owners(buildYardEnclosures(m.scene, m.houses))).toBeLessThan(4);
    // front 0 (open street fronts): the front is still fenced, with wide cart gates rather than an unclosed loop
    const o = fixture(); o.scene.enclosureProfiles![0]!.front = 0;
    const open = buildYardEnclosures(o.scene, o.houses);
    expect(edges(open).some(([a, b]) => a.y < .05 && b.y < .05)).toBe(true);
    expect(open.gates.every(g => Math.abs(Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) - 2.6) < .01)).toBe(true);
  });
  it('open ground: scattered houses still meet along one line, a lone house gets an organic yard', () => {
    // two houses 30 m apart in a deep 100 x 50 m block (plots 0 and 2 of 5 only built, every fringe house fenced)
    const f = fixture('european-organic', [0, 3]); f.scene.enclosureProfiles![0]!.plot = 1;
    const r = buildYardEnclosures(f.scene, f.houses);
    expect(owners(r)).toBe(2);
    for (let x = 16.5; x < 64; x += 1) expect(r.yards.some(y => inside(y.shape, { x, y: 8 }))).toBe(true); // no strip between them
    const lone = fixture('european-organic', [2]); lone.scene.enclosureProfiles![0]!.plot = 1;
    const yard = buildYardEnclosures(lone.scene, lone.houses).yards.map(y => y.shape.outer);
    expect(yard.length).toBeGreaterThan(0);
    const right = (r: Point[]) => r.length === 4 && r.every((b, i) => { const a = r[(i + 3) % 4], c = r[(i + 1) % 4]; return Math.abs((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) < 1e-3 * Math.hypot(a.x - b.x, a.y - b.y) * Math.hypot(c.x - b.x, c.y - b.y); });
    expect(yard.some(r => !right(r))).toBe(true);
  });
  it('every yard is a closed loop (gates and house walls only), with no doubled or crossing runs', () => {
    for (const f of [fixture(), fixture('european-organic', [0, 2, 3]), fixture('chinese', [0, 1, 2, 3], 0)]) {
      f.scene.enclosureProfiles![0]!.plot = 1;
      const r = buildYardEnclosures(f.scene, f.houses), runs = edges(r), ends = runs.flat();
      const onWall = (p: Point) => f.houses.some(h => h.footprint[0].outer.some((c, i, o) => { const d = o[(i + 1) % o.length], t = Math.max(0, Math.min(1, ((p.x - c.x) * (d.x - c.x) + (p.y - c.y) * (d.y - c.y)) / ((d.x - c.x) ** 2 + (d.y - c.y) ** 2))); return Math.hypot(p.x - c.x - t * (d.x - c.x), p.y - c.y - t * (d.y - c.y)) < .45; }));
      const onRun = (p: Point, self: [Point, Point]) => runs.some(s => s !== self && (() => { const [c, d] = s, t = Math.max(0, Math.min(1, ((p.x - c.x) * (d.x - c.x) + (p.y - c.y) * (d.y - c.y)) / ((d.x - c.x) ** 2 + (d.y - c.y) ** 2 || 1))); return Math.hypot(p.x - c.x - t * (d.x - c.x), p.y - c.y - t * (d.y - c.y)) < .25; })());
      const jamb = (p: Point) => r.gates.some(g => [g.a, g.b].some(q => Math.hypot(q.x - p.x, q.y - p.y) < .25));
      for (const s of runs) for (const p of s) expect(onRun(p, s) || onWall(p) || jamb(p)).toBe(true);
      expect(ends.length).toBeGreaterThan(0);
      // no two parallel runs closer than 1 m over the same stretch
      for (const s of runs) for (const t of runs) if (s !== t) {
        const [a, b] = s, [c, d] = t, L = Math.hypot(b.x - a.x, b.y - a.y), u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
        const par = Math.abs(u.x * (d.y - c.y) - u.y * (d.x - c.x)) / (Math.hypot(d.x - c.x, d.y - c.y) || 1) < .07, off = Math.abs((c.x - a.x) * -u.y + (c.y - a.y) * u.x);
        const t0 = (c.x - a.x) * u.x + (c.y - a.y) * u.y, t1 = (d.x - a.x) * u.x + (d.y - a.y) * u.y;
        if (par && off > .02 && off < 1) expect(Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1))).toBeLessThan(.5);
      }
    }
  });
  it('stays linear: a 2000-house town (rows and farm clusters) builds its yards and 3D meshes in well under a second', () => {
    const blocks: unknown[] = [], streets: unknown[] = [], parcels: unknown[] = [], houses: YardHouse[] = [];
    for (let by = 0; by < 14; by++) for (let bx = 0; bx < 15; bx++) {
      const x0 = bx * 110, y0 = by * 70, b = blocks.length;
      blocks.push({ shape: rect(x0, y0, 100, 60), quarter: 0, kind: 'block', zone: bx % 3 ? 'faubourg' : 'core', axis: { x: 1, y: 0 } });
      streets.push({ path: [{ x: x0 - 5, y: y0 - 3 }, { x: x0 + 105, y: y0 - 3 }], widths: [5, 5], rank: 1, role: 'street' });
      for (let i = 0; i < 10; i++) {
        const id = `b${b}p${i}`, px = x0 + (i % 5) * 20, py = i < 5 ? y0 : y0 + 30, j = (b * 7 + i * 3) % 5;
        parcels.push({ id, block: b, use: 'plot', shape: rect(px, py, 20, 30), front: [{ x: px, y: py }, { x: px + 20, y: py }], axis: { x: 1, y: 0 }, rank: 1 });
        houses.push({ parcel_id: id, footprint: [rect(px + 3 + j, py + 2, 10 - j, 8), ...(j === 0 ? [rect(px + 4, py + 16, 7, 6)] : [])], ...(j === 0 ? { programme: { farmstead: { farm: true } } } : {}) });
      }
    }
    const layout = { key: 'perf', culture: 'norse-ringfort', center: { x: 800, y: 500 }, quarters: [], warnings: [], enclosures: [], blocks, streets } as unknown as Layout;
    const part = { key: 'perf', warnings: [], enclosure: { plot: 1, field: 0, material: 'hedge', fieldMaterial: 'hedge', front: 1, side: 1, back: 1 }, parcels } as unknown as Partition;
    const scene = buildCityScene([layout], [part]);
    buildYardEnclosures(scene, houses.slice(0, 50)); // warm-up (JIT)
    const t0 = performance.now(), r = buildYardEnclosures(scene, houses), t1 = performance.now();
    const meshes = city3dLotEnclosures(r.enclosures, (x, y) => Math.sin(x / 40) + Math.cos(y / 50)), t2 = performance.now();
    expect(r.yards.length).toBeGreaterThan(1000);
    expect(t1 - t0).toBeLessThan(1000);
    expect(t2 - t1).toBeLessThan(1000);
    const tris = meshes.reduce((n, b) => n + b.volumes.reduce((m, v) => m + v.roof_mesh.faces.reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0);
    const metres = r.enclosures.reduce((n, e) => n + Math.hypot(e.path[1].x - e.path[0].x, e.path[1].y - e.path[0].y), 0);
    expect(tris / metres).toBeLessThan(5); // a few triangles per metre of hedge: a 10k town stays under ~300k
  });
  it('wraps a whole cluster in one yard and honours the farmstead hints', () => {
    const f = fixture();
    const farm = [{ parcel_id: 'p0', footprint: [rect(6, 6, 12, 10)] }, { parcel_id: 'p0', footprint: [rect(6, 20, 8, 6)] }];
    const r = buildYardEnclosures(f.scene, farm);
    expect(owners(r)).toBe(1);
    for (const h of farm) for (const q of h.footprint[0].outer) expect(r.yards.some(y => polygonContains(y.shape.outer, q) || y.shape.outer.some(v => Math.hypot(v.x - q.x, v.y - q.y) < .2))).toBe(true);
    // no fence between the cells of one yard: the house and its barn stand in one court
    for (const [a, b] of edges(r)) expect(Math.min(a.y, b.y) > 16.2 && Math.max(a.y, b.y) < 19.8 && Math.min(a.x, b.x) > 6.2 && Math.max(a.x, b.x) < 13.8).toBe(false);
    expect(buildYardEnclosures(f.scene, farm.map(h => ({ ...h, programme: { farmstead: { farm: true, enclosure: 'none' } } }))).yards).toHaveLength(0);
    const hedge = buildYardEnclosures(f.scene, farm.map(h => ({ ...h, enclosure: 'hedge' as const })));
    expect(hedge.enclosures.length).toBeGreaterThan(0); expect(hedge.enclosures.every(e => e.material === 'hedge')).toBe(true);
  });
  it('culture data decides who fences: waterborne, elven and camp cultures have no yards', () => {
    for (const c of ['stilt-town', 'merfolk-tidal', 'lizardfolk-swamp', 'venetian-lagoon', 'pnw-plank-village', 'elven', 'mongol-ordu']) {
      expect(cultureEnclosure(c).plot).toBe(0);
      expect(buildYardEnclosures(fixture(c).scene, fixture(c).houses).enclosures).toHaveLength(0);
    }
    expect(buildYardEnclosures(fixture('chinese', [0, 1], 3, 0).scene, fixture().houses).enclosures).toHaveLength(0);
    // water holes of the block are never fenced across
    const f = fixture(); f.scene.blocks[0].shape = { ...rect(0, 0, 100, 50), holes: [rect(2, 18, 14, 10).outer] };
    for (const [a, b] of edges(buildYardEnclosures(f.scene, f.houses))) for (const t of [.2, .5, .8]) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      expect(x > 2.01 && x < 15.99 && y > 18.01 && y < 27.99).toBe(false);
    }
  });
  it('softens raster steps only on vacant display ground, always inside the original land', () => {
    const source = { outer: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 0, y: 30 }], holes: [] };
    const copy = JSON.stringify(source), smooth = softenRuralGround(source);
    expect(JSON.stringify(source)).toBe(copy); expect(smooth.outer.length).toBeGreaterThan(source.outer.length);
    for (const p of smooth.outer) expect(p.x >= 0 && p.y >= 0 && p.x <= 40 && p.y <= 30 && !(p.x > 30.01 && p.y > 10.01) && !(p.x > 20.01 && p.y > 20.01)).toBe(true);
    expect(softenRuralGround(source)).toBe(smooth);
  });
  it('encloses real farmyards by culture without closing their cart entrance', () => {
    const lu = { areas: [], reserve: [], farmsteads: [{ pos: { x: 10, y: 10 }, angle: 0, yard: rect(0, 0, 20, 20).outer,
      buildings: [rect(3, 13, 7, 6).outer], gate: { x: 10, y: 0 }, entry: { x: 10, y: 2 }, drive: [] }] };
    const fenced = ruralDetails(lu, 'chinese'); expect(fenced.some(m => m.kind === 'wall')).toBe(true);
    expect(fenced.some(m => m.line.length === 2 && m.line.every(p => p.y === 0) && Math.min(...m.line.map(p => p.x)) < 10 && Math.max(...m.line.map(p => p.x)) > 10)).toBe(false);
    expect(ruralDetails(lu, 'elven').some(m => ['wall', 'hedge', 'fence'].includes(m.kind))).toBe(false);
    expect(ruralDetails(lu, 'stilt-town').some(m => ['wall', 'hedge', 'fence'].includes(m.kind))).toBe(false);
  });
  it('3D: same gate gaps, low relief-following bands, few triangles per metre', () => {
    const enclosures = [{ path: [{ x: 0, y: 0 }, { x: 8, y: 0 }], material: 'fence', fenceStyle: 'plank', side: 'front' },
      { path: [{ x: 12, y: 0 }, { x: 20, y: 0 }], material: 'wall', side: 'front', culture: 'chinese', height: 2.2 },
      { path: [{ x: 0, y: 5 }, { x: 30, y: 5 }], material: 'hedge', side: 'back' },
      { path: [{ x: 0, y: 9 }, { x: 30, y: 9 }], material: 'fence', fenceStyle: 'wattle', side: 'side' }] as const;
    const meshes = city3dLotEnclosures(enclosures as unknown as Parameters<typeof city3dLotEnclosures>[0], x => x / 10);
    expect(meshes).toHaveLength(4);
    for (const b of meshes) for (const v of b.volumes) for (const p of v.roof_mesh.vertices) {
      if (Math.abs(p.y) < 1) expect(p.x < 8.2 || p.x > 11.8).toBe(true);
      expect(p.z - p.x / 10).toBeLessThanOrEqual(2.4); expect(p.z - p.x / 10).toBeGreaterThanOrEqual(-.35); // starts under the ground, never floats
    }
    const tris = meshes.reduce((s, b) => s + b.volumes.reduce((t, v) => t + v.roof_mesh.faces.reduce((u, f) => u + f.vertices.length - 2, 0), 0), 0);
    expect(tris / (8 + 8 + 30 + 30)).toBeLessThan(25);
    const wall = meshes.find(b => b.variant_id === 'yard:wall')!, materials = new Set(wall.volumes[0].roof_mesh.faces.map(f => f.material));
    expect(materials.size).toBe(2); // body and coping, both culture-tinted
    expect([...materials].every(m => m.includes('@'))).toBe(true);
  });
});
