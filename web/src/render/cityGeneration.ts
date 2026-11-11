import { generateToponymRecord } from '../gen/names/toponyms';
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
import { regionalStreets } from '../../../rust/bridge/urbanRoads';

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

/** Regional roads sent with a town's quarters request (and drawn as its 3D bridges) by both pages: the native road
 * segments split at their crossings (bridge, ford...) and ranked by class (highway 0, main 1, others 2). */
export const cityTownRoads = regionalStreets;
/** Site archetype of each town in the quarters request (layout `siteArchetypes`, read by urban/kinds.rs): an explicit
 * per-site rule, else the requested site type, else the archetype the placement chose. */
export function citySiteArchetypes(sites: readonly { key: string; siteType?: string; archetype?: string }[], explicit?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(sites.flatMap(s => {
    const archetype = explicit?.[s.key] ?? (s.siteType && s.siteType !== 'auto' ? s.siteType : s.archetype);
    return archetype ? [[s.key, archetype]] : [];
  }));
}

/** Quarter labels receive the same cultural place name on both pages. */
export function cityNamedSite<T extends { key: string; name?: string; culture: string }>(site: T, seed: string, language = 'auto'): T & { name: string } {
  return { ...site, name: site.name?.trim() || generateToponymRecord({ seed, key: `settlement:${site.key}`, kind: 'town', culture: site.culture, language }).cultural };
}
