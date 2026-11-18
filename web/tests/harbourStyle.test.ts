import { describe, expect, it } from 'vitest';
import type { Layout, Quay, Shape } from '../../rust/bridge/urban';
import { buildCityScene } from '../src/render/cityCanvas';
import { packPlan, buildFillMeshSync } from '../src/render/cityGlBuild';
import { DEFAULT_LAYERS, planColors } from '../src/render/cityGlStyle';
import { city3dQuays, kerbApron } from '../src/render/city3dQuays';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { UrbanBuildingGround } from '../src/ui/urbanBuildingGround';
import { HARBOUR_TYPES, HARBOUR_TYPE_NAMES, harbourPaint, harbourPrism, harbourShown } from '../src/render/harbourStyle';
import { quayFill } from '../src/render/roadStyle';
import { defaultLayoutConfig } from '../../rust/bridge/urbanConfig';
import { urbanControlFields } from '../src/v2/urbanControlSchema';
import harbours from '../../rust/crates/core/src/urban/harbours.json';

const rectangle = (x: number, y: number, w: number, h: number): Shape => ({
  outer: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
  holes: [],
});
const item = (kind: string, material: string, shape: Shape): Quay => ({ kind, material, deck_z_m: 3, shape });
// A stone quay, a basin under it, and furniture: a cog with cabin, yard and mast, a crane with its jib, a boat shed, a post.
const quays: Quay[] = [
  item('basin', 'water', rectangle(0, -60, 100, 60)),
  item('quay', 'stone', rectangle(0, 0, 100, 12)),
  item('boat', 'cog', rectangle(10, -10, 23, 7)),
  item('cabin', 'cog', rectangle(11, -9, 5, 5)),
  item('yard', 'cog', rectangle(22, -12, 1, 11)),
  item('mast', 'cog', rectangle(22, -7, 0.5, 0.5)),
  item('crane', 'treadwheel', rectangle(50, -4, 3, 3)),
  item('crane-jib', 'treadwheel', rectangle(51, -10, 0.6, 6)),
  item('shiphouse', 'timber', rectangle(70, -8, 8, 14)),
  item('post', 'timber', rectangle(40, -1, 0.6, 0.6)),
];
const layout = { key: 'port', culture: 'hanseatic', quarters: [], blocks: [], streets: [], warnings: [], structure: { quays, districts: [] } } as unknown as Layout;

