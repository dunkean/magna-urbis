import { describe, expect, it } from 'vitest';
import { buildingRayDistance, surfaceTriangles, eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { buildingExterior, urbanBuildingsSvg } from '../src/render/urbanBuildings';
import { renderHouseExteriorSvg, houseMaterialColor } from '../../rust/bridge/houseRender';
import { buildingPaint } from '../src/render/urbanBuildingStyle';
import type { Point, Surface } from '../../rust/bridge/housesContract';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { ForestOccupation } from '../../rust/bridge/terrainForest';
import { withBuildingOccupation } from '../src/ui/forestOccupation';
import { UrbanBuildingGround } from '../src/ui/urbanBuildingGround';

// Original full boundary traversal. Keep this independent of the sweep so
// the ordered Float64 comparison also checks interpolation and triangle order.
function referenceSurfaceTriangles(surface: Surface): [Point, Point, Point][] {
  const triangles: [Point, Point, Point][] = [];
  for (const shape of surface) {
    const rings = [shape.outer, ...shape.holes];
    const ys = [...new Set(rings.flatMap(r => r.map(p => p.y)))].sort((a, b) => a - b);
    for (let j = 1; j < ys.length; j++) {
      const low = ys[j - 1],
        high = ys[j],
        middle = (low + high) / 2;
      const edges: { a: Point; b: Point; x: number }[] = [];
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          if (middle > Math.min(a.y, b.y) && middle < Math.max(a.y, b.y)) edges.push({ a, b, x: a.x + ((middle - a.y) / (b.y - a.y)) * (b.x - a.x) });
        }
      edges.sort((a, b) => a.x - b.x);
      const at = (edge: (typeof edges)[number], y: number): Point => ({ x: edge.a.x + ((y - edge.a.y) / (edge.b.y - edge.a.y)) * (edge.b.x - edge.a.x), y });
      for (let i = 0; i + 1 < edges.length; i += 2) {
        const a = at(edges[i], low),
          b = at(edges[i + 1], low),
          c = at(edges[i + 1], high),
          d = at(edges[i], high);
        if (b.x - a.x > 1e-9) triangles.push([a, b, c]);
        if (c.x - d.x > 1e-9) triangles.push([a, c, d]);
      }
    }
  }
  return triangles;
}

