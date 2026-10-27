import { describe, expect, it } from 'vitest';
import { TREE_FAMILIES, treeDwelling, treeCrownFaces } from '../src/render/cityTrees';
import { buildingRoof, pieceTop, pieceVolumes, readMassing, type MassingPiece } from '../src/render/cityMassing';
import { silhouetteBuilding, surfaceArea } from '../src/render/city3dMeshes';
import { buildCityBuildings } from '../src/render/cityCanvas';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const ring = Array.from({ length: 16 }, (_, i) => ({ x: 6 * Math.cos(i * Math.PI / 8), y: 6 * Math.sin(i * Math.PI / 8) }));
const trees = Array.from({ length: 120 }, (_, i) => treeDwelling(ring, 11.5, 5.7, `lot-${i}`));
function source(id: string): PlacedBuilding {
  const footprint = [{ outer: ring, holes: [] }], massing: MassingPiece[] = [{ floors: 1, eave_m: 11.5, rise_m: 5.7, roof: 'dome', ridges: [], cover: 'turf', wall: 'wood',
    volumes: [{ ring: ring.map(p => [p.x, p.y]), eave_m: 11.5, rise_m: 5.7, roof: 'dome', ridges: [], form: 'tree', tree_seed: id }] }];
  return { id, parcel_id: id, function: 'domestic', culture: { culture: 'elven', pack: '', mode: 'inspired', borrowing: null }, recipe_id: 'silhouette', variant_id: '', ground_z_m: 2,
    footprint, roof_footprint: footprint, volumes: [], structural_features: [], transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 }, programme: { role: 'dwelling.house', massing } } as unknown as PlacedBuilding;
}
describe('tree dwellings', () => {
  it('replays lot seeds independently of order and covers five broadleaf families', () => {
    expect(new Set(trees.map(t => t.family))).toEqual(new Set(TREE_FAMILIES));
    expect(treeDwelling(ring, 11.5, 5.7, 'lot-17')).toEqual(trees[17]);
    expect(new Set(trees.map(t => JSON.stringify(t.outline))).size).toBe(trees.length);
    expect(new Set(trees.map(t => t.platforms.length))).toEqual(new Set([1, 2, 3]));
    expect(new Set(trees.flatMap(t => t.platforms.map(p => p.shape)))).toEqual(new Set(['round', 'polygon', 'partial']));
    for (const t of trees) {
      expect(t.scale).toBeGreaterThanOrEqual(0.75); expect(t.scale).toBeLessThanOrEqual(1.25);
      expect(t.height / 11.5).toBeGreaterThanOrEqual(0.75); expect(t.height / 11.5).toBeLessThanOrEqual(1.25);
      expect(t.trunkRadius / t.radius).toBeGreaterThanOrEqual(0.15); expect(t.trunkRadius / t.radius).toBeLessThanOrEqual(0.3);
      expect(treeCrownFaces(t).flat().every(p => [p.x, p.y, p.z].every(Number.isFinite))).toBe(true);
      if (t.family === 'cluster') { expect(t.crowns.length).toBeGreaterThanOrEqual(2); expect(t.crowns.length).toBeLessThanOrEqual(4); }
    }
    const ratio = (family: string): number => { const c = trees.find(t => t.family === family)!.crowns[0]; return c.height / c.rx; };
    expect(ratio('oval')).toBeGreaterThan(ratio('umbrella') * 2);
  });
  it('shares seeded crown geometry and outline between 2D, picking and the merged 3D mesh', () => {
    const b = source('lot-17'), massing = readMassing((b as unknown as { programme: unknown }).programme, b.footprint, b.id)!;
    const v = pieceVolumes(b.footprint[0], massing[0])[0], rendered = silhouetteBuilding(b), mesh = rendered.volumes[0].roof_mesh;
    expect(rendered).toEqual(silhouetteBuilding(b));
    expect(buildCityBuildings({ buildings: [b] }).items[0].surface[0]).toEqual(v.shape);
    expect(surfaceArea([v.shape])).toBeGreaterThan(20);
    const crown = mesh.faces.slice(0, treeCrownFaces(v.tree!).length).map(f => f.vertices.map(i => ({ ...mesh.vertices[i], z: mesh.vertices[i].z - 2 })));
    expect(crown).toEqual(buildingRoof(b.footprint, massing).map(f => f.points));
    expect(pieceTop(massing[0])).toBeCloseTo(Math.max(...crown.flatMap(f => f.map(p => p.z))));
    expect(rendered.volumes).toHaveLength(1);
    let triangles = 0;
    eachBuildingTriangle(rendered, f => { triangles++; expect(f.points.flat().every(Number.isFinite)).toBe(true); });
    expect(triangles).toBeGreaterThan(200);
    expect(new Set(mesh.faces.map(f => f.material)).size).toBeLessThanOrEqual(3);
    expect(mesh.faces.every(f => /@[0-9a-f]{6}$/.test(f.material))).toBe(true);
  });
  it('uses the building id for older massing and preserves an explicit lot seed', () => {
    const b = source('explicit'), programme = (b as unknown as { programme: { massing: MassingPiece[] } }).programme;
    expect(readMassing(programme, b.footprint, 'other')![0].volumes![0].tree_seed).toBe('explicit');
    delete programme.massing[0].volumes![0].tree_seed;
    expect(readMassing(programme, b.footprint, 'building-a')![0].volumes![0].tree_seed).toBe('building-a:0:0');
    expect(readMassing(programme, b.footprint, 'building-b')![0].volumes![0].tree_seed).toBe('building-b:0:0');
  });
});
