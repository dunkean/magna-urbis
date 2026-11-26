/** Road drawing shared by the 2D overlay (canvas.ts), the city plan (cityCanvas.ts), the 3D tiles (tileNetworks.ts) and
 * the SVG export (landuse.ts): one rank table, one painter, so 2D and 3D keep the same colours and hierarchy.
 *
 * Natural look: a road is a tone of the ground it crosses. `setRoadGround` rasterises the land cover once into a small
 * grid; each rank turns that grid into a texture (earth mixed with the ground, lighter on dark ground, darker on pale
 * ground, a little mottling) used as stroke style. The colour then follows the ground per pixel in one stroke call, with
 * no road split and no per-frame sampling. World-anchored, so tiles and frames agree. Wear and uneven edges are extra
 * strokes, only once a road is wide enough on screen to show them. */
import type { LandKind, LandUseLayer } from '../gen/types';
import type { ResolvedAppearance } from './appearanceRecipe';
import { climatePalette } from './biomes';
import type { RenderColors } from './customColors';
import type { Palette } from './styles';
import { URBAN_SNOW, mapGroundSnow, mapLandSnow, mapLandSnowGrid, mapLandSnowKey } from './seasonPalette';
import { RecordingContext } from './gpu/recorder';
import { ROAD_GRID as GRID, roadTerrain } from './roadTerrain';
import type { RoadPavement } from './roadPavement';

export type RoadRank = 'major' | 'minor' | 'street' | 'lane' | 'track' | 'path';
export type Rgb = readonly [number, number, number];
export const ROAD_RANKS: readonly RoadRank[] = ['major', 'minor', 'street', 'lane', 'track', 'path'];

interface RankStyle {
  /** Stroke width on screen, px: floor at every zoom, ceiling while the road is not yet at true scale. */
  floor: number;
  ceil: number;
  /** Bed opacity; luminance step from the ground; share of earth against local ground; soft shoulder opacity. */
  alpha: number;
  contrast: number;
  earth: number;
  shoulder: number;
  /** Colour of the bare surface: gravel on made roads, trodden earth below. */
  surface: Rgb;
}
const GRAVEL: Rgb = [170, 160, 140],
  EARTH: Rgb = [170, 148, 110],
  DIRT: Rgb = [156, 130, 94];
export const ROAD_RANK_STYLE: Readonly<Record<RoadRank, RankStyle>> = {
  major: { floor: 2.4, ceil: 9, alpha: 0.9, contrast: 0.15, earth: 0.86, shoulder: 0.15, surface: GRAVEL },
  minor: { floor: 1.6, ceil: 7, alpha: 0.86, contrast: 0.13, earth: 0.8, shoulder: 0.12, surface: GRAVEL },
  street: { floor: 1.5, ceil: 6, alpha: 0.86, contrast: 0.095, earth: 0.8, shoulder: 0.1, surface: EARTH },
  lane: { floor: 1.1, ceil: 5, alpha: 0.78, contrast: 0.08, earth: 0.7, shoulder: 0.075, surface: EARTH },
  track: { floor: 0.95, ceil: 4, alpha: 0.82, contrast: 0.1, earth: 0.66, shoulder: 0.045, surface: DIRT },
  path: { floor: 0.75, ceil: 2.6, alpha: 0.66, contrast: 0.075, earth: 0.55, shoulder: 0, surface: DIRT },
};
/** Screen floor by urban street rank (0 = main street … 4 = lane), any look. */
export const STREET_MIN_PX: readonly number[] = [3, 2.4, 1.7, 1.2, 0.9];
/** Harbour platforms and moles seen from above: weathered stone or timber, never near-white (parchment sits a little lighter, on its paper). */
export const quayFill = (material: string, parchment = false): string => (material === 'timber' ? (parchment ? '#a08758' : '#7d6643') : parchment ? '#b9ac86' : '#8d836c');
export const regionalRank = (kind: string): RoadRank => (kind === 'major' ? 'major' : kind === 'track' ? 'track' : 'minor');
/** 3D regional streets carry a rank, not a kind. */
export const regionalStreetRank = (rank: number): RoadRank => (rank <= 1 ? 'major' : rank === 2 ? 'minor' : 'track');
export const streetRank = (role: string, rank: number): RoadRank => (role === 'track' ? 'track' : rank <= 2 ? 'street' : 'lane');

/** Width in world units: true width, kept between the rank's floor and, before true scale, its ceiling. */
export function roadWidth(rank: RoadRank, metres: number, scale: number): number {
  const s = ROAD_RANK_STYLE[rank];
  return Math.max(s.floor / scale, scale < 0.3 ? Math.min(metres, s.ceil / scale) : metres);
}
/** Width of the rendered surface: the true width, never below one screen pixel. Below a pixel the stroke keeps one
 * pixel and the painter fades it by its true share of that pixel (`metres / width`), as a photograph averages a narrow
 * road into its pixels: no cartographic floor, so roads do not read as a plan from afar. */
export const renderedRoadWidth = (metres: number, scale: number): number => Math.max(metres, 1 / scale);
/** Width a road look draws: the rendered surface takes the true width, the plan looks their floors and ceilings. */
export const lookRoadWidth = (look: RoadStyle['look'], rank: RoadRank, metres: number, scale: number): number => (look === 'rendered' ? renderedRoadWidth(metres, scale) : roadWidth(rank, metres, scale));

export interface RoadStyle {
  look: import('./composition').RoadLook;
  /** Fast satellite preview keeps the terrain-coloured bed and skips close-up marks. */ simple?: boolean;
  /** 0.5–1.5, contrast against the ground. */ emphasis: number;
  night: boolean;
  colors?: RenderColors;
  /** Surface of the place (roadPavement.ts); absent = earth and gravel. */ pavement?: RoadPavement;
  /** Snow of the land these ways cross (seasonPalette mapLandSnow), for their marks; absent: the level ground at sea level. */ snow?: number;
  /** Ways of a town: their snow is the town ground's, lowered by its clearing and treading (URBAN_SNOW). */ urban?: boolean;
}
/** Snow under the marks of a way of this style: none at night, the land's where the caller knows the place. */
const styleSnow = (style: RoadStyle): number => (style.night ? 0 : (style.snow ?? mapGroundSnow()));
/** Ink strokes of the current palette, so every backend draws the same map. */
export interface RoadInk {
  fill: string;
  edge: string;
  track: string;
  trackAlpha: number;
}
export const roadInkOf = (pal: Pick<Palette, 'roadFill' | 'roadEdge' | 'rural' | 'trackFill'>, colors?: RenderColors): RoadInk => ({
  fill: colors?.road ?? pal.roadFill,
  edge: colors?.roadEdge ?? pal.roadEdge,
  track: colors?.track ?? trackInk(pal.rural.ink ?? pal.trackFill, pal.roadFill),
  trackAlpha: pal.rural.track,
});
/** Line ink of faint ways: a dark ink on a dark ground gives way to the lighter road fill. */
export function trackInk(ink: string, fill: string): string {
  if (!ground || lum(ground.base) >= 0.55) return ink;
  return lum(rgbOf(fill)) > lum(rgbOf(ink)) ? fill : ink;
}
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Opacity factor of a rank's marks under an emphasis. Ink at 1 stays fully opaque. */
export const emphasisAlpha = (emphasis: number): number => clamp(0.5 + 0.5 * emphasis, 0.5, 1.25);

