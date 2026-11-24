/** Colours of fresh water and of its bed by climate zone and season: one palette for rivers, lakes and town water in every
 * renderer, each in its own medium (display only).
 *
 * - Satellite and 3D material grounds take the tone of the zone whole (`freshWater`, uniform uFreshWater).
 * - Natural water over another ground takes most of it.
 * - Map styles keep the value of their own ink and take a share of the hue (`MEDIUM`); monochrome styles take none.
 * Dry beds and drawn-down lake shores are the same ground: `waterBed`. Sea water is not here: it stays on the style's ramp. */
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { seasonWeights } from '../../../rust/bridge/terrainRenderV2Zones';
import { mapSeasonState } from './seasonPalette';
import type { WaterStyle } from './waterStyle';

type Rgb = readonly [number, number, number];
/** Display rgb (0-1) and strength (0-1) of a tone laid over a style's own water. */
export type WaterTone = readonly [number, number, number, number];
/** Winter, spring, summer, autumn (the order of the zone calendar). */
type Year = readonly [WaterTone, WaterTone, WaterTone, WaterTone];

export const NO_WATER_TONE: WaterTone = [0, 0, 0, 0];
/** Water under the Underdark vault: black with a teal cast. */
export const CAVE_WATER_TONE: WaterTone = [0.03, 0.09, 0.1, 0.85];

const FRESH: Readonly<Record<ClimateZone, Year>> = {
  // Green-blue, silty with the spring rains.
  temperate: [
    [0.17, 0.24, 0.24, 0.45],
    [0.24, 0.28, 0.21, 0.5],
    [0.11, 0.27, 0.25, 0.5],
    [0.17, 0.24, 0.2, 0.45],
  ],
  // Clear in summer, troubled by the winter rains.
  mediterranean: [
    [0.23, 0.31, 0.28, 0.45],
    [0.15, 0.33, 0.33, 0.5],
    [0.12, 0.35, 0.35, 0.5],
    [0.2, 0.31, 0.29, 0.5],
  ],
  // Snowmelt silt, then a light tea.
  continental: [
    [0.15, 0.21, 0.23, 0.4],
    [0.28, 0.27, 0.2, 0.5],
    [0.13, 0.22, 0.18, 0.5],
    [0.16, 0.2, 0.16, 0.5],
  ],
  // Boreal tea.
  nordic: [
    [0.11, 0.13, 0.14, 0.5],
    [0.17, 0.14, 0.09, 0.6],
    [0.14, 0.12, 0.08, 0.65],
    [0.13, 0.11, 0.08, 0.65],
  ],
  // Glacial flour: milky turquoise while the glaciers melt.
  alpine: [
    [0.14, 0.32, 0.36, 0.45],
    [0.25, 0.43, 0.43, 0.5],
    [0.34, 0.55, 0.54, 0.6],
    [0.2, 0.43, 0.45, 0.5],
  ],
  arctic: [
    [0.2, 0.3, 0.34, 0.4],
    [0.26, 0.34, 0.33, 0.5],
    [0.26, 0.4, 0.41, 0.5],
    [0.2, 0.31, 0.33, 0.45],
  ],
  steppe: [
    [0.23, 0.27, 0.25, 0.45],
    [0.37, 0.34, 0.24, 0.55],
    [0.28, 0.31, 0.23, 0.5],
    [0.26, 0.28, 0.22, 0.5],
  ],
  // Jade, loaded with fine silt.
  desert: [
    [0.22, 0.33, 0.29, 0.5],
    [0.3, 0.35, 0.27, 0.5],
    [0.29, 0.35, 0.26, 0.5],
    [0.24, 0.33, 0.28, 0.5],
  ],
  // Olive in the dry season, lateritic ochre in the rains (summer).
  savanna: [
    [0.23, 0.28, 0.19, 0.5],
    [0.32, 0.28, 0.17, 0.55],
    [0.45, 0.33, 0.18, 0.7],
    [0.36, 0.3, 0.18, 0.6],
  ],
  // Brown-green, browner in the rains.
  tropical: [
    [0.21, 0.26, 0.14, 0.55],
    [0.25, 0.26, 0.14, 0.55],
    [0.33, 0.28, 0.16, 0.65],
    [0.29, 0.27, 0.15, 0.6],
  ],
  // Bog water.
  wetland: [
    [0.15, 0.16, 0.11, 0.5],
    [0.17, 0.18, 0.1, 0.55],
    [0.15, 0.18, 0.09, 0.6],
    [0.16, 0.16, 0.09, 0.6],
  ],
};
/** Bare channel and shore ground. Every bed leans red (r - b of at least .15): the terrain shader tells the ground of the
 * painted water layer from its water by that lean. */
const DEFAULT_BED: Rgb = [0.74, 0.64, 0.46];
const BED: Readonly<Record<ClimateZone, Rgb>> = {
  temperate: [0.62, 0.56, 0.44],
  mediterranean: [0.77, 0.71, 0.57],
  continental: [0.6, 0.54, 0.42],
  nordic: [0.57, 0.51, 0.39],
  alpine: [0.66, 0.61, 0.48],
  arctic: [0.58, 0.53, 0.41],
  steppe: [0.7, 0.61, 0.45],
  desert: [0.79, 0.68, 0.49],
  savanna: [0.7, 0.53, 0.36],
  tropical: [0.62, 0.48, 0.32],
  wetland: [0.5, 0.43, 0.31],
};

