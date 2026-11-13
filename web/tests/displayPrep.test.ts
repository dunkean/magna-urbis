import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerrainData } from '../../rust/bridge/terrain';
import type { ForestOccupation } from '../../rust/bridge/terrainForest';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import type { World } from '../src/gen/types';
import { shoreRingFor, shoreRingGrid, retainShoreRing } from '../../rust/bridge/terrainForestBeach';
import { lakeDistances, seaDistanceSurface, planningWaterDistances } from '../src/render/terrainWater';
import { withBuildingOccupation, occupationMergeSlot } from '../src/ui/forestOccupation';
import { withBuildingOccupationAsync } from '../src/v2/displayForest';
import { floatPyramid } from '../src/render/floatPyramid';
import { heightPyramid } from '../src/ui/terrainSurface';
import { DISPLAY_PRODUCT_VERSION } from '../src/render/displayProduct';
import { retainTerrainDisplayPreparation } from '../src/v2/displayPrep';
import { cityContourPaths, cityContoursPending, cityFineContours, cityFineContourBlocks, type ContourWorkerRequest, type ContourWorkerResponse } from '../src/render/cityContours';
import './vectorWaterWasm';
import { loadRenderGeometry } from '../../rust/bridge/renderGeometry';

const surface = (n = 8, width = 128) => ({ x: 0, y: 0, width, n, data: Float32Array.from({ length: n * n }, (_, i) => i % n - n / 2) });
const sourceOccupation = (): ForestOccupation => ({ x: 0, y: 0, width: 16, n: 8, rgba: new Uint8Array(8 * 8 * 4), key: 'base' });
const scene = (): Building3dScene => ({ buildings: [{ projection: 'native-building-visual-1', occupation_surfaces: [[{ outer: [{ x: 3, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 9 }, { x: 3, y: 9 }], holes: [] }]] }] } as unknown as Building3dScene);
afterEach(() => vi.unstubAllGlobals());

describe('retained display preparation revisions', () => {
  it('shares one shore ring across renderer wrappers and invalidates the frame and samples', () => {
    const layer = surface(), grid = shoreRingFor(layer);
    expect(shoreRingFor({ ...layer })).toBe(grid);
    expect(shoreRingFor({ ...layer, x: 7 })).not.toBe(grid);
    expect(shoreRingFor({ ...layer, data: layer.data.slice() })).not.toBe(grid);
    expect(grid.data).toEqual(shoreRingGrid(layer, grid.n).data);
    const other = surface(); retainShoreRing(other, grid);
    expect(shoreRingFor(other)).toBe(grid);
  });
  it('hydrates cloned engine products only for their source revision', async () => {
    await loadRenderGeometry();
    const layer = surface(), lake = Float32Array.from(layer.data, v => -v);
    const distances = lakeDistances(lake, layer.n, layer.width), shore = shoreRingGrid(layer, 128);
    const water = new Uint8Array(layer.n * layer.n);
    const original = { mapSize: layer.width, terrain: { water, height: { w: layer.n, data: layer.data },
      v2NativeTerrain: { height: layer.data, resolution: layer.n, x: 0, y: 0, width: layer.width, water: { lakeField: { values: lake }, hydro: { n: layer.n } } },
      v2DisplayPreparation: { version: DISPLAY_PRODUCT_VERSION, input: { layer, planning: { water, n: layer.n, width: layer.width }, lakes: [{ field: lake, n: layer.n, width: layer.width, referenceWidth: layer.width }] }, result: { shore, lakes: [distances], planning: planningWaterDistances(water, layer.n, layer.width), heightMips: floatPyramid(layer.data, layer.n).slice(1), lakeMips: [{ field: floatPyramid(lake, layer.n).slice(1), distance: floatPyramid(distances, layer.n).slice(1) }], timings: [] } } } };
    const world = structuredClone(original) as unknown as World;
    retainTerrainDisplayPreparation(world);
    const t = world.terrain as unknown as typeof original.terrain;
    expect(shoreRingFor({ ...layer, data: t.v2NativeTerrain.height })).toBe(t.v2DisplayPreparation.result.shore);
    expect(lakeDistances(t.v2NativeTerrain.water.lakeField.values, layer.n, layer.width)).toBe(t.v2DisplayPreparation.result.lakes[0]);
    expect(planningWaterDistances(t.water, layer.n, layer.width)).toBe(t.v2DisplayPreparation.result.planning);
    expect(heightPyramid(t.v2NativeTerrain.height, layer.n)[1]).toBe(t.v2DisplayPreparation.result.heightMips[0]);
    const edited = structuredClone(original);
    edited.terrain.v2NativeTerrain.height = edited.terrain.v2NativeTerrain.height.slice();
    retainTerrainDisplayPreparation(edited as unknown as World);
    expect(shoreRingFor({ ...layer, data: edited.terrain.v2NativeTerrain.height })).not.toBe(edited.terrain.v2DisplayPreparation.result.shore);
  });
  it('retains separate sea resolutions/origins instead of replacing the last surface', async () => {
    await loadRenderGeometry();
    const layer = surface(), terrain = { height: layer.data, resolution: layer.n, width: layer.width, x: 0, y: 0 };
    const first = seaDistanceSurface(terrain);
    const crop = seaDistanceSurface({ ...terrain, x: 16 });
    expect(crop).not.toBe(first);
    expect(seaDistanceSurface({ ...terrain })).toBe(first);
    expect(seaDistanceSurface({ ...terrain, resolution: 4 })).not.toBe(first);
  });
  it('reuses async footprint merges from sync consumers and presentation wrappers', async () => {
    const base = sourceOccupation(), buildings = scene(), merged = await withBuildingOccupationAsync(base, buildings);
    expect(withBuildingOccupation({ ...base }, { buildings: [...buildings.buildings] })).toBe(merged);
    expect(await withBuildingOccupationAsync(base, { ...buildings })).toBe(merged);
    expect(occupationMergeSlot(base, buildings).value).toBe(merged);
    expect(withBuildingOccupation({ ...base, rgba: base.rgba.slice() }, buildings)).not.toBe(merged);
    const projected = { buildings: buildings.buildings.map(b => ({ ...b })) } as Building3dScene;
    expect(withBuildingOccupation(base, projected)).toBe(merged);
    const detail = { x: 0, y: 0, width: 16, n: 8, rgba: new Uint8Array(256), key: 'detail' };
    const withDetail = withBuildingOccupation({ ...base, detail }, buildings)!;
    expect(withDetail.rgba).toBe(merged!.rgba); expect(withDetail.detail).toBe(detail);
    expect(base.rgba.every(v => v === 0)).toBe(true);
  });
});

