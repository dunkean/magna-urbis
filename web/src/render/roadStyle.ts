/** Road drawing shared by the 2D overlay (canvas.ts), the city plan (cityCanvas.ts), the 3D tiles (tileNetworks.ts) and
 * the SVG export (landuse.ts): one rank table, one painter, so 2D and 3D keep the same colours and hierarchy.
 *
 * Natural look: a road is a tone of the ground it crosses. `setRoadGround` rasterises the land cover once into a small
 * grid; each rank turns that grid into a texture (earth mixed with the ground, lighter on dark ground, darker on pale
 * ground, a little mottling) used as stroke style. The colour then follows the ground per pixel in one stroke call, with
 * no road split and no per-frame sampling. World-anchored, so tiles and frames agree. Wear and uneven edges are extra
 * strokes with irregular dashes, only once a road is wide enough on screen to show them. */
import type { LandKind, LandUseLayer } from '../gen/types';
import type { RenderColors } from './customColors';
import type { Palette } from './styles';
import { mapGroundSnow, roofSeasonKey } from './seasonPalette';
import { RecordingContext } from './gpu/recorder';
import type { RoadPavement } from './roadPavement';

export type RoadRank = 'major' | 'minor' | 'street' | 'lane' | 'track' | 'path';
export type Rgb = readonly [number, number, number];
export const ROAD_RANKS: readonly RoadRank[] = ['major', 'minor', 'street', 'lane', 'track', 'path'];

interface RankStyle {
  /** Stroke width on screen, px: floor at every zoom, ceiling while the road is not yet at true scale. */
  floor: number; ceil: number;
  /** Bed opacity; luminance step from the ground; share of earth against local ground; soft shoulder opacity. */
  alpha: number; contrast: number; earth: number; shoulder: number;
  /** Colour of the bare surface: gravel on made roads, trodden earth below. */
  surface: Rgb;
}
const GRAVEL: Rgb = [170, 160, 140], EARTH: Rgb = [170, 148, 110], DIRT: Rgb = [156, 130, 94];
export const ROAD_RANK_STYLE: Readonly<Record<RoadRank, RankStyle>> = {
  major: { floor: 2.4, ceil: 9, alpha: .9, contrast: .15, earth: .86, shoulder: .15, surface: GRAVEL },
  minor: { floor: 1.6, ceil: 7, alpha: .86, contrast: .13, earth: .8, shoulder: .12, surface: GRAVEL },
  street: { floor: 1.5, ceil: 6, alpha: .86, contrast: .095, earth: .8, shoulder: .1, surface: EARTH },
  lane: { floor: 1.1, ceil: 5, alpha: .78, contrast: .08, earth: .7, shoulder: .075, surface: EARTH },
  track: { floor: .95, ceil: 4, alpha: .66, contrast: .075, earth: .58, shoulder: .045, surface: DIRT },
  path: { floor: .75, ceil: 2.6, alpha: .5, contrast: .05, earth: .44, shoulder: 0, surface: DIRT },
};
/** Screen floor by urban street rank (0 = main street … 4 = lane), any look. */
export const STREET_MIN_PX: readonly number[] = [3, 2.4, 1.7, 1.2, .9];
/** Harbour platforms and moles seen from above: weathered stone or timber, never near-white (parchment sits a little lighter, on its paper). */
export const quayFill = (material: string, parchment = false): string => material === 'timber' ? (parchment ? '#a08758' : '#7d6643') : parchment ? '#b9ac86' : '#8d836c';
export const regionalRank = (kind: string): RoadRank => kind === 'major' ? 'major' : kind === 'track' ? 'track' : 'minor';
/** 3D regional streets carry a rank, not a kind. */
export const regionalStreetRank = (rank: number): RoadRank => rank <= 1 ? 'major' : rank === 2 ? 'minor' : 'track';
export const streetRank = (role: string, rank: number): RoadRank => role === 'track' ? 'track' : rank <= 2 ? 'street' : 'lane';

