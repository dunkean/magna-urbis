import { describe, expect, it } from 'vitest';
import marketHall from '../../../contributions/models/market-hall.json';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { ROLE_MODEL_CATALOGUE_ISSUES, roleModelById, roleModelIssue } from '../../src/render/city3d/authoredModels';
import { city3dBuildingsSteps } from '../../src/render/city3d/display';
import { modelPreviewFixture, modelPreviewView } from '../../src/render/city3d/modelPreview';
import { city3dScene } from '../../src/render/city3d/scene';
import { silhouetteBuilding } from '../../src/render/city3d/silhouette';
import { building3dHeight, buildingRayDistance, eachBuildingTriangle, type BuildingTriangle, type OverviewVolume } from '../../src/render/urbanBuildingGeometry';

const MARKER = marketHall.materials.copper;

function triangles(building: PlacedBuilding, overview = false): BuildingTriangle[] {
  const output: BuildingTriangle[] = [];
  eachBuildingTriangle(building, triangle => output.push(triangle), overview);
  return output;
}

describe('contributed role models', () => {
  it('validates the metric fixture, constrains both LODs and reports invalid authoring inputs', () => {
    expect(ROLE_MODEL_CATALOGUE_ISSUES).toEqual([]);
    expect(roleModelIssue(marketHall)).toBeUndefined();
    expect(roleModelById(marketHall.id)).toBe(marketHall);
    expect(roleModelById('unknown')).toBeUndefined();
    const broken = structuredClone(marketHall);
    broken.near.vertices[0][0] = 99;
    expect(roleModelIssue(broken)).toContain('outside the footprint');
    broken.near.vertices[0][0] = marketHall.near.vertices[0][0];
    broken.near.triangles[0][3] = 'missing-material';
    expect(roleModelIssue(broken)).toContain('city3d material');
    broken.near.triangles[0][3] = marketHall.near.triangles[0][3];
    broken.near.triangles[0][2] = broken.near.triangles[0][0];
    expect(roleModelIssue(broken)).toContain('degenerate');
  });

  it('keeps one fixture for both displays and fits the opted-in silhouette without changing its source', () => {
    const fixture = modelPreviewFixture(marketHall.id),
      scene = fixture.scene,
      surface = fixture.decor.raster.height,
      [source, procedural] = scene.buildings;
    expect(modelPreviewFixture(marketHall.id)).toEqual(fixture);
    expect(surface.every(height => height === 40)).toBe(true);
    expect(modelPreviewView(fixture, true, 1200).scale).toBeLessThan(modelPreviewView(fixture, false, 1200).scale);

    const bench = city3dScene(scene);
    const steps = city3dBuildingsSteps(scene, {});
    let v2 = steps.next();
    while (!v2.done) v2 = steps.next();
    expect(v2.value).toEqual(bench);

    const [authored, baseline] = bench.buildings;
    const fitted = authored.volumes[0] as OverviewVolume;
    const original = silhouetteBuilding(source);
    expect(fitted.authoredExterior?.model).toBe(marketHall.id);
    expect(procedural.culture).toEqual(source.culture);
    expect(baseline).toEqual(silhouetteBuilding(procedural));
    expect(authored.id).toBe(source.id);
    expect(authored.footprint).toBe(source.footprint);
    expect(building3dHeight(authored)).toBe(building3dHeight(original));
    expect(fitted.levels).toEqual(original.volumes[0].levels);
    expect(fitted.foundation).toEqual(original.volumes[0].foundation);
    expect(source.volumes).toEqual([]);

    const near = triangles(authored),
      overview = triangles(authored, true);
    expect(near.some(triangle => triangle.material === MARKER)).toBe(true);
    expect(overview.some(triangle => triangle.material === MARKER)).toBe(false);
    expect(near.length - overview.length).toBe(marketHall.near.triangles.length - marketHall.overview.triangles.length);
    const x = authored.entrance.x,
      y = authored.footprint[0].outer[0].y + marketHall.footprintM[1] / 2;
    for (const lod of [near, overview]) {
      const hits = lod.flatMap(triangle => buildingRayDistance([x, y, 70], [0, 0, -1], triangle.points) ?? []);
      expect(Math.min(...hits)).toBeCloseTo(70 - authored.ground_z_m - marketHall.heightM);
    }
  });

  it('retains the shared fallback for a different culture, a courtyard or a size mismatch', () => {
    const { scene } = modelPreviewFixture(marketHall.id),
      source = scene.buildings[0],
      { outer } = source.footprint[0];
    const courtyards = [{ outer, holes: [outer.map(p => ({ x: (p.x + source.entrance.x) / 2, y: (p.y + source.entrance.y - 3) / 2 }))] }];
    const small = [{ holes: [], outer: outer.map(p => ({ x: (p.x + 3 * source.entrance.x) / 4, y: (p.y + 3 * source.entrance.y) / 4 })) }];
    const differentCulture = { ...source, culture: { ...source.culture, culture: 'bastide' } };
    expect(city3dScene({ ...scene, buildings: [differentCulture] }).buildings[0]).toEqual(silhouetteBuilding(differentCulture));
    for (const footprint of [courtyards, small]) {
      const changed = { ...source, footprint, roof_footprint: footprint };
      const display = city3dScene({ ...scene, buildings: [changed] }).buildings[0];
      expect(display).toEqual(silhouetteBuilding(changed));
    }
  });
});
