import { describe, expect, it } from 'vitest';
import { FAR_TOWN_FADE, farTownAlpha, farTownBuildingsShown } from '../src/render/cityFarRaster';

describe('far town raster', () => {
  it('cross-fades from the buildings to the raster across the fade band, without a gap', () => {
    expect(farTownAlpha(1)).toBe(0);
    expect(farTownAlpha(FAR_TOWN_FADE[1])).toBe(1);
    expect(farTownAlpha(20)).toBe(1);
    let last = 0;
    for (let mpp = FAR_TOWN_FADE[0]; mpp <= FAR_TOWN_FADE[1]; mpp += .05) { const a = farTownAlpha(mpp); expect(a).toBeGreaterThanOrEqual(last); last = a; }
    // Below the top of the band the buildings are drawn; above it the raster alone stands for them, fully opaque.
    expect(farTownBuildingsShown(FAR_TOWN_FADE[1] - .01)).toBe(true);
    expect(farTownBuildingsShown(FAR_TOWN_FADE[1])).toBe(false);
  });
});
