import { expect, it } from 'vitest';
import type { SettlementRaster } from '../../rust/bridge/settlements';
import { v1LandscapePixels, v1LandscapeWorld, v1RoadPaint } from '../src/render/v1Landscape';
import { renderTerrainPixels } from '../src/render/raster';
import { PALETTES } from '../src/render/styles';
import { regionalRoadSurface } from '../src/render/roadSurfaces';

const raster = (): SettlementRaster => ({ width: 160, n: 8, height: Float32Array.from({ length: 64 }, (_, i) => 10 + i * .2), water: new Uint8Array(64), waterLevel: new Float32Array(64), riverWidth: new Float32Array(64), riverIds: new Int32Array(64) });
it('uses the original V1 terrain colours and light without modifying the retained raster', () => {
  const r = raster(), heights = r.height.slice(), water = r.water.slice();
  const reference = renderTerrainPixels(v1LandscapeWorld(r), PALETTES.parchment, { pixels: 16 });
  expect(v1LandscapePixels(r, 'parchment').rgb).toEqual(reference.rgb);
  expect(v1LandscapePixels(r, 'atlas').rgb).not.toEqual(reference.rgb);
  expect(r.height).toEqual(heights); expect(r.water).toEqual(water);
});
it('keeps retained hydrology visible and uses V1 road widths in world metres', () => {
  const r = raster(); r.water[27] = 2;
  const land = v1LandscapePixels(raster(), 'parchment'), wet = v1LandscapePixels(r, 'parchment');
  const at = (6 * wet.w + 6) * 3;
  expect(wet.rgb.slice(at, at + 3)).not.toEqual(land.rgb.slice(at, at + 3));
  const road = v1RoadPaint('major', 8, 2, 'parchment'), physical = regionalRoadSurface('major', 2, 8);
  expect(road.width).toBe(physical.fill * 2); expect(road.casingWidth).toBe(physical.casing * 2);
  expect(road.fill).toBe(PALETTES.parchment.roadFill);
});
