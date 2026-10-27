import { describe, expect, it } from 'vitest';
import { buildCityBuildings, buildCityScene } from '../src/render/cityCanvas';
import { cityGlPick, cityGlPlanMesh } from '../src/render/cityGl';
import {
  buildFillMeshSync, buildStreetStrokes, CityGlPacker, mergeTriangulations, meshFeatureAt, META, packBuildings, slicePolygons, splitPolygons,
  STROKE_STRIDE, triangulatePolygons, visibleRanges,
} from '../src/render/cityGlBuild';
import { DEFAULT_LAYERS, planColors } from '../src/render/cityGlStyle';
import type { Layout, Partition, Shape } from '../../rust/bridge/urban';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';

const ring = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const area = (pos: Float32Array, tri: Uint32Array): number => {
  let s = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] * 2, b = tri[i + 1] * 2, c = tri[i + 2] * 2;
    s += Math.abs((pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[c] - pos[a]) * (pos[b + 1] - pos[a + 1])) / 2;
  }
  return s;
};

describe('cityGl triangulation', () => {
  // A 40 m court-house lot with a 10 m court, far from the origin (float32 relative coordinates).
  const courtyard: Shape = { outer: [...ring(5000, 8000, 40, 30), { x: 5000, y: 8000 }], holes: [ring(5015, 8010, 10, 10).reverse()] };

  it('covers a polygon with a hole exactly and leaves the hole empty', () => {
    const packer = new CityGlPacker({ x: 5020, y: 8015 });
    packer.add(courtyard, 7);
    const mesh = buildFillMeshSync({ polygons: packer.done(), layers: { lots: { features: [7, 8], polygons: [0, 1], chunks: [{ box: [5000, 8000, 5040, 8030], polygons: [0, 1] }] } }, featureCount: 8, origin: { x: 5020, y: 8015 } });
    expect(mesh.positions.length / 2).toBe(8); // closing point dropped
    expect(area(mesh.positions, mesh.triangles)).toBeCloseTo(40 * 30 - 10 * 10, 6);
    expect(mesh.lines.length / 2).toBe(8); // 4 outer + 4 hole edges
    expect(meshFeatureAt(mesh, 'lots', { x: 5005, y: 8005 })).toBe(7);
    expect(meshFeatureAt(mesh, 'lots', { x: 5020, y: 8015 })).toBeUndefined(); // in the court
    expect(meshFeatureAt(mesh, 'lots', { x: 5045, y: 8015 })).toBeUndefined(); // outside
  });

  it('gives the same mesh when split over workers (slice, triangulate, merge)', () => {
    const packer = new CityGlPacker({ x: 0, y: 0 });
    for (let i = 0; i < 50; i++) packer.add(i % 3 ? { outer: ring(i * 50, 0, 40, 20 + i), holes: [] } : { ...courtyard, outer: courtyard.outer.map(p => ({ x: p.x - 5000 + i * 50, y: p.y - 8000 })), holes: courtyard.holes.map(h => h.map(p => ({ x: p.x - 5000 + i * 50, y: p.y - 8000 }))) }, i);
    const p = packer.done(), whole = triangulatePolygons(p);
    const ranges = splitPolygons(p, 4);
    expect(ranges[0][0]).toBe(0); expect(ranges[ranges.length - 1][1]).toBe(50);
    const merged = mergeTriangulations(ranges.map(([from, to]) => { const s = slicePolygons(p, from, to); return { result: triangulatePolygons(s), vertexOffset: s.vertexOffset }; }));
    expect(Array.from(merged.triangles)).toEqual(Array.from(whole.triangles));
    expect(Array.from(merged.lines)).toEqual(Array.from(whole.lines));
    expect(Array.from(merged.polyTriangles)).toEqual(Array.from(whole.polyTriangles));
  });
});

