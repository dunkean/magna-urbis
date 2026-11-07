/** The season of the vector map styles: one palette per point of the zone's year, on top of the biome palette.
 *
 * The material styles read the same calendar in their shaders (`ZONE_SEASONS`). Held as display state, like the forest tone:
 * the palette is resolved in many places and every one of them must agree. */
import { calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import type { Palette } from './styles';

export interface SeasonPaint { herb: readonly [number, number, number]; leaf: number; evergreen: number; snow: number; spring: number; autumn: number }
const SNOW = '#f1f3ef', BARE_WOOD = '#8d8373', AUTUMN_WOOD = '#b78a3e', SPRING_WOOD = '#a6bc72', YOUNG_CROP = '#b4c47c', STUBBLE = '#c29a5c';
/** Summer is the palette as authored. */
const SUMMER = .5;
let season = SUMMER, zone: ClimateZone | undefined, calendar: SeasonCalendar | undefined;
export function setMapSeason(next: number, nextZone: ClimateZone | undefined = zone, nextCalendar: SeasonCalendar | undefined = calendar): void { season = next; zone = nextZone; calendar = nextCalendar; }
/** The benches load a map apart from the appearance that sets the season. */
export function setMapClimateZone(next: ClimateZone | undefined): void { zone = next; }
/** Part of every cache key of a seasonal map layer. */
export const mapSeasonKey = (): string => zone && season !== SUMMER ? `${zone}:${Math.round(season * 100)}:${JSON.stringify(calendar ?? {})}` : '';

const rgb = (hex: string): [number, number, number] => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const hex = (c: readonly number[]): string => '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const isHex = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c);
const mix = (a: string, b: string, t: number): string => { if (!isHex(a)) return a; const A = rgb(a), B = rgb(b); return hex(A.map((x, i) => x + (B[i] - x) * t)); };
const tinted = (c: string, ratio: readonly number[]): string => isHex(c) ? hex(rgb(c).map((x, i) => x * ratio[i])) : c;

/** The zone's year at this point of the cycle. */
export function seasonPaint(value: number, climateZone: ClimateZone, edits?: SeasonCalendar): SeasonPaint {
  const w = seasonWeights(value), year = calendarSeason(climateZone, edits), blend = (row: readonly number[]): number => row.reduce((sum, v, i) => sum + v * w[i], 0);
  return { herb: [0, 1, 2].map(i => blend(year.herb.map(c => c[i]))) as unknown as SeasonPaint['herb'], leaf: blend(year.leaf), evergreen: year.leaf[0], snow: blend(year.snow), spring: w[1], autumn: w[3] };
}
/** Crops follow the herbs: green while they grow, ochre once they ripen or lie dry. */
function cropTone(c: string, herb: SeasonPaint['herb']): string {
  const growing = Math.min(1, Math.max(0, herb[1] / herb[0] - 1) * 2.5), ripe = Math.min(1, Math.max(0, herb[0] / herb[1] - 1) * 2.5), value = (herb[0] + herb[1] + herb[2]) / 3;
  return tinted(mix(mix(c, YOUNG_CROP, .4 * growing), STUBBLE, .3 * ripe), [Math.min(1, value + .1), Math.min(1, value + .1), Math.min(1, value + .1)]);
}
function woodTone(c: string, s: SeasonPaint): string {
  const deciduous = 1 - s.evergreen;
  return mix(mix(mix(c, BARE_WOOD, .7 * (1 - s.leaf)), AUTUMN_WOOD, .35 * s.autumn * deciduous), SPRING_WOOD, .15 * s.spring * deciduous);
}
/** Only the land use follows the season: paper, relief ramp and water stay as drawn. */
export function applySeason(pal: Palette, s: SeasonPaint): Palette {
  const snowed = (c: string, cover = .85): string => mix(c, SNOW, s.snow * cover);
  const herbs = (c: string): string => snowed(tinted(c, s.herb));
  const crops = (c: string): string => snowed(cropTone(c, s.herb), .8);
  const wood = (c: string): string => snowed(woodTone(c, s), .4);
  return { ...pal,
    land: { ...pal.land, field: crops(pal.land.field), meadow: herbs(pal.land.meadow), pasture: herbs(pal.land.pasture), commons: herbs(pal.land.commons), garden: herbs(pal.land.garden), orchard: wood(pal.land.orchard), forest: wood(pal.land.forest), marsh: herbs(pal.land.marsh) },
    stripA: crops(pal.stripA), stripB: crops(pal.stripB), furrow: snowed(pal.furrow, .6), hedge: wood(pal.hedge),
    treeFill: wood(pal.treeFill), treeInk: snowed(pal.treeInk, .25), orchardDot: snowed(pal.orchardDot, .25), grass: snowed(tinted(pal.grass, s.herb), .6), reed: snowed(tinted(pal.reed, s.herb), .5) };
}
const MONOCHROME = new Set(['engraving', 'blueprint', 'night']);
const cache = new WeakMap<Palette, Map<string, Palette>>();
/** Same palette object for the same season: renderers compare palettes by identity. */
export function seasonalPalette(pal: Palette): Palette {
  const key = mapSeasonKey();
  if (!key || MONOCHROME.has(pal.name)) return pal;
  let entries = cache.get(pal); if (!entries) cache.set(pal, entries = new Map());
  let found = entries.get(key); if (!found) entries.set(key, found = applySeason(pal, seasonPaint(season, zone!, calendar)));
  return found;
}