// ---------------------------------------------------------------- the ground
/** Colours of the ground under the roads: a base and each land cover, as drawn by the current ground. `soil`: the open
 * ground and the bare trodden earth of the map's biome, read by the rendered surface only (the plan looks ignore it). */
export interface RoadGroundTones {
  key: string;
  base: Rgb;
  kinds: Partial<Record<LandKind, Rgb>>;
  soil?: BiomeSoil;
}
/** Open ground of a biome seen from above (what the satellite ground paints between the land-use classes), and its bare
 * soil, worn by traffic: a dirt road is that soil, never a foreign colour band. */
export interface BiomeSoil {
  ground: Rgb;
  earth: Rgb;
  /** 0–1: how far the worn ways sink into the local cover (vegetation regrowth, dust of the same soil); humid lush grounds the most. */ merge: number;
}
const BIOME_SOIL: Readonly<Record<string, BiomeSoil>> = {
  temperate: { ground: [112, 132, 74], earth: [134, 116, 90], merge: 0.25 },
  forest: { ground: [100, 122, 70], earth: [120, 104, 82], merge: 0.3 },
  desert: { ground: [198, 172, 130], earth: [212, 190, 150], merge: 0.15 },
  steppe: { ground: [166, 156, 106], earth: [182, 160, 120], merge: 0.2 },
  // Tropical red earth is muted and soon grassed over: seen from above a track is a dull, slightly warmer green-brown.
  tropical: { ground: [94, 124, 64], earth: [140, 112, 84], merge: 0.6 },
  tundra: { ground: [138, 140, 116], earth: [132, 124, 108], merge: 0.2 },
  underdark: { ground: [92, 88, 98], earth: [112, 106, 114], merge: 0.15 },
  // Climate zones of the terrain (terrainClimate CLIMATE_ZONES): they win over the map biome where the region has one.
  mediterranean: { ground: [148, 140, 96], earth: [180, 152, 114], merge: 0.2 },
  continental: { ground: [110, 128, 72], earth: [128, 112, 90], merge: 0.25 },
  nordic: { ground: [96, 112, 72], earth: [112, 102, 88], merge: 0.3 },
  alpine: { ground: [110, 124, 80], earth: [142, 136, 126], merge: 0.2 },
  arctic: { ground: [150, 150, 140], earth: [128, 122, 112], merge: 0.2 },
  savanna: { ground: [168, 150, 96], earth: [168, 128, 94], merge: 0.4 },
  wetland: { ground: [92, 112, 72], earth: [98, 88, 72], merge: 0.45 },
};
/** The soil of a climate zone or biome name; unknown names take the temperate soil. */
/** The soil name of a map: its terrain climate zone, unless that is the default temperate zone and the map biome says more. */
export const roadSoilOf = (zone: string | undefined, biome: string | undefined): string => (zone && zone !== 'temperate' ? zone : (biome ?? zone ?? 'temperate'));
export const biomeSoil = (biome: string | undefined): BiomeSoil => BIOME_SOIL[biome ?? ''] ?? (biome?.startsWith('underdark') ? BIOME_SOIL.underdark : BIOME_SOIL.temperate);
const rgbOf = (hex: string): Rgb => {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const over = (top: Rgb, under: Rgb, alpha: number): Rgb => [under[0] + (top[0] - under[0]) * alpha, under[1] + (top[1] - under[1]) * alpha, under[2] + (top[2] - under[2]) * alpha];
/** The material grounds paint their own cover: what they look like from above. */
const MATERIAL_TONES: RoadGroundTones = {
  key: 'material',
  base: [112, 132, 74],
  kinds: { field: [196, 170, 96], meadow: [164, 174, 104], pasture: [138, 156, 88], forest: [58, 80, 44], orchard: [116, 140, 76], garden: [148, 164, 92], marsh: [104, 122, 88], commons: [152, 160, 100] },
};
export function roadGroundTones(material: boolean, pal: Pick<Palette, 'name' | 'paper' | 'land' | 'landOpacity'>, biome?: string): RoadGroundTones {
  if (material) return biome === undefined ? MATERIAL_TONES : { ...MATERIAL_TONES, key: `material:${biome}`, soil: biomeSoil(biome) };
  const base = rgbOf(pal.paper),
    kinds = Object.fromEntries(Object.entries(pal.land).map(([kind, color]) => [kind, over(rgbOf(color), base, pal.landOpacity)]));
  return { key: pal.name, base, kinds };
}
/** The display climate supplies the road soil, including on the painted satellite ground. */
export function mapRoadTones(r: ResolvedAppearance, biome: string | undefined, zone: string | undefined): RoadGroundTones {
  return roadGroundTones(r.ground.traits.family === 'material' || r.composition.networks.roads.look === 'rendered', climatePalette(r.palette.mapStyle, biome), roadSoilOf(zone, biome));
}
const lum = (c: Rgb): number => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
const NIGHT_EARTH: Rgb = [27, 32, 42];
/** Local road colour: earth pulled towards the ground, lifted off dark ground, sunk into pale ground. */
export function roadTone(ground: Rgb, rank: RoadRank, emphasis: number, night: boolean, snow = mapGroundSnow()): Rgb {
  if (night) return over(NIGHT_EARTH, ground, 0.72 + 0.08 * clamp(emphasis, 0.5, 1.5));
  const s = ROAD_RANK_STYLE[rank],
    l = lum(ground),
    mix = over(night ? NIGHT_EARTH : s.surface, ground, s.earth),
    m = lum(mix);
  // Above .7 a ground is pale enough for the road to sink; the band keeps the turn free of a hard step.
  const sink = clamp((l - 0.66) / 0.1, 0, 1),
    step = s.contrast * (night ? 0.62 : 1) * clamp(emphasis, 0.5, 1.5);
  const target = (l + step) * (1 - sink) + (l - 1.9 * step) * sink,
    k = clamp(target, 0.05, 0.95) / Math.max(0.04, m);
  // Scaling brightens the chroma too; earth stays dull.
  const out: Rgb = [mix[0] * k, mix[1] * k, mix[2] * k],
    grey = lum(out) * 255;
  const dry: Rgb = [grey + (out[0] - grey) * 0.8, grey + (out[1] - grey) * 0.8, grey + (out[2] - grey) * 0.8];
  // Trodden snow is cooler and darker than the untouched mantle, even on a path.
  const compact = (rank === 'path' || rank === 'track' ? 7 : 0) - 12 * (clamp(emphasis, 0.5, 1.5) - 1);
  return over([180 + compact, 192 + compact, 202 + compact], dry, snow);
}

/** Rendered surface (look `rendered`): the bare soil of the biome, worn and compacted. Made roads are a gravel of that
 * soil, streets and lanes its packed earth, tracks and paths the soil itself; a little of the local cover stays mixed in
 * (dust on the verges, grass between the wheels), more on the quiet ways. Snow as on the natural look. */
const RENDERED_EARTH: Readonly<Record<RoadRank, { gravel: number; light: number; ground: number }>> = {
  major: { gravel: 0.5, light: 1.06, ground: 0.1 },
  minor: { gravel: 0.38, light: 1.04, ground: 0.14 },
  street: { gravel: 0.18, light: 1.05, ground: 0.1 },
  lane: { gravel: 0.1, light: 1.02, ground: 0.18 },
  track: { gravel: 0, light: 1, ground: 0.28 },
  path: { gravel: 0, light: 0.98, ground: 0.4 },
};
const ROAD_GRAVEL: Rgb = [172, 166, 154];
/** Share of the soil's merge each rank takes: main roads keep the most of their own surface, town streets nearly all. */
const MERGE_SHARE: Readonly<Record<RoadRank, number>> = { major: 0.55, minor: 0.75, street: 0.3, lane: 0.45, track: 1, path: 1 };
/** Merge of the current ground's soil, 0 on the plan looks. */
const soilMerge = (): number => ground?.soil?.merge ?? 0;
export function renderedTone(ground: Rgb, soil: BiomeSoil, rank: RoadRank, emphasis: number, night: boolean, snow = mapGroundSnow()): Rgb {
  if (night) return over(NIGHT_EARTH, ground, 0.7 + 0.08 * clamp(emphasis, 0.5, 1.5));
  const r = RENDERED_EARTH[rank],
    e = clamp(emphasis, 0.5, 1.5);
  const earth = over(ROAD_GRAVEL, soil.earth, r.gravel),
    k = r.light * (1 + 0.06 * (e - 1));
  // The soil's merge takes the way further into the local cover, tracks the most, made roads less (they stay a little
  // more visible), town streets only slightly; the result loses some chroma (dust, sparse grass), never a colour band.
  const merge = soil.merge * MERGE_SHARE[rank],
    take = r.ground + (1 - r.ground) * merge;
  const mixed = over([earth[0] * k, earth[1] * k, earth[2] * k], ground, 1 - take),
    grey = lum(mixed) * 255,
    dull = 1 - 0.45 * merge;
  const bare: Rgb = [grey + (mixed[0] - grey) * dull, grey + (mixed[1] - grey) * dull, grey + (mixed[2] - grey) * dull];
  // A worn crown catches light on dark ground and reads as compacted earth on pale sand.
  // Fade the correction through the midtones to keep continuous colour across a field boundary.
  const relief = 1 - 2 * fadeIn(lum(ground), 0.49, 0.64);
  const separation = relief * (rank === 'path' || rank === 'track' ? 0.115 : 0.095) * e;
  const delta = separation - (lum(bare) - lum(ground));
  const lift = 255 * (relief > 0 ? Math.max(0, delta) : Math.min(0, delta)) * Math.abs(relief);
  const out: Rgb = [bare[0] + lift, bare[1] + lift, bare[2] + lift];
  const compact = (rank === 'path' || rank === 'track' ? 7 : 0) - 12 * (e - 1);
  return over([180 + compact, 192 + compact, 202 + compact], out, snow);
}

/** Asphalt from above: a dark, slightly warm grey, never black. Trunk roads and streets are rolled asphalt, minor roads a
 * paler chip seal, lanes and alleys worn asphalt. Tracks and paths are never paved. */
const ASPHALT: Rgb = [96, 93, 88],
  CHIP_SEAL: Rgb = [126, 120, 109],
  WORN_ASPHALT: Rgb = [112, 108, 101],
  NIGHT_ASPHALT: Rgb = [22, 25, 33];
const PAVED_SURFACE: Partial<Record<RoadRank, Rgb>> = { major: ASPHALT, street: ASPHALT, minor: CHIP_SEAL, lane: WORN_ASPHALT };
/** Whether a rank of a place with this surface is drawn as a paved road. */
export const pavedRank = (rank: RoadRank, pavement: RoadPavement | undefined): boolean => pavement === 'asphalt' && rank in PAVED_SURFACE;
/** Colour of a paved road: its own material, with a little of the local ground (dust, verge light) so that it sits in
 * the scene. In snow a busy road is ploughed down to dark wet asphalt; quieter ones keep more packed snow. */
export function pavedTone(ground: Rgb, rank: RoadRank, emphasis: number, night: boolean, snow = mapGroundSnow()): Rgb {
  const e = clamp(emphasis, 0.5, 1.5);
  if (night) return over(NIGHT_ASPHALT, ground, 0.78 + 0.08 * e);
  const dry = over(PAVED_SURFACE[rank] ?? ASPHALT, ground, 0.9),
    k = 1 - 0.14 * (e - 1);
  const base: Rgb = [dry[0] * k, dry[1] * k, dry[2] * k];
  if (!(snow > 0)) return base;
  const kept = rank === 'major' ? 0.12 : rank === 'street' ? 0.3 : rank === 'minor' ? 0.55 : 0.85;
  return over([196, 206, 214], [base[0] * 0.74, base[1] * 0.76, base[2] * 0.8], snow * kept);
}

interface RoadGround {
  exposure?: Int8Array;
  key: string;
  size: number;
  data: Uint8ClampedArray;
  base: Rgb;
  night: boolean;
  soil?: BiomeSoil;
}
let ground: RoadGround | undefined,
  groundId = 0;
const grounds = new WeakMap<object, Map<string, RoadGround>>(),
  emptyGrounds = new Map<string, RoadGround>();
const makeSurface = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement | undefined => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = globalThis.document;
  return doc ? Object.assign(doc.createElement('canvas'), { width: w, height: h }) : undefined;
};
const rgbCss = (c: Rgb): string => `rgb(${c.map(v => Math.round(clamp(v, 0, 255))).join(',')})`;
const moonlit = (c: Rgb): Rgb => [c[0] * 0.3, c[1] * 0.34, c[2] * 0.46];
/** Cached per retained land-use revision and ground appearance; callable before either 2D or 3D paints. */
export function setRoadGround(landuse: LandUseLayer | undefined, size: number, tones: RoadGroundTones, night: boolean, terrain?: Parameters<typeof roadTerrain>[0]): void {
  const relief = terrain && roadTerrain(terrain);
  const key = JSON.stringify([tones, night, size, relief?.id]);
  const owner = landuse ?? terrain;
  let cache = owner ? grounds.get(owner) : emptyGrounds;
  if (!cache) grounds.set(owner!, (cache = new Map()));
  const cached = cache.get(key);
  if (cached) {
    ground = cached;
    return;
  }
  const surface = makeSurface(GRID, GRID);
  const ctx = surface?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null | undefined;
  const shade = (c: Rgb): Rgb => (night && tones.key.startsWith('material') ? moonlit(c) : c);
  const base = shade(tones.base);
  let data = new Uint8ClampedArray(0);
  if (ctx) {
    ctx.fillStyle = rgbCss(base);
    ctx.fillRect(0, 0, GRID, GRID);
    ctx.setTransform(GRID / size, 0, 0, GRID / size, 0, 0);
    // No forest tone: a way through the woods is bare earth in the gaps of the canopy (its opacity follows the canopy,
    // canopyRuns), never a tint of the crowns, which turned it olive and hid it on the glades of a wooded parcel.
    for (const kind of ['meadow', 'pasture', 'commons', 'marsh', 'field', 'garden', 'orchard'] as const) {
      const tone = tones.kinds[kind];
      if (!tone) continue;
      ctx.fillStyle = rgbCss(shade(tone));
      // Each ring in its own Path2D, appended: the same contours, but Chrome's closePath walks the whole path it closes,
      // which made one growing path quadratic in rings (1.8 s for a town of 100,000).
      const path = new Path2D();
      for (const a of landuse?.areas ?? [])
        if (a.kind === kind)
          for (const ring of [a.poly, ...(a.holes ?? [])]) {
            const r = new Path2D();
            ring.forEach((p, i) => (i ? r.lineTo(p.x, p.y) : r.moveTo(p.x, p.y)));
            r.closePath();
            path.addPath(r);
          }
      ctx.fill(path, 'evenodd');
    }
    data = ctx.getImageData(0, 0, GRID, GRID).data;
  }
  ground = { key: `${key}|${++groundId}`, size, data, base, night, soil: tones.soil, exposure: relief?.exposure };
  cache.set(key, ground);
}
/** Identity of the current road ground (tones and land use): meshes coloured from it rebuild when it changes. */
export const roadGroundKey = (): string => ground?.key ?? '';
const groundAt = (x: number, y: number): Rgb | undefined => {
  if (!ground) return undefined;
  if (!ground.data.length) return ground.base;
  const i = clamp(Math.floor((x * GRID) / ground.size), 0, GRID - 1),
    j = clamp(Math.floor((y * GRID) / ground.size), 0, GRID - 1),
    k = (j * GRID + i) * 4;
  return [ground.data[k], ground.data[k + 1], ground.data[k + 2]];
};
// Share the retained land-use colours with roof shading. Open material ground takes the biome soil.
export function mapGroundLightness(x: number, y: number): number {
  const c = groundAt(x, y);
  if (!ground || !c) return -1;
  const { base, soil } = ground;
  return lum(soil && c.every((v, i) => v === base[i]) ? soil.ground : c);
}