export interface WaterDate {
  zone?: ClimateZone;
  season?: number;
}
/** Tone of the fresh water of a zone at a point of the year; none without a zone. */
export function freshWater({ zone, season = 0.5 }: WaterDate): WaterTone {
  if (!zone) return NO_WATER_TONE;
  const w = seasonWeights(season),
    year = FRESH[zone],
    blend = (c: number): number => year.reduce((sum, tone, s) => sum + tone[c] * w[s], 0);
  return [blend(0), blend(1), blend(2), blend(3)];
}
/** Ground of dry channels and exposed lake shores (display rgb, 0-1). */
export const waterBed = (zone?: ClimateZone): Rgb => (zone ? BED[zone] : DEFAULT_BED);

/** Share of the tone a style takes. From `NATURAL` up the water is a material and takes the tone's own value. The satellite
 * looks tone their water in the shader: their vector ink is only a coverage, and an ochre one would read as a bed there. */
const NATURAL = 0.85;
const MEDIUM: Readonly<Record<string, number>> = { parchment: 0.22, atlas: 0.4, watabou: 0.3, engraving: 0, cadastre: 0.3, blueprint: 0, illuminated: 0.3, topographic: 0.4, white: 0, night: 0, minimal: 0.35, 'fantasy-ink': 0, 'fantasy-color': 0.3, 'parchment-render': 0, copernicus: 0 };
const medium = (style: string): number => MEDIUM[style] ?? (style.startsWith('render-v2') ? 0 : NATURAL);

const channels = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const toHex = (c: readonly number[]): string =>
  '#' +
  c
    .map(v =>
      Math.round(255 * Math.max(0, Math.min(1, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const luminance = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const isHex = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);
const mixed = (base: string, over: readonly number[], share: number): string => toHex(channels(base).map((v, i) => v + (over[i] - v) * share));

/** The current map season's tone in a style whose own water is `base` (its shore stop). */
export function mapFreshTone(style: string, base: string): WaterTone {
  const share = medium(style),
    { zone, season } = mapSeasonState(),
    tone = freshWater({ zone, season });
  if (share <= 0 || tone[3] <= 0 || !isHex(base)) return NO_WATER_TONE;
  const value = share >= NATURAL ? 1 : luminance(channels(base)) / Math.max(0.02, luminance(tone));
  return [Math.min(1, tone[0] * value), Math.min(1, tone[1] * value), Math.min(1, tone[2] * value), tone[3] * share];
}
/** Colour `c` of a style's water under a tone. */
export const tonedWater = (c: string, tone: WaterTone): string => (tone[3] > 0 && isHex(c) ? mixed(c, tone, tone[3]) : c);
/** Vector river and lake colour of a style in the current map season. */
export const freshWaterInk = (style: string, base: string): string => tonedWater(base, mapFreshTone(style, base));
/** Lake ramp of a style in the current map season. */
export function freshWaterRamp(style: string, water: WaterStyle): WaterStyle {
  const tone = mapFreshTone(style, water.stops[0][1]);
  return tone[3] > 0 ? { ...water, stops: water.stops.map(([t, c]) => [t, tonedWater(c, tone)] as const) } : water;
}
/** uFreshWater of the 3D views: the satellite ground's own tone, or that of the natural water over a draped map. */
export function freshWater3d(ground?: { renderV2?: number; climateZone?: ClimateZone; v2Season?: number }): WaterTone {
  return ground?.renderV2 ? freshWater({ zone: ground.climateZone, season: ground.v2Season }) : mapFreshTone('render3d', '#1a4d5c');
}
/** Bed ink of a style in the current map zone: the zone's bed on material grounds, the style's own wash tinted on maps. */
export function waterBedInk(style: string, wash: string): string {
  const { zone } = mapSeasonState(),
    share = medium(style);
  if (!zone || share <= 0) return wash;
  return mixed(wash, waterBed(zone), share >= NATURAL ? 1 : share);
}

/** Grass cover of a dry ditch by zone; the rest is bare earth. */
const DITCH_GRASS: Readonly<Record<ClimateZone, number>> = { temperate: 0.85, mediterranean: 0.45, continental: 0.8, nordic: 0.7, alpine: 0.8, arctic: 0.4, steppe: 0.5, desert: 0.05, savanna: 0.5, tropical: 0.9, wetland: 0.95 };
const GRASS: Rgb = [0.4, 0.47, 0.27],
  SNOW: Rgb = [0.9, 0.92, 0.92];
/** Bottom of a dry moat in the current map season: grass in the season's colours over the zone's earth, under its snow. */
export function dryDitchColour(): string {
  const { zone, paint } = mapSeasonState();
  if (!zone || !paint) return '#8a7a5e';
  const ground = waterBed(zone).map((v, i) => 0.78 * v + (GRASS[i] * paint.herb[i] - 0.78 * v) * DITCH_GRASS[zone]);
  return toHex(ground.map((v, i) => v + (SNOW[i] - v) * 0.8 * paint.snow));
}

/** Fresh water of the material shaders: the tone over the water's own colour, which keeps its depth. */
export const FRESH_WATER_GLSL = `
uniform vec4 uFreshWater;
vec3 freshWaterTone(vec3 c){return mix(c,uFreshWater.rgb,uFreshWater.a);}
`;
