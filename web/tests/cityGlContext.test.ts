import { InstanceRanges } from '../src/render/city/live/instanceRanges';
import { NightLamps } from '../src/render/city/live/nightLamps';
import { nightHouseLights } from '../src/render/cityNight';
import { expect, it, vi } from 'vitest';
import type { Layout, Partition } from '../../rust/bridge/urban';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { buildCityBuildings, buildCityScene } from '../src/render/cityCanvas';
import { createCityGlRenderer } from '../src/render/cityGl';

function context() {
  const driver = { lost: false, compileSucceeds: true };
  let resource = 0;
  const operations = {
    isContextLost: () => driver.lost,
    createProgram: vi.fn(() => ({ resource: ++resource })),
    createShader: () => ({ resource: ++resource }),
    createBuffer: () => ({ resource: ++resource }),
    createVertexArray: () => ({ resource: ++resource }),
    createTexture: () => ({ resource: ++resource }),
    getShaderParameter: () => driver.compileSucceeds,
    getShaderInfoLog: () => 'simulated restored driver failure',
    getProgramParameter: (_program: unknown, name: number) => (name === 2 ? 0 : true),
    getExtension: () => null,
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    viewport: vi.fn(),
    drawElements: vi.fn(),
  };
  const gl = new Proxy(
    { ...operations, ACTIVE_UNIFORMS: 2, drawingBufferWidth: 800, drawingBufferHeight: 600 },
    {
      get(target, key) {
        return key in target ? target[key as keyof typeof target] : typeof key === 'string' && /^[A-Z_0-9]+$/.test(key) ? 1 : () => undefined;
      },
    },
  ) as unknown as WebGL2RenderingContext;
  const canvas = new EventTarget() as EventTarget & { getContext(): WebGL2RenderingContext };
  canvas.getContext = () => gl;
  return { canvas, driver, operations };
}

it('retains the newest CPU scene during context loss and reuploads it before notifying the host', async () => {
  const { canvas, driver, operations } = context();
  const notify = vi.fn(),
    renderer = createCityGlRenderer(canvas as unknown as HTMLCanvasElement, { allowSoftware: true, onInvalidate: notify });
  const programs = operations.createProgram.mock.calls.length; // per context: plan, stroke variants, discs, paving, walls
  const sceneAt = (x: number, id: string) => {
    const shape = {
      outer: [
        { x, y: 0 },
        { x: x + 20, y: 0 },
        { x: x + 20, y: 20 },
        { x, y: 20 },
      ],
      holes: [],
    };
    return buildCityScene(
      [{ key: id, quarters: [], blocks: [{ shape, kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } }], streets: [], enclosures: [], phases: [] } as unknown as Layout],
      [{ key: id, parcels: [{ id, shape, use: 'plot', block: 0, axis: { x: 1, y: 0 } }] } as unknown as Partition],
    );
  };
  const draw = () => renderer.draw({ viewport: { minX: 0, minY: 0, maxX: 200, maxY: 30 }, metresPerPixel: 0.2, view: 'parcels' });
  expect(renderer.ready).toBe(false);
  await renderer.setScene(sceneAt(0, 'first'), undefined, { workers: 0 });
  expect(renderer.ready).toBe(true);
  expect(notify).toHaveBeenCalledOnce();
  expect(draw().drawCalls).toBeGreaterThan(0);
  driver.lost = true;
  expect(renderer.ready).toBe(false); // Physical loss precedes the DOM event.
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(notify).toHaveBeenCalledTimes(2);
  const uploads = operations.bufferData.mock.calls.length,
    viewports = operations.viewport.mock.calls.length;
  expect(draw().drawCalls).toBe(0);
  expect(operations.viewport).toHaveBeenCalledTimes(viewports);
  await renderer.setScene(sceneAt(100, 'latest'), undefined, { workers: 0 });
  expect(operations.bufferData).toHaveBeenCalledTimes(uploads);
  expect(renderer.ready).toBe(false);
  expect(renderer.pick({ x: 110, y: 10 }, { view: 'parcels', metresPerPixel: 0.2 })).toMatchObject({ kind: 'parcel', id: 'latest' });
  expect(notify).toHaveBeenCalledTimes(3);
  driver.lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(renderer.ready).toBe(true);
  expect(notify).toHaveBeenCalledTimes(4);
  expect(operations.createProgram).toHaveBeenCalledTimes(2 * programs);
  expect(operations.bufferData.mock.calls.length).toBeGreaterThan(uploads);
  expect(draw().drawCalls).toBeGreaterThan(0);
  expect(renderer.pick({ x: 110, y: 10 }, { view: 'parcels', metresPerPixel: 0.2 })).toMatchObject({ id: 'latest' });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    driver.lost = true;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    driver.lost = false;
    driver.compileSucceeds = false;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(renderer.ready).toBe(false);
    expect(warning).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledTimes(6);
    expect(draw().drawCalls).toBe(0);
  } finally {
    warning.mockRestore();
    renderer.dispose();
  }
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(notify).toHaveBeenCalledTimes(6);
  expect(renderer.ready).toBe(false);
});