/** A low-frequency stain, ±1: the same world cell is the same on every tile. */
const stain = (i: number, j: number): number => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
};

// In a wet hollow the earth packs dark. On a cut slope the loose material is paler and less saturated.
function terrainRoadTone(c: Rgb, rank: RoadRank, emphasis: number, night: boolean, snow: number, paved: boolean, soil: BiomeSoil | undefined, exposure: number): Rgb {
  const tone = paved ? pavedTone(c, rank, emphasis, night, snow) : soil ? renderedTone(c, soil, rank, emphasis, night, snow) : roadTone(c, rank, emphasis, night, snow);
  if (!soil || !exposure || night) return tone;
  const loose = paved ? 0.22 : 1 - RENDERED_EARTH[rank].gravel;
  const amount = (Math.abs(exposure) / 16) * loose * (1 - snow);
  return exposure < 0 ? over([tone[0] * 0.69, tone[1] * 0.71, tone[2] * 0.75], tone, amount) : over(ROAD_GRAVEL, tone, amount * 0.65);
}

type Surface = OffscreenCanvas | HTMLCanvasElement;
const texturesOf = new Map<string, Surface>();
/** One rank's texture (`bare`: the ground itself, for the grass between wheel ruts). */
function texture(rank: RoadRank | 'bare', emphasis: number, paved = false, rendered = false, urban = false): Surface | undefined {
  if (!ground?.data.length) return undefined;
  const soil = rendered ? (ground.soil ?? BIOME_SOIL.temperate) : undefined;
  const key = `${ground.key}|${rank}${paved ? '|paved' : ''}${soil ? '|r' : ''}${urban ? '|u' : ''}|${emphasis}|${mapLandSnowKey()}`;
  let out = texturesOf.get(key);
  if (out) return out;
  const surface = makeSurface(GRID, GRID),
    ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!surface || !ctx) return undefined;
  const image = ctx.createImageData(GRID, GRID),
    d = ground.data,
    o = image.data,
    night = ground.night,
    // The snow of the land under each texel: a way is never whiter than the ground it crosses.
    snowGrid = night || rank === 'bare' ? undefined : mapLandSnowGrid(GRID, ground.size, urban ? URBAN_SNOW : 0);
  const lut = new Map<number, Rgb>();
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const k = (j * GRID + i) * 4;
      let c: Rgb = [d[k], d[k + 1], d[k + 2]];
      // The rendered surface reads the biome's open ground where no land-use class is drawn (the grid base).
      if (soil && !night && c[0] === ground.base[0] && c[1] === ground.base[1] && c[2] === ground.base[2]) c = soil.ground;
      if (rank !== 'bare') {
        const level = snowGrid ? Math.round(snowGrid[j * GRID + i] * 32) : 0,
          snow = level / 32,
          exposure = soil ? (ground.exposure?.[j * GRID + i] ?? 0) : 0,
          id = (((c[0] << 16) | (c[1] << 8) | c[2]) * 64 + level) * 33 + exposure;
        let t = lut.get(id);
        if (!t) lut.set(id, (t = terrainRoadTone(c, rank, emphasis, night, snow, paved, soil, exposure)));
        c = t;
      }
      // A rolled surface is more even than trodden earth: resurfaced lengths, under half the mottling.
      const m = paved ? 1 + 0.03 * stain(i >> 1, j >> 1) + 0.012 * stain(i, j) : soil ? 1 + 0.045 * stain(i >> 3, j >> 3) + 0.035 * stain(i >> 1, j >> 1) + 0.02 * stain(i, j) : 1 + 0.05 * stain(i >> 1, j >> 1) + 0.03 * stain(i, j);
      o[k] = c[0] * m;
      o[k + 1] = c[1] * m;
      o[k + 2] = c[2] * m;
      o[k + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  if (texturesOf.size >= 32) texturesOf.delete(texturesOf.keys().next().value!);
  texturesOf.set(key, surface);
  return surface;
}
const patterns = new WeakMap<CanvasRenderingContext2D, WeakMap<Surface, CanvasPattern>>();
/** Recorded patterns (GPU engine) are shared by every recording context but never mixed with the native ones. */
const recordedPatterns = new WeakMap<Surface, CanvasPattern>();
function pattern(ctx: CanvasRenderingContext2D, surface: Surface, metresPerTexel = ground!.size / GRID): CanvasPattern | undefined {
  const recording = ctx instanceof RecordingContext;
  let own = patterns.get(ctx);
  if (!own && !recording) patterns.set(ctx, (own = new WeakMap()));
  let p = recording ? recordedPatterns.get(surface) : own!.get(surface);
  if (!p) {
    const made = ctx.createPattern?.(surface as CanvasImageSource, 'repeat');
    if (!made) return undefined;
    made.setTransform?.(new DOMMatrix([metresPerTexel, 0, 0, metresPerTexel, 0, 0]));
    if (recording) recordedPatterns.set(surface, made);
    else own!.set(surface, made);
    p = made;
  }
  return p;
}
const GRAIN = 128,
  GRAIN_METRES = 40;
