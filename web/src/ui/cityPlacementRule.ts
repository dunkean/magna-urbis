// One-city placement rule shared by City Bench (terrainSettlements, citybench) and the V2 (v2/testHook.ts).
// The site itself is chosen by the Rust settlement engine (`settlements::place`, list mode); this module only
// writes the request both pages send: the culture's site preferences and the edge margin that keeps the framed town on the map.
import { getCulture } from '../gen/urban/culture';
import type { Point, SettlementConfig, SettlementSpec } from '../../../rust/bridge/settlements';

/** settlements::extent_radius: the radius of a town of `population` people, in metres. */
export const extentRadius = (population: number): number => population < 1000 ? 20 + 9 * Math.sqrt(population) : 20 + 9 * Math.sqrt(1000) * (population / 1000) ** 0.4;

/** The culture's site preferences under the spec's own (City Bench `prefs`). */
export function withCulturePrefs(spec: SettlementSpec): SettlementSpec {
  const p = getCulture(spec.culture).sitePrefs ?? {};
  return { ...spec, sitePrefs: { mountainFace: p.mountainFace ?? 0, woodland: p.woodland ?? 0, weights: { ...p.weights }, ...spec.sitePrefs } };
}

/** The placement request of a configuration: every spec carries its culture's site preferences. */
export function cityPlacementRequest(config: SettlementConfig): SettlementConfig {
  return { ...config, main: withCulturePrefs(config.main), list: config.list.map(withCulturePrefs) };
}

/**
 * Edge margin (share of the map width) that keeps the whole town and its 2D frame (about 1.25 extent radii + 60 m) on the map.
 * Rust placement asks edge >= edgeMargin * width + 0.8 * radius + 40 m. Never below `current`, at most 0.3.
 */
export function framedEdgeMargin(population: number, width: number, current = 0.03): number {
  const radius = extentRadius(population);
  return Math.min(0.3, Math.max(current, Math.ceil((0.45 * radius + 20) / width * 100) / 100));
}

/** The 2D view that frames a city extent in a viewport (City Bench "City" button). */
export function cityFocusView(extent: { center: Point; radius: number }, width: number, height: number): { cx: number; cy: number; scale: number } {
  return { cx: extent.center.x, cy: extent.center.y, scale: Math.min(width, height) / Math.max(200, 2.4 * extent.radius) };
}
