import { expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { city3dProjectionScene, projectionDetailMatches, surfaceArea } from '../src/render/city3dMeshes';
import { building3dHeight, buildingRayDistance, eachBuildingTriangle, type BuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { projectNativeBuildingRecords } from '../src/ui/urbanBuildingProjection';
import { UrbanBuildingGround } from '../src/ui/urbanBuildingGround';
import { withBuildingOccupation } from '../src/ui/forestOccupation';

const chunks = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch);
const buildings = chunks.flatMap(chunk => chunk.buildings);

it('keeps all six real C accepted-plan projections typed, with exact roofs, heights and no guessed native record', () => {
  const source = projectNativeBuildingRecords(buildings), display = city3dProjectionScene(source);
  expect(display.kinds).toEqual({ silhouette: 0, compact: 6, detailed: 0 });
  for (let i = 0; i < buildings.length; i++) {
    const b = display.buildings[i], dto = source.buildings[i];
    expect(b).toBe(dto); expect(b.footprint).toBe(buildings[i].footprint); expect(b.roof_footprint).toBe(buildings[i].roof_footprint);
    expect('volumes' in b).toBe(false); expect('resolved' in b).toBe(false); expect('transform' in b).toBe(false);
    expect(building3dHeight(b)).toBe(dto.height_m);
    for (const overview of [false, true]) {
      const faces: BuildingTriangle[] = []; eachBuildingTriangle(b, t => faces.push(t), overview);
      const roof = faces.filter(t => t.surface === 'roof'); expect(roof.length).toBeGreaterThan(0);
      const area = roof.reduce((sum, t) => { const [a,c,d] = t.points;
        return sum + Math.abs((c[0]-a[0])*(d[1]-a[1])-(c[1]-a[1])*(d[0]-a[0])) / 2; }, 0);
      expect(area).toBeCloseTo(surfaceArea(dto.roof_footprint), 5);
      expect(roof.every(t => t.points.every(p => p[2] === dto.ground_z_m + dto.height_m))).toBe(true);
      expect(faces.every(t => t.points.every(p => p[2] >= dto.ground_z_m))).toBe(true);
    }
  }
  // Same ID from a re-parsed index is not permission to attach an old exterior.
  const refreshed = projectNativeBuildingRecords([structuredClone(buildings[0])]);
  expect(projectionDetailMatches(refreshed.buildings[0], buildings[0])).toBe(false);
  expect(city3dProjectionScene(refreshed, { details: new Map([[buildings[0].id, buildings[0]]]) }).buildings[0]).toBe(refreshed.buildings[0]);
});

it('keeps terrain ground and forest occupation identical for real C circulation and structural surfaces', () => {
  const b = buildings[1]; expect(b.circulation.length).toBeGreaterThan(0); expect(b.structural_features.length).toBeGreaterThan(0);
  const native = { buildings: [b] }, projection = projectNativeBuildingRecords([b]);
  const before = new UrbanBuildingGround(native), after = new UrbanBuildingGround(projection);
  for (const shape of [...b.footprint, ...b.circulation]) for (const p of shape.outer) {
    for (const dx of [-.1,0,.1]) expect(after.constrain(p.x+dx,p.y,b.ground_z_m+50)).toBe(before.constrain(p.x+dx,p.y,b.ground_z_m+50));
  }
  const originalOccupation = withBuildingOccupation(undefined,native), projectedOccupation = withBuildingOccupation(undefined,projection);
  expect(projectedOccupation).toEqual(originalOccupation);
  expect(projection.buildings[0].occupation_surfaces[2]).toBe(b.structural_features[0].surface);
  // Visual cache overlays do not replace the accepted ground/occupation input
  // during a later full display rebuild (e.g. material-color change).
  const display=city3dProjectionScene(projection);display.buildings=[];
  expect(withBuildingOccupation(undefined,display)).toEqual(originalOccupation);
  const restoredGround=new UrbanBuildingGround(display), p=b.footprint[0].outer[0];
  expect(restoredGround.constrain(p.x,p.y,b.ground_z_m+50)).toBe(before.constrain(p.x,p.y,b.ground_z_m+50));
});

it('preserves a projection courtyard in the cap and shared ray geometry', () => {
  const outer = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], hole = [{x:3,y:3},{x:7,y:3},{x:7,y:7},{x:3,y:7}];
  const surface = [{outer,holes:[hole]}], base = projectNativeBuildingRecords([buildings[0]]).buildings[0];
  const dto = {...base,footprint:surface,roof_footprint:surface};
  const faces: BuildingTriangle[]=[]; eachBuildingTriangle(dto,t=>faces.push(t));
  const z = dto.ground_z_m + dto.height_m + 10;
  expect(faces.every(t=>buildingRayDistance([5,5,z],[0,0,-1],t.points)===null)).toBe(true);
  expect(faces.some(t=>buildingRayDistance([1,1,z],[0,0,-1],t.points)!==null)).toBe(true);
});
