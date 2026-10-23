import { expect, it, vi } from 'vitest';
import type { Layout, Partition } from '../../rust/bridge/urban';
import { buildCityScene } from '../src/render/cityCanvas';
import { createCityGlRenderer } from '../src/render/cityGl';

it('retains the newest CPU scene during context loss and reuploads it before notifying the host', async () => {
  let lost = false, compileSucceeds = true, resource = 0;
  const operations = {
    isContextLost: () => lost,
    createProgram: vi.fn(() => ({ resource: ++resource })),
    createShader: () => ({ resource: ++resource }),
    createBuffer: () => ({ resource: ++resource }),
    createVertexArray: () => ({ resource: ++resource }),
    createTexture: () => ({ resource: ++resource }),
    getShaderParameter: () => compileSucceeds,
    getShaderInfoLog: () => 'simulated restored driver failure',
    getProgramParameter: (_program: unknown, name: number) => name === 2 ? 0 : true,
    getExtension: () => null,
    bufferData: vi.fn(), viewport: vi.fn(), drawElements: vi.fn(),
  };
  const gl = new Proxy({ ...operations, ACTIVE_UNIFORMS: 2, drawingBufferWidth: 800, drawingBufferHeight: 600 }, {
    get(target, key) { return key in target ? target[key as keyof typeof target] : typeof key === 'string' && /^[A-Z_0-9]+$/.test(key) ? 1 : () => undefined; },
  }) as unknown as WebGL2RenderingContext;
  const canvas = new EventTarget() as EventTarget & { getContext(): WebGL2RenderingContext };
  canvas.getContext = () => gl;
  const notify = vi.fn(), renderer = createCityGlRenderer(canvas as unknown as HTMLCanvasElement, { allowSoftware: true, onInvalidate: notify });
  const programs = operations.createProgram.mock.calls.length; // per context: plan, stroke variants, discs, paving, walls
  const sceneAt = (x: number, id: string) => {
    const shape = { outer: [{ x, y: 0 }, { x: x + 20, y: 0 }, { x: x + 20, y: 20 }, { x, y: 20 }], holes: [] };
    return buildCityScene([{ key: id, quarters: [], blocks: [{ shape, kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } }], streets: [], enclosures: [], phases: [] } as unknown as Layout],
      [{ key: id, parcels: [{ id, shape, use: 'plot', block: 0, axis: { x: 1, y: 0 } }] } as unknown as Partition]);
  };
  const draw = () => renderer.draw({ viewport: { minX: 0, minY: 0, maxX: 200, maxY: 30 }, metresPerPixel: 0.2, view: 'parcels' });
  expect(renderer.ready).toBe(false);
  await renderer.setScene(sceneAt(0, 'first'), undefined, { workers: 0 });
  expect(renderer.ready).toBe(true); expect(notify).toHaveBeenCalledOnce(); expect(draw().drawCalls).toBeGreaterThan(0);
  lost = true;
  expect(renderer.ready).toBe(false); // Physical loss precedes the DOM event.
  const event = new Event('webglcontextlost', { cancelable: true }); canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect(notify).toHaveBeenCalledTimes(2);
  const uploads = operations.bufferData.mock.calls.length, viewports = operations.viewport.mock.calls.length;
  expect(draw().drawCalls).toBe(0); expect(operations.viewport).toHaveBeenCalledTimes(viewports);
  await renderer.setScene(sceneAt(100, 'latest'), undefined, { workers: 0 });
  expect(operations.bufferData).toHaveBeenCalledTimes(uploads); expect(renderer.ready).toBe(false);
  expect(renderer.pick({ x: 110, y: 10 }, { view: 'parcels', metresPerPixel: 0.2 })).toMatchObject({ kind: 'parcel', id: 'latest' });
  expect(notify).toHaveBeenCalledTimes(3);
  lost = false; canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(renderer.ready).toBe(true); expect(notify).toHaveBeenCalledTimes(4);
  expect(operations.createProgram).toHaveBeenCalledTimes(2 * programs); expect(operations.bufferData.mock.calls.length).toBeGreaterThan(uploads);
  expect(draw().drawCalls).toBeGreaterThan(0);
  expect(renderer.pick({ x: 110, y: 10 }, { view: 'parcels', metresPerPixel: 0.2 })).toMatchObject({ id: 'latest' });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    lost = true; canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    lost = false; compileSucceeds = false; canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(renderer.ready).toBe(false); expect(warning).toHaveBeenCalledOnce(); expect(notify).toHaveBeenCalledTimes(6);
    expect(draw().drawCalls).toBe(0);
  } finally { warning.mockRestore(); renderer.dispose(); }
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(notify).toHaveBeenCalledTimes(6); expect(renderer.ready).toBe(false);
});
