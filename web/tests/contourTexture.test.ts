import { afterEach, expect, it, vi } from 'vitest';
import { contourRaster, paintContourRaster, type ContourRaster } from '../src/render/contourRaster';
import { IDENTITY, SPRITE_STRIDE, type DisplayList, type LiveRasterizer } from '../src/render/gpu/contract';
import { createLiveRasterizer } from '../src/render/gpu/liveRasterizer';
import { RecordingCanvas } from '../src/render/gpu/recorder';

afterEach(() => vi.unstubAllGlobals());

// Exercise the real recorder, prepare, replay, bake and LRU without allocating an 8192-square test canvas.
function glProbe() {
  const calls = {
    isContextLost: () => false,
    getExtension: () => ({ COMPLETION_STATUS_KHR: 0x91b1 }),
    getParameter: () => 8192,
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    getProgramParameter: () => 1,
    getShaderParameter: () => true,
    getActiveUniform: () => ({ name: 'uContourTint' }),
    getUniformLocation: (_program: unknown, name: string) => name,
    uniform4f: vi.fn(),
    texImage2D: vi.fn(),
    generateMipmap: vi.fn(),
    texParameteri: vi.fn(),
    deleteTexture: vi.fn(),
  };
  const constants = new Map<string, number>();
  const gl: WebGL2RenderingContext = new Proxy(calls, {
    get(target, key: string) {
      if (key in target) return target[key as keyof typeof calls];
      if (/^[A-Z_0-9]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, constants.size + 1);
        return constants.get(key);
      }
      return key.startsWith('create') ? () => ({}) : () => {};
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

function plate(worldSize = 8192) {
  const getContext = vi.fn(() => ({ setTransform() {} }));
  vi.stubGlobal('document', { createElement: () => ({ getContext }) });
  const result = contourRaster({ width: worldSize }, { thin: '', index: '' }, { contourIndexW: 1.6 }, true);
  expect(getContext).toHaveBeenCalledWith('2d', { alpha: false });
  return result;
}

const tint = { rgba: [0.25, 0.125, 0.75, 0.375] as const };
const image = (side: number) => ({ width: side, height: side }) as HTMLCanvasElement;
function band(coverage?: ContourRaster, ordinary?: HTMLCanvasElement) {
  const recorder = new RecordingCanvas(32, 32),
    ctx = recorder.getContext('2d')!;
  if (ordinary) ctx.drawImage(ordinary, 0, 0);
  if (coverage) paintContourRaster(ctx, coverage, tint, 0, 0, 32, 32);
  return recorder.finish();
}
function replay(raster: LiveRasterizer, list: DisplayList) {
  raster.replayLive([{ list, post: IDENTITY, scissor: [0, 0, 32, 32] }], null, 32, 32);
}
function bake(raster: LiveRasterizer, list: DisplayList) {
  raster.prepare(list);
  const baked = raster.bake(list, 1)!;
  raster.releaseBaked(baked);
}

it('keeps the 8192-square coverage plate between tilted band bakes under the existing texture budget', () => {
  const produced = plate();
  function uploads(coverage: ContourRaster) {
    const { gl, calls } = glProbe();
    const ink = createLiveRasterizer(gl)!,
      drape = createLiveRasterizer(gl)!;
    try {
      const initial = band(coverage);
      ink.prepare(initial);
      replay(ink, initial);
      const inkTextureBytes = ink.bytes() - SPRITE_STRIDE * Float32Array.BYTES_PER_ELEMENT;
      for (let i = 0; i < 6; i++) {
        // A band without contours ages their texture. New ordinary sprites in the next prepare trigger the LRU.
        bake(drape, band(undefined, image(32)));
        bake(drape, band(coverage, image(32)));
      }
      return { count: calls.texImage2D.mock.calls.filter(args => args[5] === coverage.canvas).length, inkTextureBytes };
    } finally {
      ink.dispose();
      drape.dispose();
    }
  }
  // Same-sized untagged source follows the original mipmapped RGBA path and reproduces all seven uploads.
  expect(uploads({ ...produced, canvas: image(8192) })).toEqual({ count: 7, inkTextureBytes: Math.ceil(8192 ** 2 * 4 * 4 / 3) });
  expect(uploads(produced)).toEqual({ count: 2, inkTextureBytes: Math.ceil(8192 ** 2 * 2 * 4 / 3) });
});

it('keeps ordinary and contour draws of the same source lossless in either order', () => {
  const produced = plate(1024),
    ordinary = image(produced.canvas.width);
  const { gl, calls } = glProbe(),
    raster = createLiveRasterizer(gl)!;
  try {
    const recorder = new RecordingCanvas(32, 32),
      ctx = recorder.getContext('2d')!;
    ctx.drawImage(produced.canvas, 0, 0);
    paintContourRaster(ctx, produced, tint, 0, 0, 32, 32);
    paintContourRaster(ctx, { ...produced, canvas: ordinary }, tint, 0, 0, 32, 32);
    ctx.drawImage(ordinary, 0, 0);
    const list = recorder.finish();
    expect(raster.warm()).toBe(true);
    raster.prepare(list);
    expect(calls.texImage2D.mock.calls).toEqual([
      [gl.TEXTURE_2D, 0, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, produced.canvas],
      [gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ordinary],
    ]);
    expect(calls.generateMipmap).toHaveBeenCalledTimes(2);
    expect(calls.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    replay(raster, list);
    expect(calls.texImage2D).toHaveBeenCalledTimes(2);
    expect(calls.uniform4f).toHaveBeenCalledWith('uContourTint', ...tint.rgba);
    expect(raster.liveTally()).toMatchObject({ late: 0, sprite: 8 });
  } finally {
    raster.dispose();
  }
});

it('evicts coverage under pressure and uploads it afresh after context loss and in a second context', () => {
  const coverage = plate(),
    list = band(coverage);
  const first = glProbe(),
    second = glProbe();
  const raster = createLiveRasterizer(first.gl)!,
    other = createLiveRasterizer(second.gl)!;
  try {
    raster.prepare(list);
    other.prepare(list);
    expect(first.calls.texImage2D).toHaveBeenCalledOnce();
    expect(second.calls.texImage2D).toHaveBeenCalledOnce();
    replay(raster, band()); // Advance past the plate's last use.
    raster.prepare(band(undefined, image(6144)));
    expect(first.calls.deleteTexture).toHaveBeenCalledTimes(1);
    raster.prepare(list);
    expect(first.calls.texImage2D.mock.calls.filter(args => args[5] === coverage.canvas)).toHaveLength(2);
    raster.dropContext();
    expect(first.calls.deleteTexture).toHaveBeenCalledTimes(1);
    expect(raster.bytes()).toBe(0);
    raster.prepare(list);
    expect(first.calls.texImage2D.mock.calls.filter(args => args[5] === coverage.canvas)).toHaveLength(3);
    other.prepare(list);
    expect(second.calls.texImage2D).toHaveBeenCalledOnce();
  } finally {
    raster.dispose();
    other.dispose();
  }
  expect(first.calls.deleteTexture).toHaveBeenCalledTimes(2);
  expect(second.calls.deleteTexture).toHaveBeenCalledOnce();
});