/** Width in world units: true width, kept between the rank's floor and, before true scale, its ceiling. */
export function roadWidth(rank: RoadRank, metres: number, scale: number): number {
  const s = ROAD_RANK_STYLE[rank];
  return Math.max(s.floor / scale, scale < .3 ? Math.min(metres, s.ceil / scale) : metres);
}

export interface RoadStyle { look: import('./composition').RoadLook; /** 0.5–1.5, contrast against the ground. */ emphasis: number; night: boolean; colors?: RenderColors; /** Surface of the place (roadPavement.ts); absent = earth and gravel. */ pavement?: RoadPavement }
/** Ink strokes of the current palette, so every backend draws the same map. */
export interface RoadInk { fill: string; edge: string; track: string; trackAlpha: number }
export const roadInkOf = (pal: Pick<Palette, 'roadFill' | 'roadEdge' | 'rural' | 'trackFill'>, colors?: RenderColors): RoadInk =>
  ({ fill: colors?.road ?? pal.roadFill, edge: colors?.roadEdge ?? pal.roadEdge, track: colors?.track ?? trackInk(pal.rural.ink ?? pal.trackFill, pal.roadFill), trackAlpha: pal.rural.track });
/** Line ink of faint ways: a dark ink on a dark ground gives way to the lighter road fill. */
export function trackInk(ink: string, fill: string): string {
  if (!ground || lum(ground.base) >= .55) return ink;
  return lum(rgbOf(fill)) > lum(rgbOf(ink)) ? fill : ink;
}
const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v;
/** Opacity factor of a rank's marks under an emphasis. Ink at 1 stays fully opaque. */
export const emphasisAlpha = (emphasis: number): number => clamp(.5 + .5 * emphasis, .5, 1.25);

