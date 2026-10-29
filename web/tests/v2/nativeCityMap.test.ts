import { afterEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/gen/types';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { CityDrawOptions, CityScene } from '../../src/render/cityCanvas';
import type { BuildingRenderMetrics } from '../../src/render/urbanBuildingLod';
import { createNativeCityMap } from '../../src/v2/nativeCityMap';

const draw = vi.hoisted(() => vi.fn());
const raster = vi.hoisted(() => vi.fn(() => undefined));
vi.mock('../../src/v2/rustUrban', () => ({ rustSettlementRaster: raster }));
vi.mock('../../src/render/cityCanvas', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/render/cityCanvas')>();
  return { ...original, drawCity: draw };
});
const ring = (x: number, y: number, width: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + width }, { x, y: y + width }];
function house(id: string, x: number): PlacedBuilding {
  const footprint = [{ outer: ring(x, 10, 12), holes: [ring(x + 3, 13, 3)] }];
  return { id, parcel_id: 'same-local-parcel', function: 'domestic', footprint, roof_footprint: footprint,
    entrance: { x, y: 10 }, ground_z_m: 0, volumes: [], cartographic: { height_m: 9, ridges: [], validation: 'plan_only' },
    transform: { origin: { x, y: 10 }, orientation_deg: 0 } } as unknown as PlacedBuilding;
}
function world(): World {
  const snapshot = (x: number, id: string) => ({ stage: 'buildings',
    layouts: [{ key: 'same-local-layout', quarters: [], blocks: [], streets: [], enclosures: [] }],
    partitions: [{ key: 'same-local-layout', parcels: [{ id: 'same-local-parcel', block: 0, use: 'plot', shape: { outer: ring(x, 10, 16), holes: [] } }] }],
    scene: { buildings: [house(id, x)], refusals: [{ parcel_id: 'same-local-parcel' }], open_spaces: [], materials: [] } });
  return { options: { labels: true }, debug: { v2RustCities: { a: snapshot(10, 'house-a'), b: snapshot(110, 'house-b') } } } as unknown as World;
}
class Context {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  globalAlpha = 1;
  transform: number[] = [1, 0, 0, 1, 0, 0];
  rings: { x: number; y: number }[][] = [];
  fills: { rings: { x: number; y: number }[][]; color: string }[] = [];
  images: { alpha: number; image: unknown }[] = [];
  transforms: number[][] = [];
  private stack: { alpha: number; transform: number[] }[] = [];
  save(): void { this.stack.push({ alpha: this.globalAlpha, transform: this.transform }); }
  restore(): void { const state = this.stack.pop()!; this.globalAlpha = state.alpha; this.transform = state.transform; }
  setTransform(...values: number[]): void { this.transform = values; this.transforms.push(values); }
  translate(): void {}
  beginPath(): void { this.rings = []; }
  moveTo(x: number, y: number): void { this.rings.push([{ x, y }]); }
  lineTo(x: number, y: number): void { this.rings.at(-1)!.push({ x, y }); }
  rect(x: number, y: number, width: number): void { this.rings.push(ring(x, y, width)); }
  closePath(): void {}
  clip(): void {}
  fill(): void { this.fills.push({ rings: this.rings, color: String(this.fillStyle) }); }
  stroke(): void {}
  clearRect(): void {}
  drawImage(image: unknown): void { this.images.push({ image, alpha: this.globalAlpha }); }
  asContext(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
}
function drawNative(ctx: CanvasRenderingContext2D, _scene: CityScene, options: CityDrawOptions) {
  const metrics = (options.view === 'buildings' && options.buildingsVisible ? options.renderer?.draw(ctx, { viewport: options.viewport,
    metresPerPixel: options.mpp, appearance: options.appearance }) : undefined) as BuildingRenderMetrics | undefined;
  return { lod: options.lod, buildings: metrics?.visibleBuildings ?? 0, blocks: 0, parcels: 0, streets: 0, ms: 0, pending: false };
}
afterEach(() => { vi.unstubAllGlobals(); draw.mockReset(); raster.mockClear(); });

describe('V2 retained native city map', () => {
  it('leaves legacy worlds to their original renderer without constructing a raster', () => {
    const map = createNativeCityMap({ options: {} } as World, vi.fn());
    const stats = map.draw(new Context().asContext(), { cx: 0, cy: 0, scale: 1 }, 100, 100, 1, { style: 'atlas' });
    expect(stats.native).toBe(false); expect(raster).not.toHaveBeenCalled(); expect(draw).not.toHaveBeenCalled();
    map.dispose();
  });

  it('keeps overlapping local archive ids separate and draws retained courtyard geometry without mutating it', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    draw.mockImplementation(drawNative);
    const source = world(), before = JSON.stringify(source), map = createNativeCityMap(source, vi.fn()), ctx = new Context();
    const stats = map.draw(ctx.asContext(), { cx: 70, cy: 20, scale: 10 }, 1600, 400, 2,
      { style: 'atlas', terrainStyle: 'render-v2', textured: false, city: { buildingStyle: 'cartographic', painted: true } });
    expect(stats.visibleBuildings).toBe(2); expect(stats.houses).toHaveLength(2);
    expect(draw.mock.calls.map(([, plan]) => plan.parcels[0].shape.outer[0].x)).toEqual([10, 110]);
    expect(ctx.fills.some(fill => fill.rings.length === 2 && fill.rings[0].some(point => point.x === 10))).toBe(true);
    expect(ctx.fills.some(fill => fill.rings.length === 2 && fill.rings[0].some(point => point.x === 110))).toBe(true);
    expect(ctx.fills.some(fill => fill.color.includes('rgba'))).toBe(true); // painted native height shadows
    expect(JSON.stringify(source)).toBe(before);
    map.dispose();
  });

  it('composites opacity once and restores a host context already scaled for DPR', () => {
    const surface = new Context();
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return surface.asContext(); }
    });
    draw.mockImplementation((ctx, plan, options) => {
      const stats = drawNative(ctx, plan, options);
      ctx.globalAlpha = 1; // shared painters can change alpha internally
      return stats;
    });
    const target = new Context(); target.globalAlpha = .5; target.setTransform(2, 0, 0, 2, 0, 0);
    const map = createNativeCityMap(world(), vi.fn());
    map.draw(target.asContext(), { cx: 70, cy: 20, scale: 10 }, 1600, 400, 2,
      { style: 'atlas', textured: false, city: { opacity: .25, plan: false, buildingStyle: 'silhouette' } });
    expect(target.images).toHaveLength(1); expect(target.images[0].alpha).toBe(.125);
    expect(target.globalAlpha).toBe(.5); expect(target.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(surface.transforms).toContainEqual([20, 0, 0, 20, 200, 0]);
    expect(draw.mock.calls[0][2].layers).toEqual(Object.fromEntries(Object.keys(draw.mock.calls[0][2].layers).map(key => [key, false])));
    map.dispose();
  });

  it('uses access evidence from each retained scene and suppresses late texture invalidation after disposal', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    draw.mockImplementation(drawNative);
    const invalidated = vi.fn(), map = createNativeCityMap(world(), invalidated);
    map.draw(new Context().asContext(), { cx: 70, cy: 20, scale: 1 }, 300, 200, 1,
      { style: 'parchment', textured: false, labels: false, city: { view: 'roles', palette: 'parchment', diagnostic: 'access', groundBlend: 'blended', layers: { axes: true } } });
    const options = draw.mock.calls[0][2];
    expect(options.refusedParcels.has('same-local-parcel')).toBe(true);
    expect(options.labels).toBe(false); expect(options.groundBlend).toBe(true); expect(options.layers.axes).toBe(true);
    options.onTexturesReady(); map.dispose(); await Promise.resolve();
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('exports urban streets independently from buildings and cadastral ground', () => {
    vi.stubGlobal('OffscreenCanvas', undefined); draw.mockImplementation(drawNative);
    const map = createNativeCityMap(world(), vi.fn()), ctx = new Context(), camera = { cx: 70, cy: 20, scale: 10 };
    const appearance = { style: 'atlas', textured: false } as const;
    const streets = map.draw(ctx.asContext(), camera, 1600, 400, 2, appearance, { city: false, streets: true, labels: false });
    const streetOptions = draw.mock.calls[0][2];
    expect(streetOptions.buildingsVisible).toBe(false); expect(streets.visibleBuildings).toBe(0);
    expect(streetOptions.layers.streets).toBe(true); expect(streetOptions.labels).toBe(false);
    expect(Object.entries(streetOptions.layers).filter(([key]) => key !== 'streets').every(([, shown]) => !shown)).toBe(true);
    draw.mockClear();
    const buildings = map.draw(ctx.asContext(), camera, 1600, 400, 2, appearance, { city: true, streets: false });
    const buildingOptions = draw.mock.calls[0][2];
    expect(buildingOptions.layers.streets).toBe(false); expect(buildingOptions.layers.parcels).toBe(true);
    expect(buildingOptions.buildingsVisible).toBe(true); expect(buildings.visibleBuildings).toBe(2);
    map.dispose();
  });
});
