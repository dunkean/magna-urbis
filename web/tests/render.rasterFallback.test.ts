import { expect, it } from 'vitest';
import type { World } from '../src/gen/types';
import { renderTerrainPixels } from '../src/render/raster';
import { PALETTES } from '../src/render/styles';

it('tints wooded ground without tinting water or open land', () => {
  const height = new Float32Array(16).fill(50);
  height[2] = -5;
  const world = { mapSize: 400, terrain: { height: { w: 4, h: 4, data: height } } } as World;
  const palette = { ...PALETTES.parchment, shade: 0, grain: 0, hatch: 0 };
  const options = { pixels: 4, surface: height, heightRange: { min: 0, max: 100 }, exaggeration: 1 };
  const bare = renderTerrainPixels(world, palette, options).rgb;
  const wooded = renderTerrainPixels(world, palette, {
    ...options,
    canopy: { color: '#4d6338', coverageAt: x => (x >= 200 ? 1 : 0) },
  }).rgb;
  const pixel = (rgb: Uint8Array, index: number) => [...rgb.slice(index * 3, index * 3 + 3)];

  expect(pixel(wooded, 0)).toEqual(pixel(bare, 0));
  expect(pixel(wooded, 2)).toEqual(pixel(bare, 2));
  expect(pixel(wooded, 3)).not.toEqual(pixel(bare, 3));
  expect(wooded[10]).toBeGreaterThan(wooded[11]);
});
