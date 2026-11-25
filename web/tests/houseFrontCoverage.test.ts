import { describe, expect, it } from 'vitest';
import catalogue from '../../rust/crates/core/src/urban/catalogue.json';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { baseVolume } from '../src/render/city3d/volume';
import { facadeDoor, facadeQuad } from '../src/render/city3d/features';
import { OPENING, LIT_WINDOW } from '../src/render/city3d/materials';
import { RoofBuilder } from '../src/render/city3d/roofGeometry';
import { cultureHouseFronts, detailedHouseFront } from '../src/render/houseFronts';
import { buildHouseFront } from '../src/render/houseFrontKit';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
const prior =
  'indian-temple dravidian-temple rajput-fort south-asian-metropolis european-organic bastide hanseatic flemish-cloth-town industrial-victorian haussmannian garden-city rynek-town wizard-city gnomish american-grid global-high-rise modernist-functionalist gulf-contemporary chinese-megacity korean-high-rise japanese-contemporary corporate-arcology futuristic-space-colony cyberpunk solarpunk dystopian-brutalism'.split(
    ' ',
  );
const footprint = [
  {
    outer: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ],
    holes: [],
  },
];
const material = { coating: 'city3d:wall:plaster', cladding: 'city3d:cover:tile', base: 'stone', frame: 'wood', roof_frame: 'wood', infill: 'plaster' };
const volume = baseVolume('house', footprint, 0, 3, 1, material, new RoofBuilder().mesh(), 'RF-GABLE', { footprint, z_min_m: 0, z_max_m: 0 });
const house = (culture: string) => ({ id: 'front-test', function: 'domestic', culture: { culture }, ground_z_m: 0, entrance: { x: 4, y: 0 }, footprint, roof_footprint: footprint, volumes: [volume], structural_features: [], courtyards: [] }) as unknown as PlacedBuilding;
describe('regional dwelling frontages', () => {
  it('assigns a volumetric design to all remaining catalogue cultures', () => {
    const remaining = Object.keys(catalogue.cultures).filter(c => !prior.includes(c));
    expect(remaining).toHaveLength(89);
    for (const id of remaining) {
      const draw = cultureHouseFronts[id];
      expect(draw, id).toBeTypeOf('function');
      const mesh = buildHouseFront({ x: 0, y: 0, z: 0, nx: 0, ny: 1 }, { width: 4.5, depth: 1.7, height: 3.2, seed: 57, floor: 0, wall: material.coating, cover: material.cladding }, draw);
      expect(mesh.faces.length, id).toBeGreaterThan(4);
      expect(Math.max(...mesh.vertices.map(p => p.y)), id).toBeGreaterThan(0.23);
      expect(
        mesh.vertices.every(p => Number.isFinite(p.x + p.y + p.z)),
        id,
      ).toBe(true);
      expect(
        mesh.faces.reduce((n, f) => n + f.vertices.length - 2, 0),
        id,
      ).toBeLessThan(440);
    }
  });
  it('fits an actual clear frontage once and avoids a neighbouring wing and a courtyard', () => {
    const b = house('roman-core'),
      a = detailedHouseFront(b);
    expect(a?.frame.ny).toBe(-1);
    expect(detailedHouseFront(b)).toBe(a);
    const surrounding = [
      {
        outer: [
          { x: -5, y: -5 },
          { x: 13, y: -5 },
          { x: 13, y: 11 },
          { x: -5, y: 11 },
        ],
        holes: [],
      },
    ];
    expect(detailedHouseFront({ ...b, courtyards: surrounding })).toBeNull();
    expect(detailedHouseFront({ ...b, volumes: [volume, { ...volume, role: 'minor', footprint: surrounding }] })).toBeNull();
    const reach = (crafted: boolean, overview: boolean) => {
      let edge = 0;
      eachBuildingTriangle(
        b,
        t => {
          for (const p of t.points) edge = Math.min(edge, p[1]);
        },
        overview,
        undefined,
        0,
        false,
        crafted,
      );
      return edge;
    };
    expect(reach(false, false)).toBe(0);
    expect(reach(true, true)).toBe(0);
    expect(reach(true, false)).toBeLessThan(-0.25);
  });
  it('keeps corner entrances, raised thresholds and adjacent windows in their measured facade coordinates', () => {
    for (const culture of ['byzantine-greek', 'venetian-lagoon', 'sahel', 'stilt-town', 'swahili-stone-town']) {
      for (const angle of [0, 0.61, 2.1]) {
        const at = (s: number, d: number) => ({ x: 43 + Math.cos(angle) * s - Math.sin(angle) * d, y: -17 + Math.sin(angle) * s + Math.cos(angle) * d });
        const ring = [at(0, 0), at(9, 0), at(9, 5), at(0, 5)];
        const shape = [{ outer: ring, holes: [] }],
          mesh = new RoofBuilder(),
          bottom = 3.7;
        facadeDoor(mesh, ring[0], ring[1], 1, 0.4, 1.5, bottom, bottom + 2.16, 0.04, LIT_WINDOW);
        facadeQuad(mesh, ring[0], ring[1], 1, 2.3, 3.2, bottom + 0.95, bottom + 2.1, 0.04, OPENING);
        const v = { ...volume, footprint: shape, z_m: 3, wall_height_m: 4, levels: [{ index: 0, footprint: shape, z_m: 3, height_m: 4 }], roof_mesh: mesh.mesh(), stiltHeight_m: 3 };
        const b = { ...house(culture), footprint: shape, volumes: [v], entrance: at(1, -3) };
        const frame = detailedHouseFront(b)?.frame;
        expect(frame, culture).toBeDefined();
        expect(frame!.x).toBeCloseTo(at(0.95, 0).x, 7);
        expect(frame!.y).toBeCloseTo(at(0.95, 0).y, 7);
        expect(frame!.z).toBeCloseTo(bottom);
        expect(frame!.doorWidth).toBeCloseTo(1.1);
        expect(frame!.doorHeight).toBeCloseTo(2.16);
        expect(frame!.width).toBeLessThanOrEqual(1.91);
        expect(frame!.windows).toHaveLength(1);
        expect(frame!.windows![0].x).toBeCloseTo(-1.8);
        expect(frame!.windows![0].bottom).toBeCloseTo(0.95);
      }
    }
  });
  it('keeps native low-eaved snow and hide shelters eligible for their fitted entrance', () => {
    for (const culture of ['inuit-camp', 'native-plains']) {
      const b = house(culture);
      b.volumes = [{ ...volume, wall_height_m: 0.15, roof_height_m: 2.9 }];
      expect(detailedHouseFront(b)?.frame.height, culture).toBeGreaterThan(1.5);
    }
  });
});
