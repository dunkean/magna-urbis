import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMaterialRasterContext, MaterialRasterUnavailableError } from '../../rust/bridge/terrainMaterialContext';

afterEach(() => vi.unstubAllGlobals());
const context = () => ({ isContextLost: () => false });
describe('material raster WebGL2 contexts', () => {
  it('keeps the worker OffscreenCanvas path when it supports WebGL2', () => {
    const gl = context(), getContext = vi.fn(() => gl), createElement = vi.fn();
    vi.stubGlobal('OffscreenCanvas', class { getContext = getContext; });
    vi.stubGlobal('document', { createElement });
    expect(createMaterialRasterContext().gl).toBe(gl); expect(createElement).not.toHaveBeenCalled();
    expect(getContext).toHaveBeenCalledWith('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false });
  });
  it('composes the same shader on a page canvas when OffscreenCanvas rejects WebGL2', () => {
    const gl = context(), canvas = { getContext: vi.fn(() => gl), width: 0, height: 0 };
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    expect(createMaterialRasterContext()).toEqual({ canvas, gl }); expect(canvas.width).toBe(1); expect(canvas.height).toBe(1);
  });
  it('also supports page canvases when OffscreenCanvas is absent or throws', () => {
    const gl = context(), canvas = { getContext: () => gl };
    vi.stubGlobal('document', { createElement: () => canvas }); vi.stubGlobal('OffscreenCanvas', undefined);
    expect(createMaterialRasterContext().canvas).toBe(canvas);
    vi.stubGlobal('OffscreenCanvas', class { constructor() { throw new Error('Unsupported'); } });
    expect(createMaterialRasterContext().canvas).toBe(canvas);
  });
  it('does not reuse a lost offscreen context as a working material renderer', () => {
    const gl = context(), canvas = { getContext: () => gl };
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return { isContextLost: () => true }; } });
    vi.stubGlobal('document', { createElement: () => canvas });
    expect(createMaterialRasterContext().gl).toBe(gl);
  });
  it('reports actual WebGL2 absence explicitly in pages and workers', () => {
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
    vi.stubGlobal('document', undefined);
    expect(createMaterialRasterContext).toThrow(MaterialRasterUnavailableError);
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(createMaterialRasterContext).toThrow(/WebGL2/);
  });
});
