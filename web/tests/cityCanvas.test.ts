import { describe, expect, it, vi } from 'vitest';
import type { Layout, Partition, Point, Shape } from '../../rust/bridge/urban';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { buildCityBuildings, buildCityScene, districtRoleLabel, drawCity, pickCity, roleFamily, selectCityLod, type CityDrawOptions, type CityLayers } from '../src/render/cityCanvas';
import { cityGlOverlayLayers } from '../src/render/cityGl';
import { mockCanvas, MockPath2D } from '../scripts/fakeworld';

const square = (x: number, y: number, size: number): Shape => ({ outer: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }], holes: [] });
/** A 20 x 20 grid of 40 m blocks, each cut into four parcels; districts carry the stream B roles. */
function city(): { layout: Layout; partition: Partition } {
  const blocks = [], parcels = [], allocations = [];
  for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) {
    const b = blocks.length;
    blocks.push({ shape: square(i * 50, j * 50, 40), quarter: i < 10 ? 0 : 1, kind: 'block', axis: { x: 1, y: 0 }, zone: 'core', phase: 0 });
    for (let k = 0; k < 4; k++) {
      const id = `p${b}-${k}`;
      parcels.push({ id, shape: square(i * 50 + (k % 2) * 20, j * 50 + Math.floor(k / 2) * 20, 20), block: b, use: 'plot' as const, front: null, axis: { x: 1, y: 0 }, rank: 0 });
      allocations.push({ parcelId: id, demandId: 'd', function: 'domestic', culture: 'x', architecturePack: 'x', capacity: 1, unit: 'domesticUnits' as const, score: 1, reasons: [],
        ...(b === 0 && k === 0 ? { role: 'worship.parish', landmark: true, households: 0 } : { role: 'dwelling.row', households: 2 }) });
    }
  }
  const district = (id: number, role: string, wealth: number) => ({ id, center: 0, phase: 0, tissue: 'organic', quarters: [id], role, wealth });
  const layout = { key: 'c', culture: 'x', center: { x: 500, y: 500 }, quarters: [{ shape: square(0, 0, 500), phase: 0 }, { shape: square(500, 0, 500), phase: 0 }],
    streets: [{ path: [{ x: 45, y: 0 }, { x: 45, y: 1000 }], widths: [5, 5], rank: 1, role: 'street' }], blocks, warnings: [],
    enclosures: [{ path: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], kind: 'wall', gates: [{ x: 500, y: 0 }], towers: [{ x: 0, y: 0 }] }],
    structure: { version: 1, mechanism: 'auto', family: 'compact', reserve: [], allocated: [square(0, 0, 1000)], centers: [{ id: 0, point: { x: 500, y: 500 }, weight: 1 }],
      districts: [district(0, 'religious', 0.8), district(1, 'poor', 0.1)], history: [],
      metrics: { targetArea: 0, allocatedArea: 0, streetArea: 0, reservedArea: 0, grossDensity: 0, plannedPopulation: 0, shortfallArea: 0, components: 1, accessAdded: 0 } },
  } as unknown as Layout;
  const partition = { key: 'c', parcels, warnings: [], programme: { allocations } } as unknown as Partition;
  return { layout, partition };
}