/** Share of the grain shown at `scale` px per metre: 0 below one screen pixel per grain texel, 1 from two. */
const grainVisibility = (scale: number): number => {
  const t = clamp((scale * GRAIN_METRES) / GRAIN - 1, 0, 1);
  return t * t * (3 - 2 * t);
};
let grainSurface: Surface | undefined;
/** Gravel and earth grain up close: a seamless tile, stones and stains in transparent ink, anchored to the world. */
let wearSurface: Surface | undefined;
function grainTile(worn: boolean): Surface | undefined {
  const cached = worn ? wearSurface : grainSurface;
  if (cached) return cached;
  const surface = makeSurface(GRAIN, GRAIN),
    ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!surface || !ctx) return undefined;
  const image = ctx.createImageData(GRAIN, GRAIN),
    o = image.data;
  for (let j = 0; j < GRAIN; j++)
    for (let i = 0; i < GRAIN; i++) {
      const fine = stain(i, j),
        wide = stain(i >> 3, (j >> 3) + 97) + stain(((i + 4) >> 3) % (GRAIN >> 3), ((j + 4) >> 3) % (GRAIN >> 3)),
        v = worn ? 0.72 * patchNoise(i, j, 32) + 0.46 * patchNoise(i, j, 8) + 0.26 * fine : 0.55 * fine + 0.3 * wide,
        k = (j * GRAIN + i) * 4,
        light = v > 0;
      o[k] = light ? 226 : 46;
      o[k + 1] = light ? 214 : 36;
      o[k + 2] = light ? 188 : 20;
      o[k + 3] = worn ? Math.min(94, Math.abs(v) * 112) : Math.min(72, Math.abs(v) * 90);
    }
  ctx.putImageData(image, 0, 0);
  if (worn) wearSurface = surface;
  else grainSurface = surface;
  return surface;
}
/** The photographic wash has metre-scale patches as well as fine aggregate. It survives downsampling at town zoom. */
export function roadGrain(ctx: CanvasRenderingContext2D, worn = false): CanvasPattern | undefined {
  const tile = grainTile(worn);
  return tile && pattern(ctx, tile, worn ? 0.55 : GRAIN_METRES / GRAIN);
}
/** Paint of a rank: the ground-following texture, its base tone without a ground grid, or the custom colour. */
export function roadPaint(ctx: CanvasRenderingContext2D, rank: RoadRank, style: RoadStyle): string | CanvasPattern {
  const custom = rank === 'track' || rank === 'path' ? style.colors?.track : style.colors?.road;
  if (custom) return custom;
  const paved = pavedRank(rank, style.pavement),
    rendered = style.look === 'rendered',
    surface = texture(rank, style.emphasis, paved, rendered, !!style.urban),
    made = surface && pattern(ctx, surface);
  if (made) return made;
  const base = ground?.base ?? MATERIAL_TONES.base;
  return rgbCss(paved ? pavedTone(base, rank, style.emphasis, style.night) : rendered ? renderedTone(ground?.soil?.ground ?? base, ground?.soil ?? BIOME_SOIL.temperate, rank, style.emphasis, style.night) : roadTone(base, rank, style.emphasis, style.night));
}
/** Point sample for the GPU street table, stairs and vector exports, using the same bed as the texture. */
export function roadToneAt(x: number, y: number, rank: RoadRank, style: RoadStyle): string {
  const custom = style.colors?.[rank === 'track' || rank === 'path' ? 'track' : 'road'];
  if (custom) return custom;
  const soil = style.look === 'rendered' ? (ground?.soil ?? BIOME_SOIL.temperate) : undefined;
  let c = groundAt(x, y) ?? MATERIAL_TONES.base;
  if (soil && !style.night && (!ground || c.every((v, i) => v === ground!.base[i]))) c = soil.ground;
  const cell = ground ? clamp(Math.floor((y * GRID) / ground.size), 0, GRID - 1) * GRID + clamp(Math.floor((x * GRID) / ground.size), 0, GRID - 1) : 0;
  const snow = style.night ? 0 : mapLandSnow(x, y, style.urban ? URBAN_SNOW : 0);
  return rgbCss(terrainRoadTone(c, rank, style.emphasis, style.night, snow, pavedRank(rank, style.pavement), soil, ground?.exposure?.[cell] ?? 0));
}

