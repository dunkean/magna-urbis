import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewer, type FrameRequest } from '../src/ui/viewer';

class Element extends EventTarget {
  style = { opacity: '', transform: '', width: '', height: '' };
  dataset: Record<string, string> = {};
  classList = { add: vi.fn(), remove: vi.fn() };
  width = 800; height = 600; clientWidth = 140;
  parentElement?: Element;
  children: Element[] = [];
  context = { drawImage: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn(), strokeRect: vi.fn(), transferFromImageBitmap: vi.fn() };
  getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; }
  getContext() { return this.context; }
  insertBefore(child: Element, _before: Element) { child.parentElement = this; this.children.push(child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = undefined; }
}
function setup() {
  const callbacks = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 2 }));
  const container = new Element(), canvas = new Element(), minimap = new Element();
  const errors = vi.fn();
  const viewer = createViewer({ container: container as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
    minimap: minimap as unknown as HTMLCanvasElement, onError: errors });
  const tick = () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(cb => cb(0)); };
  return { viewer, container, canvas, minimap, tick, callbacks, errors };
}
afterEach(() => vi.unstubAllGlobals());

describe('viewer presentation and scheduling', () => {
  it('coalesces direct camera changes into one draw, retains the miniature, and stays idle after painting', () => {
    const { viewer, canvas, container, minimap, tick, callbacks } = setup();
    const element = new Element(), mini = new Element(); let first = true;
    const draw = vi.fn((r: FrameRequest) => { const result = { mini: first ? mini as unknown as HTMLCanvasElement : undefined, ms: 1, band: 0, scale: r.view.scale }; first = false; return result; });
    viewer.setDirectSource({ element: element as unknown as HTMLElement, draw });
    viewer.contentChanged(2400, false);
    viewer.setView({ cx: 1000, cy: 1100, scale: 1 }); viewer.setView({ cx: 1200, cy: 1300, scale: 2 });
    tick();
    expect(draw).toHaveBeenCalledOnce(); expect(draw.mock.calls[0][0]).toMatchObject({ view: { cx: 1200, cy: 1300, scale: 2 }, dpr: 2 });
    expect(canvas.style.opacity).toBe('0'); expect(container.children).toContain(element);
    expect(canvas.context.transferFromImageBitmap).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    viewer.zoomBy(1.1); tick(); expect(draw).toHaveBeenCalledTimes(2);
    expect(minimap.context.drawImage).toHaveBeenCalledTimes(2);
    viewer.clear(); expect(container.children).not.toContain(element); expect(canvas.style.opacity).toBe(''); expect(callbacks.size).toBe(0);
  });
  it('keeps one worker request in flight and requests only the newest camera after an answer', () => {
    const { viewer, tick } = setup(); const requests: FrameRequest[] = [];
    viewer.setSource({ request: r => requests.push(r) }); viewer.contentChanged(2400, false); tick();
    viewer.zoomBy(2); viewer.zoomBy(2); tick(); expect(requests).toHaveLength(1);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    viewer.present({ ...requests[0], bitmap, mini: undefined, ms: 1, band: 0, scale: requests[0].view.scale }); tick();
    expect(requests).toHaveLength(2); expect(requests[1].view.scale).toBe(requests[0].view.scale * 4);
    viewer.present({ ...requests[1], mini: undefined, ms: 1, band: 0, scale: requests[1].view.scale }); tick(); expect(requests).toHaveLength(2);
  });
  it('closes obsolete bitmaps without releasing the replacement source request or drawing over direct layers', () => {
    const { viewer, canvas, tick } = setup(); const old: FrameRequest[] = [], current: FrameRequest[] = [];
    viewer.setSource({ request: r => old.push(r) }); tick();
    viewer.setSource({ request: r => current.push(r) }); tick();
    const bitmap = { close: vi.fn() }, mini = { close: vi.fn() };
    const answer = { ...old[0], bitmap: bitmap as unknown as ImageBitmap, mini: mini as unknown as ImageBitmap, ms: 1, band: 0, scale: 1 };
    expect(viewer.present(answer)).toBe(false); expect(bitmap.close).toHaveBeenCalledOnce(); expect(mini.close).toHaveBeenCalledOnce();
    viewer.zoomBy(2); tick(); expect(current).toHaveLength(1);
    viewer.setDirectSource({ element: new Element() as unknown as HTMLElement, draw: () => ({ ms: 1, band: 0, scale: 1 }) }); tick();
    expect(viewer.present({ ...answer, seq: current[0].seq })).toBe(false);
    expect(canvas.context.transferFromImageBitmap).not.toHaveBeenCalled(); viewer.destroy();
  });
});
