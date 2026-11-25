import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { CITY3D_CUT_M, CITY3D_FOOTING_DEPTH_M, CITY3D_PLINTH_M, CITY3D_STREET_DOOR_M, city3dScene, silhouetteBuilding } from '../src/render/city3dMeshes';
import { eachBuildingTriangle, type BuildingTriangle, type SeatedVolume } from '../src/render/urbanBuildingGeometry';
import { buildCityBuildings } from '../src/render/cityCanvas';
import { terrainSeat } from '../src/render/city3d/terrainSeat';

// A 30 % slope rising to the east: 3 m over a 10 m house.
const slope = (x: number): number => 50 + 0.3 * x;
const square = (x: number, y: number, w: number, d = w) => ({
  outer: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + d },
    { x, y: y + d },
  ],
  holes: [],
});
type Shape = ReturnType<typeof square>;
const piece = (shape: Shape, extra: Record<string, unknown> = {}, volume: Record<string, unknown> = {}) => ({
  floors: 1,
  eave_m: 3,
  rise_m: 2,
  roof: 'hip',
  cover: 'thatch',
  wall: 'stone',
  tone: 0.5,
  volumes: [{ ring: shape.outer.map(p => [p.x, p.y]), eave_m: 3, rise_m: 2, roof: 'hip', cover: 'thatch', wall: 'stone', tone: 0.5, ...volume }],
  ...extra,
});
const site = (shapes: Shape[], pieces: object[], recipe = 'silhouette'): PlacedBuilding =>
  ({ id: 'h', parcel_id: 'p', recipe_id: recipe, function: 'domestic', culture: { culture: 'any' }, ground_z_m: 0, footprint: shapes, roof_footprint: shapes, volumes: [], structural_features: [], programme: { massing: pieces } }) as unknown as PlacedBuilding;
const house = (stilts_m?: number): PlacedBuilding => {
  const shape = square(0, 0, 10);
  return site([shape], [piece(shape, {}, stilts_m ? { stilts_m } : {})]);
};
const triangles = (b: PlacedBuilding): BuildingTriangle[] => {
  const out: BuildingTriangle[] = [];
  eachBuildingTriangle(b, t => out.push(t));
  return out;
};