// ---------------------------------------------------------------- the painter
const SHADOW = 'rgb(34,27,14)',
  WEAR = 'rgb(58,44,26)',
  LIGHT_WEAR = 'rgb(214,204,180)';
/** Rendered surface: opacity of the worn bed (its colour already follows the ground) and of the dusty verge. */
const RENDERED_BED: Readonly<Record<RoadRank, number>> = { major: 0.92, minor: 0.9, street: 0.9, lane: 0.84, track: 0.88, path: 0.82 };
const RENDERED_APRON: Readonly<Record<RoadRank, number>> = { major: 0.16, minor: 0.14, street: 0.06, lane: 0.05, track: 0.22, path: 0.18 };
/** The verge: the biome soil, dry and a little paler (trampled dust, thin grass). */
const apronTone = (): Rgb => {
  const s = ground?.soil ?? BIOME_SOIL.temperate,
    g = s.ground;
  return over([s.earth[0] * 1.08, s.earth[1] * 1.08, s.earth[2] * 1.06], g, 0.55);
};
// A repeated, seamless patch of trampled earth with gaps for the actual terrain to show through.
// Both sides sample world coordinates: at bends, tile boundaries and junctions the patches stay in place.
const vergeTiles = new WeakMap<BiomeSoil, Surface>();
function patchNoise(x: number, y: number, step: number): number {
  const i = Math.floor(x / step),
    j = Math.floor(y / step),
    period = GRAIN / step;
  const fx = fadeIn(x % step, 0, step),
    fy = fadeIn(y % step, 0, step);
  const next = (k: number) => (k + 1) % period;
  const a = stain(i, j) * (1 - fx) + stain(next(i), j) * fx;
  const b = stain(i, next(j)) * (1 - fx) + stain(next(i), next(j)) * fx;
  return a + (b - a) * fy;
}
function vergeTile(soil: BiomeSoil): Surface | undefined {
  const cached = vergeTiles.get(soil);
  if (cached) return cached;
  const side = GRAIN,
    tile = makeSurface(side, side),
    ctx = tile?.getContext('2d') as CanvasRenderingContext2D | undefined;
  if (!tile || !ctx) return undefined;
  const image = ctx.createImageData(side, side);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const patch = 0.54 * patchNoise(x, y, 32) + 0.33 * patchNoise(x, y, 8) + 0.13 * patchNoise(x, y, 2);
      const grain = stain(x, y),
        offset = (y * side + x) * 4;
      const color = over(soil.earth, soil.ground, 0.74 + 0.22 * patch);
      for (let k = 0; k < 3; k++) image.data[offset + k] = color[k] * (1.06 + 0.16 * patch + 0.06 * grain);
      image.data[offset + 3] = 255 * fadeIn(patch + 0.09 * grain, -0.48, 0.46);
    }
  ctx.putImageData(image, 0, 0);
  vergeTiles.set(soil, tile);
  return tile;
}
export const roadVergeTone = (): string => rgbCss(apronTone());
export function roadVergePaint(ctx: CanvasRenderingContext2D): string | CanvasPattern {
  const tile = vergeTile(ground?.soil ?? BIOME_SOIL.temperate);
  return (tile && pattern(ctx, tile, 0.45)) || roadVergeTone();
}