describe('harbour vocabulary shared by the plan and the 3D city', () => {
  it('keeps the look of the platforms and gives every furniture kind a paint', () => {
    expect(harbourPaint('quay', 'stone', true, '#4e3b28')).toEqual({ fill: quayFill('stone', true), fillAlpha: 1, line: '#4e3b28', lineAlpha: 1, width: 0.9 });
    expect(harbourPaint('pier', 'timber', false, '#57534b')).toEqual({ fill: quayFill('timber', false), fillAlpha: 1, line: '#57534b', lineAlpha: 1, width: 0.9 });
    expect(harbourPaint('mole', 'stone', true, '#4e3b28')).toMatchObject({ line: '#2b2015', width: 1.6 });
    expect(harbourPaint('basin', 'water', true, '#4e3b28').lineAlpha).toBe(0);
    for (const kind of ['boat', 'boat-ashore', 'cabin', 'mast', 'yard', 'crane', 'crane-jib', 'beacon', 'post', 'cargo', 'raft', 'shiphouse', 'slip', 'steps', 'jetty', 'breakwater', 'kerb'])
      for (const parchment of [true, false]) expect(harbourPaint(kind, 'cog', parchment, '#4e3b28').fill).toMatch(/^#[0-9a-f]{6}$/);
    // A boat does not take the colour of the quay it lies at.
    expect(harbourPaint('boat', 'cog', true, '#4e3b28').fill).not.toBe(quayFill('stone', true));
  });
  it('hides small furniture on far views and shows boats at every zoom', () => {
    const scene = buildCityScene([layout]),
      mesh = buildFillMeshSync(packPlan(scene)),
      first = mesh.layers.quays.features[0];
    const alpha = (lod: 'far' | 'mid' | 'near' | 'close', i: number): number => planColors(scene, mesh, { lod, palette: 'parchment', view: 'buildings', layers: DEFAULT_LAYERS, buildingsVisible: false, diagnostic: 'none' }).fill[(first + i) * 4 + 3];
    const boat = quays.findIndex(q => q.kind === 'boat'),
      mast = quays.findIndex(q => q.kind === 'mast');
    expect(harbourShown('mast', 'mid')).toBe(false);
    expect(harbourShown('boat', 'far')).toBe(true);
    expect(harbourShown('kerb', 'far')).toBe(false);
    expect(harbourShown('kerb', 'mid')).toBe(true);
    for (const lod of ['far', 'mid', 'near', 'close'] as const) expect(alpha(lod, boat)).toBe(255);
    expect(alpha('far', mast)).toBe(0);
    expect(alpha('mid', mast)).toBe(0);
    expect(alpha('near', mast)).toBe(255);
  });
  it('raises the same items as prisms: quay wall into the water, hull, mast, crane, gabled shed; the basin has no volume', () => {
    expect(harbourPrism('basin', 'water', 3)).toBeNull();
    expect(harbourPrism('quay', 'stone', 3)).toMatchObject({ top: 3 });
    expect(harbourPrism('quay', 'stone', 3)!.bottom).toBeLessThan(2);
    const buildings = city3dQuays([layout]);
    // One structure for the quay, one for the grouped furniture.
    expect(buildings.map(b => b.variant_id)).toEqual(['quay', 'furniture']);
    expect(buildings[1].volumes).toHaveLength(quays.length - 2);
    const top = (id: string): number => {
      let z = -Infinity;
      eachBuildingTriangle({ ...buildings[1], volumes: buildings[1].volumes.filter(v => v.id === id) }, t => {
        z = Math.max(z, ...t.points.map(p => p[2]));
      });
      return z;
    };
    const id = (kind: string): string => `city3d-quay:0:${quays.findIndex(q => q.kind === kind)}:deck`;
    const water = 2,
      cog = harbours.boats.cog;
    expect(top(id('boat'))).toBeCloseTo(water + cog.freeboard);
    expect(top(id('mast'))).toBeCloseTo(water + cog.mast);
    expect(top(id('crane'))).toBeGreaterThan(3 + 6);
    // The shed's ridge stands above its eaves.
    expect(top(id('shiphouse'))).toBeCloseTo(3 + 3.2 + 2.4);
  });
  it('gives every prism its sides and carries a stone quay wall over the 3D beach to the water', () => {
    const buildings = city3dQuays([layout]);
    const walls = (id: string): number => {
      let n = 0;
      eachBuildingTriangle({ ...buildings[1], volumes: buildings[1].volumes.filter(v => v.id === id) }, t => {
        if (t.surface === 'wall') n++;
      });
      return n;
    };
    // A mast is a pole, not a floating cap.
    expect(walls(`city3d-quay:0:${quays.findIndex(q => q.kind === 'mast')}:deck`)).toBeGreaterThan(0);
    // The drawn waterline at y = -1; the 3D ground keeps above the water (level 2) down to y = -4.75.
    const ground = (_x: number, y: number): number => 3 + y * 0.2;
    expect(kerbApron(rectangle(0, -1, 20, 1), 2, ground)).toMatchObject({ outer: expect.any(Array) });
    const apron = kerbApron(rectangle(0, -1, 20, 1), 2, ground)!;
    expect(Math.min(...apron.outer.map(p => p.y))).toBeCloseTo(-5, 0);
    for (const p of apron.outer) expect(p.y).toBeLessThanOrEqual(-1 + 1e-9);
    // Already in the water, or no terrain: nothing to add.
    expect(kerbApron(rectangle(0, -1, 20, 1), 2, () => 1)).toBeNull();
    expect(kerbApron(rectangle(0, -1, 20, 1), 2)).toBeNull();
    const withGround = city3dQuays([{ ...layout, structure: { quays: [item('kerb', 'stone', rectangle(0, -1, 20, 1))], districts: [] } } as unknown as Layout], ground);
    expect(withGround.flatMap(b => b.volumes.map(v => v.id))).toContain('city3d-quay:0:0:apron');
  });
  it('joins a descending bank without cutting it to the underwater wall bottom', () => {
    const shape = rectangle(0, -1, 20, 5.5),
      q = { ...item('quay', 'stone', shape), deck_z_m: 20 };
    const bank = (x: number, y: number) => (y > 0 ? 3 : 1.5) + x * 0.02;
    const water = (x: number) => 1 + x * 0.02;
    const buildings = city3dQuays([{ ...layout, structure: { quays: [q] } } as Layout], bank, water);
    const v = buildings[0].volumes[0],
      vertices = v.roof_mesh.vertices;
    expect(vertices.length).toBeGreaterThan(shape.outer.length);
    for (let i = 0; i < vertices.length; i += 4) {
      const [land, wet, bottom] = vertices.slice(i, i + 3);
      expect(land.z).toBeCloseTo(bank(land.x, land.y) + 0.02);
      expect(wet.z).toBeGreaterThanOrEqual(water(wet.x) + 0.4);
      expect(wet.z).toBeLessThanOrEqual(bank(land.x, land.y) + 0.3);
      expect(bottom.z).toBeLessThanOrEqual(Math.min(water(wet.x), bank(wet.x, wet.y)));
    }
    const terrain = new UrbanBuildingGround({ buildings });
    expect(terrain.constrain(10, 4.5, 3.2)).toBe(3.2);
    expect(terrain.constrain(10, 6, 3.2)).toBe(3.2);
    // The far representation retains the same sloping deck and wall, without a flat cap.
    const counts = [false, true].map(overview => {
      let n = 0;
      eachBuildingTriangle(buildings[0], () => n++, overview);
      return n;
    });
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
  it('keeps the wall below a low bed and timber pontoons just above displayed water', () => {
    const qs = [item('quay', 'stone', rectangle(0, -1, 20, 5.5)), item('pier', 'timber', rectangle(8, -12, 2, 12))];
    const buildings = city3dQuays(
      [{ ...layout, structure: { quays: qs } } as Layout],
      (_x, y) => (y > 0 ? 2 : -0.5),
      () => 0.5,
    );
    const v = buildings[0].volumes[0];
    expect(v.roof_mesh.vertices[2].z).toBeLessThanOrEqual(-0.5);
    const pier = buildings.find(b => b.variant_id === 'pier')!.volumes[0];
    expect(pier.roof_mesh.vertices.every(p => Math.abs(p.z - 0.9) < 1e-6)).toBe(true);
    expect(pier.levels[0].height_m).toBeCloseTo(0.2);
  });
  it('offers every harbour type of the catalogue as a generation parameter, named in English and French', () => {
    expect(defaultLayoutConfig().portType).toBe('auto');
    const field = urbanControlFields().find(f => f.path.endsWith('portType'));
    expect(field?.section).toBe('ports');
    expect(field?.options?.map(o => o.value)).toEqual(['auto', 'bare', ...HARBOUR_TYPES]);
    for (const type of HARBOUR_TYPES) {
      expect(HARBOUR_TYPE_NAMES[type][0]).toBeTruthy();
      expect(HARBOUR_TYPE_NAMES[type][1]).toBeTruthy();
    }
    expect(field?.options?.every(o => !/^[a-z-]+$/.test(o.label))).toBe(true);
  });
});
