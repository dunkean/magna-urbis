import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LandUseLayer, World } from '../src/gen/types';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import { packOccupationLanduse, unpackOccupationLanduse } from '../src/ui/occupationLanduse';
import { OccupationPreparation } from '../src/ui/occupationPreparation';
import { OccupationQueue } from '../src/ui/occupationQueue';
import { floatPyramid, retainFloatPyramid } from '../src/render/floatPyramid';
import { heightPyramid } from '../src/ui/terrainSurface';
import { planningWaterDistances, retainPlanningWaterDistances, lakeDistances, lakeDistancePyramid } from '../src/render/terrainWater';
import { forestOccupation, packOccupationShapes, withOccupationShapes } from '../src/ui/forestOccupation';
import { landDetail } from '../src/ui/landDetail';
import { registerDisplayLanduse, type DisplayPrepRequest } from '../src/v2/displayPrep';
import { v2ForestOccupationParts, withBuildingOccupationAsync } from '../src/v2/displayForest';
import './vectorWaterWasm';
import { loadRenderGeometry } from '../../rust/bridge/renderGeometry';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const ring = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 24 }, { x: 0, y: 24 }];
const layer = (): LandUseLayer => ({ areas: [{ kind: 'field', poly: ring, holes: [], strips: [ring], stripAngle: .125 }], reserve: [], farmsteads: [], ways: [[{ x: -0, y: 4 }, { x: 24, y: 4 }]] });
const packedShapes = () => packOccupationShapes([{ outer: ring.map(p => ({ x: p.x + 5, y: p.y + 5 })), holes: [] }]);

describe('worker-retained occupation inputs', () => {
  it('packs every coordinate list, including a single large polygon, with exact Float64 coordinates', () => {
    const landuse = layer();
    landuse.areas[0].poly = Array.from({ length: 20000 }, (_, i) => ({ x: Math.sin(i) * 1e4, y: i / 7 }));
    landuse.forestCorridors = [{ path: ring, half: [1, 2, 3, 4] }];
    const before = structuredClone(landuse), packed = packOccupationLanduse(landuse);
    expect(packed.coordinates.length).toBeGreaterThan(40000);
    expect(JSON.stringify(packed.tree).length).toBeLessThan(1000);
    const transferred = structuredClone(packed, { transfer: [packed.lengths.buffer, packed.coordinates.buffer] });
    expect(unpackOccupationLanduse(transferred)).toEqual(before);
    expect(landuse).toEqual(before); expect(packed.coordinates.byteLength).toBe(0);
    expect(Object.is(unpackOccupationLanduse(transferred).ways![0][0].x, -0)).toBe(true);
  });
  it('keeps source rasters after transferring replies, and merges by revision without a returned base plane', () => {
    const landuse = layer(), worker = new OccupationPreparation();
    worker.register(10, packOccupationLanduse(landuse));
    const occupation = worker.occupation(10, 20, [])!;
    expect(occupation).toEqual(forestOccupation(landuse));
    const original = structuredClone(occupation);
    structuredClone(occupation, { transfer: [occupation.rgba.buffer] });
    expect(occupation.rgba.byteLength).toBe(0);
    const shapes = packedShapes();
    expect(worker.merge(shapes, undefined, { landuseRevision: 10, revision: 20 })).toEqual(withOccupationShapes(original, [{ outer: ring.map(p => ({ x: p.x + 5, y: p.y + 5 })), holes: [] }]));
    const detail = worker.detail(10)!;
    expect(detail).toEqual(landDetail(landuse));
    structuredClone(detail, { transfer: [detail.rgba.buffer] });
    expect(worker.detail(10)).toEqual(landDetail(landuse));
    expect(worker.occupation(10, 20, [])).toEqual(original);
    worker.release(10); expect(() => worker.detail(10)).toThrow(/not registered/);
  });
  it('allows the dependent merge to arrive before optional detail', async () => {
    vi.useFakeTimers();
    const queue = new OccupationQueue(), order: string[] = [];
    queue.enqueue('occupation', async () => { order.push('occupation'); });
    queue.enqueue('detail', async () => { order.push('detail'); });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['occupation']);
    queue.enqueue('merge', async () => { order.push('merge'); });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['occupation', 'merge']);
    await vi.advanceTimersByTimeAsync(16);
    expect(order).toEqual(['occupation', 'merge', 'detail']);
  });
  it('registers once across presentations and uses reference-only occupation/detail/merge requests', async () => {
    const requests: DisplayPrepRequest[] = [], processor = new OccupationPreparation(), queue = new OccupationQueue();
    class FakeWorker {
      onmessage?: (event: { data: { id: number; result: unknown; ms: number } }) => void;
      postMessage(request: DisplayPrepRequest, transfer: Transferable[] = []): void {
        const data = structuredClone(request, { transfer }); requests.push(data);
        queue.enqueue(data.kind, async () => {
          let result: unknown;
          switch (data.kind) {
            case 'register': processor.register(data.input.revision, data.input.packed); break;
            case 'occupation': result = processor.occupation(data.input.landuseRevision, data.input.revision, data.input.corridors); break;
            case 'detail': result = processor.detail(data.input.landuseRevision); break;
            case 'merge': result = processor.merge(data.input.shapes, data.input.source, data.input.retained); break;
            case 'release': processor.release(data.input.revision); break;
            default: throw new Error('Unexpected job');
          }
          this.onmessage?.({ data: { id: data.id, result, ms: 0 } });
        });
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('document', {});
    const landuse = layer(), world = { landuse, terrain: {}, roads: [] } as unknown as World;
    const parts = v2ForestOccupationParts(world);
    const buildings = { buildings: [{ projection: 'native-building-visual-1', occupation_surfaces: [[{ outer: ring, holes: [] }]] }] } as unknown as Building3dScene;
    const merge = parts.occupation.then(base => withBuildingOccupationAsync(base, buildings));
    await Promise.all([merge, parts.detail]);
    expect(v2ForestOccupationParts({ ...world }).occupation).toBe(parts.occupation);
    await registerDisplayLanduse(landuse).ready;
    expect(requests.map(r => r.kind)).toEqual(['register', 'occupation', 'merge', 'detail']);
    const mergeRequest = requests.find(r => r.kind === 'merge')!;
    expect(mergeRequest.kind === 'merge' && mergeRequest.input.source).toBeUndefined();
    expect(mergeRequest.kind === 'merge' && mergeRequest.input.retained).toBeTruthy();
    expect(requests.filter(r => r.kind === 'register')).toHaveLength(1);
    expect(landuse.areas[0].poly).toEqual(ring);
  });
});

