import type { Palette } from './styles';
import { waterRamp } from './waterStyle';

/** Display tokens only. Never write these colours into generated geometry or materials. */
export const COLOR_GROUPS = {
  ground: ['paper', 'groundLow', 'groundHigh'],
  cover: ['contour', 'forest', 'meadow', 'field'],
  roads: ['road', 'roadEdge', 'track'],
  water: ['waterShore', 'waterDeep', 'river'],
  buildings: ['building', 'buildingEdge'],
} as const;
export type RenderColorKey = typeof COLOR_GROUPS[keyof typeof COLOR_GROUPS][number];
export type RenderColors = Partial<Record<RenderColorKey, string>>;
export const COLOR_KEYS = Object.values(COLOR_GROUPS).flat() as RenderColorKey[];
export const isRenderColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function validateRenderColors(value: unknown): asserts value is RenderColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('appearance.colors: expected an object.');
  for (const [key, color] of Object.entries(value))
    if (!COLOR_KEYS.includes(key as RenderColorKey) || !isRenderColor(color)) throw new Error(`appearance.colors.${key}: expected a #RRGGBB colour token.`);
}
export function paletteColors(p: Palette): Required<RenderColors> {
  return { paper: p.paper, groundLow: p.hypso[0][1], groundHigh: p.hypso.at(-1)![1], contour: p.contour,
    forest: p.land.forest, meadow: p.land.meadow, field: p.land.field,
    road: p.roadFill, roadEdge: p.roadEdge, track: p.trackFill,
    waterShore: p.water.stops[0][1], waterDeep: p.water.stops.at(-1)![1], river: p.riverFill,
    building: p.urban.mass, buildingEdge: p.urban.massEdge };
}
/** Return an isolated palette. Empty overrides preserve palette identity and historical pixels. */
export function applyRenderColors(p: Palette, colors?: RenderColors): Palette {
  if (!colors || !Object.keys(colors).length) return p;
  const c = { ...paletteColors(p), ...colors };
  return { ...p, paper: c.paper, contour: c.contour,
    hypso: colors.groundLow || colors.groundHigh ? [[0, c.groundLow], [1, c.groundHigh]] : p.hypso,
    land: { ...p.land, forest: c.forest, meadow: c.meadow, field: c.field },
    treeFill: colors.forest ?? p.treeFill,
    roadFill: c.road, roadEdge: c.roadEdge, trackFill: c.track,
    rural: colors.track ? { ...p.rural, ink: c.track } : p.rural,
    water: colors.waterShore || colors.waterDeep ? { ...waterRamp(c.waterShore, c.waterDeep), bandFraction: p.water.bandFraction } : p.water,
    waterEdge: colors.waterShore ?? p.waterEdge, seaFill: colors.waterDeep ?? p.seaFill,
    lakeFill: colors.waterDeep ?? p.lakeFill, riverFill: c.river, riverEdge: colors.river ?? p.riverEdge,
    urban: { ...p.urban, mass: c.building, massEdge: c.buildingEdge, street: colors.road ?? p.urban.street, streetEdge: colors.roadEdge ?? p.urban.streetEdge } };
}

/** Physical satellite materials and diagnostic scales keep their own semantic colours. */
export function supportsRenderColor(key: RenderColorKey, style: string): boolean {
  if (['groundLow', 'groundHigh'].includes(key)) return !/^(render|fantasy|copernicus)/.test(style);
  if (['forest', 'meadow'].includes(key)) return !/^(render|fantasy|copernicus)/.test(style);
  if (['waterShore', 'waterDeep', 'river'].includes(key)) return !style.startsWith('render-v2');
  if (key === 'contour') return !/^(fantasy|copernicus)/.test(style);
  return true;
}
