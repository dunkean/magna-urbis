import { describe, expect, it } from 'vitest';
import { renderTerrainPixels } from '../src/render/raster';
import { DEFAULT_TERRAIN_LIGHTING, terrainLights } from '../src/render/terrainLighting';
import { PALETTES } from '../src/render/styles';
import type { World } from '../src/gen/types';

describe('terrain lighting', () => {
  const n = 4;
  const surface = Float32Array.from({ length: n * n }, (_, i) => 100 + (i % n) * 10);
  const world = { mapSize: 40, terrain: { height: { w: n, h: n, cell: 10, data: surface }, water: new Uint8Array(n * n) } } as unknown as World;
  const pal = { ...PALETTES.parchment, hatch: 0, grain: 0 };
  const render = (lighting = DEFAULT_TERRAIN_LIGHTING) => renderTerrainPixels(world, pal, { pixels: n, surface, exaggeration: 2, heightRange: { min: 100, max: 130 }, lighting }).rgb;

  it('preserves the fixed renderer at the default settings', () => {
    const original = renderTerrainPixels(world, pal, { pixels: n, surface, exaggeration: 2, heightRange: { min: 100, max: 130 } }).rgb;
    expect(render()).toEqual(original);
  });

  it('reverses the illuminated slope when the sun rotates by 180 degrees', () => {
    const west = render(), east = render({ ...DEFAULT_TERRAIN_LIGHTING, azimuth: 135 });
    expect(west[0]).toBeGreaterThan(east[0]);
    expect(surface).toEqual(world.terrain.height.data);
  });

  it('disabling hillshade removes all direction and strength effects', () => {
    expect(render({ ...DEFAULT_TERRAIN_LIGHTING, enabled: false })).toEqual(render({ ...DEFAULT_TERRAIN_LIGHTING, enabled: false, azimuth: 135, elevation: 5, strength: 3 }));
  });

  it('keeps the light finite at a zenith sun', () => {
    const lights = terrainLights({ ...DEFAULT_TERRAIN_LIGHTING, elevation: 90 });
    expect([...lights.primary, ...lights.secondary, lights.flat].every(Number.isFinite)).toBe(true);
    expect(lights.primary[0]).toBeCloseTo(0);
  });
});