describe('City Bench canvas scene', () => {
  it('hides names, glyphs and centre pins at every LOD in canvas and GL overlays without hiding geometry', () => {
    const { layout, partition } = city(), scene = buildCityScene([layout], [partition]);
    const layers: CityLayers = { reserve: false, allocated: false, centers: true, domains: false, quarters: false, blocks: true, streets: true, enclosures: false, parcels: true, gardens: false, places: false, fronts: false, axes: false, access: false };
    class CityPath extends MockPath2D { addPath(path: MockPath2D): void { this.ops += path.ops; } }
    vi.stubGlobal('Path2D', CityPath);
    try {
      for (const overlay of [false, true]) for (const lod of ['far', 'mid', 'near', 'close'] as const) {
        const { canvas, log, reset } = mockCanvas(1000, 1000), ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const options: CityDrawOptions = { viewport: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, mpp: 1, dpr: 1, lod, view: 'roles', palette: 'atlas', width: 1,
          layers: overlay ? cityGlOverlayLayers(layers) : layers, buildingsVisible: false, appearance: { style: 'cartographic', diagnostic: 'none' } };
        const shown = drawCity(ctx, scene, options);
        if (lod !== 'far') { expect(log.calls.fillText).toBeGreaterThan(0); expect(log.calls.arc).toBeGreaterThan(0); }
        reset();
        const hidden = drawCity(ctx, scene, { ...options, labels: false });
        expect(log.calls.fillText ?? 0).toBe(0); expect(log.calls.strokeText ?? 0).toBe(0); expect(log.calls.arc ?? 0).toBe(0);
        expect(hidden.blocks).toBe(shown.blocks); expect(hidden.parcels).toBe(shown.parcels); expect(hidden.streets).toBe(shown.streets);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('indexes the plan once, culls by viewport, picks by bins and reads optional role contracts', () => {
    const { layout, partition } = city();
    const scene = buildCityScene([layout], [partition]);
    expect(scene.parcels).toHaveLength(1600);
    // Viewport culling: a 100 m window sees a handful of blocks, never the whole city.
    const visible = scene.bins.blocks.query({ minX: 0, minY: 0, maxX: 99, maxY: 99 });
    expect(visible).toEqual([0, 1, 20, 21]);
    // Districts and allocations keep the optional stream B fields.
    expect(scene.blocks[0].district?.role).toBe('religious');
    expect(scene.blocks[15].district).toMatchObject({ role: 'poor', wealth: 0.1 });
    expect(scene.landmarks).toHaveLength(1);
    expect(scene.landmarks[0]).toMatchObject({ family: 'worship', label: 'Église' });
    // Wall: broken at the gate, with two gate towers and the contract tower.
    expect(scene.walls[0].pieces.length).toBeGreaterThan(1);
    expect(scene.walls[0].gateTowers).toHaveLength(2);
    expect(scene.walls[0].towers).toEqual([{ x: 0, y: 0 }]);
    // Silhouettes: building picked before its parcel, both through the bins.
    const at = (p: Point): Point => p;
    const batch = { schema_version: '1', generator_version: 'silhouette', refusals: [], open_spaces: [], buildings: [
      { id: 'b0', parcel_id: 'p0-0', function: 'collective', footprint: [square(2, 2, 10)], roof_footprint: [square(2, 2, 10)], diagnostics: [] },
    ] } as unknown as PlacementBatch;
    const buildings = buildCityBuildings(batch, scene);
    expect(buildings.items[0]).toMatchObject({ family: 'worship', landmark: true });
    const hit = pickCity(scene, buildings, at({ x: 5, y: 5 }));
    expect(hit.building?.id).toBe('b0');
    expect(hit.parcel?.id).toBe('p0-0');
    expect(pickCity(scene, buildings, at({ x: 15, y: 15 })).building).toBeUndefined();
    expect(pickCity(scene, buildings, at({ x: 45, y: 45 })).parcel).toBeUndefined();
  });

  it('chooses the level of detail with hysteresis and maps roles to families', () => {
    expect(['close', 'near', 'mid', 'far'].map((_, i) => selectCityLod([0.3, 1, 5, 20][i]))).toEqual(['close', 'near', 'mid', 'far']);
    // Just past the near/mid limit (2.2 m/px) the previous level is kept.
    expect(selectCityLod(2.4, 'near')).toBe('near');
    expect(selectCityLod(2.0, 'mid')).toBe('mid');
    expect(selectCityLod(3, 'near')).toBe('mid');
    expect(roleFamily('commerce.inn')).toBe('commerce');
    expect(roleFamily('religious.temple')).toBe('worship');
    expect(roleFamily(undefined, 'workshop')).toBe('craft');
    expect(districtRoleLabel('craft:tanners')).toBe('Artisanat · tanneurs');
  });
});