describe('requested contour worker coverage', () => {
  it('queues cold normal/fine levels, draws the previous level, and publishes exact typed paths', async () => {
    await loadRenderGeometry();
    const requests: ContourWorkerRequest[] = [];
    let receiver: FakeWorker | undefined;
    class FakeWorker {
      onmessage?: (message: { data: ContourWorkerResponse }) => void;
      constructor() { receiver = this; }
      postMessage(request: ContourWorkerRequest): void { requests.push(request); }
      terminate(): void {}
    }
    const n = 64, terrain = { height: Float32Array.from({ length: n * n }, (_, i) => i % n / 100), width: n * 10, resolution: n, caveMask: new Uint8Array() } as TerrainData;
    const exact = cityContourPaths(terrain, 'flat', 1);
    const workerTerrain = { ...terrain, height: terrain.height.slice() };
    const expectedBlocks = cityFineContourBlocks(workerTerrain, 'flat', 1, { minX: 0, minY: 0, maxX: 300, maxY: 300 });
    vi.stubGlobal('document', {}); vi.stubGlobal('Worker', FakeWorker);
    const ready = vi.fn(), cold = cityContourPaths(terrain, 'flat', .05, false, ready);
    expect(cold.thin).toBe(''); expect(cityContoursPending(terrain)).toBe(1);
    expect(requests).toHaveLength(1); expect(requests[0].topographic).toBe(false);
    const encoder = new TextEncoder();
    receiver!.onmessage!({ data: { id: requests[0].id, paths: { step: 8, thin: encoder.encode('M1.00,2.00L3.00,4.00'), index: encoder.encode('') } } });
    expect(ready).toHaveBeenCalledOnce(); expect(cityContoursPending(terrain)).toBe(0);
    expect(cityContourPaths(terrain, 'flat', .01, false, ready).thin).toBe('M1.00,2.00L3.00,4.00');
    const view = { minX: 0, minY: 0, maxX: 300, maxY: 300 };
    // Waiting callers (onReady) get the worker; the live overlay without a callback stays synchronous.
    expect(cityFineContours(terrain, 'flat', 1, view, ready)).toBeUndefined();
    const fineRequest = requests.find(request => request.fine)!;
    expect(fineRequest).toBeDefined();
    cityContourPaths(terrain, 'flat', 1, false, ready); // registers the fine repaint callback even on a retained normal band
    receiver!.onmessage!({ data: { id: fineRequest.id, blocks: expectedBlocks.map(({ key, block }) => ({ key, thin: encoder.encode(block.thin), index: encoder.encode(block.index) })) } });
    expect(cityFineContours(terrain, 'flat', 1, view)?.blocks).toEqual(expectedBlocks.map(p => p.block));
    expect(cityContourPaths(terrain, 'flat', 1)).toBe(exact);
  });
});
