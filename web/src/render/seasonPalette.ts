/** The season of the vector map styles: one palette per point of the zone's year, on top of the biome palette.
 *
 * The material styles read the same calendar in their shaders (`ZONE_SEASONS`). Held as display state, like the forest tone:
 * the palette is resolved in many places and every one of them must agree. */
import { calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import { CLIMATE_ZONE_VALUES, type ClimateValues, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { AUTUMN_CROWN_MEAN } from '../../../rust/bridge/terrainForestSeason';
import { ColorSlot } from './gpu/contract';
import { canvasColor } from './gpu/colors';
import { forestLandPaint } from './landuseForestTone';
import { fieldHedgeStyle } from './hedges';
import { mixHex } from './cartography/geometry';
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
let landSeasonDirty = true,
  landSeasonRevision = 0;
let landSeason: { tint: [number, number, number, number]; snow: SnowTerms } | undefined;
export function setMapSeason(next: number, nextZone: ClimateZone | undefined = zone, nextCalendar: SeasonCalendar | undefined = calendar): void {
  landSeasonDirty = true;
  season = next;
  zone = nextZone;
  calendar = nextCalendar;
}
/** The benches load a map apart from the appearance that sets the season. */
export function setMapClimateZone(next: ClimateZone | undefined, values?: ClimateValues): void {
  landSeasonDirty = true;
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
  return smooth(0.405, 0.465, groundSnowSupply(altitude, settings));
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** The climatic snow of a date at sea level, as four terms an altitude only lowers by its lapse (0.0065 °C per metre):
 * the date's temperature, the warm season's temperature, the divisor of the supply (lowered twenty times the lapse) and
 * the precipitation. The paper ground's shader reads them as `uLandSnow` (treeSymbolsGlsl.ts landSeason). */
export type SnowTerms = readonly [date: number, warm: number, divisor: number, precipitation: number];
const NO_SNOW: SnowTerms = [0, 0, 0, 0];
function snowTerms(settings?: GroundSnowSettings): SnowTerms {
  const snowZone = settings?.climateZone ?? zone;
  if (!snowZone) return NO_SNOW;
  const c = settings?.climate ?? climate ?? CLIMATE_ZONE_VALUES[snowZone],
    year = calendarSeason(snowZone, settings ? settings.calendar : calendar),
    date = settings?.season ?? season;
  const amplitude = 6 + 0.5 * Math.max(0, 10 - c.temperature),
    warm = c.temperature + amplitude,
    cold = c.temperature - amplitude - year.cool;
  const phase = 0.5 - 0.5 * Math.cos(2 * Math.PI * (date - 0.08));
  const w = seasonWeights(date),
    thaw = (year.thaw ?? [0, 0, 0, 0]).reduce((sum, v, i) => sum + v * w[i], 0);
  return [cold + (warm - cold) * phase + thaw, warm, 10 * (warm + cold) + 280, c.precipitation];
}
/** Climatic snow of level ground at an altitude, before its cover threshold (v2Snow / v2PerennialSnow at slope 0). */
function snowSupply(terms: SnowTerms, altitude: number): number {
  const lapse = 0.0065 * Math.max(0, altitude),
    supply = smooth(0.12, 0.7, terms[3] / Math.max(120, terms[2] - 20 * lapse));
  return Math.max(smooth(2, -5, terms[0] - lapse), smooth(2.5, -2.5, terms[1] - lapse)) * supply;
}
/** Precompute the date and climate once for a batch of crowns at different elevations. */
export function groundSnowAtAltitude(settings: GroundSnowSettings): (altitude: number) => number {
  const terms = snowTerms(settings);
  return altitude => smooth(0.405, 0.465, snowSupply(terms, altitude));
}
const groundSnowSupply = (altitude: number, settings?: GroundSnowSettings): number => snowSupply(snowTerms(settings), altitude);

/** The relief the land snow reads: B-spline control heights (m), row by row from the north-west corner, `n` per side
 * over the square of side `width` at (`x`, `y`). */
export interface SnowRelief {
  readonly data: Float32Array;
  readonly n: number;
  readonly width: number;
  readonly x?: number;
  readonly y?: number;
}
let snowRelief: (SnowRelief & { top: number; id: number }) | undefined,
  snowReliefId = 0;
/** The relief of a terrain for the land snow: its display field, else its height grid. The map's terrain spans
 * [0, width]² in world metres, as for the tilted relief (render/world/heights.ts). */
export const snowReliefOf = (t: { field?: { n: number; data: Float32Array }; resolution: number; height: Float32Array; width: number } | undefined): SnowRelief | undefined =>
  t && (t.field ? { data: t.field.data, n: t.field.n, width: t.width } : t.height.length ? { data: t.height, n: t.resolution, width: t.width } : undefined);
/** Set with the map: the land snow follows its relief (none: the level ground at sea level, mapGroundSnow()). */
export function setMapSnowRelief(relief: SnowRelief | undefined): void {
  if (relief?.data === snowRelief?.data && relief?.n === snowRelief?.n && relief?.width === snowRelief?.width && relief?.x === snowRelief?.x && relief?.y === snowRelief?.y) return;
  let top = 0;
  if (relief) for (let i = 0; i < relief.data.length; i++) if (relief.data[i] > top) top = relief.data[i];
  snowRelief = relief && { ...relief, top, id: ++snowReliefId };
}
/** Height (m) and slope (m/m) of the relief at a world point: bilinear control heights, centred differences. */
function reliefAt(r: SnowRelief, x: number, y: number): [number, number] {
  const cell = r.width / r.n,
    at = (i: number, j: number): number => r.data[Math.max(0, Math.min(r.n - 1, j)) * r.n + Math.max(0, Math.min(r.n - 1, i))];
  const gx = (x - (r.x ?? 0)) / cell - 0.5,
    gy = (y - (r.y ?? 0)) / cell - 0.5,
    i = Math.floor(gx),
    j = Math.floor(gy),
    fx = gx - i,
    fy = gy - j;
  const h = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  const ci = Math.round(gx),
    cj = Math.round(gy),
    dx = (at(ci + 1, cj) - at(ci - 1, cj)) / (2 * cell),
    dy = (at(ci, cj + 1) - at(ci, cj - 1)) / (2 * cell);
  return [h, Math.hypot(dx, dy)];
}
/** Snow cover of the land at a world point (0-1): the mean cover of the satellite ground there (terrainRenderV2 v2Local)
 * with its drift and exposure patterns averaged out. The level-ground snow of the point's altitude, shed by the slope as
 * v2Snow sheds it, and the ledge patches a steep face keeps. Without a relief: the level ground at sea level. What lies on
 * the ground (streets, roads, squares) takes this snow, so a way is never whiter than the land around it. */
export function mapLandSnow(x: number, y: number, urban = 0): number {
  if (snowRelief) return landSnowAt(snowRelief, x, y, groundSnowSupply, urban);
  return urban > 0 ? smooth(0.325, 0.575, groundSnowSupply(0) - urban) : mapGroundSnow();
}
/** Lowering of the snow pack in a town (terrainRenderV2 v2Local): cleared, trodden and warmed ground. */
export const URBAN_SNOW = 0.35;
/** `urban`: the town's lowering of the pack (URBAN_SNOW); its cover is then the mean of the patches the drifts draw
 * across the threshold (v2WinterCover's band), as the town ground shows it. */
function landSnowAt(r: SnowRelief, x: number, y: number, supplyAt: (altitude: number) => number, urban = 0): number {
  const [h, slope] = reliefAt(r, x, y),
    supply = supplyAt(h);
  if (!(supply > 0)) return 0;
  const pack = supply * (1 - smooth(0.45, 1.25, slope)),
    level = smooth(0.405, 0.465, supply),
    held = urban > 0 ? smooth(0.325, 0.575, pack - urban) : smooth(0.405, 0.465, pack),
    ledges = level * (0.34 - 0.22 * smooth(1.25, 2.8, slope)) * smooth(0.6, 1.25, slope);
  return Math.max(held, Math.min(ledges, level));
}
/** Snow anywhere on the land of the map (0-1): the level-ground snow at its highest point. */
export const mapSnowPossible = (): number => (snowRelief ? mapGroundSnow(snowRelief.top) : mapGroundSnow());
/** Part of the cache keys of what follows the land snow: the date's snow and the relief. */
export const mapLandSnowKey = (): string => `${roofSeasonKey()}|${snowRelief?.id ?? 0}`;
const landGrids = new Map<string, Float32Array>();
/** Land snow over `n` x `n` cells covering the square [0, size]² (mean of four samples per cell), kept for the date and
 * the relief. The climatic snow is read from a table by 10 m of altitude. */
export function mapLandSnowGrid(n: number, size: number, urban = 0): Float32Array {
  const key = `${mapLandSnowKey()}|${n}|${size}|${urban}`,
    kept = landGrids.get(key);
  if (kept) return kept;
  const grid = new Float32Array(n * n),
    r = snowRelief;
  if (!r) grid.fill(mapLandSnow(0, 0, urban));
  else if (mapSnowPossible() > 0) {
    const STEP = 10,
      table = Float32Array.from({ length: Math.ceil(Math.max(0, r.top) / STEP) + 2 }, (_, k) => groundSnowSupply(k * STEP)),
      supplyAt = (altitude: number): number => table[Math.max(0, Math.min(table.length - 1, Math.round(altitude / STEP)))],
      cell = size / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let q = 0; q < 4; q++) sum += landSnowAt(r, (i + 0.25 + 0.5 * (q & 1)) * cell, (j + 0.25 + 0.5 * (q >> 1)) * cell, supplyAt, urban);
        grid[j * n + i] = sum / 4;
      }
  }
  // The ways of the open land and those of the towns: two grids per date and relief.
  if (landGrids.size >= 4) landGrids.delete(landGrids.keys().next().value!);
  landGrids.set(key, grid);
  return grid;
}
/** Snow of the paper ground at an altitude (0-1): the low-ground snow of the zone's calendar, more where the climate
 * keeps it. */
export const mapSnowCover = (altitude = 0): number => (zone ? Math.max(seasonPaint(season, zone, calendar).snow, mapGroundSnow(altitude)) : 0);
/** Seasonal colour ratio of the open ground. */
export const mapHerbTint = (): SeasonPaint['herb'] => (zone ? seasonPaint(season, zone, calendar).herb : [1, 1, 1]);
/** Opacity of a full snow cover on the paper: the relief reads through it. */
export const LAND_SNOW_ALPHA = 0.86;
/** The date on the lit land of a paper map, laid over its summer sheet by the overlay's canvas copy (v1Landscape.ts
 * seasonLand) and by the ground's shader (treeSymbolsGlsl.ts landSeason, uniforms `uLandTint` and `uLandSnow`): the
 * multiply tint of the open ground with the low-ground snow of the calendar in its fourth component, and the snow terms. */
export function mapLandSeason(): { tint: [number, number, number, number]; snow: SnowTerms } {
  if (!landSeasonDirty && landSeason) return landSeason;
  const herb = mapHerbTint(),
    brightest = Math.max(...herb),
    shade = (v: number): number => 1 - 0.5 * (1 - v / brightest);
  const tint: [number, number, number, number] = [shade(herb[0]), shade(herb[1]), shade(herb[2]), zone ? seasonPaint(season, zone, calendar).snow : 0],
    snow = snowTerms();
  landSeasonDirty = false;
  if (!landSeason || tint.some((v, i) => v !== landSeason!.tint[i]) || snow.some((v, i) => v !== landSeason!.snow[i])) {
    landSeason = { tint, snow };
    landSeasonRevision++;
  }
  return landSeason;
}
export function mapLandSeasonRevision(): number {
  if (landSeasonDirty) mapLandSeason();
  return landSeasonRevision;
}
const snowHash = (i: number, j: number, salt: number): number => {
  let h = (Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
};
/** Raggedness of the snow line (0-1, two octaves of value noise) at a point of the map in 512ths of its side. An
 * integer lattice hash, the same in the ground's shader (landSnowOctave): both copies of the land draw one snow line. */
export function landSnowRagged(gx: number, gy: number): number {
  let sum = 0;
  for (let octave = 0; octave < 2; octave++) {
    const f = octave ? 3.1 / 14 : 1 / 14,
      salt = octave ? 0x7c15a4e9 : 0x2f6b1d35,
      x = gx * f,
      y = gy * f,
      i = Math.floor(x),
      j = Math.floor(y),
      u = x - i,
      v = y - j,
      su = u * u * (3 - 2 * u),
      sv = v * v * (3 - 2 * v);
    const h00 = snowHash(i, j, salt),
      h01 = snowHash(i, j + 1, salt),
      top = h00 + (snowHash(i + 1, j, salt) - h00) * su,
      bottom = h01 + (snowHash(i + 1, j + 1, salt) - h01) * su;
    sum += (octave ? 0.35 : 0.65) * (top + (bottom - top) * sv);
  }
  return sum;
}
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
  if (snowKey?.season !== season || snowKey.zone !== zone || snowKey.calendar !== calendar || snowKey.climate !== climate) snowKey = { season, zone, calendar, climate, key: SNOW_LEVELS.map(level => mapGroundSnow(level).toFixed(3)).join() };
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
const seasonSources = new WeakMap<Palette, Palette>();
export const seasonSource = (pal: Palette): Palette => seasonSources.get(pal) ?? pal;

/** Land use and water share the calendar; paper and relief keep their authored tones. */
export function applySeason(pal: Palette, s: SeasonPaint, crownSnow = 0.7): Palette {
  const snowed = (c: string, cover = 0.85): string => mix(c, SNOW, s.snow * cover);
  const herbs = (c: string): string => snowed(tinted(c, s.herb));
  const crops = (c: string): string => snowed(cropTone(c, s.herb), 0.8);
  const wood = (c: string): string => snowed(woodTone(c, s), 0.4);
  const result = {
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
  seasonSources.set(result, seasonSource(pal));
  return result;
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

/** Each recipe reads the resolved palette, including biome, season and user colour overrides. */
const landColor = (key: keyof Palette['land']) => (p: Palette) => p.land[key];
const token =
  <K extends keyof Palette>(key: K) =>
  (p: Palette) =>
    p[key];
const pen = (key: 'treeFill' | 'treeInk' | 'grass' | 'reed' | 'orchardDot') => (p: Palette) => mixHex(p[key], p.inkSoft, 0.32);
const inks = {
  ink: token('ink'),
  densityInk: (p: Palette) => (/^#[0-9a-f]{6}$/i.test(p.ink) ? p.ink : '#3d2f20'),
  paper: token('paper'),
  roadEdge: token('roadEdge'),
  roadFill: token('roadFill'),
  trackFill: token('trackFill'),
  farmInk: token('farmInk'),
  farmYard: token('farmYard'),
  farmRoof: token('farmRoof'),
  bridgeDeck: token('bridgeDeck'),
  bridgeInk: token('bridgeInk'),
  wall: (p: Palette) => p.urban.wall,
  placeInk: (p: Palette) => p.urban.placeInk,
  gardenInk: (p: Palette) => p.urban.gardenInk,
  landmarkEdge: (p: Palette) => p.urban.landmarkEdge,
  wallFill: (p: Palette) => p.urban.wallFill,
  ruralInk: (p: Palette) => p.rural.ink ?? p.trackFill,
  field: landColor('field'),
  garden: landColor('garden'),
  pasture: landColor('pasture'),
  meadow: landColor('meadow'),
  forest: landColor('forest'),
  commons: landColor('commons'),
  marsh: landColor('marsh'),
  orchard: landColor('orchard'),
  stripA: token('stripA'),
  stripB: token('stripB'),
  furrow: token('furrow'),
  hedge: token('hedge'),
  treeInk: token('treeInk'),
  treeFill: token('treeFill'),
  grass: token('grass'),
  reed: token('reed'),
  orchardDot: token('orchardDot'),
  riverFill: token('riverFill'),
  waterEdge: token('waterEdge'),
  seaFill: token('seaFill'),
  lakeFill: token('lakeFill'),
  waterShore: (p: Palette) => p.water.stops[0][1],
  markedForest: (p: Palette) => forestLandPaint(p, 'marked').color,
  groundForest: (p: Palette) => forestLandPaint(p, 'ground').color,
  fieldHedge: (p: Palette) => fieldHedgeStyle(p, 1).color,
  openGround: (p: Palette) => mixHex(p.paper, p.land.meadow, 0.35),
  terrace: (p: Palette) => mixHex(p.land.meadow, p.land.garden, 0.4),
  cornfield: (p: Palette) => mixHex(p.land.field, p.urban.gardenInk, 0.14),
  turfWall: (p: Palette) => mixHex(p.grass, p.urban.wall, 0.35),
  farmLeaves: token('treeFill'),
  symbolLeaves: token('treeFill'),
  penLeaves: pen('treeFill'),
  penTreeFill: pen('treeFill'),
  penTreeInk: pen('treeInk'),
  penGrass: pen('grass'),
  penReed: pen('reed'),
  penOrchardDot: pen('orchardDot'),
  sheetGrass: (p: Palette) => mixHex(p.inkSoft, p.grass, 0.3),
  sheetReed: (p: Palette) => mixHex(p.inkSoft, p.reed, 0.3),
  sheetWash: (p: Palette) => mixHex(p.treeFill, p.inkSoft, 0.3),
};
export type SeasonInk = keyof typeof inks;
const slotNames = new WeakMap<ColorSlot, SeasonInk>();
export const seasonInkOf = (slot: ColorSlot): SeasonInk | undefined => slotNames.get(slot);

/** Renderer-local: independently visible renderers can show different dates and colour overrides.
 * Only slots actually used by a recording need updating. */
export class SeasonColorTable {
  private readonly slots = new Map<SeasonInk, ColorSlot>();
  constructor(private palette: Palette) {}
  readonly ink = (name: SeasonInk): ColorSlot => {
    let slot = this.slots.get(name);
    if (!slot) {
      slot = new ColorSlot();
      slotNames.set(slot, name);
      this.slots.set(name, slot);
      this.write(name, slot);
    }
    return slot;
  };
  update(palette: Palette): void {
    if (this.palette === palette) return;
    this.palette = palette;
    for (const [name, slot] of this.slots) this.write(name, slot);
  }
  private write(name: SeasonInk, slot: ColorSlot): void {
    const color = inks[name](this.palette);
    const leaf = this.palette.season?.leaf ?? 1;
    const alpha = name === 'farmLeaves' ? 0.3 + 0.7 * leaf : name === 'symbolLeaves' || name === 'penLeaves' ? 0.25 + 0.75 * leaf : 1;
    const rgba = canvasColor(color);
    // Unrepresentable custom CSS retains native Canvas assignment semantics.
    slot.css = color;
    slot.valid = !!rgba && rgba !== 'invalid';
    if (!rgba || rgba === 'invalid') return;
    slot.rgba.set(rgba);
    slot.rgba[3] *= alpha;
    if (alpha !== 1) slot.css = `rgba(${rgba[0] * 255},${rgba[1] * 255},${rgba[2] * 255},${rgba[3] * alpha})`;
  }
}