/** How far each side wears into the bed, in metres. Subpixel ways keep a single legible stroke. */
export function roadFeather(rank: RoadRank, width: number, scale: number): number {
  const loose = rank === 'track' || rank === 'path' || rank === 'lane';
  return Math.min(loose ? 1.3 : 1.9, width * (loose ? 0.235 : 0.175) * (1 + soilMerge() * 0.5)) * fadeIn(width * scale, 1.5, 4);
}
/** Cobbled streets of a town centre (rendered surface, earth-road cultures): weathered setts, grey with the local soil. */
export function cobbleTone(style: RoadStyle): string {
  const s = ground?.soil ?? BIOME_SOIL.temperate,
    snow = styleSnow(style);
  if (style.night) return rgbCss(over(NIGHT_EARTH, [120, 116, 110], 0.7));
  return rgbCss(over([200, 206, 212], over([146, 140, 130], s.earth, 0.7), snow * 0.8));
}
/** Irregular runs, metres: nothing repeats along a sight line, and they do not depend on the zoom. */
const EDGE_DASH = [61, 17, 29, 41, 13, 23, 47, 11];
export interface NaturalMarks {
  shadow: { color: string; alpha: number; extra: number } | undefined;
  bed: { alpha: number };
  wear: { color: string; alpha: number; share: number } | undefined;
  /** Opacity of the grain, 0 until a road is wide enough to show it. */ grain: number;
}
/** The strokes of a natural road of `width` world units at `scale` px per unit; each shows only once it can be seen. */
export function naturalMarks(rank: RoadRank, width: number, scale: number, style: RoadStyle): NaturalMarks {
  const s = ROAD_RANK_STYLE[rank],
    e = emphasisAlpha(style.emphasis),
    px = width * scale,
    snow = styleSnow(style);
  // Earth tracks and paths held at their screen floor are thinner than a pixel on the ground: their opacity is the
  // share of the stroke they really cover (about 3 m and 1.6 m wide), as a photograph averages a narrow pale line
  // into its pixel. A track stays a thin pale line at 2 to 8 m per pixel; a path fades out first.
  const cover = rank === 'track' || rank === 'path' ? clamp(((rank === 'track' ? 3 : 1.6) * scale) / s.floor, rank === 'track' ? 0.3 : 0.2, 1) : 1;
  if (style.look === 'rendered' && !snow && !style.night) {
    // Rendered: no drawn shoulder. A worn, dusty verge of the same soil, wide and faint, only once it covers a pixel.
    // The soil's merge thins the verge and lets the cover back over the quiet ways (encroaching grass, crowns).
    const merge = soilMerge() * MERGE_SHARE[rank],
      apron = px >= 1.6 ? RENDERED_APRON[rank] * (1 - 0.7 * merge) : 0;
    return {
      shadow: apron > 0 ? { color: rgbCss(apronTone()), alpha: clamp(apron * e, 0, 0.3), extra: Math.max(1.2 / scale, width * (rank === 'track' || rank === 'path' ? 0.45 : 0.32)) } : undefined,
      bed: { alpha: clamp(RENDERED_BED[rank] * e * (1 - 0.3 * merge), 0.2, 1) },
      wear: px >= 2.6 && px < 9 ? { color: WEAR, alpha: 0.07 * e, share: 0.46 } : undefined,
      grain: 0.8 * Math.min(1, e) * fadeIn(px, 3, 8) * fadeIn(scale, 0.6, 2),
    };
  }
  return {
    shadow: s.shoulder > 0 || snow ? { color: snow ? 'rgb(116,139,158)' : SHADOW, alpha: clamp((snow ? 0.2 : s.shoulder) * e, 0, 0.4), extra: Math.max(1.4 / scale, width * 0.34) } : undefined,
    bed: { alpha: clamp((snow ? Math.max(0.8, s.alpha) : s.alpha) * e, 0.2, 1) * (snow ? 1 : cover) },
    wear: px >= 2.6 && px < 7 ? { color: snow ? 'rgb(128,151,172)' : style.night ? LIGHT_WEAR : WEAR, alpha: (style.night ? 0.05 : 0.09) * e, share: 0.5 } : undefined,
    // The grain tile is per-texel noise: below about one screen pixel per texel the unfiltered pattern aliases into
    // pixel speckle (a grainy, "pixelated" street at town zoom). It fades in between 1 and 2 px per texel.
    grain: px >= 7 ? (style.night ? 0.3 : 0.5) * Math.min(1, e) * (1 - Number(snow)) * grainVisibility(scale) : 0,
  };
}
// ---------------------------------------------------------------- paved roads
const MARKING = 'rgb(232,228,212)',
  VERGE = 'rgb(168,158,136)',
  SNOW_BANK = 'rgb(238,242,246)',
  JOINT = 'rgb(54,52,50)',
  TYRE = 'rgb(198,192,180)';
