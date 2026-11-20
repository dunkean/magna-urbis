import { afterEach, expect, it, vi } from 'vitest';
import { ComposedView } from '../src/v2/display/composedView';
import { DisplayReadiness } from '../src/v2/display/readiness';

afterEach(() => vi.unstubAllGlobals());

it('does not complete first presentation between a finished paint job and its final 2D frame', () => {
  const frame: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frame.push(cb));
  const view = Object.assign(Object.create(ComposedView.prototype), { pitch: 0, yaw: 0, live: { active: () => true }, rest: 'painting', motion: { restOwed: false }, awaited: undefined, townPending: false, pendingOverlay: () => 0 });
  const request = { mark: vi.fn(), has: () => false };
  const map = { preparing: false, request };
  const parts = { ground: {}, water: { vectorPending: false }, contours: { pending: () => 0 } };
  const readiness = new DisplayReadiness(map as never, parts as never, () => view);
  readiness.notePresented();
  expect(readiness.pendingWork()).toBeGreaterThan(0);
  expect(frame).toHaveLength(0);
  view.rest = 'exact';
  readiness.notePresented();
  expect(readiness.pendingWork()).toBe(0);
  frame.forEach(cb => cb());
  expect(request.mark).toHaveBeenCalledWith('visible-complete');
});

it('does not wait for an unused top-view paint in tilted or fallback rendering', () => {
  const view = Object.assign(Object.create(ComposedView.prototype), { pitch: 1, yaw: 0, live: { active: () => true, layerPending: () => false }, rest: 'due', motion: { restOwed: false }, awaited: undefined, townPending: false, volumes: { pending: () => false } });
  expect(view.pendingViewOnly()).toBe(0);
  view.pitch = 0;
  view.live.active = () => false;
  expect(view.pendingViewOnly()).toBe(0);
});

it('keeps visible forest preparation pending only in the active tilted view', () => {
  const view = Object.assign(Object.create(ComposedView.prototype), {
    pitch: 1,
    yaw: 0,
    live: { active: () => true, layerPending: () => false },
    rest: 'live',
    motion: { restOwed: false },
    awaited: undefined,
    townPending: false,
    volumes: { pending: () => false },
    trees: { pendingPresentation: () => true },
  });
  expect(view.pendingViewOnly()).toBe(1);
  view.live.active = () => false;
  expect(view.pendingViewOnly()).toBe(0);
  view.pitch = 0;
  view.live.active = () => true;
  expect(view.pendingViewOnly()).toBe(0);
});