// ---------------------------------------------------------------- the ground
/** Colours of the ground under the roads: a base and each land cover, as drawn by the current ground. */
export interface RoadGroundTones { key: string; base: Rgb; kinds: Partial<Record<LandKind, Rgb>> }
const rgbOf = (hex: string): Rgb => { const v = parseInt(hex.replace('#', '').slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const over = (top: Rgb, under: Rgb, alpha: number): Rgb => [under[0] + (top[0] - under[0]) * alpha, under[1] + (top[1] - under[1]) * alpha, under[2] + (top[2] - under[2]) * alpha];
/** The material grounds paint their own cover: what they look like from above. */
const MATERIAL_TONES: RoadGroundTones = { key: 'material', base: [112, 132, 74], kinds: {
  field: [196, 170, 96], meadow: [164, 174, 104], pasture: [138, 156, 88], forest: [58, 80, 44], orchard: [116, 140, 76], garden: [148, 164, 92], marsh: [104, 122, 88], commons: [152, 160, 100] } };
export function roadGroundTones(material: boolean, pal: Pick<Palette, 'name' | 'paper' | 'land' | 'landOpacity'>): RoadGroundTones {
  if (material) return MATERIAL_TONES;
  const base = rgbOf(pal.paper), kinds = Object.fromEntries(Object.entries(pal.land).map(([kind, color]) => [kind, over(rgbOf(color), base, pal.landOpacity)]));
  return { key: pal.name, base, kinds };
}
const lum = (c: Rgb): number => (.3 * c[0] + .59 * c[1] + .11 * c[2]) / 255;
const NIGHT_EARTH: Rgb = [27, 32, 42];
/** Local road colour: earth pulled towards the ground, lifted off dark ground, sunk into pale ground. */
export function roadTone(ground: Rgb, rank: RoadRank, emphasis: number, night: boolean, snow = mapGroundSnow()): Rgb {
  if (night) return over(NIGHT_EARTH, ground, .72 + .08 * clamp(emphasis, .5, 1.5));
  const s = ROAD_RANK_STYLE[rank], l = lum(ground), mix = over(night ? NIGHT_EARTH : s.surface, ground, s.earth), m = lum(mix);
  // Above .7 a ground is pale enough for the road to sink; the band keeps the turn free of a hard step.
  const sink = clamp((l - .66) / .1, 0, 1), step = s.contrast * (night ? .62 : 1) * clamp(emphasis, .5, 1.5);
  const target = (l + step) * (1 - sink) + (l - 1.9 * step) * sink, k = clamp(target, .05, .95) / Math.max(.04, m);
  // Scaling brightens the chroma too; earth stays dull.
  const out: Rgb = [mix[0] * k, mix[1] * k, mix[2] * k], grey = lum(out) * 255;
  const dry: Rgb = [grey + (out[0] - grey) * .8, grey + (out[1] - grey) * .8, grey + (out[2] - grey) * .8];
  // Trodden snow is cooler and darker than the untouched mantle, even on a path.
  const compact = (rank === 'path' || rank === 'track' ? 7 : 0) - 12 * (clamp(emphasis, .5, 1.5) - 1);
  return over([180 + compact, 192 + compact, 202 + compact], dry, snow);
}

/** Asphalt from above: a dark, slightly warm grey, never black. Trunk roads and streets are rolled asphalt, minor roads a
 * paler chip seal, lanes and alleys worn asphalt. Tracks and paths are never paved. */
const ASPHALT: Rgb = [96, 93, 88], CHIP_SEAL: Rgb = [126, 120, 109], WORN_ASPHALT: Rgb = [112, 108, 101], NIGHT_ASPHALT: Rgb = [22, 25, 33];
const PAVED_SURFACE: Partial<Record<RoadRank, Rgb>> = { major: ASPHALT, street: ASPHALT, minor: CHIP_SEAL, lane: WORN_ASPHALT };
/** Whether a rank of a place with this surface is drawn as a paved road. */
export const pavedRank = (rank: RoadRank, pavement: RoadPavement | undefined): boolean => pavement === 'asphalt' && rank in PAVED_SURFACE;
/** Colour of a paved road: its own material, with a little of the local ground (dust, verge light) so that it sits in
 * the scene. In snow a busy road is ploughed down to dark wet asphalt; quieter ones keep more packed snow. */
export function pavedTone(ground: Rgb, rank: RoadRank, emphasis: number, night: boolean, snow = mapGroundSnow()): Rgb {
  const e = clamp(emphasis, .5, 1.5);
  if (night) return over(NIGHT_ASPHALT, ground, .78 + .08 * e);
  const dry = over(PAVED_SURFACE[rank] ?? ASPHALT, ground, .9), k = 1 - .14 * (e - 1);
  const base: Rgb = [dry[0] * k, dry[1] * k, dry[2] * k];
  if (!(snow > 0)) return base;
  const kept = rank === 'major' ? .12 : rank === 'street' ? .3 : rank === 'minor' ? .55 : .85;
  return over([196, 206, 214], [base[0] * .74, base[1] * .76, base[2] * .8], snow * kept);
}

const GRID = 256;
interface RoadGround { key: string; size: number; data: Uint8ClampedArray; base: Rgb; night: boolean }
let ground: RoadGround | undefined, groundId = 0;
const grounds = new WeakMap<LandUseLayer, Map<string, RoadGround>>(), emptyGrounds = new Map<string, RoadGround>();
const makeSurface = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement | undefined => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = globalThis.document; return doc ? Object.assign(doc.createElement('canvas'), { width: w, height: h }) : undefined;
};
const rgbCss = (c: Rgb): string => `rgb(${c.map(v => Math.round(clamp(v, 0, 255))).join(',')})`;
const moonlit = (c: Rgb): Rgb => [c[0] * .3, c[1] * .34, c[2] * .46];
/** Cached per retained land-use revision and ground appearance; callable before either 2D or 3D paints. */
export function setRoadGround(landuse: LandUseLayer | undefined, size: number, tones: RoadGroundTones, night: boolean): void {
  const key = JSON.stringify([tones, night, size]);
  let cache = landuse ? grounds.get(landuse) : emptyGrounds;
  if (!cache) grounds.set(landuse!, cache = new Map());
  const cached = cache.get(key); if (cached) { ground = cached; return; }
  const surface = makeSurface(GRID, GRID);
  const ctx = surface?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null | undefined;
  const shade = (c: Rgb): Rgb => night && tones === MATERIAL_TONES ? moonlit(c) : c;
  const base = shade(tones.base);
  let data = new Uint8ClampedArray(0);
  if (ctx) {
    ctx.fillStyle = rgbCss(base); ctx.fillRect(0, 0, GRID, GRID);
    ctx.setTransform(GRID / size, 0, 0, GRID / size, 0, 0);
    for (const kind of ['meadow', 'pasture', 'commons', 'marsh', 'field', 'garden', 'orchard', 'forest'] as const) {
      const tone = tones.kinds[kind]; if (!tone) continue;
      ctx.fillStyle = rgbCss(shade(tone)); ctx.beginPath();
      for (const a of landuse?.areas ?? []) if (a.kind === kind) for (const ring of [a.poly, ...(a.holes ?? [])]) {
        ring.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      }
      ctx.fill('evenodd');
    }
    data = ctx.getImageData(0, 0, GRID, GRID).data;
  }
  ground = { key: `${key}|${++groundId}`, size, data, base, night };
  cache.set(key, ground);
}
const groundAt = (x: number, y: number): Rgb | undefined => {
  if (!ground) return undefined; if (!ground.data.length) return ground.base;
  const i = clamp(Math.floor(x * GRID / ground.size), 0, GRID - 1), j = clamp(Math.floor(y * GRID / ground.size), 0, GRID - 1), k = (j * GRID + i) * 4;
  return [ground.data[k], ground.data[k + 1], ground.data[k + 2]];
};
/** A low-frequency stain, ±1: the same world cell is the same on every tile. */
const stain = (i: number, j: number): number => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1; };

