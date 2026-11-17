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

type Point = { x: number; y: number };
type Shape = { outer: Point[]; holes: Point[][] };
/** The edge-by-edge footing rule (the loop long shapes used to run), for one shape. */
function reference(shape: Shape, footing: number, x: number, y: number, original: number): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of shape.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!(footing < original) || x < x0 - 8 || x > x1 + 8 || y < y0 - 8 || y > y1 + 8) return original;
  let inside = false, squared = Infinity;
  for (const ring of [shape.outer, ...shape.holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    squared = Math.min(squared, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
  }
  const d = inside ? 0 : Math.sqrt(squared);
  if (d >= 8) return original;
  const t = Math.max(0, (d - 2) / 6);
  return Math.min(original, footing + (original - footing) * t * t * (3 - 2 * t));
}
const ring = (cx: number, cy: number, radius: number, points: number, wobble: number): Point[] =>
  Array.from({ length: points }, (_, i) => { const a = i / points * Math.PI * 2, r = radius + wobble * Math.sin(a * 9); return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; });

describe('terrain footings under long shapes', () => {
  it('lowers the ground around a moat ring as the edge-by-edge rule does, bit for bit', () => {
    // A ditch round a town (long outer ring, the town as a hole) and a house: the ring is indexed, the house is not.
    const moat: Shape = { outer: ring(500, 400, 300, 700, 12), holes: [ring(500, 400, 270, 500, 10)] };
    const house: Shape = { outer: [{ x: 495, y: 395 }, { x: 507, y: 395 }, { x: 507, y: 404 }, { x: 495, y: 404 }], holes: [] };
    const scene = { buildings: [
      { id: 'moat', recipe_id: 'city3d-wall', footprint: [moat], ground_z_m: 3 },
      { id: 'house', recipe_id: 'silhouette', footprint: [house], ground_z_m: 9 },
    ] } as unknown as Building3dScene;
    const ground = new UrbanBuildingGround(scene);
    let lowered = 0, blended = 0;
    for (let y = 80; y <= 720; y += 3.7) for (let x = 180; x <= 820; x += 4.3) {
      const expected = Math.min(reference(moat, 3, x, y, 10), reference(house, 9, x, y, 10)), got = ground.constrain(x, y, 10);
      expect(got).toBe(expected);
      if (got < 10) lowered++;
      if (got > 3 && got < 9) blended++;
    }
    // Points on the vertices and the box edges of the ring.
    for (const p of [...moat.outer.slice(0, 40), ...moat.holes[0].slice(0, 40)]) for (const [dx, dy] of [[0, 0], [1.5, 0], [0, -6.5], [7.9, 0], [0, 8.1]])
      expect(ground.constrain(p.x + dx, p.y + dy, 10)).toBe(reference(moat, 3, p.x + dx, p.y + dy, 10));
    expect(ground.constrain(NaN, 400, 10)).toBe(10);   // no cell holds such a point
    expect(lowered).toBeGreaterThan(1000); expect(blended).toBeGreaterThan(200);
  });
});