describe('shared float mips and planning water revisions', () => {
  it('retains the original box filter, shares height getters, and keys size/channel parameters', () => {
    const data = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i) * 1e7);
    const expected = [data]; let n = 8;
    while (n > 1 && n % 2 === 0) {
      const from = expected[expected.length - 1], half = n / 2, to = new Float32Array(half * half);
      for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) { const i = y * 2 * n + x * 2; to[y * half + x] = (from[i] + from[i + 1] + from[i + n] + from[i + n + 1]) * .25; }
      expected.push(to); n = half;
    }
    expect(heightPyramid(data, 8)).toEqual(expected);
    expect(heightPyramid(data, 8)).toBe(floatPyramid(data, 8));
    expect(floatPyramid(data, 4)).not.toBe(floatPyramid(data, 8));
    expect(floatPyramid(data, 4, 2)).not.toBe(floatPyramid(data, 4));
    expect(floatPyramid(new Float32Array(9), 3)).toHaveLength(1);
    const fresh = data.slice(), descendants = expected.slice(1).map(a => a.slice());
    retainFloatPyramid(fresh, 8, descendants);
    expect(heightPyramid(fresh, 8)[0]).toBe(fresh); expect(heightPyramid(fresh, 8)[1]).toBe(descendants[0]);
    retainFloatPyramid(fresh, 8, expected.slice(1)); expect(heightPyramid(fresh, 8)[1]).toBe(descendants[0]);
  });
  it('publishes planning water by sample identity and retains lake distance mips', async () => {
    await loadRenderGeometry();
    const n = 8, water = Uint8Array.from({ length: 64 }, (_, i) => i % n < 4 ? 1 : 0), width = 128;
    const values = planningWaterDistances(water, n, width), fresh = water.slice();
    retainPlanningWaterDistances(fresh, n, width, values);
    expect(planningWaterDistances(fresh, n, width)).toBe(values);
    expect(planningWaterDistances(fresh, n, width * 2)).not.toBe(values);
    expect(planningWaterDistances(fresh.slice(), n, width)).not.toBe(values);
    const lake = Float32Array.from(water, v => v ? 1 : -1), distance = lakeDistances(lake, n, width);
    expect(lakeDistancePyramid(lake, n, width)).toBe(floatPyramid(distance, n));
  });
});
