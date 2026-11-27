/**
 * Far look of a satellite town: the scale band over which its far raster (cityFarRaster.ts) replaces the buildings.
 *
 * Part of the town's look (city/look.ts); read by the Canvas town (drawCitySteps), the GPU town (live/cityLayer.ts)
 * and the raster itself.
 */
import type { ResolvedAppearance } from '../appearanceRecipe';

/** The town look follows the satellite recipe even when the host uses a cheaper ground shader. */
export function usesSatelliteTown(appearance: ResolvedAppearance): boolean {
  const look = appearance.composition.recipe.ground.look;
  return look === 'satellite' || look === 'satellite-2' || !!appearance.traits?.satelliteVariant;
}

/** Metres per CSS pixel where the raster starts to fade in over the detailed buildings, and where it replaces them. */
export const FAR_TOWN_FADE: readonly [number, number] = [1.6, 2.2];
/** Share of the raster drawn over the detailed buildings at `mpp` (0: buildings only, 1: raster only). */
export function farTownAlpha(mpp: number): number {
  const t = Math.max(0, Math.min(1, (mpp - FAR_TOWN_FADE[0]) / (FAR_TOWN_FADE[1] - FAR_TOWN_FADE[0])));
  return t * t * (3 - 2 * t);
}
/** True when the detailed buildings are drawn under the raster (or alone). */
export const farTownBuildingsShown = (mpp: number): boolean => mpp < FAR_TOWN_FADE[1];
