import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlContextRecovery, LIGHT_TEXTURE_CAP, MapContextLostError, capRgbaRaster, enterMapGpuLight, isMapContextLost, lowEndGpu, mapGpuLight, mapTextureCap, noteMapRenderer, resetMapGpuProfile, textureCap } from '../src/ui/glContextRecovery';

afterEach(() => {
  vi.unstubAllGlobals();
  resetMapGpuProfile();
});

describe('map WebGL context recovery', () => {
  it('retries once, then goes light, then fails', () => {
    const r = new GlContextRecovery();
    expect(r.lost()).toBe(true);
    expect(r.stage).toBe('retry');
    expect(r.waiting).toBe(true);
    expect(r.restored()).toBe(false);
    expect(r.waiting).toBe(false);
    expect(r.lost()).toBe(true);
    expect(r.stage).toBe('light');
    expect(r.restored()).toBe(true); // enter the light profile, once
    expect(r.light).toBe(true);
    expect(r.lost()).toBe(false);
    expect(r.failed).toBe(true); // no preventDefault: give up
    expect(r.restored()).toBe(false);
  });
  it('fails when no restore arrives in time', () => {
    const r = new GlContextRecovery();
    r.lost();
    r.expired();
    expect(r.failed).toBe(true);
    expect(r.waiting).toBe(false);
    r.expired();
    expect(r.failed).toBe(true);
  });
  it('a renderer created in the light profile keeps one retry', () => {
    const r = new GlContextRecovery(true);
    expect(r.lost()).toBe(true);
    expect(r.stage).toBe('light');
    r.restored();
    expect(r.lost()).toBe(false);
    expect(r.failed).toBe(true);
  });
  it('final losses are recognised by name', () => {
    expect(isMapContextLost(new MapContextLostError())).toBe(true);
    expect(new MapContextLostError('x', true).final).toBe(true);
    expect(isMapContextLost(new Error('other'))).toBe(false);
  });
});

describe('map GPU budget', () => {
  it('starts with the light shader and texture budget in Firefox on Windows', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0' });
    expect(mapGpuLight()).toBe(true);
    expect(mapTextureCap(16384)).toBe(LIGHT_TEXTURE_CAP);
  });
  it('flags integrated and software renderers', () => {
    expect(lowEndGpu('ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (RPL-P), OpenGL 4.6 (Core Profile) Mesa 25.2.8)')).toBe(true);
    expect(lowEndGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(lowEndGpu('llvmpipe (LLVM 17.0.6, 256 bits)')).toBe(true);
    expect(lowEndGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(lowEndGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(lowEndGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4)).toBe(true);
  });
  it('caps textures to the device and to 2048 when light or low-end', () => {
    expect(textureCap(16384, false)).toBe(16384);
    expect(textureCap(16384, true)).toBe(LIGHT_TEXTURE_CAP);
    expect(textureCap(1024, true)).toBe(1024);
    noteMapRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)');
    expect(mapTextureCap(16384)).toBe(16384);
    noteMapRenderer('ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (RPL-P), OpenGL 4.6 (Core Profile) Mesa 25.2.8)');
    expect(mapTextureCap(16384)).toBe(LIGHT_TEXTURE_CAP);
  });
  it('enters the light profile once and tells the page', () => {
    let events = 0;
    const listener = (): void => {
      events++;
    };
    globalThis.window?.addEventListener('mu-map-gpu-lighter', listener);
    enterMapGpuLight();
    enterMapGpuLight();
    expect(mapGpuLight()).toBe(true);
    if (globalThis.window) expect(events).toBe(1);
    globalThis.window?.removeEventListener('mu-map-gpu-lighter', listener);
  });
  it('box-halves rasters and their same-grid companions until they fit', () => {
    const n = 8,
      rgba = new Uint8Array(n * n * 4),
      bank = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      rgba.set([(i % n) * 10, 100, 200, 255], i * 4);
      bank[i * 4] = 40;
    }
    const raster = { x: 1, y: 2, width: 3, n, rgba, key: 'k' };
    const {
      raster: small,
      companions: [halfBank],
    } = capRgbaRaster(raster, 2, [bank]);
    expect(small.n).toBe(2);
    expect(small.rgba.length).toBe(16);
    expect(halfBank!.length).toBe(16);
    expect([small.x, small.y, small.width, small.key]).toEqual([1, 2, 3, 'k']);
    expect(small.rgba[0]).toBe(15); // mean of columns 0..3: 0, 10, 20, 30
    expect(Array.from(small.rgba.slice(1, 4))).toEqual([100, 200, 255]);
    expect(halfBank![0]).toBe(40);
    expect(capRgbaRaster(raster, 8).raster).toBe(raster);
  });
});
