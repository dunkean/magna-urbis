import { describe, expect, it } from 'vitest';
import nativeScene from './fixtures/surface-native-city-plans.json';
import { exportMagnaBuildings } from '../src/surface/adapters/magna';
import { occupationFromMagnaScene } from '../src/surface/adapters/occupation';
import { exportSurfaceInputPacket } from '../src/surface/adapters/export';
import { Occupation, type TerrainGrid } from '../src/surface/model';
import { projectNativeBuilding } from '../src/ui/urbanBuildingProjection';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';

const terrain = (): TerrainGrid => ({ width: 20, height: 20, originX: 100.5, originZ: 200.5, spacingM: 1,
  heights: new Float32Array(400), source: { id: 'test-only-grid', version: '1', sourceLOD: 0, nativeSpacingM: 1 } });
const ring = (x: number, y: number, width: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + width }, { x, y: y + width }];
function acceptedProjection(id: string, x: number, y: number) {
  return { projection: 'native-building-visual-1', nativeRealization: false, id, parcel_id: id + '/parcel', ground_z_m: 10, height_m: 5,
    footprint: [{ outer: ring(x, y, 10), holes: [ring(x + 3, y + 3, 4)] }], roof_footprint: [],
    occupation_surfaces: [[{ outer: ring(x, y, 10), holes: [ring(x + 3, y + 3, 4)] }]], ground_constraints: [] };
}
describe('existing native city compatibility and accepted occupation', () => {
  it('reads exact cached native city plans without fabricating realized geometry from proxies', () => {
    const scene = nativeScene as unknown as Building3dScene;
    const before = JSON.stringify(scene), packet = exportMagnaBuildings(scene);
    expect(packet.buildings.map(b => b.id)).toEqual(nativeScene.buildings.map(b => b.id));
    expect(packet.buildings.every(b => b.representation === 'native')).toBe(true);
    expect(packet.buildings[0].footprint).toEqual(nativeScene.buildings[0].footprint);
    const original = scene.buildings[0] as PlacedBuilding;
    const proxy = projectNativeBuilding(original);
    const projectionPacket = exportMagnaBuildings({ buildings: [proxy], occupationBuildings: [original] });
    expect(projectionPacket.buildings[0].nativeRealization).toBe(false);
    expect(projectionPacket.occupationBuildings[0].nativeRealization).toBe(true);
    expect(projectionPacket.occupationBuildings[0].id).toBe(original.id);
    for (const building of [...packet.buildings, ...projectionPacket.buildings]) for (const t of building.triangles) {
      const [a, b, c] = t.points, u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(cross.reduce((sum, value, i) => sum + value * t.normal[i], 0)).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(JSON.stringify(scene)).toBe(before);
  });
  it('keeps courtyards free, excludes thin boundaries, and ignores unaccepted visual overlays', () => {
    const grid = terrain(), accepted = acceptedProjection('accepted', 102, 202), overlay = acceptedProjection('overlay', 114, 204);
    const scene = { buildings: [overlay], occupationBuildings: [accepted] } as unknown as Building3dScene;
    const before = JSON.stringify(scene), occupancy = occupationFromMagnaScene(grid, scene);
    const at = (x: number, y: number) => occupancy.classes[(y - grid.originZ) * grid.width + x - grid.originX];
    expect(at(103.5, 203.5)).toBe(Occupation.Built);
    expect(at(106.5, 206.5)).toBe(Occupation.Natural);
    expect(at(115.5, 205.5)).toBe(Occupation.Natural);
    expect(at(101.5, 202.5)).toBe(Occupation.Built); // cell touches a wall edge
    const explicitEmpty = occupationFromMagnaScene(grid, { buildings: [overlay], occupationBuildings: [] } as unknown as Building3dScene);
    expect(explicitEmpty.classes.some(c => c === Occupation.Built)).toBe(false);
    expect(JSON.stringify(scene)).toBe(before);
    expect(exportMagnaBuildings(scene).occupationBuildings.map(b => b.id)).toEqual(['accepted']);
  });
  it('rasterizes source roads at the same sample centres and excludes populations on roads and buildings', () => {
    const grid = terrain(), source = { version: 'original', classes: new Uint8Array(400).fill(Occupation.Meadow) };
    const road = { id: 'road-source-id', points: [[100, 215], [120, 215]] as [number, number][], widthM: .1 };
    const scene = { buildings: [acceptedProjection('house', 102, 202)] } as unknown as Building3dScene;
    const occupation = occupationFromMagnaScene(grid, scene, [road], source);
    expect(occupation.classes[14 * 20 + 15]).toBe(Occupation.Road);
    expect(occupation.classes[10 * 20 + 15]).toBe(Occupation.Meadow);
    expect(source.classes.every(c => c === Occupation.Meadow)).toBe(true);
    const packet = exportSurfaceInputPacket({ seed: 7, terrain: grid, occupation: source }, scene, {}, { roads: [road] });
    expect(packet.urban.roads![0].id).toBe('road-source-id');
    expect(packet.candidates!.every(c => {
      const x = Math.max(0, Math.min(19, Math.round(c.x - grid.originX))), y = Math.max(0, Math.min(19, Math.round(c.z - grid.originZ)));
      return ![Occupation.Road, Occupation.Built].includes(occupation.classes[y * 20 + x]);
    })).toBe(true);
  });
});
