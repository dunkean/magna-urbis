import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewer, type FrameRequest } from '../src/ui/viewer';
import type { CanvasRenderer } from '../src/render/canvas';
import { MAX_PITCH } from '../src/render/world/camera';

class Element extends EventTarget {
  style = { opacity: '', transform: '', width: '', height: '' };
  dataset: Record<string, string> = {};
  classList = { add: vi.fn(), remove: vi.fn() };
  width = 800;
  height = 600;
  clientWidth = 140;
  getBoundingClientRect() {
    return { width: this.width, height: this.height, left: 0, top: 0 };
  }
  getContext() {
    return { drawImage: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn(), strokeRect: vi.fn() };
  }
  insertBefore() {}
  remove() {}
  setPointerCapture() {}
}
function pointer(type: string, id: number, x: number, y: number, more: { button?: number; ctrlKey?: boolean } = {}): Event {
  return Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y, button: more.button ?? 0, ctrlKey: more.ctrlKey ?? false });
}
/** A viewer over a direct source; `tilts` says whether the source presents a map that tilts. */
function setup(tilts: boolean, onView?: (view: FrameRequest['view']) => void) {
  const callbacks: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const page = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  vi.stubGlobal('window', page);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const container = new Element(),
    canvas = new Element(),
    element = new Element();
  if (tilts) element.dataset.camera = 'tilt';
  const viewer = createViewer({ container: container as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement, onView });
  const frames: FrameRequest[] = [];
  viewer.setDirectSource({
    element: element as unknown as HTMLElement,
    draw: request => {
      frames.push(request);
      return { ms: 0, band: 0, scale: request.view.scale };
    },
  });
  viewer.contentChanged(4000, false);
  /** Runs the pending animation frames `ms` later. */
  const tick = (ms = 16) => {
    now += ms;
    for (const cb of callbacks.splice(0)) cb(now);
  };
  tick();
  return { viewer, canvas, element, page, frames, tick };
}

