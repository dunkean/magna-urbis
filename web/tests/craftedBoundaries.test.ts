import { describe, expect, it } from 'vitest';
import type { Enclosure } from '../../rust/bridge/urban';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { city3dWalls } from '../src/render/city3d/walls';
import { city3dLotEnclosures } from '../src/render/city3d/yards';
import type { YardBoundary } from '../src/render/cityLotEnclosures';
import { boundaryOf } from '../src/render/craftedBoundaries';
import { buildingBounds } from '../src/render/world/buildingsMesh';
import { eachBuildingTriangle, buildingRayDistance, type BuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { city3dFarmBuildings, city3dFarmSources } from '../src/render/city3d/display';
import type { Farmstead } from '../src/gen/types';

const path = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 40 },
  { x: 0, y: 40 },
];
const ground = (x: number, y: number) => x * 0.13 + y * 0.04;
const body = (kind: string): Enclosure => ({
  kind,
  path,
  gates: [
    { x: 30, y: 0 },
    { x: 30, y: 40 },
  ],
  height_m: kind === 'hedge' ? 2.5 : 4,
  curtain_width_m: kind === 'hedge' ? 6 : 2,
  material: kind === 'hedge' ? 'thorn' : kind === 'wall' ? 'stone' : 'timber',
});
function triangles(b: PlacedBuilding, crafted: boolean, overview = false, level = 0) {
  const result: BuildingTriangle[] = [];
  eachBuildingTriangle(b, t => result.push(t), overview, undefined, level, false, crafted);
  return result;
}
describe('3D boundaries on generated ground', () => {
  it('raises a kraal thorn enclosure in both modes, leaves both gates traversable and drapes its brushwork', () => {
    const walls = city3dWalls([body('hedge')], ground, 'kraal', 'kraal');
    expect(walls.length).toBeGreaterThan(0);
    for (const detailed of [false, true]) {
      const all = walls.flatMap(b => triangles(b, detailed));
      expect(all.length).toBeGreaterThan(0);
      expect(all.some(t => t.material?.includes('thornwood'))).toBe(detailed);
      for (const y of [0, 40]) {
        const hit = (x: number) => all.some(t => buildingRayDistance([x, y, ground(x, y) + 12], [0, 0, -1], t.points) !== null);
        expect(hit(30)).toBe(false);
        expect(hit(19)).toBe(true);
      }
      if (detailed)
        for (const t of all.filter(t => t.material?.includes('thornwood'))) {
          expect(t.ground?.every(Number.isFinite)).toBe(true);
          expect(t.points.every(p => p.every(Number.isFinite))).toBe(true);
        }
    }
  });
  it('adds pointed timber, masonry projections and bank courses only in close detail', () => {
    for (const e of [body('palisade'), body('wall'), { ...body('wall'), material: 'rammed-earth' }]) {
      const [b] = city3dWalls([e], ground);
      expect(triangles(b, true).length).toBeGreaterThan(triangles(b, false).length);
      expect(triangles(b, true, true)).toEqual(triangles(b, false, true));
      const bounds = buildingBounds(b, true);
      expect(
        triangles(b, true)
          .filter(t => t.surface === 'yard')
          .every(t => t.points.every(p => p.every((v, i) => v >= bounds[i] - 0.001 && v <= bounds[i + 3] + 0.001))),
      ).toBe(true);
    }
  });
  it('keeps parcel ribbons at distance and changes the actual near mesh for each fence material', () => {
    for (const [material, fenceStyle] of [
      ['fence', 'plank'],
      ['fence', 'wattle'],
      ['wall', undefined],
      ['hedge', undefined],
    ] as const) {
      const yard: YardBoundary = { material, side: 'front', path: [path[0], path[1]], fenceStyle, culture: 'japanese-jokamachi' };
      const [b] = city3dLotEnclosures([yard], ground);
      const near = triangles(b, true),
        normal = triangles(b, false);
      expect(near.length).toBeGreaterThan(normal.length);
      expect(triangles(b, true, false, 2)).toEqual(triangles(b, false, false, 2));
      expect(near.every(t => t.ground?.length === 3 && t.points.every(p => p.every(Number.isFinite)))).toBe(true);
    }
  });
  it('opens up the individual stock rails of a farm paddock', () => {
    const f = { pos: path[0], culture: 'kraal', angle: 0, yard: [], drive: [], buildings: [], plots: [{ kind: 'paddock', poly: path }] } as unknown as Farmstead;
    const fences = city3dFarmBuildings(city3dFarmSources([f], undefined, ground), { heightAt: ground }) as PlacedBuilding[];
    const b = fences.find(f => !!boundaryOf(f))!;
    expect(boundaryOf(b)?.replace).toBe(true);
    expect(triangles(b, true).some(t => t.material?.includes('binding'))).toBe(true);
  });
});