const fadeIn = (v: number, from: number, to: number): number => {
  const t = clamp((v - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
/** One stroke over the bed of a paved road; `paint` undefined restores the bed itself. */
export interface PavedStroke {
  paint?: string;
  width: number;
  alpha: number;
  cap: CanvasLineCap;
}
export interface PavedMarks {
  /** Bed opacity. */
  bed: number;
  /** Gravel verge beside a country road, the ploughed bank in snow. */
  verge: { color: string; alpha: number; extra: number } | undefined;
  /** Bottom to top: edge lines, wheel paths, the joint between lanes, centre line. Each fades in once it resolves on screen. */
  strokes: PavedStroke[];
  /** Opacity of the aggregate grain. */
  grain: number;
}
/** The marks of a paved carriageway of `width` world units at `scale` px per unit. `lines`: painted lane markings
 * (trunk roads and main streets only); `edges`: thin edge lines too (open roads, not kerbed streets). Nothing here
 * depends on the view position, so a retained list stays valid. */
export function pavedMarks(rank: RoadRank, width: number, scale: number, style: RoadStyle, lines = rank === 'major', edges = rank === 'major'): PavedMarks {
  const e = Math.min(1, emphasisAlpha(style.emphasis)),
    px = width * scale,
    snow = styleSnow(style),
    dry = 1 - snow,
    dim = style.night ? 0.45 : 1;
  const narrow = rank === 'minor' || rank === 'lane',
    line = Math.max(0.2, 1 / scale),
    strokes: PavedStroke[] = [];
  const edge = lines && edges ? fadeIn(px, 14, 22) * 0.6 * dry * dim : 0,
    wear = fadeIn(px, 7, 12) * 0.1 * dry * dim,
    detail = fadeIn(px, 16, 28) * dry * dim;
  const bed = clamp(0.96 * emphasisAlpha(style.emphasis), 0.5, 1);
  // A pale band with its middle restored leaves two thin edge lines; the same trick leaves two lighter wheel paths.
  if (edge > 0.01) strokes.push({ paint: MARKING, width: width - 0.5, alpha: edge, cap: 'round' }, { width: width - 0.5 - 2 * line, alpha: bed, cap: 'round' });
  if (wear > 0.004) strokes.push({ paint: TYRE, width: width * (narrow ? 0.6 : 0.7), alpha: wear, cap: 'round' }, { width: width * (narrow ? 0.26 : 0.4), alpha: bed * 0.7, cap: 'round' });
  if (detail > 0.01) strokes.push({ paint: JOINT, width: Math.max(0.12, 0.8 / scale), alpha: 0.16 * detail, cap: 'butt' });
  // The centre line shows from about 9 px of carriageway.
  const centre = lines ? fadeIn(px, 9, 15) * 0.82 * (1 - 0.8 * snow) * (style.night ? 0.5 : 1) : 0;
  if (centre > 0.01) strokes.push({ paint: MARKING, width: 0.8 * line, alpha: 0.6 * centre, cap: 'butt' });
  return { bed, strokes, verge: px >= 3 ? { color: snow ? SNOW_BANK : VERGE, alpha: (snow ? 0.75 * snow : style.night ? 0.1 : 0.3) * e, extra: Math.max(1.2 / scale, width * (snow ? 0.3 : 0.22)) } : undefined, grain: px >= 7 ? 0.2 * e * dry * dim * grainVisibility(scale) : 0 };
}
/** Kerb and sidewalk strip of a paved street: pale concrete, snowed over in winter. */
export function sidewalkTone(style: RoadStyle): string {
  const snow = styleSnow(style);
  return rgbCss(over([232, 236, 240], style.night ? [50, 55, 66] : [174, 170, 160], 0.85 * snow));
}
// ---------------------------------------------------------------- ways under the woods
/** Canopy over the ways, read from the products the satellite ground paints its woods from: the forest field (R: canopy
 * cover) and the occupation raster (R: signed distance to open land, B: class). Set once per forest product; the road
 * lists split each way by canopy level when they are built, never per frame. */
interface CanopyRaster {
  x: number;
  y: number;
  width: number;
  n: number;
  rgba: Uint8Array;
}
let canopyField: CanopyRaster | undefined,
  canopyOccupation: CanopyRaster | undefined,
  canopyRevision = 0;
export function setRoadCanopy(field: CanopyRaster | undefined, occupation: CanopyRaster | undefined): void {
  if (field === canopyField && occupation === canopyOccupation) return;
  canopyField = field;
  canopyOccupation = occupation;
  canopyRevision++;
}
/** Changes whenever the canopy changes: part of every cache key of a split road list. */
export const roadCanopyRevision = (): number => (canopyField ? canopyRevision : 0);
const texel = (r: CanopyRaster, x: number, y: number): number => {
  const i = Math.floor(((x - r.x) / r.width) * r.n),
    j = Math.floor(((y - r.y) / r.width) * r.n);
  return i < 0 || j < 0 || i >= r.n || j >= r.n ? -1 : (j * r.n + i) * 4;
};
/** Closed canopy share over a point, 0 open to 1 closed: open land of the occupation (fields, meadows, clearings,
 * towns) carries none; a covered way (class 12) keeps the woods it runs through. */
function canopyAt(x: number, y: number): number {
  if (!canopyField) return 0;
  const f = texel(canopyField, x, y);
  if (f < 0) return 0;
  const o = canopyOccupation ? texel(canopyOccupation, x, y) : -1;
  if (o >= 0 && canopyOccupation!.rgba[o + 3] && canopyOccupation!.rgba[o] > 128 && canopyOccupation!.rgba[o + 2] !== 12) return 0;
  // Read the continuous control field like the 3D canopy, instead of stepping between its coarse texels.
  const gx = ((x - canopyField.x) / canopyField.width) * canopyField.n - 0.5,
    gy = ((y - canopyField.y) / canopyField.width) * canopyField.n - 0.5;
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    fx = gx - ix,
    fy = gy - iy;
  const at = (i: number, j: number): number => canopyField!.rgba[(clamp(j, 0, canopyField!.n - 1) * canopyField!.n + clamp(i, 0, canopyField!.n - 1)) * 4] / 255;
  const c = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  const t = clamp((c - 0.3) / 0.45, 0, 1);
  return t * t * (3 - 2 * t);
}
/** Canopy levels of a split way: 0 open … CANOPY_LEVELS - 1 closed. */
export const CANOPY_LEVELS = 4;
/** A continuous trace in canopy gaps; made roads lose only a little contrast at their cleared edges. */
export const roadCanopyOpacity = (rank: RoadRank, canopy: number): number => 1 - (rank === 'path' || rank === 'track' || rank === 'lane' ? 0.58 : 0.25) * canopy;
const CANOPY_STEP = 14;
type Pt = { x: number; y: number };
/** A way cut into runs of one canopy level, sampled every ~14 m and smoothed so a level holds for at least a few tens of
 * metres; consecutive runs share their end point, so the way stays continuous. One run when no canopy is set. */
export function canopyRuns(pts: readonly Pt[]): { level: number; pts: Pt[] }[] {
  if (!canopyField || pts.length < 2) return [{ level: 0, pts: pts as Pt[] }];
  const at: Pt[] = [pts[0]],
    value: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i],
      n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CANOPY_STEP));
    for (let k = 1; k <= n; k++) {
      const t0 = (k - 1) / n,
        t = k / n,
        m = (t0 + t) / 2;
      value.push(canopyAt(a.x + (b.x - a.x) * m, a.y + (b.y - a.y) * m));
      at.push(k === n ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  const level = value.map((_, k) => Math.round((CANOPY_LEVELS - 1) * (0.25 * value[Math.max(0, k - 1)] + 0.5 * value[k] + 0.25 * value[Math.min(value.length - 1, k + 1)])));
  if (level.every(l => l === 0)) return [{ level: 0, pts: pts as Pt[] }];
  const out: { level: number; pts: Pt[] }[] = [];
  for (let k = 0; k < level.length; k++) {
    const last = out[out.length - 1];
    if (last && last.level === level[k]) last.pts.push(at[k + 1]);
    else out.push({ level: level[k], pts: [at[k], at[k + 1]] });
  }
  return out;
}
/** One paved regional road class: verge, clean-edged bed, then markings and wear once they resolve. */
function strokePavedRoad(ctx: CanvasRenderingContext2D, path: Path2D, rank: RoadRank, width: number, scale: number, style: RoadStyle, canopy = 0, metres = width): void {
  const paint = roadPaint(ctx, rank, style),
    marks = pavedMarks(rank, width, scale, style),
    snow = styleSnow(style);
  // A paved road clears its corridor (forestRoom.ts): the crowns only take a little off its edges.
  marks.bed *= 1 - 0.25 * canopy;
  // Rendered: below a pixel, the road's true share of it.
  if (style.look === 'rendered') {
    const cover = clamp(metres / Math.max(width, 1e-6), 0.15, 1);
    marks.bed *= cover;
    if (marks.verge) marks.verge.alpha *= cover;
    if (cover < 1) marks.strokes.length = 0;
  }
  // Asphalt stops square: a round cap as wide as the road reads as a drawn lollipop at a loose end or a change of surface.
  const stroke = (color: string | CanvasPattern, w: number, alpha: number, cap: CanvasLineCap = 'square'): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.globalAlpha = alpha;
    ctx.lineCap = cap;
    ctx.stroke(path);
  };
  ctx.lineJoin = 'round';
  if (marks.verge) {
    const rendered = style.look === 'rendered' && !snow && !style.night;
    stroke(rendered ? roadVergePaint(ctx) : marks.verge.color, width + marks.verge.extra, marks.verge.alpha * (rendered ? 1.6 : 1));
    if (rendered) stroke(paint, width + 0.45 * marks.verge.extra, 0.24 * marks.bed);
  }
  stroke(paint, width, marks.bed);
  // A quiet road under snow: two wheel ruts down to the surface.
  if (snow && rank !== 'major' && width * scale >= 4) {
    stroke('rgb(130,151,170)', width * 0.66, 0.34 * Number(snow));
    stroke(paint, width * 0.3, marks.bed);
  }
  for (const s of marks.strokes) stroke(s.paint ?? paint, s.width, s.alpha, s.cap);
  if (marks.grain) {
    const grain = roadGrain(ctx);
    if (grain) stroke(grain, width, marks.grain);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
}

/** One natural road class: shoulder, bed with an uneven edge, wear, and wheel ruts on earth tracks up close. `canopy`
 * (0 open … 1 closed, canopyRuns): under closed woods the way is a fainter continuous trace, the gap in the crowns.
 * Earth beds end butt: the runs of one way meet end to end, and round caps would bead at every change of level. */
export function strokeNaturalRoad(ctx: CanvasRenderingContext2D, path: Path2D, rank: RoadRank, width: number, scale: number, style: RoadStyle, canopy = 0, metres = width): void {
  if (style.simple && style.look === 'rendered') {
    ctx.strokeStyle = roadPaint(ctx, rank, style);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    ctx.lineWidth = width;
    ctx.globalAlpha = Math.min(1, RENDERED_BED[rank] * emphasisAlpha(style.emphasis)) * roadCanopyOpacity(rank, canopy) * clamp(metres / width, 0.1, 1);
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    return;
  }
  if (pavedRank(rank, style.pavement)) {
    strokePavedRoad(ctx, path, rank, width, scale, style, canopy, metres);
    return;
  }
  const paint = roadPaint(ctx, rank, style),
    marks = naturalMarks(rank, width, scale, style),
    px = width * scale,
    earthen = rank === 'track' || rank === 'path',
    snow = styleSnow(style);
  // Rendered: below a pixel the road's true share of it, a little less again (a photograph loses a thin way into its
  // verges), so regional roads read narrower and quieter from afar.
  const share = metres / Math.max(width, 1e-6),
    rendered = style.look === 'rendered',
    cover = rendered ? clamp(share < 1 ? 0.8 * share : 1, 0.1, 1) : 1;
  const open = 1 - canopy,
    under = roadCanopyOpacity(rank, canopy) * cover;
  marks.bed.alpha *= under;
  if (rendered && marks.shadow) marks.shadow.alpha *= cover;
  const stroke = (color: string | CanvasPattern, w: number, alpha: number, dash: readonly number[] = [], cap: CanvasLineCap = 'butt'): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dash as number[]);
    ctx.lineCap = cap;
    ctx.stroke(path);
  };
  ctx.lineJoin = 'round';
  if (marks.shadow) {
    const verge = rendered && !snow && !style.night ? roadVergePaint(ctx) : marks.shadow.color;
    if (snow) stroke(verge, width + marks.shadow.extra * 1.8, marks.shadow.alpha * 0.35 * open);
    stroke(verge, width + marks.shadow.extra, marks.shadow.alpha * open);
  }
  const feather = rendered ? roadFeather(rank, width, scale) : 0;
  if (feather > 0) {
    // Nested translucent shoulders let the material beneath carry through the merge into another way.
    const broken = !snow && !style.night;
    stroke(broken ? roadVergePaint(ctx) : paint, width + feather, marks.bed.alpha * (broken ? 0.8 : 0.2));
    stroke(paint, width, marks.bed.alpha * 0.24);
    stroke(paint, width - feather, marks.bed.alpha * 0.44);
    stroke(paint, width - 2 * feather, marks.bed.alpha);
  } else if (rendered || rank === 'path' || px < 2.4) stroke(paint, width, marks.bed.alpha);
  else {
    // A narrower continuous bed and full-width irregular runs: the edge wanders without any new geometry; on earth the grass eats further in.
    stroke(paint, width * (earthen ? 0.66 : 0.88), marks.bed.alpha);
    stroke(paint, width, marks.bed.alpha * (earthen ? 0.72 : 1), EDGE_DASH);
  }
  if (marks.wear) stroke(marks.wear.color, width * marks.wear.share, marks.wear.alpha * open);
  if (marks.grain) {
    const grain = roadGrain(ctx, rendered && !snow && !style.night);
    if (grain) stroke(grain, width - feather, marks.grain * under);
  }
  if (snow && rank !== 'path' && px >= 4) {
    // A dark band with its centre restored leaves two parallel wheel ruts.
    stroke('rgb(130,151,170)', width * 0.66, 0.38 * Number(snow));
    stroke(paint, width * 0.3, marks.bed.alpha);
  } else if ((rendered ? rank === 'track' : earthen) && px >= 5) {
    const grass = texture('bare', style.emphasis, false, rendered),
      p = grass && pattern(ctx, grass);
    if (p) stroke(p, width * 0.16, 0.38 * under);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
}
