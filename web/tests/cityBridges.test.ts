import { describe, expect, it, vi } from 'vitest';
import type { Layout, Street } from '../../rust/bridge/urban';
import type { RoadOutput } from '../../rust/bridge/settlements';
import { outsideUrbanStreets } from '../../rust/bridge/urbanNetwork';
import { bridgeRoadOwnership, cityBridgeStreets, urbanReplacesCrossing } from '../src/render/cityBridges';
import { buildCityScene, drawCity } from '../src/render/cityCanvas';
import { buildFillMeshSync, buildStreetStrokes, META, packPlan, STROKE_STRIDE } from '../src/render/cityGlBuild';
import { DEFAULT_LAYERS, planColors } from '../src/render/cityGlStyle';
import { city3dBridges } from '../src/render/city3dMeshes';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';

const street = (path: [number, number][], width = 3, role = 'bridge'): Street => ({ path: path.map(([x, y]) => ({ x, y })), widths: path.map(() => width), rank: 4, role });
const layout = (streets: Street[]): Layout => ({ key: 'river', center: { x: 50, y: 0 }, culture: 'bastide', streets, quarters: [], blocks: [], enclosures: [], warnings: [] }) as unknown as Layout;

describe('bridge visibility and ownership', () => {
  it('keeps narrow minor bridges in the Canvas and GPU plan at every LOD', () => {
    class Path { moveTo() {} lineTo() {} closePath() {} addPath() {} }
    vi.stubGlobal('Path2D', Path);
    try {
      const scene = buildCityScene([layout([street([[0, 0], [100, 0]], 1.5), street([[0, 20], [100, 20]], 3), street([[0, 40], [100, 40]], 8)])]);
      const strokes = buildStreetStrokes(scene, { x: 0, y: 0 }), metadata = new Uint32Array(strokes.data), mesh = buildFillMeshSync(packPlan(scene));
      expect(strokes.count).toBe(3);
      for (let i = 0; i < 3; i++) expect(metadata[i * STROKE_STRIDE + 8] & META.crossing).toBe(META.crossing);
      for (const lod of ['far', 'mid', 'near', 'close'] as const) {
        const ctx = new Proxy({ stroke: vi.fn() }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined }) as unknown as CanvasRenderingContext2D;
        const stats = drawCity(ctx, scene, { viewport: { minX: -10, minY: -10, maxX: 110, maxY: 50 }, mpp: 1, dpr: 1, lod, palette: 'parchment', view: 'buildings', width: 1,
          layers: { ...DEFAULT_LAYERS, blocks: false, domains: false, enclosures: false, centers: false }, buildingsVisible: false, appearance: { style: 'cartographic', diagnostic: 'none' } });
        expect(stats.streets).toBe(3); expect(ctx.stroke).toHaveBeenCalled();
        const colors = planColors(scene, mesh, { lod, palette: 'parchment', view: 'buildings', layers: DEFAULT_LAYERS, buildingsVisible: false, diagnostic: 'none' });
        expect(colors.draws.streets).toBe(true); expect(colors.draws.streetCasing).toBe(true);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('retires the old oblique regional deck in both displays while retaining other channels', () => {
    const canonical = street([[0, 0], [100, 0]], 6), old = street([[0, -30], [100, 30]], 6), far = street([[500, -30], [600, 30]], 6);
    const city = layout([canonical]);
    expect(cityBridgeStreets([city], [old, canonical, far])).toEqual([canonical, far]);
    const roads = { segments: [{ width: 6, crossings: [{ kind: 'bridge', path: old.path }] }] } as unknown as RoadOutput;
    const masks = bridgeRoadOwnership([city], roads);
    expect(outsideUrbanStreets([old], masks)).toEqual([]);
    expect(city.streets).toEqual([canonical]);
    expect(urbanReplacesCrossing(street([[14, 0], [20, 0]]), [layout([street([[0, 0], [6, 0]])])])).toBe(false);
    const moved = layout([street([[30, 100], [130, 100]], 6), street([[0, -30], [30, 100]], 6, 'approach'), street([[100, 30], [130, 100]], 6, 'approach')]);
    expect(urbanReplacesCrossing(old, [moved])).toBe(true);
  });

  it('builds an elevated deck, two parapets and piers in one bridge batch', () => {
    const bridges = city3dBridges([street([[0, 0], [80, 0]], 6)], () => 0, () => 10);
    expect(bridges).toHaveLength(1);
    const b = bridges[0], deck = b.volumes.find(v => v.id.endsWith(':deck'))!;
    expect(deck.z_m + deck.wall_height_m).toBeGreaterThan(10);
    const rails = b.volumes.filter(v => v.id.includes(':parapet:'));
    expect(rails).toHaveLength(2); expect(b.volumes.some(v => v.id.includes(':pier:'))).toBe(true);
    expect(rails.every(v => v.z_m >= deck.z_m + deck.wall_height_m && v.wall_height_m >= 1)).toBe(true);
    let triangles = 0, top = -Infinity;
    eachBuildingTriangle(b, t => { triangles++; top = Math.max(top, ...t.points.map(p => p[2])); });
    expect(triangles).toBeGreaterThan(30); expect(top).toBeGreaterThan(deck.z_m + deck.wall_height_m + 1);
    const raised = city3dBridges([street([[0, 0], [80, 0]], 6, 'causeway')], x => x >= 79 ? 8 : 0);
    expect(raised[0].volumes.some(v => v.id.includes(':pier:'))).toBe(true);
  });
});
