/**
 * City display contract shared by the V2 and City Bench.
 *
 * The V2 is the reference renderer; City Bench and the v7 sheets must show the same city.
 * Every display choice that both pages make (building architecture, 2D engine, defaults)
 * lives here and both pages import it. Do not fork a choice in one page only: change it
 * here, and `web/tests/v2/cityParity.test.ts` keeps the two pages honest.
 */
import type { UrbanSceneMode } from '../ui/urbanSceneProtocol';
import { DEFAULT_CITY, DEFAULT_CITY_LAYERS, type ResolvedAppearance } from './appearanceRecipe';
import { cityGlBlocker, type RenderMode } from './renderMode';

/** Building architecture: city volumes raised by `urban/massing.rs` (silhouettes),
 * or native house plans from the houses crate (compact plans, detailed houses). */
export type CityArchitecture = UrbanSceneMode;
export const CITY_ARCHITECTURES: readonly CityArchitecture[] = ['silhouette', 'compact', 'detailed'];
/** City volumes are the default display in both pages: fast, follow the city silhouette, windows in 3D. */
export const DEFAULT_CITY_ARCHITECTURE: CityArchitecture = 'silhouette';
export const cityArchitectureOf = (value: unknown): CityArchitecture =>
  CITY_ARCHITECTURES.includes(value as CityArchitecture) ? value as CityArchitecture : DEFAULT_CITY_ARCHITECTURE;

/** Display defaults of one city: the V2 table (`appearanceRecipe.ts`), imported by City Bench instead of a private copy. */
export const CITY_DISPLAY_DEFAULTS = Object.freeze({
  view: DEFAULT_CITY.view, palette: DEFAULT_CITY.palette, buildingStyle: DEFAULT_CITY.buildingStyle,
  opacity: DEFAULT_CITY.opacity, width: DEFAULT_CITY.width, groundBlend: DEFAULT_CITY.groundBlend,
  layers: DEFAULT_CITY_LAYERS,
});

/** Building plans drawn by the native house renderer (houses crate: compact, detailed). City volumes
 * (`generator_version: 'silhouette'`) are plan silhouettes with roof pans and shadows (cityMassing.ts),
 * drawn by cityGl, or by drawCity on the Canvas 2D path, in both pages. */
export const usesNativeHouseRenderer = (scene: { generator_version?: string } | undefined): boolean =>
  !!scene && scene.generator_version !== 'silhouette';

/** The 2D city engine rule of both pages (`render=auto|gpu|cpu`). WebGL2 (cityGl) draws the plan and
 * the city volumes unless this returns why Canvas 2D (drawCity) must draw the frame instead. */
export function cityGlBlockReason(o: {
  mode: RenderMode; appearance: ResolvedAppearance; palette: string; ready: boolean; compare?: boolean;
}): string | null {
  const base = cityGlBlocker({ mode: o.mode, compare: !!o.compare, parchment: o.palette === 'parchment', ready: o.ready });
  if (base) return base;
  const r = o.appearance, c = r.composition;
  if (c.landuse.urban !== 'off') return 'urban-landuse';
  if (c.networks.roads.look === 'natural') return 'natural-roads';
  if (r.city.buildingStyle !== 'cartographic') return 'building-style';
  if (r.city.painted) return 'painted';
  if (c.ambience === 'night') return 'night';
  return null;
}

const NO_REGIONAL_STREETS: readonly import('../../../rust/bridge/urban').Street[] = Object.freeze([]);
/** Hidden roads keep a stable input identity: they must not rebuild bridges and ground tiles on every refresh. */
export function cityRegionalStreets(appearance: ResolvedAppearance, roads: readonly import('../../../rust/bridge/urban').Street[]) {
  return appearance.composition.networks.roads.visible ? roads : NO_REGIONAL_STREETS;
}
