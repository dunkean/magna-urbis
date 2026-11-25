import { describe, expect, it } from 'vitest';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { drapeFootprintDepth, drapeLevels, drapeTier } from '../src/render/world/footprint';
import { DRAPE_COARSE_TIERS, drapeLayers } from '../src/render/world/mapDrape';
import { PatchList, lodEyeHeight, patchLevels, patchRatio, selectPatches, type PatchQuery } from '../src/render/world/patches';
import { MAX_SCALE, type View } from '../src/render/view';

const MAP = 40000,
  TILE = 512;

/** Distinct drape tiles the squares of a tilted frame ask for (drapedGround.ts `select`), on a flat 40 km map. */
function tilesWanted(view: View, cssW: number, cssH: number, dpr: number, quality: 'full' | 'light'): number {
  const camera = createFrameCamera(),
    width = cssW * dpr,
    height = cssH * dpr;
  frameCamera(camera, view, cssW, cssH, width, height, dpr);
  const finest = Math.ceil(Math.log2((MAX_SCALE * dpr) / (TILE / MAP)) - 1e-9);
  const query: PatchQuery = { mapSize: MAP, levels: Math.max(patchLevels(2048), drapeLevels(camera.focal, lodEyeHeight(camera), MAP, TILE, finest)), ratio: patchRatio(camera.focal / dpr, quality), low: 0, high: 0, tanX: width / (2 * camera.focal), tanY: height / (2 * camera.focal) },
    list = new PatchList();
  selectPatches(list, camera, query);
  const seen = new Set<string>();
  for (let i = 0; i < list.count; i++) {
    const shown = drapeTier(camera.focal, drapeFootprintDepth(list.depth[i], lodEyeHeight(camera)), MAP, TILE, list.tier[i], finest),
      shift = list.tier[i] - shown;
    seen.add(`${shown}/${list.ix[i] >> shift}/${list.iy[i] >> shift}`);
  }
  return seen.size;
}
function most(cssW: number, cssH: number, dpr: number, quality: 'full' | 'light', pitches: readonly number[]): number {
  let max = 0;
  for (const pitch of pitches) for (const scale of [0.05, 0.2, 0.6, 1.5, 6, 30]) for (const yaw of [0, 0.7, 2.4]) max = Math.max(max, tilesWanted({ cx: 20000, cy: 20000, scale, pitch: (pitch * Math.PI) / 180, yaw }, cssW, cssH, dpr, quality));
  return max;
}
/** Tiles the drape holds besides the coarse tiers (4^0 + 4^1 tiles) and the layer of the bake under way. */
const room = (quality: 'full' | 'light'): number => drapeLayers(quality) - 1 - (4 ** DRAPE_COARSE_TIERS - 1) / 3;

describe('budget of the map drape', () => {
  it('resolves foreground water above the height-grid tier and spends fewer texels at the horizon', () => {
    expect(drapeLevels(1000, 100, MAP, TILE, 16)).toBeGreaterThan(patchLevels(256));
    expect(drapeFootprintDepth(100, 100)).toBe(100);
    expect(drapeFootprintDepth(400, 100)).toBe(800);
  });
  it('holds every tile a 1600 x 1000 tilted view asks for, up to the steepest tilt', () => {
    const pitches = [20, 40, 55, 62, 70];
    // The numbers of the header of mapDrape.ts.
    expect(most(1600, 1000, 1, 'full', [55])).toBe(41);
    expect(most(1600, 1000, 1, 'full', pitches)).toBe(59);
    expect(most(1600, 1000, 2, 'full', [55])).toBe(75);
    expect(most(1600, 1000, 2, 'full', pitches)).toBe(102);
    expect(most(1600, 1000, 2, 'full', pitches)).toBeLessThanOrEqual(room('full'));
    expect(most(1600, 1000, 2, 'light', pitches)).toBeLessThanOrEqual(room('light'));
  });
  it('holds the near tiles of a 2560 x 1440 view at both pixel ratios', () => {
    expect(most(2560, 1440, 1, 'full', [55, 70])).toBeLessThanOrEqual(room('full'));
    expect(most(2560, 1440, 2, 'full', [55, 70])).toBeLessThanOrEqual(room('full'));
  });
});