describe('cityGl scene, picking and styles', () => {
  const layout = {
    key: 'k', quarters: [{ shape: { outer: ring(1000, 1000, 100, 100), holes: [] }, phase: 0 }],
    blocks: [{ shape: { outer: ring(1000, 1000, 100, 100), holes: [] }, kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } }],
    streets: [
      { path: [{ x: 990, y: 990 }, { x: 1110, y: 990 }, { x: 1110, y: 1110 }], widths: [6], rank: 0, role: 'main' },
      { path: [{ x: 1000, y: 1050 }, { x: 1100, y: 1050 }], widths: [3], rank: 3, role: 'lane' },
      { path: [{ x: 1050, y: 900 }, { x: 1050, y: 990 }], widths: [5], rank: 1, role: 'bridge' },
    ],
    enclosures: [], phases: [],
  } as unknown as Layout;
  const partition = { key: 'k', parcels: [
    { id: 'p-court', shape: { outer: ring(1000, 1000, 50, 50), holes: [ring(1020, 1020, 10, 10)] }, use: 'plot', block: 0, axis: { x: 1, y: 0 } },
    { id: 'p-garden', shape: { outer: ring(1050, 1000, 50, 50), holes: [] }, use: 'garden', block: 0, axis: { x: 1, y: 0 } },
  ] } as unknown as Partition;
  const scene = buildCityScene([layout], [partition]);
  const batch = { buildings: [{ id: 'b1', parcel_id: 'p-court', function: 'domestic', footprint: [{ outer: ring(1002, 1002, 12, 8), holes: [] }], roof_footprint: [] }], refusals: [], open_spaces: [] } as unknown as PlacementBatch;
  const buildings = buildCityBuildings(batch, scene);

  it('picks building, parcel, court (block) and street-side block like the drawn mesh', () => {
    expect(cityGlPick(scene, buildings, { x: 1005, y: 1005 })).toMatchObject({ kind: 'building', id: 'b1' });
    expect(cityGlPick(scene, buildings, { x: 1040, y: 1010 })).toMatchObject({ kind: 'parcel', id: 'p-court' });
    const court = cityGlPick(scene, buildings, { x: 1025, y: 1025 });
    expect(court.kind).toBe('block'); expect(court.parcel).toBeUndefined();
    expect(cityGlPick(scene, undefined, { x: 1005, y: 1005 })).toMatchObject({ kind: 'parcel', id: 'p-court' });
    expect(cityGlPick(scene, buildings, { x: 500, y: 500 })).toEqual({});
    // The GPU mesh agrees with the CPU pick: same parcel feature, nothing in the court.
    const mesh = cityGlPlanMesh(scene), p0 = mesh.layers.parcels.features[0];
    expect(meshFeatureAt(mesh, 'parcels', { x: 1040, y: 1010 })).toBe(p0);
    expect(meshFeatureAt(mesh, 'parcels', { x: 1075, y: 1025 })).toBe(p0 + 1);
    expect(meshFeatureAt(mesh, 'parcels', { x: 1025, y: 1025 })).toBeUndefined();
    expect(meshFeatureAt(mesh, 'blocks', { x: 1025, y: 1025 })).toBe(mesh.layers.blocks.features[0]);
    const bm = buildFillMeshSync(packBuildings(buildings, mesh.origin));
    expect(meshFeatureAt(bm, 'buildings', { x: 1005, y: 1005 })).toBe(0);
  });

  it('sorts street segments minor first, crossings last, with butt ends on bridges', () => {
    const s = buildStreetStrokes(scene, { x: 1000, y: 1000 }), u = new Uint32Array(s.data), f = new Float32Array(s.data);
    expect(s.count).toBe(4);
    expect(u[7]).toBe(1); // lane (rank 3) first
    expect(u[3 * STROKE_STRIDE + 7]).toBe(2); // bridge last
    expect(u[3 * STROKE_STRIDE + 8] & (META.crossing | META.buttStart | META.buttEnd)).toBe(META.crossing | META.buttStart | META.buttEnd);
    expect(s.count - s.firstWithRank[1]).toBe(3); // far: main (2 segments) + bridge
    expect(f[STROKE_STRIDE * 2 + 6]).toBeCloseTo(120, 5); // second main segment starts 120 m along
  });

  it('groups polygons in grid chunks and draws only the chunks in view', () => {
    // Two lots 3 km apart: one chunk each, feature ids stay the scene indices.
    const far = { ...partition, parcels: [...partition.parcels, { id: 'p-far', shape: { outer: ring(4000, 1000, 20, 20), holes: [] }, use: 'plot', block: 0, axis: { x: 1, y: 0 } }] } as unknown as Partition;
    const s2 = buildCityScene([layout], [far]), mesh = cityGlPlanMesh(s2), l = mesh.layers.parcels;
    expect(l.chunks.length).toBe(2);
    expect(meshFeatureAt(mesh, 'parcels', { x: 4010, y: 1010 })).toBe(l.features[0] + 2);
    const all = visibleRanges(l.chunks, { minX: 0, minY: 0, maxX: 5000, maxY: 2000 }, c => c.triangles);
    expect(all).toEqual([[l.triangles.start, l.triangles.count]]); // consecutive chunks merge into one draw
    const near = visibleRanges(l.chunks, { minX: 990, minY: 990, maxX: 1110, maxY: 1110 }, c => c.triangles);
    const home = l.chunks.find(c => c.box[0] < 1100)!;
    expect(near).toEqual([[home.triangles.start, home.triangles.count]]); expect(home.triangles.count).toBe((8 + 2) * 3); // court lot (hole) + garden
    expect(visibleRanges(l.chunks, { minX: -900, minY: -900, maxX: -800, maxY: -800 }, c => c.triangles)).toEqual([]);
    // Street suffix (level of detail) clips the ranges.
    const st = buildStreetStrokes(scene, { x: 1000, y: 1000 });
    const ranges = visibleRanges(st.chunks!, { minX: 0, minY: 0, maxX: 2000, maxY: 2000 }, c => ({ start: c.first, count: c.count }), 0, st.firstWithRank[1]);
    expect(ranges).toEqual([[st.firstWithRank[1], st.count - st.firstWithRank[1]]]);
  });

  it('switches draws and colours with the level of detail, never the geometry', () => {
    const mesh = cityGlPlanMesh(scene), state = { view: 'parcels' as const, palette: 'growth' as const, layers: DEFAULT_LAYERS, buildingsVisible: true, diagnostic: 'none' };
    const far = planColors(scene, mesh, { ...state, lod: 'far' }), near = planColors(scene, mesh, { ...state, lod: 'near' });
    expect(far.draws).toMatchObject({ footprint: true, blocks: false, parcels: false, streetCasing: true });
    expect(near.draws).toMatchObject({ footprint: false, blocks: true, parcels: true, parcelLines: true, streetCasing: true });
    const p0 = mesh.layers.parcels.features[0];
    expect(far.fill[p0 * 4 + 3]).toBe(0);
    expect(near.fill[p0 * 4 + 3]).toBe(255);
    expect(Array.from(near.fill.slice((p0 + 1) * 4, (p0 + 1) * 4 + 3))).toEqual([0xa8, 0xbc, 0x89]); // garden
  });
});
