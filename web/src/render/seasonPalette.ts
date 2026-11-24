/** The season of the vector map styles: one palette per point of the zone's year, on top of the biome palette.
 *
 * The material styles read the same calendar in their shaders (`ZONE_SEASONS`). Held as display state, like the forest tone:
 * the palette is resolved in many places and every one of them must agree. */
import { calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import { CLIMATE_ZONE_VALUES, type ClimateValues, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { AUTUMN_CROWN_MEAN } from '../../../rust/bridge/terrainForestSeason';
import type { Palette } from './styles';

export interface SeasonPaint {
  /** Colour ratio of the herbs to their own summer (the palettes are authored in summer). */
  herb: readonly [number, number, number];
  leaf: number;
  evergreen: number;
  snow: number;
  spring: number;
  autumn: number;
  seaIce: number;
  winter: number;
}
const SNOW = '#f1f3ef',
  BARE_WOOD = '#8d8373',
  SPRING_WOOD = '#a6bc72',
  YOUNG_CROP = '#b4c47c',
  STUBBLE = '#c29a5c';
let season = 0.5,
  zone: ClimateZone | undefined,
  calendar: SeasonCalendar | undefined;
let climate: ClimateValues | undefined;
export function setMapSeason(next: number, nextZone: ClimateZone | undefined = zone, nextCalendar: SeasonCalendar | undefined = calendar): void {
  season = next;
  zone = nextZone;
  calendar = nextCalendar;
}
/** The benches load a map apart from the appearance that sets the season. */
export function setMapClimateZone(next: ClimateZone | undefined, values?: ClimateValues): void {
  zone = next;
  climate = values;
}
/** Physical snow on level ground at a town's altitude. CPU counterpart of
 * terrainRenderV2 v2Local/v2Snow: lapse rate, lag, supply, thaw and perennial floor.
 * Field-scale drift noise is averaged out at town scale. */
export interface GroundSnowSettings {
  season: number;
  climateZone?: ClimateZone;
  climate: Pick<ClimateValues, 'temperature' | 'precipitation'>;
  calendar?: SeasonCalendar;
}
export function mapGroundSnow(altitude = 0, settings?: GroundSnowSettings): number {
  const snowZone = settings?.climateZone ?? zone;
  if (!snowZone) return 0;
  const c = settings?.climate ?? climate ?? CLIMATE_ZONE_VALUES[snowZone],
    year = calendarSeason(snowZone, settings ? settings.calendar : calendar),
    date = settings?.season ?? season;
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const annual = c.temperature - 0.0065 * Math.max(0, altitude),
    amplitude = 6 + 0.5 * Math.max(0, 10 - c.temperature);
  const warm = annual + amplitude,
    cold = annual - amplitude - year.cool;
  const phase = 0.5 - 0.5 * Math.cos(2 * Math.PI * (date - 0.08));
  const w = seasonWeights(date),
    thaw = (year.thaw ?? [0, 0, 0, 0]).reduce((sum, v, i) => sum + v * w[i], 0);
  const supply = smooth(0.12, 0.7, c.precipitation / Math.max(120, 10 * (warm + cold) + 280));
  const cover = Math.max(smooth(2, -5, cold + (warm - cold) * phase + thaw), smooth(2.5, -2.5, warm)) * supply;
  return smooth(0.405, 0.465, cover);
}
/** Snow of the paper ground at an altitude (0-1): the low-ground snow of the zone's calendar, more where the climate
 * keeps it. */
export const mapSnowCover = (altitude = 0): number => (zone ? Math.max(seasonPaint(season, zone, calendar).snow, mapGroundSnow(altitude)) : 0);
/** Seasonal colour ratio of the open ground. */
export const mapHerbTint = (): SeasonPaint['herb'] => (zone ? seasonPaint(season, zone, calendar).herb : [1, 1, 1]);
/** The climate zone of the map and its calendar, for what grows on it (treeSpecies.ts). */
export const mapZone = (): { zone: ClimateZone | undefined; larch: number } => ({ zone, larch: zone ? calendarSeason(zone, calendar).larch : 0 });
/** Crown state of the map season, for the town crowns painted over natural grounds (cityGrove.ts): leaf fullness,
 * spring and autumn weights, winter leaf of the zone (evergreen share) and the calendar's crown snow setting. */
export function mapCrownSeason(): { leaf: number; spring: number; autumn: number; evergreen: number; crownSnow: number } {
  if (!zone) return { leaf: 1, spring: 0, autumn: 0, evergreen: 1, crownSnow: 0.7 };
  const s = seasonPaint(season, zone, calendar);
  return { leaf: s.leaf, spring: s.spring, autumn: s.autumn, evergreen: s.evergreen, crownSnow: calendar?.crownSnow ?? 0.7 };
}
/** Altitudes (m) whose snow tells two dates apart for what only wears the ground snow. */
const SNOW_LEVELS = Array.from({ length: 17 }, (_, i) => i * 250);
let snowKey: { season: number; zone: ClimateZone | undefined; calendar: SeasonCalendar | undefined; climate: ClimateValues | undefined; key: string } | undefined;
/** Part of the cache keys of what depends on the season through the ground snow alone (roofs, roads, river ice): dates
 * with the same snow share it, so that a bare spring and a bare autumn recolour nothing. */
export function roofSeasonKey(): string {
  if (snowKey?.season !== season || snowKey.zone !== zone || snowKey.calendar !== calendar || snowKey.climate !== climate)
    snowKey = { season, zone, calendar, climate, key: SNOW_LEVELS.map(level => mapGroundSnow(level).toFixed(3)).join() };
  return snowKey.key;
}
/** Zone and date of the map, with the zone's year there: the water palette reads them (waterPalette.ts). */
export const mapSeasonState = (): { zone?: ClimateZone; season: number; paint?: SeasonPaint } => ({ zone, season, ...(zone ? { paint: seasonPaint(season, zone, calendar) } : {}) });
/** Part of every cache key of a seasonal map layer. */
export const mapSeasonKey = (): string => (zone ? `${zone}:${Math.round(season * 100)}:${JSON.stringify(calendar ?? {})}` : '');

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const hex = (c: readonly number[]): string =>
  '#' +
  c
    .map(x =>
      Math.round(Math.max(0, Math.min(255, x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const isHex = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);
const mix = (a: string, b: string, t: number): string => {
  if (!isHex(a)) return a;
  const A = rgb(a),
    B = rgb(b);
  return hex(A.map((x, i) => x + (B[i] - x) * t));
};
const tinted = (c: string, ratio: readonly number[]): string => (isHex(c) ? hex(rgb(c).map((x, i) => x * ratio[i])) : c);

/** The zone's year at this point of the cycle. */
export function seasonPaint(value: number, climateZone: ClimateZone, edits?: SeasonCalendar): SeasonPaint {
  const w = seasonWeights(value),
    year = calendarSeason(climateZone, edits),
    blend = (row: readonly number[]): number => row.reduce((sum, v, i) => sum + v * w[i], 0),
    herb = [0, 1, 2].map(i => blend(year.herb.map(c => c[i])) / year.herb[2][i]) as unknown as SeasonPaint['herb'];
  return { herb, leaf: blend(year.leaf), evergreen: year.leaf[0], snow: blend(year.snow), spring: w[1], autumn: w[3], seaIce: blend(year.seaIce), winter: w[0] };
}

/** Cartographic water follows the same calendar as land; shore ice is strongest at the coastal end. */
const waterSources = new WeakMap<Palette, Palette>();
function waterSeason(pal: Palette, s: SeasonPaint): Palette {
  const source = waterSources.get(pal) ?? pal;
  const water = { ...source.water, stops: source.water.stops.map(([position, color]) => [position, mix(mix(color, '#365566', 0.16 * s.winter + 0.05 * s.autumn), '#d7e3e7', s.seaIce * (0.92 - 0.55 * Math.min(1, position)))] as const) };
  const result = { ...pal, water, riverFill: water.stops[0][1], waterEdge: water.stops[0][1], lakeFill: water.stops.at(-1)![1], seaFill: water.stops.at(-1)![1] };
  waterSources.set(result, source);
  return result;
}
/** Crops follow the herbs: green while they grow, ochre once they ripen or lie dry. */
function cropTone(c: string, herb: SeasonPaint['herb']): string {
  const growing = Math.min(1, Math.max(0, herb[1] / herb[0] - 1) * 2.5),
    ripe = Math.min(1, Math.max(0, herb[0] / herb[1] - 1) * 2.5),
    value = (herb[0] + herb[1] + herb[2]) / 3;
  return tinted(mix(mix(c, YOUNG_CROP, 0.4 * growing), STUBBLE, 0.3 * ripe), [Math.min(1, value + 0.1), Math.min(1, value + 0.1), Math.min(1, value + 0.1)]);
}
/** Same population hue as the ground's unresolved crowns, retaining each map token's exposure. */
function autumnWood(c: string, s: SeasonPaint): string {
  if (!isHex(c)) return c;
  const color = rgb(c),
    fall = s.autumn * (1 - s.evergreen),
    lum = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  return hex(color.map((v, i) => v * (1 - fall * AUTUMN_CROWN_MEAN.weight) + lum * AUTUMN_CROWN_MEAN.hue[i] * fall));
}
function woodTone(c: string, s: SeasonPaint): string {
  const deciduous = 1 - s.evergreen;
  return mix(autumnWood(mix(c, BARE_WOOD, 0.7 * (1 - s.leaf)), s), SPRING_WOOD, 0.15 * s.spring * deciduous);
}
/** Land use and water share the calendar; paper and relief keep their authored tones. */
export function applySeason(pal: Palette, s: SeasonPaint, crownSnow = 0.7): Palette {
  const snowed = (c: string, cover = 0.85): string => mix(c, SNOW, s.snow * cover);
  const herbs = (c: string): string => snowed(tinted(c, s.herb));
  const crops = (c: string): string => snowed(cropTone(c, s.herb), 0.8);
  const wood = (c: string): string => snowed(woodTone(c, s), 0.4);
  return {
    ...waterSeason(pal, s),
    land: {
      ...pal.land,
      field: crops(pal.land.field),
      meadow: herbs(pal.land.meadow),
      pasture: herbs(pal.land.pasture),
      commons: herbs(pal.land.commons),
      garden: herbs(pal.land.garden),
      orchard: wood(pal.land.orchard),
      forest: wood(pal.land.forest),
      marsh: herbs(pal.land.marsh),
    },
    stripA: crops(pal.stripA),
    stripB: crops(pal.stripB),
    furrow: snowed(pal.furrow, 0.6),
    hedge: wood(pal.hedge),
    treeFill: wood(pal.treeFill),
    treeInk: snowed(autumnWood(pal.treeInk, s), 0.25),
    season: { fill: pal.treeFill, ink: pal.treeInk, leaf: s.leaf, autumn: s.autumn * (1 - s.evergreen), spring: s.spring * (1 - s.evergreen), snow: Math.min(1, s.snow * crownSnow * 1.25) },
    orchardDot: snowed(pal.orchardDot, 0.25),
    grass: snowed(tinted(pal.grass, s.herb), 0.6),
    reed: snowed(tinted(pal.reed, s.herb), 0.5),
  };
}
const MONOCHROME = new Set(['engraving', 'blueprint', 'night', 'white']);
const cache = new WeakMap<Palette, Map<string, Palette>>();
/** Terrain material ramps need the water tokens alone; biomePalette owns seasonal land. */
export function seasonalWaterPalette(pal: Palette): Palette {
  const key = mapSeasonKey();
  if (!key || MONOCHROME.has(pal.name)) return pal;
  let entries = cache.get(pal);
  if (!entries) cache.set(pal, (entries = new Map()));
  let found = entries.get(`water:${key}`);
  if (!found) entries.set(`water:${key}`, (found = waterSeason(pal, seasonPaint(season, zone!, calendar))));
  return found;
}
/** Small shared material payload, also bound for the draped-map 3D shader. */
export function waterSeasonUniforms(value = season, climateZone = zone, edits = calendar): [number, number] {
  if (!climateZone) return [0, 0];
  const paint = seasonPaint(value, climateZone, edits);
  return [paint.winter, paint.seaIce];
}
/** Same palette object for the same season: renderers compare palettes by identity. */
export function seasonalPalette(pal: Palette): Palette {
  const key = mapSeasonKey();
  if (!key || MONOCHROME.has(pal.name)) return pal;
  let entries = cache.get(pal);
  if (!entries) cache.set(pal, (entries = new Map()));
  let found = entries.get(key);
  if (!found) {
    entries.set(key, (found = applySeason(pal, seasonPaint(season, zone!, calendar), calendar?.crownSnow)));
  }
  return found;
}