type Surface = OffscreenCanvas | HTMLCanvasElement;
const texturesOf = new Map<string, Surface>();
/** One rank's texture (`bare`: the ground itself, for the grass between wheel ruts). */
function texture(rank: RoadRank | 'bare', emphasis: number, paved = false): Surface | undefined {
  if (!ground?.data.length) return undefined;
  const key = `${ground.key}|${rank}${paved ? '|paved' : ''}|${emphasis}|${roofSeasonKey()}`; let out = texturesOf.get(key);
  if (out) return out;
  const surface = makeSurface(GRID, GRID), ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!surface || !ctx) return undefined;
  const image = ctx.createImageData(GRID, GRID), d = ground.data, o = image.data, night = ground.night;
  const lut = new Map<number, Rgb>();
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const k = (j * GRID + i) * 4;
    let c: Rgb = [d[k], d[k + 1], d[k + 2]];
    if (rank !== 'bare') { const id = d[k] << 16 | d[k + 1] << 8 | d[k + 2]; let t = lut.get(id); if (!t) lut.set(id, t = paved ? pavedTone(c, rank, emphasis, night) : roadTone(c, rank, emphasis, night)); c = t; }
    // A rolled surface is more even than trodden earth: resurfaced lengths, under half the mottling.
    const m = paved ? 1 + .03 * stain(i >> 1, j >> 1) + .012 * stain(i, j) : 1 + .05 * stain(i >> 1, j >> 1) + .03 * stain(i, j);
    o[k] = c[0] * m; o[k + 1] = c[1] * m; o[k + 2] = c[2] * m; o[k + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (texturesOf.size >= 32) texturesOf.delete(texturesOf.keys().next().value!);
  texturesOf.set(key, surface);
  return surface;
}
const patterns = new WeakMap<CanvasRenderingContext2D, Map<Surface, CanvasPattern>>();
/** Recorded patterns (GPU engine) are shared by every recording context but never mixed with the native ones. */
const recordedPatterns = new WeakMap<Surface, CanvasPattern>();
function pattern(ctx: CanvasRenderingContext2D, surface: Surface): CanvasPattern | undefined {
  const recording = ctx instanceof RecordingContext;
  let own = patterns.get(ctx); if (!own && !recording) patterns.set(ctx, own = new Map());
  let p = recording ? recordedPatterns.get(surface) : own!.get(surface);
  if (!p) {
    const made = ctx.createPattern?.(surface as CanvasImageSource, 'repeat'); if (!made) return undefined;
    made.setTransform?.(new DOMMatrix([ground!.size / GRID, 0, 0, ground!.size / GRID, 0, 0]));
    if (recording) recordedPatterns.set(surface, made); else own!.set(surface, made);
    p = made;
  }
  return p;
}
const GRAIN = 128, GRAIN_METRES = 40;
/** Share of the grain shown at `scale` px per metre: 0 below one screen pixel per grain texel, 1 from two. */
const grainVisibility = (scale: number): number => { const t = clamp(scale * GRAIN_METRES / GRAIN - 1, 0, 1); return t * t * (3 - 2 * t); };
let grainSurface: Surface | undefined;
/** Gravel and earth grain up close: a seamless tile, stones and stains in transparent ink, anchored to the world. */
function grainTile(): Surface | undefined {
  if (grainSurface) return grainSurface;
  const surface = makeSurface(GRAIN, GRAIN), ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!surface || !ctx) return undefined;
  const image = ctx.createImageData(GRAIN, GRAIN), o = image.data;
  for (let j = 0; j < GRAIN; j++) for (let i = 0; i < GRAIN; i++) {
    const fine = stain(i, j), wide = stain(i >> 3, (j >> 3) + 97) + stain(((i + 4) >> 3) % (GRAIN >> 3), ((j + 4) >> 3) % (GRAIN >> 3)), v = .55 * fine + .3 * wide, k = (j * GRAIN + i) * 4, light = v > 0;
    o[k] = light ? 226 : 46; o[k + 1] = light ? 214 : 36; o[k + 2] = light ? 188 : 20; o[k + 3] = Math.min(72, Math.abs(v) * 90);
  }
  ctx.putImageData(image, 0, 0);
  return grainSurface = surface;
}
const grains = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
let recordedGrain: CanvasPattern | undefined;
/** The grain pattern for this context, or undefined where patterns do not exist. Recorded and native patterns stay apart. */
export function roadGrain(ctx: CanvasRenderingContext2D): CanvasPattern | undefined {
  const recording = ctx instanceof RecordingContext;
  let p = recording ? recordedGrain : grains.get(ctx);
  if (!p) {
    const tile = grainTile(), made = tile && ctx.createPattern?.(tile as CanvasImageSource, 'repeat'); if (!made) return undefined;
    made.setTransform?.(new DOMMatrix([GRAIN_METRES / GRAIN, 0, 0, GRAIN_METRES / GRAIN, 0, 0]));
    if (recording) recordedGrain = made; else grains.set(ctx, made);
    p = made;
  }
  return p;
}
/** Paint of a rank: the ground-following texture, its base tone without a ground grid, or the custom colour. */
export function roadPaint(ctx: CanvasRenderingContext2D, rank: RoadRank, style: RoadStyle): string | CanvasPattern {
  const custom = rank === 'track' || rank === 'path' ? style.colors?.track : style.colors?.road;
  if (custom) return custom;
  const paved = pavedRank(rank, style.pavement), surface = texture(rank, style.emphasis, paved), made = surface && pattern(ctx, surface);
  return made ?? rgbCss((paved ? pavedTone : roadTone)(ground?.base ?? MATERIAL_TONES.base, rank, style.emphasis, style.night));
}
/** Road colour at one point, for backends without patterns (SVG). */
export const roadToneAt = (x: number, y: number, rank: RoadRank, style: RoadStyle): string => style.colors?.[rank === 'track' || rank === 'path' ? 'track' : 'road'] ?? rgbCss(roadTone(groundAt(x, y) ?? ground?.base ?? MATERIAL_TONES.base, rank, style.emphasis, style.night));

