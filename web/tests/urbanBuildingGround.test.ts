import { describe, expect, it } from 'vitest';
import { UrbanBuildingGround } from '../src/ui/urbanBuildingGround';
import { Terrain3d } from '../src/ui/terrain3d';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';

function ground(xs = [60], heights = [4]): UrbanBuildingGround {
  return new UrbanBuildingGround({ buildings: xs.map((x, i) => ({
    projection: 'native-building-visual-1',
    ground_constraints: [{ height_m: heights[i], footprint: [{ outer: [
      { x, y: 10 }, { x: x + 10, y: 10 }, { x: x + 10, y: 20 }, { x, y: 20 },
    ], holes: [] }] }],
  })) } as unknown as Building3dScene);
}

describe('3D terrain beside native foundations', () => {
  it('removes terrain cuts for hidden meshes and rebuilds them when visibility changes', () => {
    const scene = { buildings: [{ projection: 'native-building-visual-1', ground_constraints: [{
      height_m: 4, footprint: [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], holes: [] }],
    }] }] } as unknown as Building3dScene;
    const view = { buildingScene: undefined, buildingsVisible: true, buildingGround: new UrbanBuildingGround(),
      buildings: { setScene() {} }, clearPatches() {}, setForest() {}, request() {},
    };
    const set = (visible: boolean) => Terrain3d.prototype.setBuildings.call(view as unknown as Terrain3d, scene, { style: 'cartographic', diagnostic: 'none' }, visible);
    set(false); expect(view.buildingGround.constrain(5, 5, 12)).toBe(12);
    set(true); expect(view.buildingGround.constrain(5, 5, 12)).toBe(4);
    set(false); expect(view.buildingGround.constrain(5, 5, 12)).toBe(12);
  });

  it('keeps triangles crossing a facade below the footing instead of cutting a tooth into it', () => {
    const terrain = ground();
    // Both endpoints of a 2 m grid edge straddling the facade must be at the
    // footing. A cut limited to the polygon left the outside endpoint at 12 m.
    expect(terrain.constrain(59, 15, 12)).toBe(4);
    expect(terrain.constrain(61, 15, 12)).toBe(4);
    expect(terrain.constrain(59, 15, 2)).toBe(2);
  });

  it('joins the relief continuously, including across spatial index cells', () => {
    const terrain = ground([65]);
    expect(terrain.constrain(63, 15, 12)).toBe(4);
    expect(terrain.constrain(60, 15, 12)).toBe(8);
    expect(terrain.constrain(57, 15, 12)).toBe(12);
    for (const x of [57, 63, 65]) {
      expect(Math.abs(terrain.constrain(x + .001, 15, 12) - terrain.constrain(x - .001, 15, 12))).toBeLessThan(.001);
    }
  });

  it('combines neighbouring collars independently of building order', () => {
    const a = ground([60, 76], [4, 7]), b = ground([76, 60], [7, 4]);
    for (let x = 50; x < 95; x += .5) expect(a.constrain(x, 15, 12)).toBe(b.constrain(x, 15, 12));
  });
});
