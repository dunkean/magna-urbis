/**
 * Levels of detail of the town: which level a scale shows and how a level is kept at a limit.
 *
 * Part of the town's look (city/look.ts); read by both town renderers (cityCanvas.ts, cityGl.ts) and by their hosts.
 */
import type { CityLod } from '../cityCanvas';

/** Finest first. */
export const LOD_ORDER: readonly CityLod[] = ['close', 'near', 'mid', 'far'];
/** Upper metres-per-pixel bound of close, near and mid; far is everything above. */
export const CITY_LOD_LIMITS = [0.55, 2.2, 9];
/** `?lod=off`: the building level of detail is never left, whatever the scale (houses on a whole town). */
export const CITY_LOD_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lod') === 'off';
/** Level for a scale, keeping the previous one while the scale stays within `hysteresis` (relative) of its band, so a
 * zoom at a limit does not flicker. */
export function selectCityLod(mpp: number, previous?: CityLod, hysteresis = 0.15): CityLod {
  if (CITY_LOD_OFF) return mpp <= CITY_LOD_LIMITS[0] ? 'close' : 'near';
  const index = CITY_LOD_LIMITS.findIndex(limit => mpp <= limit),
    raw = LOD_ORDER[index < 0 ? 3 : index];
  if (!previous || previous === raw) return raw;
  const i = LOD_ORDER.indexOf(previous),
    low = i === 0 ? 0 : CITY_LOD_LIMITS[i - 1],
    high = i === 3 ? Infinity : CITY_LOD_LIMITS[i];
  return mpp >= low * (1 - hysteresis) && mpp <= high * (1 + hysteresis) ? previous : raw;
}
/** `lod` is `level` or finer. */
export const atLeast = (lod: CityLod, level: CityLod): boolean => LOD_ORDER.indexOf(lod) <= LOD_ORDER.indexOf(level);