it('keeps draw and allocation counts stable across a house edit in a multi-page town, then issues no further uploads', async () => {
  const { canvas, operations } = context(),
    renderer = createCityGlRenderer(canvas as unknown as HTMLCanvasElement, { allowSoftware: true });
  const shape = (x: number) => ({
    outer: [
      { x, y: 0 },
      { x: x + 12, y: 0 },
      { x: x + 12, y: 8 },
      { x, y: 8 },
    ],
    holes: [],
  });
  const plan = buildCityScene([{ key: 'town', quarters: [], blocks: [{ shape: shape(5), kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } }], streets: [], enclosures: [], phases: [] } as unknown as Layout], []);
  const house = (x: number, id: string) => ({ id, function: 'domestic', footprint: [shape(x)], roof_footprint: [] }) as unknown as PlacedBuilding;
  const rest = [house(302, 'near'), house(3600, 'far')],
    set = (x: number) => buildCityBuildings({ buildings: [house(x, 'edit'), ...rest] }, plan, { roofs: false });
  const draw = () => renderer.draw({ viewport: { minX: -10, minY: -10, maxX: 3800, maxY: 20 }, metresPerPixel: 0.2, lod: 'close', view: 'buildings' });
  try {
    await renderer.setScene(plan, set(10), { workers: 0, revision: 10 });
    const draws = draw().drawCalls,
      counts = renderer.stats();
    expect(counts.pages).toBe(3);
    expect(draws).toBeGreaterThan(0);
    for (const op of [operations.bufferData, operations.bufferSubData, operations.texImage2D, operations.texSubImage2D]) op.mockClear();
    await renderer.setScene(plan, set(11), { workers: 0, revision: 11, edit: { previous: 10, rects: [{ x0: 8, y0: -1, x1: 30, y1: 10 }] } });
    expect(draw().drawCalls).toBe(draws);
    expect(operations.bufferData).not.toHaveBeenCalled();
    expect(operations.texImage2D).not.toHaveBeenCalled();
    const geometryBytes = operations.bufferSubData.mock.calls.reduce((n, c) => n + (c[2] as ArrayBufferView).byteLength, 0);
    // The four rectangle corners occur in the body and footprint passes. The unchanged trailing Y stays resident.
    expect(geometryBytes).toBe(60);
    const textureBytes = operations.texSubImage2D.mock.calls.reduce((n, c) => n + (c.at(-1) as ArrayBufferView).byteLength, 0);
    expect(textureBytes).toBe(8);
    operations.bufferSubData.mockClear();
    operations.texSubImage2D.mockClear();
    expect(draw().drawCalls).toBe(draws);
    expect(operations.bufferSubData).not.toHaveBeenCalled();
    expect(operations.texSubImage2D).not.toHaveBeenCalled();
  } finally {
    renderer.dispose();
  }
});

it('updates house lights against the uploaded revision and leaves a distant cell resident', () => {
  const { canvas, operations } = context(),
    lamps = new NightLamps(canvas.getContext()),
    plan = buildCityScene([], []);
  const house = (x: number) =>
    ({
      id: 'home',
      function: 'mixed',
      footprint: [
        {
          outer: [
            { x, y: 0 },
            { x: x + 8, y: 0 },
            { x: x + 8, y: 8 },
            { x, y: 8 },
          ],
          holes: [],
        },
      ],
      roof_footprint: [],
    }) as unknown as PlacedBuilding;
  const far = house(3300),
    make = (x: number) => buildCityBuildings({ buildings: [house(x), far] }, plan, { roofs: false });
  const first = make(10);
  lamps.step(plan, [first], false, { revision: 1 });
  const expected: number[] = [];
  nightHouseLights(house(11), (x, y, r, a) => expected.push(x, y, r, a));
  expect(expected.length).toBeGreaterThan(0);
  operations.bufferData.mockClear();
  operations.bufferSubData.mockClear();
  const next = make(11),
    houses = [next];
  lamps.step(plan, houses, false, { revision: 2, edit: { previous: 1, rects: [{ x0: 0, y0: -2, x1: 32, y1: 16 }] } });
  expect(operations.bufferData).not.toHaveBeenCalled();
  expect(operations.bufferSubData.mock.calls.map(call => Array.from(call[2] as Float32Array)).flat()).toEqual(Array.from(Float32Array.from(expected)));
  operations.bufferSubData.mockClear();
  lamps.step(plan, houses, false, { revision: 2 });
  expect(operations.bufferSubData).not.toHaveBeenCalled();
  lamps.drop(true);
});
it('compacts removed instances without leaving holes and copies resident records when the instance buffer grows', () => {
  const { canvas, operations } = context(),
    ranges = new InstanceRanges(canvas.getContext(), 3);
  ranges.replace('first', [1, 2, 3]);
  ranges.replace('second', [4, 5, 6]);
  ranges.flush();
  operations.bufferSubData.mockClear();
  ranges.replace('first', []);
  ranges.flush();
  expect(ranges.count).toBe(1);
  expect(Array.from(operations.bufferSubData.mock.calls[0][2] as Float32Array)).toEqual([4, 5, 6]);
  operations.bufferSubData.mockClear();
  ranges.replace('large', new Float32Array(90).fill(9));
  ranges.flush();
  expect(operations.bufferSubData.mock.calls[0][1]).toBe(12);
  expect(ranges.count).toBe(31);
  ranges.dispose();
});
