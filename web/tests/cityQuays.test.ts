import { describe, expect, it } from 'vitest';
import type { Layout, Quay, Shape } from '../../rust/bridge/urban';
import { buildCityScene } from '../src/render/cityCanvas';
import { packPlan, buildFillMeshSync, meshFeatureAt } from '../src/render/cityGlBuild';
import { DEFAULT_LAYERS, planColors } from '../src/render/cityGlStyle';
import { normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';
import { city3dQuays } from '../src/render/city3dQuays';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';

const rectangle = (x: number, y: number, w: number, h: number): Shape => ({ outer: [{ x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }], holes: [] });
const quay: Quay = { kind: 'quay', material: 'stone', deck_z_m: 3, shape: { ...rectangle(0, 0, 100, 12), holes: [rectangle(40, 3, 10, 6).outer.reverse()] } };
const pier: Quay = { kind: 'pier', material: 'timber', deck_z_m: 3, shape: rectangle(20, -35, 5, 40) };
const layout = { key: 'port', culture: 'swahili-stone-town', quarters: [], blocks: [], streets: [], warnings: [], structure: { quays: [quay, pier], districts: [] } } as unknown as Layout;

describe('retained harbour geometry', () => {
  it('retains the placement flag separately for each town in a batch', () => {
    const config = normalizeLayoutConfig({ siteArchetypes: { coast: 'harbor', river: 'bridge' } });
    expect(config.siteArchetypes).toEqual({ coast: 'harbor', river: 'bridge' });
  });
  it('packs and colours the platforms at every zoom, preserving water holes', () => {
    const scene = buildCityScene([layout]), mesh = buildFillMeshSync(packPlan(scene));
    expect(scene.extent.minY).toBe(-35);
    expect(mesh.layers.quays.triangles.count).toBeGreaterThan(0);
    expect(meshFeatureAt(mesh, 'quays', { x: 22, y: -20 })).toBeDefined();
    expect(meshFeatureAt(mesh, 'quays', { x: 45, y: 5 })).toBeUndefined();
    for (const lod of ['far', 'mid', 'near', 'close'] as const) {
      const colors = planColors(scene, mesh, { lod, palette: 'parchment', view: 'buildings', layers: DEFAULT_LAYERS, buildingsVisible: false, diagnostic: 'none' });
      const first = mesh.layers.quays.features[0] * 4;
      expect(colors.fill[first + 3]).toBe(255); expect(colors.line[first + 3]).toBe(255);
    }
  });
  it('renders slabs above water and pier posts, without roofing over holes', () => {
    const buildings = city3dQuays([layout]);
    expect(buildings).toHaveLength(2);
    expect(buildings[1].volumes.length).toBeGreaterThan(1);
    let topArea = 0, maxZ = -Infinity;
    eachBuildingTriangle(buildings[0], triangle => {
      maxZ = Math.max(maxZ, ...triangle.points.map(p => p[2]));
      if (triangle.surface !== 'roof') return;
      const [a, b, c] = triangle.points;
      topArea += Math.abs((b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])) / 2;
    });
    expect(maxZ).toBeCloseTo(3); expect(topArea).toBeCloseTo(1140);
  });
});
