import { afterEach, expect, it, vi } from 'vitest';
import type { CityGlCreateOptions, CityGlDrawOptions, CityGlFrame } from '../src/render/cityGl';

const gpu = vi.hoisted(() => ({ ready: true, invalidate: undefined as (() => void) | undefined,
  draw: vi.fn((_options: CityGlDrawOptions) => ({ drawCalls: 1 } as CityGlFrame)), dispose: vi.fn() }));
vi.mock('../src/render/cityGl', () => ({ createCityGlRenderer: (_canvas: unknown, options?: CityGlCreateOptions) => { gpu.invalidate = options?.onInvalidate; return gpu; } }));
import { CityGlCanvasLayer } from '../src/render/cityGlHost';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); gpu.ready = true; gpu.invalidate = undefined; });

it('presents only a GPU image drawn for the current frame, including pan, fallback, early return and resize', () => {
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn() };
  class Element {
    style: Record<string, string> = {}; dataset = {}; parentNode?: Element;
    attributes: Record<string, string> = {}; children: Element[] = []; width = 300; height = 150;
    append(child: Element) { this.children.push(child); child.parentNode = this; }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    getContext() { return ctx; }
    remove() { this.parentNode = undefined; }
  }
  vi.stubGlobal('document', { createElement: () => new Element(), createElementNS: () => new Element() });
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const viewBox = { x: 100, y: 200, width: 400, height: 300 }, rect = { width: 800, height: 600 };
  const map = { viewBox: { baseVal: viewBox }, getBoundingClientRect: () => rect } as unknown as SVGSVGElement;
  const parent = new Element(); let mode: 'gpu' | 'canvas' | 'empty' = 'gpu';
  const layer = new CityGlCanvasLayer(map, parent as unknown as HTMLElement, (_ctx, frame) => {
    if (mode === 'empty') return false;
    if (mode === 'gpu') frame.drawGl!({ viewport: frame.viewport, metresPerPixel: frame.mpp } as CityGlDrawOptions);
    return false;
  });
  expect(layer.glCanvas.style.visibility).toBe('hidden');
  layer.draw(); expect(layer.glCanvas.style.visibility).toBe('visible');
  expect(gpu.draw).toHaveBeenCalledTimes(1);
  mode = 'canvas'; viewBox.x += 80; viewBox.y += 40; layer.draw();
  expect(layer.glCanvas.style.visibility).toBe('hidden'); // Old GPU image must not remain fixed under the moved Canvas plan.
  expect(gpu.draw).toHaveBeenCalledTimes(1);
  expect(parent.children[0].attributes.x).toBe('180');
  mode = 'gpu'; layer.draw(); expect(layer.glCanvas.style.visibility).toBe('visible');
  expect(gpu.draw.mock.calls[1][0]).toMatchObject({ viewport: { minX: 180, minY: 240 } });
  mode = 'empty'; layer.draw(); expect(layer.glCanvas.style.visibility).toBe('hidden');
  rect.width = 600; rect.height = 400; viewBox.width = 200; viewBox.height = 400 / 3;
  mode = 'gpu'; layer.draw();
  expect([layer.glCanvas.width, layer.glCanvas.height]).toEqual([1200, 800]);
  expect(layer.glCanvas.style.visibility).toBe('visible');
  expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 400, 1200, 400); // lower strip of the resized bitmap (clearCanvas2d)
  layer.dispose(); expect(gpu.dispose).toHaveBeenCalledOnce();
});

it('paints Canvas while GPU is lost, repaints a stationary camera after restore/import, and never presents a failed draw', () => {
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn() };
  class Element {
    style: Record<string, string> = {}; dataset = {}; parentNode?: Element; width = 300; height = 150;
    append(child: Element) { child.parentNode = this; }
    setAttribute() {}
    getContext() { return ctx; }
    remove() { this.parentNode = undefined; }
  }
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.stubGlobal('document', { createElement: () => new Element(), createElementNS: () => new Element() });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  const nextFrame = () => { expect(frames.size).toBe(1); const [id, callback] = [...frames][0]; frames.delete(id); callback(0); };
  const map = { viewBox: { baseVal: { x: 100, y: 200, width: 400, height: 300 } }, getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as SVGSVGElement;
  let canvasFrames = 0, gpuFrames = 0;
  const layer = new CityGlCanvasLayer(map, new Element() as unknown as HTMLElement, (_ctx, frame) => {
    const rendered = frame.drawGl?.({ viewport: frame.viewport, metresPerPixel: frame.mpp } as CityGlDrawOptions);
    if (rendered) gpuFrames++; else canvasFrames++; // paintCity chooses full Canvas layers from the draw result.
    return false;
  });
  layer.draw(); expect(gpuFrames).toBe(1); expect(layer.glCanvas.style.visibility).toBe('visible');
  gpu.ready = false; gpu.invalidate!();
  expect(layer.glCanvas.style.visibility).toBe('hidden'); nextFrame();
  expect(canvasFrames).toBe(1); expect(gpu.draw).toHaveBeenCalledTimes(1);
  gpu.invalidate!(); nextFrame(); // A new scene imported while lost still needs the complete Canvas plan.
  expect(canvasFrames).toBe(2);
  gpu.ready = true; gpu.invalidate!(); nextFrame();
  expect(gpuFrames).toBe(2); expect(layer.glCanvas.style.visibility).toBe('visible');
  expect(gpu.draw.mock.calls[1][0].viewport).toEqual(gpu.draw.mock.calls[0][0].viewport);
  gpu.draw.mockImplementationOnce(() => { gpu.ready = false; gpu.invalidate!(); return { drawCalls: 0 } as CityGlFrame; });
  layer.draw();
  expect(canvasFrames).toBe(3); expect(layer.glCanvas.style.visibility).toBe('hidden');
  const invalidate = gpu.invalidate!; layer.dispose(); expect(frames.size).toBe(0);
  invalidate(); expect(frames.size).toBe(0); // Late notifications cannot revive the disposed host.
});