// ---------------------------------------------------------------- the painter
const SHADOW = 'rgb(34,27,14)', WEAR = 'rgb(58,44,26)', LIGHT_WEAR = 'rgb(214,204,180)';
/** Irregular runs, metres: nothing repeats along a sight line, and they do not depend on the zoom. */
const EDGE_DASH = [61, 17, 29, 41, 13, 23, 47, 11], WEAR_DASH = [23, 9, 41, 15, 17, 7, 31, 19], RUT_DASH = [19, 5, 33, 9, 13, 4];
export interface NaturalMarks { shadow: { color: string; alpha: number; extra: number } | undefined; bed: { alpha: number }; wear: { color: string; alpha: number; share: number; dash: readonly number[] } | undefined; /** Opacity of the grain, 0 until a road is wide enough to show it. */ grain: number }
/** The strokes of a natural road of `width` world units at `scale` px per unit; each shows only once it can be seen. */
export function naturalMarks(rank: RoadRank, width: number, scale: number, style: RoadStyle): NaturalMarks {
  const s = ROAD_RANK_STYLE[rank], e = emphasisAlpha(style.emphasis), px = width * scale, snow = !style.night && mapGroundSnow();
  // Earth tracks and paths held at their screen floor are thinner than a pixel on the ground: they fade with the
  // share of the pixel they really cover (about 3 m and 1.6 m wide), and stay a little quieter at any scale, so
  // a path that follows a river bank or a valley rim does not outline it on the far and mid views.
  const faint = rank === 'track' || rank === 'path' ? .85 * clamp((rank === 'track' ? 3 : 1.6) * scale / s.floor, .35, 1) : 1;
  return { shadow: s.shoulder > 0 || snow ? { color: snow ? 'rgb(116,139,158)' : SHADOW, alpha: clamp((snow ? .2 : s.shoulder) * e, 0, .4), extra: Math.max(1.4 / scale, width * .34) } : undefined,
    bed: { alpha: clamp((snow ? Math.max(.8, s.alpha) : s.alpha) * e, .2, 1) * (snow ? 1 : faint) },
    wear: px >= 2.6 && px < 7 ? { color: snow ? 'rgb(128,151,172)' : style.night ? LIGHT_WEAR : WEAR, alpha: (style.night ? .07 : .13) * e, share: .56, dash: WEAR_DASH } : undefined,
    // The grain tile is per-texel noise: below about one screen pixel per texel the unfiltered pattern aliases into
    // pixel speckle (a grainy, "pixelated" street at town zoom). It fades in between 1 and 2 px per texel.
    grain: px >= 7 ? (style.night ? .3 : .5) * Math.min(1, e) * (1 - Number(snow)) * grainVisibility(scale) : 0 };
}
// ---------------------------------------------------------------- paved roads
const MARKING = 'rgb(232,228,212)', VERGE = 'rgb(168,158,136)', SNOW_BANK = 'rgb(238,242,246)', REPAIR = 'rgb(54,52,50)', TYRE = 'rgb(198,192,180)';
/** Metres. Centre line: 3 m dashes every 12 m. Repairs and cracks: long irregular runs, nothing repeats along a sight line. */
const CENTRE_DASH = [3, 9], REPAIR_DASH = [7, 61, 12, 143, 5, 89, 9, 211], CRACK_DASH = [11, 5, 23, 31, 7, 3, 37, 53];
const fadeIn = (v: number, from: number, to: number): number => { const t = clamp((v - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };
/** One stroke over the bed of a paved road; `paint` undefined restores the bed itself. */
export interface PavedStroke { paint?: string; width: number; alpha: number; dash?: readonly number[]; cap: CanvasLineCap }
export interface PavedMarks {
  /** Bed opacity. */
  bed: number;
  /** Gravel verge beside a country road, the ploughed bank in snow. */
  verge: { color: string; alpha: number; extra: number } | undefined;
  /** Bottom to top: edge lines, wheel paths, repairs, cracks, centre line. Each fades in once it resolves on screen. */
  strokes: PavedStroke[];
  /** Opacity of the aggregate grain. */
  grain: number;
}
/** The marks of a paved carriageway of `width` world units at `scale` px per unit. `lines`: painted lane markings
 * (trunk roads and main streets only); `edges`: thin edge lines too (open roads, not kerbed streets). Nothing here
 * depends on the view position, so a retained list stays valid. */
export function pavedMarks(rank: RoadRank, width: number, scale: number, style: RoadStyle, lines = rank === 'major', edges = rank === 'major'): PavedMarks {
  const e = Math.min(1, emphasisAlpha(style.emphasis)), px = width * scale, snow = style.night ? 0 : mapGroundSnow(), dry = 1 - snow, dim = style.night ? .45 : 1;
  const narrow = rank === 'minor' || rank === 'lane', line = Math.max(.2, 1 / scale), strokes: PavedStroke[] = [];
  const edge = lines && edges ? fadeIn(px, 14, 22) * .6 * dry * dim : 0, wear = fadeIn(px, 7, 12) * .1 * dry * dim, detail = fadeIn(px, 16, 28) * dry * dim;
  const bed = clamp(.96 * emphasisAlpha(style.emphasis), .5, 1);
  // A pale band with its middle restored leaves two thin edge lines; the same trick leaves two lighter wheel paths.
  if (edge > .01) strokes.push({ paint: MARKING, width: width - .5, alpha: edge, cap: 'round' }, { width: width - .5 - 2 * line, alpha: bed, cap: 'round' });
  if (wear > .004) strokes.push({ paint: TYRE, width: width * (narrow ? .6 : .7), alpha: wear, cap: 'round' }, { width: width * (narrow ? .26 : .4), alpha: bed * .7, cap: 'round' });
  if (detail > .01) strokes.push({ paint: REPAIR, width: width * .3, alpha: .2 * detail, dash: REPAIR_DASH, cap: 'butt' },
    { paint: REPAIR, width: Math.max(.12, .8 / scale), alpha: .42 * detail, dash: CRACK_DASH, cap: 'butt' });
  // The centre line shows from about 9 px of carriageway: its 12 m period is then well above the pixel.
  const centre = lines ? fadeIn(px, 9, 15) * .82 * (1 - .8 * snow) * (style.night ? .5 : 1) : 0;
  if (centre > .01) strokes.push({ paint: MARKING, width: line, alpha: centre, dash: CENTRE_DASH, cap: 'butt' });
  return { bed, strokes,
    verge: px >= 3 ? { color: snow ? SNOW_BANK : VERGE, alpha: (snow ? .75 * snow : style.night ? .1 : .3) * e, extra: Math.max(1.2 / scale, width * (snow ? .3 : .22)) } : undefined,
    grain: px >= 7 ? .2 * e * dry * dim * grainVisibility(scale) : 0 };
}
/** Kerb and sidewalk strip of a paved street: pale concrete, snowed over in winter. */
export function sidewalkTone(style: RoadStyle): string {
  const snow = style.night ? 0 : mapGroundSnow();
  return rgbCss(over([232, 236, 240], style.night ? [50, 55, 66] : [174, 170, 160], .85 * snow));
}
/** One paved regional road class: verge, clean-edged bed, then markings and wear once they resolve. */
function strokePavedRoad(ctx: CanvasRenderingContext2D, path: Path2D, rank: RoadRank, width: number, scale: number, style: RoadStyle): void {
  const paint = roadPaint(ctx, rank, style), marks = pavedMarks(rank, width, scale, style), snow = !style.night && mapGroundSnow();
  const stroke = (color: string | CanvasPattern, w: number, alpha: number, dash: readonly number[] = [], cap: CanvasLineCap = 'round'): void => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; ctx.setLineDash(dash as number[]); ctx.lineCap = cap; ctx.stroke(path);
  };
  ctx.lineJoin = 'round';
  if (marks.verge) stroke(marks.verge.color, width + marks.verge.extra, marks.verge.alpha);
  stroke(paint, width, marks.bed);
  // A quiet road under snow: two wheel ruts down to the surface.
  if (snow && rank !== 'major' && width * scale >= 4) { stroke('rgb(130,151,170)', width * .66, .34 * Number(snow)); stroke(paint, width * .3, marks.bed); }
  for (const s of marks.strokes) stroke(s.paint ?? paint, s.width, s.alpha, s.dash, s.cap);
  if (marks.grain) { const grain = roadGrain(ctx); if (grain) stroke(grain, width, marks.grain); }
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = 'round';
}

/** One natural road class: shoulder, bed with an uneven edge, wear, and wheel ruts on earth tracks up close. */
export function strokeNaturalRoad(ctx: CanvasRenderingContext2D, path: Path2D, rank: RoadRank, width: number, scale: number, style: RoadStyle): void {
  if (pavedRank(rank, style.pavement)) { strokePavedRoad(ctx, path, rank, width, scale, style); return; }
  const paint = roadPaint(ctx, rank, style), marks = naturalMarks(rank, width, scale, style), px = width * scale, earthen = rank === 'track' || rank === 'path', snow = !style.night && mapGroundSnow();
  const stroke = (color: string | CanvasPattern, w: number, alpha: number, dash: readonly number[] = [], cap: CanvasLineCap = 'round'): void => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; ctx.setLineDash(dash as number[]); ctx.lineCap = cap; ctx.stroke(path);
  };
  ctx.lineJoin = 'round';
  if (marks.shadow) {
    if (snow) stroke(marks.shadow.color, width + marks.shadow.extra * 1.8, marks.shadow.alpha * .35);
    stroke(marks.shadow.color, width + marks.shadow.extra, marks.shadow.alpha);
  }
  if (rank === 'path' && !snow) stroke(paint, width, marks.bed.alpha, [Math.max(3.4, 4 / scale), Math.max(1.8, 2.6 / scale)], 'butt');
  else if (px < 2.4) stroke(paint, width, marks.bed.alpha);
  else {
    // A narrower continuous bed and full-width irregular runs: the edge wanders without any new geometry; on earth the grass eats further in.
    stroke(paint, width * (earthen ? .66 : .88), marks.bed.alpha);
    stroke(paint, width, marks.bed.alpha * (earthen ? .72 : 1), EDGE_DASH);
  }
  if (marks.wear) stroke(marks.wear.color, width * marks.wear.share, marks.wear.alpha, marks.wear.dash, 'round');
  if (marks.grain) { const grain = roadGrain(ctx); if (grain) stroke(grain, width, marks.grain); }
  if (snow && rank !== 'path' && px >= 4) {
    // A dark band with its centre restored leaves two parallel wheel ruts.
    stroke('rgb(130,151,170)', width * .66, .38 * Number(snow));
    stroke(paint, width * .3, marks.bed.alpha);
  } else if (earthen && px >= 5) { const grass = texture('bare', style.emphasis), p = grass && pattern(ctx, grass); if (p) stroke(p, width * .2, .55, RUT_DASH, 'butt'); }
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = 'round';
}
