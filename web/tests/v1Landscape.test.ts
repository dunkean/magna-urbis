import { expect, it, vi } from 'vitest';
import type { SettlementRaster } from '../../rust/bridge/settlements';
import { landBackdrop, v1LandscapePixels, v1LandscapeWorld, v1RoadPaint } from '../src/render/v1Landscape';
import { setMapSeason, setMapClimateZone } from '../src/render/seasonPalette';
import { renderTerrainPixels } from '../src/render/raster';
import { PALETTES } from '../src/render/styles';
import { regionalRoadSurface } from '../src/render/roadSurfaces';
import { SHADERS } from '../src/render/gpu/shaders';
import { TREE_SYMBOLS_GLSL } from '../src/render/treeSymbolsGlsl';

const raster = (): SettlementRaster => ({ width: 160, n: 8, height: Float32Array.from({ length: 64 }, (_, i) => 10 + i * 0.2), water: new Uint8Array(64), waterLevel: new Float32Array(64), riverWidth: new Float32Array(64), riverIds: new Int32Array(64) });
it('uses the ground snow function and its noise helpers in the punched-land fragment shader', () => {
  const shared = SHADERS.land[1].match(/uniform vec4 uLandTint;[\s\S]*?vec3 landSeason\([\s\S]*?\n\}/)?.[0];
  expect(shared).toBeDefined();
  expect(TREE_SYMBOLS_GLSL).toContain(shared!);
  expect(SHADERS.land[1]).not.toContain('treeWash(');
});
it('shares a packed metre-height texture between punched summer sheets and calendar dates', () => {
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
  try {
    const r = raster(),
      first = {} as HTMLCanvasElement,
      second = {} as HTMLCanvasElement;
    setMapSeason(0.5, 'alpine', {});
    const summer = landBackdrop(first, r, 48).uniforms();
    setMapSeason(0, 'alpine', {});
    const winter = landBackdrop(second, r, 48).uniforms();
    expect(winter.heights).toBe(summer.heights);
    expect(winter.tint).not.toEqual(summer.tint);
    for (let i = 0; i < r.height.length; i++) {
      const [hi, lo, , alpha] = winter.heights.data.subarray(i * 4, i * 4 + 4);
      expect(((256 * hi + lo) * winter.maxHeight) / 65535).toBeCloseTo(r.height[i], 3);
      expect(alpha).toBe(255);
    }
  } finally {
    vi.unstubAllGlobals();
    setMapSeason(0.5, undefined, {});
    setMapClimateZone(undefined);
  }
});
it('uses the original V1 terrain colours and light without modifying the retained raster', () => {
  const r = raster(),
    heights = r.height.slice(),
    water = r.water.slice();
  const reference = renderTerrainPixels(v1LandscapeWorld(r), PALETTES.parchment, { pixels: 16 });
  expect(v1LandscapePixels(r, 'parchment').rgb).toEqual(reference.rgb);
  expect(v1LandscapePixels(r, 'atlas').rgb).not.toEqual(reference.rgb);
  expect(r.height).toEqual(heights);
  expect(r.water).toEqual(water);
});
it('keeps retained hydrology visible and uses V1 road widths in world metres', () => {
  const r = raster();
  r.water[27] = 2;
  const land = v1LandscapePixels(raster(), 'parchment'),
    wet = v1LandscapePixels(r, 'parchment');
  const at = (6 * wet.w + 6) * 3;
  expect(wet.rgb.slice(at, at + 3)).not.toEqual(land.rgb.slice(at, at + 3));
  const road = v1RoadPaint('major', 8, 2, 'parchment'),
    physical = regionalRoadSurface('major', 2, 8);
  expect(road.width).toBe(physical.fill * 2);
  expect(road.casingWidth).toBe(physical.casing * 2);
  expect(road.fill).toBe(PALETTES.parchment.roadFill);
});
