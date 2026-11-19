import { afterEach, expect, it, vi } from 'vitest';
import { createMinimalContourPainter } from '../src/render/minimalContourPainter';
import { emptyMinimalGeometry } from '../src/render/minimalMap';

afterEach(() => vi.unstubAllGlobals());

function fixture(renderer = 'NVIDIA RTX 5090') {
  let resource = 0;
  const calls = {
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: lose } : null),
      getParameter: () => renderer,
      getProgramParameter: () => true,
      getUniformLocation: (_program: unknown, name: string) => name,
      isContextLost: () => false,
      createProgram: () => ({ id: ++resource }),
      createShader: () => ({ id: ++resource }),
      createBuffer: () => ({ id: ++resource }),
      createVertexArray: () => ({ id: ++resource }),
      bufferData: vi.fn(),
      uniform4f: vi.fn(),
      drawArraysInstanced: vi.fn(),
    },
    lose = vi.fn();
  const gl = new Proxy(calls, { get: (target, key) => (key in target ? target[key as keyof typeof calls] : /^[A-Z_0-9]+$/.test(String(key)) ? 1 : () => {}) });
  const canvas = Object.assign(new EventTarget(), { width: 0, height: 0, getContext: () => gl });
  vi.stubGlobal('document', { createElement: () => canvas });
  return { canvas, calls, lose };
}

it('uploads a terrain once and draws one retained segment pass without frame uploads', () => {
  const { canvas, calls, lose } = fixture(),
    painter = createMinimalContourPainter()!;
  const contours = {
    exact: emptyMinimalGeometry(1000),
    levels: [
      { scale: 1, segments: new Float32Array([0, 0, 10, 10, 0]) },
      { scale: 4, segments: new Float32Array([0, 0, 10, 10, 0, 10, 10, 20, 20, 1]) },
    ],
  };
  painter.set(contours);
  painter.set(contours);
  expect(calls.bufferData).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 12; i++) expect(painter.draw({ cx: 250 + i, cy: 500, scale: 0.5 }, 1000, 800, 1)).toBe(canvas);
  expect(calls.drawArraysInstanced).toHaveBeenCalledTimes(12);
  expect(calls.drawArraysInstanced.mock.calls.every(args => args[3] === 1)).toBe(true);
  expect(calls.bufferData).toHaveBeenCalledTimes(2);
  painter.draw({ cx: 250, cy: 500, scale: 2 }, 1000, 800, 1);
  expect(calls.uniform4f).toHaveBeenLastCalledWith('uView', 0.004, -0.005, -1, 2.5);
  expect(calls.drawArraysInstanced.mock.lastCall?.[3]).toBe(2);
  expect(painter.draw({ cx: 250, cy: 500, scale: 8 }, 1000, 800, 1)).toBeUndefined();
  const lost = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lost);
  expect(lost.defaultPrevented).toBe(true);
  expect(painter.draw({ cx: 250, cy: 500, scale: 2 }, 1000, 800, 1)).toBeUndefined();
  expect(calls.bufferData).toHaveBeenCalledTimes(2);
  painter.dispose();
  expect(lose).toHaveBeenCalledOnce();
});

it('leaves software and unavailable WebGL on exact Canvas contours', () => {
  const { lose } = fixture('Google SwiftShader');
  expect(createMinimalContourPainter()).toBeUndefined();
  expect(lose).toHaveBeenCalledOnce();
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  expect(createMinimalContourPainter()).toBeUndefined();
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => {
        throw new Error('denied');
      },
    }),
  });
  expect(createMinimalContourPainter()).toBeUndefined();
});
