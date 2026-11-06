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
  major: { floor: 2.4, ceil: 9, alpha: .96, contrast: .2, earth: .82, shoulder: .2, surface: GRAVEL },
  minor: { floor: 1.6, ceil: 7, alpha: .92, contrast: .17, earth: .74, shoulder: .16, surface: GRAVEL },
  street: { floor: 1.5, ceil: 6, alpha: .92, contrast: .12, earth: .74, shoulder: .14, surface: EARTH },
  lane: { floor: 1.1, ceil: 5, alpha: .84, contrast: .1, earth: .62, shoulder: .1, surface: EARTH },
  track: { floor: .95, ceil: 4, alpha: .72, contrast: .095, earth: .5, shoulder: .06, surface: DIRT },
  path: { floor: .75, ceil: 2.6, alpha: .54, contrast: .06, earth: .38, shoulder: 0, surface: DIRT },
};
/** Screen floor by urban street rank (0 = main street … 4 = lane), any look. */
export const STREET_MIN_PX: readonly number[] = [3, 2.4, 1.7, 1.2, .9];
export const regionalRank = (kind: string): RoadRank => kind === 'major' ? 'major' : kind === 'track' ? 'track' : 'minor';
/** 3D regional streets carry a rank, not a kind. */
export const regionalStreetRank = (rank: number): RoadRank => rank <= 1 ? 'major' : rank === 2 ? 'minor' : 'track';
export const streetRank = (role: string, rank: number): RoadRank => role === 'track' ? 'track' : rank <= 2 ? 'street' : 'lane';

/** Width in world units: true width, kept between the rank's floor and, before true scale, its ceiling. */
export function roadWidth(rank: RoadRank, metres: number, scale: number): number {
  const s = ROAD_RANK_STYLE[rank];
  return Math.max(s.floor / scale, scale < .3 ? Math.min(metres, s.ceil / scale) : metres);
}