describe('houses on a slope', () => {
  it('is sunk into the hill: a small plinth downhill, the footing under every corner', () => {
    const b = silhouetteBuilding(house(), slope),
      corners = b.footprint[0].outer.map(p => slope(p.x));
    expect(b.ground_z_m).toBeCloseTo(Math.min(...corners) + CITY3D_PLINTH_M, 9);
    for (const v of b.volumes) expect(v.foundation.z_min_m).toBeLessThanOrEqual(Math.min(...corners));
  });

  it('bounds the sink: a street uphill keeps a door in the wall, a deep building stands over a lower storey, a cliff takes it whole', () => {
    expect(terrainSeat({ low: 10, high: 10.4, slope: 0.1 }, 3)).toBe(10.4);
    expect(terrainSeat({ low: 10, high: 13, slope: 0.3 }, 3)).toBe(10 + CITY3D_PLINTH_M);
    expect(terrainSeat({ low: 10, high: 13, slope: 0.3 }, 3, { mean: 13, high: 13 })).toBeCloseTo(13 - (3 - CITY3D_STREET_DOOR_M), 9);
    expect(terrainSeat({ low: 10, high: 13, slope: 0.3 }, 6, { mean: 13, high: 13 })).toBe(10 + CITY3D_PLINTH_M);
    expect(terrainSeat({ low: 10, high: 16, slope: 0.6 }, 3)).toBe(16 - CITY3D_CUT_M);
    expect(terrainSeat({ low: 10, high: 40, slope: 4 }, 3)).toBe(10 + CITY3D_PLINTH_M);
  });

  it('opens a lower storey on the wall the hill leaves bare, and no window or door under the ground', () => {
    const steep = (x: number): number => 50 + 0.75 * x,
      shape = square(0, 0, 10),
      b = silhouetteBuilding(site([shape], [piece(shape, {}, { floors: 1 })]), steep),
      openings = b.volumes[0].roof_mesh.faces.filter(f => /opening|window/i.test(f.material)).map(f => f.vertices.map(i => b.volumes[0].roof_mesh.vertices[i]));
    expect(openings.some(face => Math.max(...face.map(p => p.z)) < b.ground_z_m)).toBe(true);
    for (const face of openings) for (const p of face) expect(p.z).toBeGreaterThan(steep(p.x) - 0.4);
  });

  it('closes a mono-pitch roof with wall on its high side and both ends, at every level of detail', () => {
    const shape = square(0, 0, 10),
      source = site([shape], [piece(shape, {}, { roof: 'shed', ridges: [[0.05, 0, 0.05, 10]] })]);
    for (const overview of [false, true]) {
      const walls: BuildingTriangle[] = [];
      eachBuildingTriangle(
        silhouetteBuilding(source),
        t => {
          if (Math.abs(t.normal[2]) < 0.01 && Math.max(...t.points.map(p => p[2])) > 3.1 && Math.min(...t.points.map(p => p[2])) >= 2.999) walls.push(t);
        },
        overview,
      );
      // The high side (west) and the two ends, up to the roof.
      expect(new Set(walls.map(t => t.normal.slice(0, 2).map(n => Math.round(n)).join()))).toEqual(new Set(['-1,0', '0,1', '0,-1']));
      expect(Math.max(...walls.flatMap(t => t.points.map(p => p[2])))).toBeGreaterThan(4.8);
    }
  });

  it('steps two houses of a row down the slope, each on its own floor', () => {
    const at = (x: number) => silhouetteBuilding(site([square(x, 0, 8)], [piece(square(x, 0, 8))]), slope).ground_z_m;
    expect(at(8) - at(0)).toBeCloseTo(slope(8) - slope(0), 9);
  });

  it('runs every stilt post down to its own ground, not to the uphill floor seat', () => {
    const b = silhouetteBuilding(house(2.2), slope),
      v = b.volumes[0],
      floor = b.ground_z_m + 2.2;
    const feet = v.roof_mesh.vertices.filter(p => p.z < floor - 0.01);
    expect(feet.length).toBeGreaterThan(0);
    for (const p of feet) expect(p.z).toBeLessThanOrEqual(slope(p.x));
  });

  it('seats each piece on its own ground: a barn downhill is not lifted to its house floor', () => {
    const home = square(20, 0, 10),
      barn = square(0, 0, 8);
    const b = silhouetteBuilding(site([home, barn], [piece(home), piece(barn)]), slope),
      [h, w] = b.volumes as SeatedVolume[];
    expect(h.z_m).toBeCloseTo(slope(20) + CITY3D_PLINTH_M, 9);
    expect(w.z_m).toBeCloseTo(slope(0) + CITY3D_PLINTH_M, 9);
    expect(b.ground_z_m).toBeCloseTo(slope(20) + CITY3D_PLINTH_M, 9);
    // The barn's footing reaches below its own low side; the house keeps the building's ground, the barn names its own.
    expect(w.foundation.z_min_m).toBeLessThanOrEqual(slope(0) - CITY3D_FOOTING_DEPTH_M + 1e-9);
    expect(h.ground_m).toBeUndefined();
    expect(w.ground_m).toBeCloseTo(slope(0) + CITY3D_PLINTH_M, 9);
    // Under the relief exaggeration the barn's points keep their height above the barn's ground.
    const barnWalls = triangles({ ...b, volumes: [w] });
    expect(barnWalls.length).toBeGreaterThan(0);
    for (const t of barnWalls) t.points.forEach((p, i) => expect(t.ground![i]).toBeCloseTo(Math.min(p[2], slope(0) + CITY3D_PLINTH_M), 9));
    expect(triangles({ ...b, volumes: [h] }).every(t => t.ground === undefined)).toBe(true);
  });

  it('draws a terrace level at the floor with its retaining wall on the downhill edge, nothing floating', () => {
    const home = square(20, 0, 10),
      ring = [
        [18.5, 0],
        [30, 0],
        [30, 10],
        [18.5, 10],
      ],
      wall_m = 3.45;
    const footing = { way: 'terrace', base_z_m: 0, low_z_m: 0, drop_m: 3, terrace: { ring, wall_m } };
    const b = silhouetteBuilding(site([home], [piece(home, { footing })]), slope),
      seat = slope(20) + CITY3D_PLINTH_M;
    expect(b.volumes[0].z_m).toBeCloseTo(seat, 9);
    // The house stands on its terrace: no footing of its own.
    expect(b.volumes[0].foundation.footprint).toEqual([]);
    const [terrace] = b.structural_foundations!;
    expect(terrace.z_max_m).toBeCloseTo(seat, 9);
    // The downhill wall is at least the recorded height, and reaches below the displayed ground at every corner.
    expect(seat - terrace.z_min_m).toBeGreaterThanOrEqual(wall_m);
    for (const [x] of ring) expect(terrace.z_min_m).toBeLessThan(slope(x));
    // The slab is level at the floor: every upward face of the terrace is at the seat.
    const slab = triangles(b).filter(t => t.material === b.volumes[0].materials.base && t.normal[2] === 1);
    expect(slab.length).toBeGreaterThan(0);
    for (const t of slab) for (const p of t.points) expect(p[2]).toBeCloseTo(seat, 9);
    // The plan styles draw the terrace outline under the building.
    expect(buildCityBuildings({ buildings: [site([home], [piece(home, { footing })])] }).items[0].terraces).toEqual([{ outer: ring.map(([x, y]) => ({ x, y })), holes: [] }]);
  });

  it('re-seats compact and detailed native plans on the displayed terrain', () => {
    const shape = square(0, 0, 10),
      z = 0;
    const volume = {
      id: 'v',
      footprint: [shape],
      levels: [{ index: 0, footprint: [shape], z_m: z, height_m: 3 }],
      z_m: z,
      wall_height_m: 3,
      roof_height_m: 0,
      roof_system: 'RF-FLAT',
      roof_pitch_deg: 0,
      overhang_m: 0,
      roof_spec: {},
      materials: { frame: 'a', infill: 'a', coating: 'a', cladding: 'b', base: 'a', roof_frame: 'a' },
      role: 'main',
      envelope: 'walled',
      roof_mesh: { vertices: [], faces: [] },
      foundation: { footprint: [shape], z_min_m: z - 0.3, z_max_m: z },
    };
    const compact = { ...site([shape], [], 'native'), programme: undefined, volumes: [volume] } as unknown as PlacedBuilding;
    const scene = city3dScene({ schema_version: '1', generator_version: 'x', buildings: [compact], refusals: [], open_spaces: [] }, { heightAt: slope });
    const b = scene.buildings[0],
      v = b.volumes[0];
    expect(scene.kinds.compact).toBe(1);
    const seat = slope(0) + CITY3D_PLINTH_M;
    expect(b.ground_z_m).toBeCloseTo(seat, 9);
    expect(v.z_m).toBeCloseTo(seat, 9);
    expect(v.levels[0].z_m).toBeCloseTo(seat, 9);
    expect(v.foundation.z_max_m).toBeCloseTo(seat, 9);
    expect(v.foundation.z_min_m).toBeLessThanOrEqual(slope(0) - CITY3D_FOOTING_DEPTH_M + 1e-9);
    const detail = {
      ...compact,
      volumes: [
        {
          ...volume,
          roof_mesh: {
            vertices: [
              { x: 0, y: 0, z: 3 },
              { x: 10, y: 0, z: 3 },
              { x: 10, y: 10, z: 3 },
            ],
            faces: [{ vertices: [0, 1, 2], normal: [0, 0, 1], material: 'b', kind: 'slab' }],
          },
        },
      ],
    } as unknown as PlacedBuilding;
    const shown = city3dScene({ schema_version: '1', generator_version: 'x', buildings: [compact], refusals: [], open_spaces: [] }, { heightAt: slope, details: new Map([['h', detail]]) }).buildings[0];
    expect(shown.volumes[0].roof_mesh.vertices.map(p => p.z)).toEqual([3, 3, 3].map(z => z + seat));
    // Seated where it was planned, a plan is returned as it is.
    const level = city3dScene({ schema_version: '1', generator_version: 'x', buildings: [compact], refusals: [], open_spaces: [] }, { heightAt: () => 0 }).buildings[0];
    expect(level.volumes[0].foundation).toBe(volume.foundation);
  });

  it('leaves a flat site exactly as without terrain: same mesh, no seated volume, no terrace', () => {
    const home = square(20, 0, 10),
      barn = square(0, 0, 8),
      source = site([home, barn], [piece(home), piece(barn)]);
    const flat = silhouetteBuilding(source, () => 0),
      reference = silhouetteBuilding(source);
    expect(JSON.stringify(flat)).toBe(JSON.stringify(reference));
    expect(flat.structural_foundations).toBeUndefined();
    expect(triangles(flat).every(t => t.ground === undefined)).toBe(true);
  });
});
