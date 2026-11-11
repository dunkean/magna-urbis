/**
 * Generation defaults shared by the V2 and City Bench for one city (V2 values).
 * Layout and parcel configs already come from `rust/bridge/urbanConfig.ts` (`defaultLayoutConfig`,
 * `defaultParcelConfig`) in both pages; what lives here is what the pages used to fork.
 * `web/tests/v2/cityParity.test.ts` keeps both honest.
 */
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import { settlementRaster, type SettlementRaster } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { defaultLayoutConfig } from '../../../rust/bridge/urbanConfig';

/** Side of the settlement raster sent to the engine for city generation. */
export const CITY_RASTER_RESOLUTION = 1024;
/** Houses adapt their size to the lot unless the user turns it off (V2 field `houses.parcel_fit`). */
export const CITY_DEFAULT_PARCEL_FIT = true;
/** The native engine reads a missing `parcel_fit` as true (`parcel_fit == Some(false)` is the only refusal). */
export const parcelFitOf = (settings?: PlacementBatchSettings): boolean => settings?.parcel_fit !== false;

/** Maps wider than this plan on the native terrain side, not on the (coarser) display grid. */
export const CITY_NATIVE_RASTER_MAP_SIZE = 40000;
/** Side of the settlement raster sent to the engine (V2 rule): the display grid side, or on a map above
 * 40 km with a grid under 1024 the native terrain side (at least 16, at most 1024). */
export const cityRasterSide = (o: { mapSize: number; gridSide: number; nativeSide?: number }): number =>
  o.mapSize > CITY_NATIVE_RASTER_MAP_SIZE && o.nativeSide && o.gridSide < CITY_RASTER_RESOLUTION
    ? Math.min(CITY_RASTER_RESOLUTION, Math.max(16, o.nativeSide)) : o.gridSide;
/** Settlement raster of a native terrain for city generation and display (City Bench): the same rule, the grid being the native terrain. */
export function citySettlementRaster(t: TerrainData): SettlementRaster {
  const side = t.physical?.n ?? t.resolution;
  return settlementRaster(t, Math.min(CITY_RASTER_RESOLUTION, cityRasterSide({ mapSize: t.width, gridSide: side, nativeSide: side })));
}

/** Reviewed v7 generation choices are the city defaults, not hidden sheet-only switches.
 * Explicit layout values (including false and zero) still override these defaults. */
export const CITY_LAYOUT_DEFAULTS = Object.freeze({ naturalCampApproaches: true, streetFrontage: true, alignEnclosedGrid: true,
  hideUnusedQuarters: true, organicBranchVariation: .5, ribbonWidthVariation: .5 });
export function defaultCityLayoutConfig(): import('../../../rust/bridge/urbanConfig').LayoutConfig {
  return { ...defaultLayoutConfig(), ...CITY_LAYOUT_DEFAULTS };
}