export interface RoadStyle { look: import('./composition').RoadLook; /** 0.5–1.5, contrast against the ground. */ emphasis: number; night: boolean; colors?: RenderColors }
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
const NIGHT_EARTH: Rgb = [112, 118, 136];
/** Local road colour: earth pulled towards the ground, lifted off dark ground, sunk into pale ground. */
export function roadTone(ground: Rgb, rank: RoadRank, emphasis: number, night: boolean): Rgb {
  const s = ROAD_RANK_STYLE[rank], l = lum(ground), mix = over(night ? NIGHT_EARTH : s.surface, ground, s.earth), m = lum(mix);
  // Above .7 a ground is pale enough for the road to sink; the band keeps the turn free of a hard step.
  const sink = clamp((l - .66) / .1, 0, 1), step = s.contrast * (night ? .62 : 1) * clamp(emphasis, .5, 1.5);
  const target = (l + step) * (1 - sink) + (l - 1.9 * step) * sink, k = clamp(target, .05, .95) / Math.max(.04, m);
  // Scaling brightens the chroma too; earth stays dull.
  const out: Rgb = [mix[0] * k, mix[1] * k, mix[2] * k], grey = lum(out) * 255;
  return [grey + (out[0] - grey) * .8, grey + (out[1] - grey) * .8, grey + (out[2] - grey) * .8];
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
function texture(rank: RoadRank | 'bare', emphasis: number): Surface | undefined {
  if (!ground?.data.length) return undefined;
  const key = `${ground.key}|${rank}|${emphasis}`; let out = texturesOf.get(key);
  if (out) return out;
  const surface = makeSurface(GRID, GRID), ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!surface || !ctx) return undefined;
  const image = ctx.createImageData(GRID, GRID), d = ground.data, o = image.data, night = ground.night;
  const lut = new Map<number, Rgb>();
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const k = (j * GRID + i) * 4;
    let c: Rgb = [d[k], d[k + 1], d[k + 2]];
    if (rank !== 'bare') { const id = d[k] << 16 | d[k + 1] << 8 | d[k + 2]; let t = lut.get(id); if (!t) lut.set(id, t = roadTone(c, rank, emphasis, night)); c = t; }
    const m = 1 + .05 * stain(i >> 1, j >> 1) + .03 * stain(i, j);
    o[k] = c[0] * m; o[k + 1] = c[1] * m; o[k + 2] = c[2] * m; o[k + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (texturesOf.size >= 24) texturesOf.delete(texturesOf.keys().next().value!);
  texturesOf.set(key, surface);
  return surface;
}
const patterns = new WeakMap<CanvasRenderingContext2D, Map<Surface, CanvasPattern>>();
function pattern(ctx: CanvasRenderingContext2D, surface: Surface): CanvasPattern | undefined {
  let own = patterns.get(ctx); if (!own) patterns.set(ctx, own = new Map());
  let p = own.get(surface);
  if (!p) {
    const made = ctx.createPattern?.(surface as CanvasImageSource, 'repeat'); if (!made) return undefined;
    made.setTransform?.(new DOMMatrix([ground!.size / GRID, 0, 0, ground!.size / GRID, 0, 0]));
    own.set(surface, p = made);
  }
  return p;
}
const GRAIN = 128, GRAIN_METRES = 40;
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
/** The grain pattern for this context, or undefined where patterns do not exist. */
export function roadGrain(ctx: CanvasRenderingContext2D): CanvasPattern | undefined {
  let p = grains.get(ctx);
  if (!p) {
    const tile = grainTile(), made = tile && ctx.createPattern?.(tile as CanvasImageSource, 'repeat'); if (!made) return undefined;
    made.setTransform?.(new DOMMatrix([GRAIN_METRES / GRAIN, 0, 0, GRAIN_METRES / GRAIN, 0, 0]));
    grains.set(ctx, p = made);
  }
  return p;
}
/** Paint of a rank: the ground-following texture, its base tone without a ground grid, or the custom colour. */
export function roadPaint(ctx: CanvasRenderingContext2D, rank: RoadRank, style: RoadStyle): string | CanvasPattern {
  const custom = rank === 'track' || rank === 'path' ? style.colors?.track : style.colors?.road;
  if (custom) return custom;
  const surface = texture(rank, style.emphasis), made = surface && pattern(ctx, surface);
  return made ?? rgbCss(roadTone(ground?.base ?? MATERIAL_TONES.base, rank, style.emphasis, style.night));
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
  const s = ROAD_RANK_STYLE[rank], e = emphasisAlpha(style.emphasis), px = width * scale;
  return { shadow: s.shoulder > 0 ? { color: SHADOW, alpha: clamp(s.shoulder * e, 0, .4), extra: Math.max(1.4 / scale, width * .34) } : undefined,
    bed: { alpha: clamp(s.alpha * e, .2, 1) },
    wear: px >= 2.6 && px < 7 ? { color: style.night ? LIGHT_WEAR : WEAR, alpha: (style.night ? .07 : .13) * e, share: .56, dash: WEAR_DASH } : undefined,
    grain: px >= 7 ? (style.night ? .3 : .5) * Math.min(1, e) : 0 };
}
/** One natural road class: shoulder, bed with an uneven edge, wear, and wheel ruts on earth tracks up close. */
export function strokeNaturalRoad(ctx: CanvasRenderingContext2D, path: Path2D, rank: RoadRank, width: number, scale: number, style: RoadStyle): void {
  const paint = roadPaint(ctx, rank, style), marks = naturalMarks(rank, width, scale, style), px = width * scale, earthen = rank === 'track' || rank === 'path';
  const stroke = (color: string | CanvasPattern, w: number, alpha: number, dash: readonly number[] = [], cap: CanvasLineCap = 'round'): void => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; ctx.setLineDash(dash as number[]); ctx.lineCap = cap; ctx.stroke(path);
  };
  ctx.lineJoin = 'round';
  if (marks.shadow) stroke(marks.shadow.color, width + marks.shadow.extra, marks.shadow.alpha);
  if (rank === 'path') stroke(paint, width, marks.bed.alpha, [Math.max(3.4, 4 / scale), Math.max(1.8, 2.6 / scale)], 'butt');
  else if (px < 2.4) stroke(paint, width, marks.bed.alpha);
  else {
    // A narrower continuous bed and full-width irregular runs: the edge wanders without any new geometry; on earth the grass eats further in.
    stroke(paint, width * (earthen ? .66 : .88), marks.bed.alpha);
    stroke(paint, width, marks.bed.alpha * (earthen ? .72 : 1), EDGE_DASH);
  }
  if (marks.wear) stroke(marks.wear.color, width * marks.wear.share, marks.wear.alpha, marks.wear.dash, 'round');
  if (marks.grain) { const grain = roadGrain(ctx); if (grain) stroke(grain, width, marks.grain); }
  if (earthen && px >= 5) { const grass = texture('bare', style.emphasis), p = grass && pattern(ctx, grass); if (p) stroke(p, width * .2, .55, RUT_DASH, 'butt'); }
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = 'round';
}