describe('applied building display geometry', () => {
  it('shares Houses exterior facets, material patterns and ridge edges without a detailed HouseUnit', () => {
    const materials = { frame: 'wood', infill: 'earth', coating: '', cladding: 'tile', base: 'stone', roof_frame: 'wood' };
    const polygon = [
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
    const building = {
      id: 'real-house',
      parcel_id: 'lot',
      function: 'domestic',
      culture: { culture: 'test' },
      recipe_id: 'recipe',
      ground_z_m: 100,
      courtyards: [],
      circulation: [],
      roof_footprint: polygon,
      structural_features: [],
      volumes: [
        {
          id: 'body',
          footprint: polygon,
          levels: [{ index: 0, footprint: polygon, z_m: 100, height_m: 3, materials }],
          z_m: 100,
          wall_height_m: 3,
          roof_height_m: 2,
          roof_system: 'RF-GABLE',
          materials,
          envelope: 'closed',
          roof_mesh: {
            vertices: [
              { x: 0, y: 0, z: 103 },
              { x: 8, y: 0, z: 103 },
              { x: 8, y: 3, z: 105 },
              { x: 0, y: 3, z: 105 },
              { x: 8, y: 6, z: 103 },
              { x: 0, y: 6, z: 103 },
            ],
            faces: [
              { vertices: [0, 1, 2, 3], normal: [0, -0.55, 0.83], material: 'tile', kind: 'pan', roof_group: 'roof' },
              { vertices: [3, 2, 4, 5], normal: [0, 0.55, 0.83], material: 'thatch', kind: 'pan', roof_group: 'roof' },
            ],
            groups: [{ id: 'roof', rf: 'RF-GABLE', body_id: 'body', level: 0, domain: polygon }],
            edges: [{ kind: 'ridge', vertices: [3, 2], faces: [0, 1] }],
          },
        },
      ],
    } as unknown as PlacedBuilding;
    const catalogue = {
      materials: [
        { id: 'tile', pattern: 'tile' },
        { id: 'thatch', pattern: 'thatch' },
      ],
    } as Parameters<typeof houseMaterialColor>[0];
    const exterior = buildingExterior(building);
    const common = renderHouseExteriorSvg(exterior, catalogue, 'urban-houses', 0, 100);
    const svg = urbanBuildingsSvg({ buildings: [building], materials: catalogue.materials } as PlacementBatch, { style: 'cartographic', diagnostic: 'none' });
    expect(svg).toContain(common);
    expect(svg).toContain('url(#urban-houses-mat-tile)');
    expect(svg).toContain('url(#urban-houses-mat-thatch)');
    expect(svg).toContain('stroke-width="1.05"');
    const faceMaterials: string[] = [];
    eachBuildingTriangle(building, t => {
      if (t.surface === 'roof') faceMaterials.push(t.material!);
    });
    expect(new Set(faceMaterials)).toEqual(new Set(['tile', 'thatch']));
    expect(houseMaterialColor(catalogue, 'tile')).toBe('#ad7f62');
    const rotated = structuredClone(building);
    rotated.transform = { origin: { x: 20, y: 10 }, orientation_deg: 90 };
    for (const v of rotated.volumes) {
      v.roof_mesh.vertices = v.roof_mesh.vertices.map(p => ({ ...p, x: 20 - p.y, y: 10 + p.x }));
      for (const f of v.roof_mesh.faces) f.normal = [-f.normal[1], f.normal[0], f.normal[2]];
      for (const g of v.roof_mesh.groups ?? []) g.domain = g.domain.map(p => ({ ...p, outer: p.outer.map(p => ({ x: 20 - p.y, y: 10 + p.x })), holes: [] }));
    }
    const local = buildingExterior(rotated);
    expect(local.roofs.vertices[1].x).toBeCloseTo(8, 9);
    expect(local.roofs.vertices[1].y).toBeCloseTo(0, 9);
    expect(urbanBuildingsSvg({ buildings: [rotated], materials: catalogue.materials } as PlacementBatch, { style: 'cartographic', diagnostic: 'none' })).toContain('translate(20 10) rotate(90)');
  });

  it('keeps a courtyard open inside a concave outer boundary, in either ring winding', () => {
    const surface: Surface = [
      {
        outer: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 6 },
          { x: 8, y: 6 },
          { x: 8, y: 10 },
          { x: 0, y: 10 },
        ],
        holes: [
          [
            { x: 2, y: 2 },
            { x: 6, y: 2 },
            { x: 6, y: 5 },
            { x: 2, y: 5 },
          ],
        ],
      },
    ];
    for (const reverse of [false, true]) {
      const shape = reverse ? surface.map(p => ({ outer: [...p.outer].reverse(), holes: p.holes.map(h => [...h].reverse()) })) : surface;
      const triangles = surfaceTriangles(shape);
      const area = triangles.reduce((sum, [a, b, c]) => sum + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0);
      expect(area).toBeCloseTo(92, 8); // 12*10 - 4*4 notch - 4*3 courtyard.
      const hits = triangles.map(t => buildingRayDistance([4, 3, 20], [0, 0, -1], t.map(p => [p.x, p.y, 5]) as [[number, number, number], [number, number, number], [number, number, number]]));
      expect(hits.every(hit => hit === null)).toBe(true);
    }
  });

  it('matches the original surface traversal in triangle order and every Float64 bit', () => {
    const ring = (coordinates: [number, number][]): Point[] => coordinates.map(([x, y]) => ({ x, y }));
    const ordinates = [-0, 0.25, 0.5, 1, 1 + Number.EPSILON, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    // The outer ring alone exceeds the sweep cutoff. Include a duplicate
    // closing point, horizontal edges, repeated and adjacent ordinates.
    const outer = [{ x: -0, y: -0 }, ...ordinates.flatMap(y => [{ x: 12, y }, { x: 12, y }]), { x: -0, y: 12 }, { x: -0, y: -0 }];
    const holes = [
      ring([[2, 3], [4, 5], [7, 5], [7, 3]]),
      // This edge starts earlier than the first hole but ties it at x=2.5, y=3.5.
      ring([[4, 2], [1, 5], [0.25, 5], [0.25, 2]]),
      ring([[8, 1], [10, 1], [10, 1 + Number.EPSILON], [8, 1 + Number.EPSILON]]),
      ring([[10, 8], [10, 9], [10, 9], [10, 8]]),
    ];
    const shape = { outer, holes };
    const largest = Number.MAX_VALUE;
    const extreme = {
      outer,
      holes: [...holes, ring([[-largest, 2], [largest, 5], [largest, 6], [-largest, 3]]), ring([[-largest, -largest], [largest, largest], [2, 8]])],
    };
    const nonfinite = { outer, holes: [...holes, ring([[1, Number.NaN], [Number.POSITIVE_INFINITY, 3], [3, 6], [1, 6]])] };
    const thin = { outer: ring([[-0, -0], [1e-9, 0], [1.000000000000001e-9, 2], [-0, 2]]), holes: [] };
    const float = new DataView(new ArrayBuffer(8));
    const bits = (value: number): bigint => {
      float.setFloat64(0, value);
      return float.getBigUint64(0);
    };
    const orderedBits = (triangles: [Point, Point, Point][]) => triangles.map(triangle => triangle.map(({ x, y }) => [bits(x), bits(y)]));

    for (const surface of [
      [shape, thin],
      [{ outer: [...outer].reverse(), holes: holes.map(hole => [...hole].reverse()) }],
      [extreme],
      [nonfinite],
    ]) {
      const reference = referenceSurfaceTriangles(surface);
      expect(reference.length).toBeGreaterThan(0);
      expect(orderedBits(surfaceTriangles(surface))).toEqual(orderedBits(reference));
    }
  });

  it('selects metric heights without baking display exaggeration into the scene', () => {
    const face: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, 17],
      [10, 0, 17],
      [0, 10, 17],
    ];
    expect(buildingRayDistance([2, 2, 30], [0, 0, -1], face)).toBeCloseTo(13, 9);
    expect(buildingRayDistance([12, 12, 30], [0, 0, -1], face)).toBeNull();
    expect(face[0][2]).toBe(17);
  });
  it('keeps courtyard holes and physical roof height in the shared distant display and picking', () => {
    const shape: Surface = [
      {
        outer: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 12 },
          { x: 0, y: 12 },
        ],
        holes: [
          [
            { x: 4, y: 4 },
            { x: 8, y: 4 },
            { x: 8, y: 8 },
            { x: 4, y: 8 },
          ],
        ],
      },
    ];
    const materials = { frame: '', infill: '', coating: '', cladding: '', base: '', roof_frame: '' };
    const building = {
      ground_z_m: 100,
      structural_features: [],
      volumes: [{ footprint: shape, z_m: 100, wall_height_m: 6, roof_height_m: 3, envelope: 'walled', materials, levels: [{ footprint: shape, z_m: 100, height_m: 6 }], roof_mesh: { vertices: [], faces: [] } }],
    } as unknown as PlacedBuilding;
    const roof: number[] = [],
      court: number[] = [];
    eachBuildingTriangle(
      building,
      face => {
        const hit = buildingRayDistance([2, 2, 120], [0, 0, -1], face.points);
        if (hit !== null) roof.push(hit);
        const hole = buildingRayDistance([6, 6, 120], [0, 0, -1], face.points);
        if (hole !== null) court.push(hole);
      },
      true,
    );
    expect(Math.min(...roof)).toBe(11);
    expect(court).toEqual([]);
    expect(building.volumes[0].roof_height_m).toBe(3);
  });
  it('resolves appearance from neutral data without changing materials or physical height', () => {
    const materials = { frame: 'wood', infill: 'clay', coating: 'none', cladding: 'none', base: 'stone', roof_frame: 'wood' };
    const applied = JSON.stringify(materials);
    const geometric = buildingPaint(materials, 'workshop', 8.25, { style: 'geometric', diagnostic: 'uses' });
    const cartographic = buildingPaint(materials, 'workshop', 8.25, { style: 'cartographic', diagnostic: 'none' });
    expect(geometric.roof).not.toBe(cartographic.roof);
    expect(JSON.stringify(materials)).toBe(applied);
  });
  it('excludes accepted buildings and circulation while preserving courtyard forest and physical foundations', () => {
    const rectangle = (x: number, y: number, w: number, h = w) => [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    const scene = {
      buildings: [{ ground_z_m: 12, footprint: [{ outer: rectangle(10, 10, 20), holes: [rectangle(18, 18, 4)] }], circulation: [{ outer: rectangle(30, 18, 5, 4), holes: [] }], structural_features: [{ surface: [{ outer: rectangle(36, 12, 0.15, 16), holes: [] }] }] }],
    } as unknown as PlacementBatch;
    const rgba = new Uint8Array(20 * 20 * 4);
    for (let i = 0; i < 400; i++) {
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 3] = 255;
    }
    const source: ForestOccupation = { x: 0, y: 0, width: 40, n: 20, rgba, key: 'retained-forest' };
    const before = rgba.slice(),
      merged = withBuildingOccupation(source, scene)!;
    const at = (x: number, y: number) => {
      const i = (Math.floor(((y - merged.y) / merged.width) * merged.n) * merged.n + Math.floor(((x - merged.x) / merged.width) * merged.n)) * 4;
      return merged.rgba.slice(i, i + 4);
    };
    // Every occupied cell excludes roots (class 8), even under a 0.15 m support. The visible open ground follows the
    // actual polygons (55e0537c), so only the footprint and the circulation, wider than a texel, read as open inside.
    for (const [x, y] of [
      [14, 14],
      [32, 20],
      [36.1, 20],
    ])
      expect(at(x, y)[2]).toBe(8);
    for (const [x, y] of [
      [14, 14],
      [32, 20],
    ])
      expect(at(x, y)[0]).toBeGreaterThan(128);
    for (const [x, y] of [
      [20, 20],
      [4, 4],
    ])
      expect(at(x, y)[1]).toBeGreaterThan(128);
    expect(rgba).toEqual(before);
    scene.buildings[0].structural_foundations = [{ footprint: [{ outer: rectangle(36, 12, 0.15, 16), holes: [] }], z_min_m: 9, z_max_m: 12 }];
    const ground = new UrbanBuildingGround(scene);
    expect(ground.constrain(14, 14, 20)).toBe(12);
    // The footing collar (0e03fcb1) holds the ground at the footing within 2 m of any facade, courtyard walls included:
    // the centre of this 4 m courtyard is 2 m from them. Beyond the 8 m blend the relief is untouched.
    expect(ground.constrain(20, 20, 20)).toBe(12);
    expect(ground.constrain(4, 4, 20)).toBe(20);
    expect(ground.constrain(36.1, 20, 20)).toBe(12);
    expect(scene.buildings[0].ground_z_m).toBe(12);
  });
});
