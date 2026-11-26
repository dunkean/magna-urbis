import { afterEach, expect, it, vi } from 'vitest';
import { createSelectionOverlay } from '../../src/v2/selectionOverlay';
import { screenProjection, type ScreenProjection } from '../../src/render/world/camera';

afterEach(() => vi.unstubAllGlobals());

it('updates the selection on camera changes and leaves a stationary or cleared view idle', () => {
  const element = () => ({ dataset: {}, style: {}, append: vi.fn(), setAttribute: vi.fn(), hidden: false });
  const makeSvg = vi.fn(element);
  vi.stubGlobal('document', { createElementNS: makeSvg, createElement: element });
  const frame = vi.fn();
  vi.stubGlobal('requestAnimationFrame', frame);
  const map = { ...element(), clientWidth: 200, clientHeight: 100 };
  const view = { cx: 0, cy: 0, scale: 1 };
  let current: ScreenProjection = screenProjection(view, 200, 100);
  const project = vi.fn(() => current);
  const selection = createSelectionOverlay(map as unknown as HTMLElement, () => view, project, vi.fn());
  const [svg, , path] = makeSvg.mock.results.map(result => result.value);
  selection.set(
    [
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
    ],
    'Garden',
  );
  expect(svg.setAttribute).toHaveBeenLastCalledWith('viewBox', '-100 -50 200 100');
  svg.setAttribute.mockClear();
  selection.refresh();
  expect(svg.setAttribute).not.toHaveBeenCalled();
  current = {
    tilted: true,
    project: (x, y, out) => {
      out[0] = 2 * x;
      out[1] = 2 * y;
      return true;
    },
  };
  selection.refresh();
  expect(path.setAttribute).toHaveBeenLastCalledWith('d', 'M0.0,0.0L8.0,0.0L8.0,8.0Z');
  view.cx = 12;
  current = screenProjection(view, 200, 100);
  selection.refresh();
  expect(path.setAttribute).toHaveBeenLastCalledWith('d', 'M0,0L4,0L4,4Z');
  expect(svg.setAttribute).toHaveBeenLastCalledWith('viewBox', '-88 -50 200 100');
  selection.set([[{ x: 1, y: 2 }]], 'Marker');
  expect(svg.setAttribute).toHaveBeenLastCalledWith('viewBox', '-88 -50 200 100');
  selection.set();
  project.mockClear();
  selection.refresh();
  expect(project).not.toHaveBeenCalled();
  expect(frame).not.toHaveBeenCalled();
});