describe('viewer camera tilt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands out the views of the 2D map while the camera is not tilted', () => {
    const { viewer, frames } = setup(true);
    expect(viewer.getView()).not.toHaveProperty('pitch');
    expect(frames.at(-1)!.view).not.toHaveProperty('pitch');
    expect(frames.at(-1)!.view).not.toHaveProperty('yaw');
  });

  it('does not tilt a map whose source cannot draw it', () => {
    const { viewer, canvas, frames, tick } = setup(false);
    viewer.tiltTo(1);
    canvas.dispatchEvent(pointer('pointerdown', 1, 400, 300, { button: 2 }));
    canvas.dispatchEvent(pointer('pointermove', 1, 400, 250, { button: 2 }));
    tick();
    expect(viewer.getView()).not.toHaveProperty('pitch');
    expect(frames.at(-1)!.view).not.toHaveProperty('pitch');
  });

  it('eases to a tilt and back to the top view, telling its listeners', () => {
    const { viewer, page, frames, tick } = setup(true),
      heard: (number | undefined)[] = [];
    viewer.onCamera(view => heard.push(view.pitch));
    viewer.tiltTo(1);
    tick();
    const first = frames.at(-1)!.view.pitch!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    for (let i = 0; i < 80; i++) tick();
    expect(viewer.getView().pitch).toBe(1);
    expect(viewer.getView().yaw).toBe(0);
    expect(heard.at(-1)).toBe(1);
    // Home returns to the top view: the view is the 2D map's again.
    page.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Home', shiftKey: false }));
    for (let i = 0; i < 80; i++) tick();
    expect(viewer.getView()).not.toHaveProperty('pitch');
    expect(frames.at(-1)!.view).not.toHaveProperty('pitch');
    expect(heard.at(-1)).toBeUndefined();
  });

  it('turns and tilts with a right-drag, pans on the ground with a plain drag, and takes a view whole', () => {
    const { viewer, canvas, frames, tick } = setup(true);
    canvas.dispatchEvent(pointer('pointerdown', 1, 400, 300, { button: 2 }));
    canvas.dispatchEvent(pointer('pointermove', 1, 450, 200, { button: 2 }));
    canvas.dispatchEvent(pointer('pointerup', 1, 450, 200, { button: 2 }));
    tick();
    const tilted = viewer.getView();
    expect(tilted.pitch).toBeCloseTo(0.6, 6);
    expect(tilted.yaw).toBeCloseTo(0.4, 6);
    expect(frames.at(-1)!.view.pitch).toBe(tilted.pitch);
    // A drag far up never passes the steepest tilt.
    canvas.dispatchEvent(pointer('pointerdown', 1, 400, 500, { ctrlKey: true }));
    canvas.dispatchEvent(pointer('pointermove', 1, 400, -2000, { ctrlKey: true }));
    canvas.dispatchEvent(pointer('pointerup', 1, 400, -2000));
    tick();
    expect(viewer.getView().pitch).toBe(MAX_PITCH);
    // A plain drag moves the centre and keeps the tilt.
    const before = viewer.getView();
    canvas.dispatchEvent(pointer('pointerdown', 1, 400, 400));
    canvas.dispatchEvent(pointer('pointermove', 1, 430, 420));
    canvas.dispatchEvent(pointer('pointerup', 1, 430, 420));
    tick();
    const after = viewer.getView();
    expect(after.pitch).toBe(before.pitch);
    expect(after.yaw).toBe(before.yaw);
    expect(Math.hypot(after.cx - before.cx, after.cy - before.cy)).toBeGreaterThan(0);
    // A view set without a pitch is the top view; one with a pitch and a yaw is taken as it is.
    viewer.setView({ cx: 2000, cy: 2000, scale: 0.5 });
    tick();
    expect(viewer.getView()).toEqual({ cx: 2000, cy: 2000, scale: 0.5 });
    viewer.setView({ cx: 2000, cy: 2000, scale: 0.5, pitch: 0.7, yaw: -1 });
    tick();
    expect(frames.at(-1)!.view).toEqual({ cx: 2000, cy: 2000, scale: 0.5, pitch: 0.7, yaw: -1 });
  });

  it('never moves the camera because content loads; a map of another size refits and keeps the tilt', () => {
    const { viewer, frames, tick } = setup(true);
    viewer.setView({ cx: 1200, cy: 900, scale: 0.8, pitch: 0.9, yaw: 0.5 });
    tick();
    const pose = viewer.getView();
    viewer.contentChanged(4000, true);
    tick();
    expect(viewer.getView()).toEqual(pose);
    // A map of another size: centre and scale fit it, pitch and yaw stay.
    viewer.contentChanged(8000, true);
    tick();
    const refit = viewer.getView();
    expect(refit.cx).not.toBe(pose.cx);
    expect(refit.pitch).toBe(0.9);
    expect(refit.yaw).toBe(0.5);
    expect(frames.at(-1)!.view.pitch).toBe(0.9);
  });
  it('draws the synchronous renderer with a view changed by onView and restores direct canvas styles', () => {
    let next: FrameRequest['view'] | undefined;
    const { viewer, canvas, tick } = setup(false, () => {
      if (next) viewer.setView(next);
    });
    const renderer = { draw: vi.fn(() => ({ ms: 1, band: 0 })), dispose: vi.fn() };
    viewer.setRenderer(renderer as unknown as CanvasRenderer, 4000, true);
    next = { cx: 1100, cy: 1200, scale: 0.8 };
    tick();
    expect(renderer.draw).toHaveBeenLastCalledWith(next);
    expect(canvas.style.opacity).toBe('');
    expect(canvas.dataset.presentation).toBeUndefined();
    next = undefined;
    viewer.setPaused(true);
    viewer.setView({ cx: 1500, cy: 1500, scale: 1 });
    const draws = renderer.draw.mock.calls.length;
    tick();
    expect(renderer.draw).toHaveBeenCalledTimes(draws);
    viewer.setPaused(false);
    tick();
    expect(renderer.draw).toHaveBeenCalledTimes(draws + 1);
  });

  it('rechecks source camera capability after a direct draw', () => {
    const { viewer, element, tick } = setup(true);
    viewer.setView({ cx: 1500, cy: 1500, scale: 1, pitch: 0.7, yaw: 0.4 });
    tick();
    const heard = vi.fn();
    viewer.onCamera(heard);
    const draws: FrameRequest[] = [];
    viewer.setDirectSource({
      element: element as unknown as HTMLElement,
      draw: r => {
        draws.push(r);
        delete element.dataset.camera;
        return { ms: 0, band: 0, scale: r.view.scale };
      },
    });
    tick();
    expect(draws[0].view.pitch).toBe(0.7);
    expect(heard.mock.calls[0][0]).not.toHaveProperty('pitch');
    tick();
    expect(draws[1].view).not.toHaveProperty('pitch');
  });

  it('steps held walk/fly keys with the frame cap, releases them, and levels a locked camera', () => {
    const { viewer, page, tick } = setup(true);
    viewer.setView({ cx: 1500, cy: 1500, scale: 1, pitch: 1, yaw: 0 });
    viewer.setNavigation('walk');
    const walking = viewer.getView();
    page.dispatchEvent(Object.assign(new Event('keydown'), { key: 'w', code: 'KeyW' }));
    tick(500);
    expect(viewer.getView().cy).toBeCloseTo(walking.cy - 12 * 0.05, 9);
    page.dispatchEvent(Object.assign(new Event('keyup'), { key: 'w', code: 'KeyW' }));
    const stopped = viewer.getView();
    tick();
    expect(viewer.getView()).toEqual(stopped);
    viewer.setNavigation('fly');
    const altitude = viewer.getView().eye!;
    page.dispatchEvent(Object.assign(new Event('keydown'), { key: ' ', code: 'Space' }));
    tick(50);
    expect(viewer.getView().eye).toBeGreaterThan(altitude);
    page.dispatchEvent(new Event('blur'));
    const hovering = viewer.getView();
    tick();
    expect(viewer.getView()).toEqual(hovering);
    viewer.setTiltLocked(true);
    viewer.tiltTo(1);
    tick();
    expect(viewer.navigation()).toBe('orbit');
    expect(viewer.getView()).not.toHaveProperty('pitch');
    expect(viewer.getView()).not.toHaveProperty('eye');
  });

  it('blocks every tilt input while locked and allows it again after unlocking', () => {
    const { viewer, canvas, page, tick } = setup(true);
    viewer.tiltTo(1);
    tick();
    viewer.setTiltLocked(true); // Also cancels the ease already in flight.
    viewer.setView({ cx: 1500, cy: 1500, scale: 1, pitch: 1, yaw: 0.5 });
    viewer.setNavigation('fly');
    viewer.tiltTo(1);
    for (const more of [{ button: 2 }, { ctrlKey: true }]) {
      canvas.dispatchEvent(pointer('pointerdown', 1, 400, 300, more));
      canvas.dispatchEvent(pointer('pointermove', 1, 450, 200, more));
      canvas.dispatchEvent(pointer('pointerup', 1, 450, 200, more));
    }
    canvas.dispatchEvent(pointer('pointerdown', 1, 300, 300));
    canvas.dispatchEvent(pointer('pointerdown', 2, 500, 300));
    canvas.dispatchEvent(pointer('pointermove', 1, 300, 250));
    canvas.dispatchEvent(pointer('pointermove', 2, 500, 250));
    canvas.dispatchEvent(pointer('pointerup', 1, 300, 250));
    canvas.dispatchEvent(pointer('pointerup', 2, 500, 250));
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -100, deltaMode: 0, shiftKey: true, clientX: 400, clientY: 300 }));
    page.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowUp', shiftKey: true }));
    for (let i = 0; i < 80; i++) tick();
    expect(viewer.navigation()).toBe('orbit');
    expect(viewer.getView()).not.toHaveProperty('pitch');
    expect(viewer.getView()).not.toHaveProperty('yaw');
    viewer.setTiltLocked(false);
    viewer.tiltTo(1);
    for (let i = 0; i < 80; i++) tick();
    expect(viewer.getView().pitch).toBe(1);
  });
});
