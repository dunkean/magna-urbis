import { styleTraits } from '../../web/src/render/terrainStyle';
/** Shared display-only painter. Coordinates and pitch are world metres; no engine rules. */
export type FantasyStyle = 'fantasy-ink' | 'fantasy-color';
export interface FantasyOptions { density: number; size: number; spacing: number; followLanduse?: boolean; /** false: no forest brushes, another vegetation look owns the woods. */ forests?: boolean; /** Forest brushes alone: a ground with its relief hidden has no hills, mountains or ground motifs. */ forestsOnly?: boolean; /** Detail level: auto picks `detail` for a small map. A zoomed export asks for `detail`. */ lod?: "auto" | "overview" | "detail"; /** Nominal raster width (px) the stamp sizes are clamped for; defaults to the level raster. */ raster?: number; /** false: the SVG export leaves the stamps to a canvas painter. */ svgStamps?: boolean }
export const DEFAULT_FANTASY_OPTIONS: FantasyOptions = { density: 1, size: 1, spacing: 1 };
export const isFantasyStyle = (style: string): style is FantasyStyle => styleTraits(style).fantasy !== undefined;
export type PaintLanduse = 'forest' | 'orchard' | 'field' | 'garden' | 'vineyard' | 'marsh' | 'meadow' | 'pasture' | 'commons';
export const isCultivatedLanduse = (landuse?: PaintLanduse): boolean => landuse === 'field' || landuse === 'orchard' || landuse === 'garden' || landuse === 'vineyard' || landuse === 'pasture';
export interface PaintSample { height: number; slope: number; temperature: number; rain: number; water?: boolean; occupied?: boolean; landuse?: PaintLanduse; /** Signed local prominence / sampling radius, as in Render. */ tpi?: number; relief?: number; /** Vertical relief within about a kilometre (m): the scale of a whole mountain, independent of the map size. */ massif?: number; /** Display canopy cover 0..1 (the forest field shared with the other styles); replaces the climate estimate. */ woods?: number; /** Holdings are painted edge to edge by a field wash: crop tiles become sparse accents. */ landuseDetail?: boolean; /** Inside a road/river corridor or on a farm or hamlet: no stamp anchors, the ground wash still paints. */ cleared?: boolean }
export interface OrchardParcel { kind: string; poly: readonly { x: number; y: number }[]; holes?: readonly (readonly { x: number; y: number }[])[]; stripAngle?: number }
export interface PaintOptions { seed: string; pitch: number; density?: number; size?: number; maxStamps?: number; followLanduse?: boolean; /** Exact holdings for orchard rows; absent rasters use a fixed world orientation. */ parcels?: readonly OrchardParcel[]; /** Size stays independent of spacing. */ brushPitch?: number; forests?: boolean; forestsOnly?: boolean; /** Width of the whole map (m), the physical reference for stamp sizes; defaults to 65 brush pitches. */ mapWidth?: number; lod?: PaintLod; raster?: number; /** Tallest relief of the map (m): the top of the size hierarchy. */ reliefRef?: number; /** Land elevation of the lowlands and of the summits (m, low and high percentiles): relief tiers are relative to it. */ heightRange?: readonly [number, number];
  /** Cultivated ground stays clear of relief even when vegetation does not follow land use. */
  cultivated?: (x: number, y: number) => boolean;
  /** 'coarse': relief, woodland clumps and orchard rows (the whole-map plan); 'fine': wild single trees and ground plants only (planned per view tile, see
   * web/src/ui/fantasyRaster.ts); 'all' (default): everything. Trees may stand on the painted slopes: relief is drawn first, vegetation above it. */
  vegetation?: 'all' | 'coarse' | 'fine' }
export interface Stamp { x: number; y: number; width: number; height: number; brush: number; variant?: number; flip: boolean; opacity: number; heightScale?: number }
export interface PaintBounds { x: number; y: number; width: number; height: number }
export interface Atlas { url: string; width: number; height: number; rows: number[]; rects?: [number, number, number, number][]; variantsPerStyle?: number }
export const FAMILY_NAMES = ['pines', 'broadleaf', 'tropical', 'cypress', 'rocks', 'dunes', 'wetlands', 'crops', 'grasses', 'shrubs', 'heath', 'woodland', 'massifs', 'downs'] as const;
export type BrushFamily = typeof FAMILY_NAMES[number];
/** Brush ids: 0-15 historical, 16 alpine peaks, 17 shrubs, 18 foothills, 19 heath, 20 woodland clumps.
 * Every mountain tier (peaks, ridges, snow, foothills) draws the large painted massifs, hills the large downs:
 * both are high-resolution single landforms (see assets/fantasy/families/massifs-source). */
const BRUSH_FAMILY: BrushFamily[] = ['pines', 'broadleaf', 'tropical', 'cypress', 'downs', 'massifs', 'massifs', 'rocks', 'dunes', 'wetlands', 'crops', 'broadleaf', 'pines', 'broadleaf', 'tropical', 'grasses', 'massifs', 'shrubs', 'massifs', 'heath', 'woodland'];
/** Massif cells 0-5 are bare rock and grass, 6-7 snow-capped. */
const MASSIF_ROCK = 6;
export const BRUSH = { hills: 4, ridges: 5, snow: 6, rocks: 7, dunes: 8, wetlands: 9, crops: 10, orchards: 11, grasses: 15, peaks: 16, shrubs: 17, foothills: 18, heath: 19, woodland: 20 } as const;
/** Single trees: upright crowns with a fixed aspect. */
export const isTreeBrush = (brush: number): boolean => brush < 4 || brush === BRUSH.orchards || brush >= 12 && brush <= 14;
/** Relief symbols: hills, ridges, peaks, rocks and dunes. */
export const isReliefBrush = (brush: number): boolean => brush >= 4 && brush <= 8 || brush === 16 || brush === 18;
/** Large landforms (massifs and downs): painted first, under the holdings and the vegetation. */
export const isLandformBrush = (brush: number): boolean => brush === 4 || brush === 5 || brush === 6 || brush === 16 || brush === 18;
export interface BrushFrame { atlas: Atlas; family: BrushFamily; index: number; token: string; rect: [number, number, number, number]; aspect: number }
export interface BrushLibrary { kind: 'families'; style: FantasyStyle; families: Record<BrushFamily, Atlas>; frames: BrushFrame[]; variants: number; offsets: number[] }
export function createBrushLibrary(style: FantasyStyle, families: Record<BrushFamily, Atlas>): BrushLibrary {
  const frames: BrushFrame[] = [], offsets: number[] = [];
  const variants = Math.max(...Object.values(families).map(a => a.variantsPerStyle ?? 8));
  for (let brush = 0; brush < BRUSH_FAMILY.length; brush++) {
    offsets.push(frames.length);
    const family = BRUSH_FAMILY[brush], atlas = families[family];
    if (!atlas) throw new Error(`Missing fantasy brush sheet: ${family}`);
    const count = atlas.variantsPerStyle ?? 8;
    for (let v = 0; v < variants; v++) {
      // Five to eight tree silhouettes; never mix individual trees and giant clumps.
      // Orchard crowns: only round, single broadleaf trees, never the orchard clump atlas.
      const variant = brush === BRUSH.orchards ? [0, 1, 4][v % 3] % count : family === 'massifs' ? (brush === BRUSH.snow ? MASSIF_ROCK + v % 2 : v % MASSIF_ROCK) % count
        : v % (isTreeBrush(brush) ? Math.min(6, count) : count);
      const index = variant + (styleTraits(style).fantasy === 'color' ? count : 0), rect = atlasRect(atlas, index);
      frames.push({ atlas, family, index, token: `${family}-${index}`, rect, aspect: rect[3] / rect[2] });
    }
  }
  return { kind: 'families', style, families, frames, variants, offsets };
}
export function brushFrame(library: BrushLibrary, stamp: Stamp): BrushFrame {
  return library.frames[library.offsets[stamp.brush] + (stamp.variant ?? 0) % library.variants];
}
// Per-subject source bounds exclude neighbouring silhouettes on the generated sheets.
export const ATLAS_GEOMETRY: Record<FantasyStyle, Omit<Atlas, 'url'>> = {
  'fantasy-ink': { width: 1254, height: 1254, rows: [0,.28,.52,.735,1], rects: [
    [35,0,265,346], [323,20,305,325], [651,20,286,322], [1075,0,130,346],
    [0,414,320,230], [325,350,305,294], [638,350,312,294], [958,399,296,245],
    [0,692,320,225], [328,665,310,250], [644,680,301,236], [962,647,292,272],
    [30,928,282,326], [325,928,300,326], [647,929,307,325], [973,975,281,279]
  ] },
  'fantasy-color': { width: 1295, height: 1214, rows: [0,.295,.54,.75,1], rects: [
    [40,0,245,358], [333,20,310,338], [677,15,290,343], [1039,0,222,358],
    [0,420,326,234], [328,357,325,300], [660,350,320,308], [993,395,302,254],
    [0,680,333,234], [338,663,310,252], [653,682,329,233], [995,657,300,245],
    [30,916,292,298], [328,916,312,298], [660,916,320,298], [999,970,266,244]
  ] }
};
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function paintSeed(value: string): number {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++) seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
  return seed;
}
export function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function smooth(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t);
}
/** Same climate, lapse, valley moisture and exposure controls as Render's material.
 * Biomes provide continuous coverage, never an exclusive choice of one icon. */
export function paintingCover(s: PaintSample): { woods: number; mountain: number; hill: number; dry: number; wet: number; snow: number; temperature: number } {
  const t = s.temperature - .0065 * s.height, hot = t + 6, cold = t - 6;
  const valley = smooth(0, -.12, s.tpi ?? 0), ridge = smooth(0, .12, s.tpi ?? 0);
  const humid = s.rain / Math.max(20 * t + 280, 120) * (1 + .7 * valley - .18 * ridge);
  const rockTan = Math.tan(40 * Math.PI / 180), rockEff = rockTan * (.55 + .45 * smooth(.3, 1.3, humid));
  const exposure = clamp(smooth(rockEff * .5, rockEff * 1.3, s.slope) + .35 * ridge - .3 * valley);
  const woods = clamp((smooth(.65, 2.1, humid) * smooth(5.5, 13.5, hot + .8 * valley)
    * (1 - smooth(rockTan * .9, rockTan * 1.6, s.slope)) * (1 - .22 * ridge)
    + .14 * valley * smooth(2, 10, hot) * smooth(.4, 1.2, humid)) * (1 - exposure));
  const high = smooth(850, 2600, s.height), rugged = smooth(100, 850, s.relief ?? s.slope * 1800);
  const mountain = clamp(Math.max(high * (.45 + .55 * rugged), smooth(.20, .65, s.slope) * rugged) * (1 - .94 * valley));
  const hill = clamp(Math.max(smooth(.07, .28, s.slope), smooth(70, 350, s.relief ?? 0)) * (1 - mountain) * (1 - .95 * valley) * smooth(-.035, .065, s.tpi ?? .065));
  return { woods, mountain, hill, dry: 1 - smooth(.35, 1, humid),
    wet: smooth(1.8, 3.5, humid) * (1 - smooth(.015, .08, s.slope)) * (1 - smooth(50, 250, s.height)),
    snow: smooth(2.5, -2.5, hot) * smooth(60, 400, s.rain), temperature: cold };
}
/** Detail levels of one painting. The raster width is the nominal image the stamp pixel sizes refer to:
 * `overview` is the whole map on screen, `detail` a small or zoomed map with more, smaller stamps. */
export type PaintLod = 'overview' | 'detail';
export const LOD_RASTER: Record<PaintLod, number> = { overview: 1400, detail: 3400 };
export const fantasyLod = (mapWidth: number, viewWidth = mapWidth): PaintLod => mapWidth < 6000 || viewWidth < mapWidth / 2.5 ? 'detail' : 'overview';
/** Relief tiers, top down: peaks and ridges on the summits, foothills on the shoulders, scattered hills on the lower crests. */
type ReliefTier = 'peaks' | 'ridges' | 'foothills' | 'hills';
/** Real landscape scale (m), independent of map extent, camera and raster: a massif spans about 2.2 times the relief
 * of its kilometre (a 600 m relief gives a 1.3 km massif), a hill about 4 times. Trees (11 m crowns) read the scale on the slopes. */
const MASSIF_M = [700, 4500] as const, DOWNS_M = [400, 2000] as const, MASSIF_PER_RELIEF = 2.2, DOWNS_PER_RELIEF = 4;
/** Shoulders of a chain shrink towards its edges but stay at least this share of the core massif. */
const CHAIN_EDGE = .45, CHAIN_RADII = [1200, 2400];
/** Relief within a kilometre (m) below which no landform is drawn, and below which it is a hill rather than a massif. */
const MIN_DOWNS_RELIEF = 40, MIN_MASSIF_RELIEF = 180;
/** Relief score span of each tier. */
const TIER_SCORE: Readonly<Record<ReliefTier, readonly [number, number]>> = { peaks: [.74, 1], ridges: [.54, .86], foothills: [.38, .62], hills: [.1, .46] };
const CROWN_M = 11, GROUND_M = 22;
/** Relief of the kilometre around a point: the broad field when the sampler has it, else the local relief. */
const massifRelief = (s: PaintSample): number => s.massif ?? reliefProminence(s);
/** Vertical extent a summit stands on: local relief, or its height above the lowlands. */
export const reliefProminence = (s: PaintSample): number => Math.max(s.relief ?? s.slope * 1800, .6 * Math.max(0, s.height - 250));
interface Candidate { stamp: Stamp; r: number; prio: number }
/** Regular fruit trees, independent of the wild vegetation's Poisson sampling and LOD.
 * Keep the entire silhouette inside the holding, including holes, before drawing it over the wash. */
function orchardTrees(bounds: PaintBounds, sample: (x: number, y: number) => PaintSample | undefined, options: PaintOptions): Stamp[] {
  const result: Stamp[] = [], seed = paintSeed(options.seed) ^ 11731, step = 9;
  const inside = (x: number, y: number, ring: OrchardParcel['poly']): boolean => {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes;
    }
    return yes;
  };
  const parcels = options.parcels?.filter(p => p.kind === 'orchard') ?? [undefined];
  for (const parcel of parcels) {
    if (parcel && parcel.poly.length < 3) continue;
    let angle = parcel?.stripAngle ?? 0, longest = 0;
    if (parcel && parcel.stripAngle === undefined) for (let i = 0; i < parcel.poly.length; i++) {
      const a = parcel.poly[i], b = parcel.poly[(i + 1) % parcel.poly.length], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length > longest) { longest = length; angle = Math.atan2(b.y - a.y, b.x - a.x); }
    }
    const c = Math.cos(angle), s = Math.sin(angle), pad = 12;
    let x0 = bounds.x - pad, y0 = bounds.y - pad, x1 = bounds.x + bounds.width + pad, y1 = bounds.y + bounds.height + pad;
    if (parcel) {
      x0 = Math.max(x0, Math.min(...parcel.poly.map(p => p.x))); x1 = Math.min(x1, Math.max(...parcel.poly.map(p => p.x)));
      y0 = Math.max(y0, Math.min(...parcel.poly.map(p => p.y))); y1 = Math.min(y1, Math.max(...parcel.poly.map(p => p.y)));
    }
    if (x1 < x0 || y1 < y0) continue;
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    const us = corners.map(([x, y]) => x * c + y * s), vs = corners.map(([x, y]) => -x * s + y * c);
    const rings = parcel ? [parcel.poly, ...parcel.holes ?? []] : [];
    for (let j = Math.floor(Math.min(...vs) / step); j <= Math.ceil(Math.max(...vs) / step); j++) {
      for (let i = Math.floor(Math.min(...us) / step); i <= Math.ceil(Math.max(...us) / step); i++) {
        const u = (i + .5) * step + (hash(i, j, seed) - .5) * .6, v = (j + .5) * step + (hash(i, j, seed ^ 71) - .5) * .6;
        const x = u * c - v * s, y = u * s + v * c;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const p = sample(x, y);
        if (!p || p.landuse !== 'orchard' || p.height <= 0 || p.water || p.occupied || p.cleared) continue;
        const width = Math.max(5, Math.min(8, 6.5 * (options.size ?? 1) * (.94 + .12 * hash(i, j, seed ^ 319))));
        const h = width * 1.25, cy = y - h * .45, radius = Math.hypot(width / 2, h / 2);
        if (parcel && (!inside(x, cy, parcel.poly) || parcel.holes?.some(r => inside(x, cy, r)))) continue;
        let crosses = false;
        for (const ring of rings) for (let k = 0; k < ring.length; k++) {
          const a = ring[k], b = ring[(k + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (cy - a.y) * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(x - a.x - t * dx, cy - a.y - t * dy) < radius) { crosses = true; break; }
        }
        if (crosses) continue;
        // Raster-only callers have no contours: conservatively keep the silhouette on orchard ground.
        if (!parcel && [[-width / 2, -h * .95], [width / 2, -h * .95], [-width / 2, h * .05], [width / 2, h * .05]].some(([dx, dy]) => sample(x + dx, y + dy)?.landuse !== 'orchard')) continue;
        result.push({ x, y, width, height: h, heightScale: 1, brush: BRUSH.orchards, variant: Math.floor(hash(i, j, seed ^ 6317) * 3), flip: hash(i, j, seed ^ 97) > .5, opacity: 1 });
      }
    }
  }
  return result;
}
/** Order-independent Poisson-like rejection: a candidate survives unless a higher-priority one lies within
 * the sum of their radii. Local by construction, so cropped plans keep the same anchors. */
function suppress(items: Candidate[]): Candidate[] {
  if (items.length < 2) return items;
  let maxR = 0; for (const c of items) maxR = Math.max(maxR, c.r);
  const cell = Math.max(2 * maxR, 1e-6), grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx + 1048576) * 2097152 + (cy + 1048576);
  items.forEach((c, i) => {
    const k = key(Math.floor(c.stamp.x / cell), Math.floor(c.stamp.y / cell)), list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  });
  return items.filter((c, i) => {
    const cx = Math.floor(c.stamp.x / cell), cy = Math.floor(c.stamp.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(key(cx + dx, cy + dy)) ?? []) {
      const o = items[j];
      if (j === i || !(o.prio > c.prio || o.prio === c.prio && j < i)) continue;
      const rr = c.r + o.r, ex = o.stamp.x - c.stamp.x, ey = o.stamp.y - c.stamp.y;
      if (ex * ex + ey * ey < rr * rr) return false;
    }
    return true;
  });
}
/** World anchored, back-to-front stamps. Relief fades continuously from high peaks through foothills and
 * scattered hills to the plain; woods go from a dense core to a sparse edge and isolated trees. Sizes follow
 * physical references clamped to the raster, spacing is a Poisson-like rejection tied to stamp size. */
export function planPainting(bounds: PaintBounds, sample: (x: number, y: number) => PaintSample | undefined, options: PaintOptions): Stamp[] {
  const pitch = options.pitch, density = Math.max(0, Math.min(2, options.density ?? 1)), size = Math.max(.1, Math.min(2, options.size ?? 1));
  const brushPitch = options.brushPitch ?? pitch, lod = options.lod ?? 'overview';
  const mapWidth = options.mapWidth ?? brushPitch * 65, raster = options.raster ?? LOD_RASTER[lod];
  if (![pitch, brushPitch, bounds.x, bounds.y, bounds.width, bounds.height, density, size, mapWidth, raster].every(Number.isFinite) || pitch <= 0 || brushPitch <= 0 || bounds.width <= 0 || bounds.height <= 0 || mapWidth <= 0 || raster <= 0 || density === 0) return [];
  const defaultBudget = lod === 'detail' ? 200000 : 150000, requested = options.maxStamps ?? defaultBudget;
  const seed = paintSeed(options.seed), result: Stamp[] = [], budget = Number.isFinite(requested) ? Math.max(0, Math.min(400000, Math.floor(requested))) : defaultBudget;
  const spacing = Math.max(.3, Math.min(3, pitch / brushPitch)), fine = Math.max(.4, Math.min(1, spacing));
  const refProm = Math.max(120, options.reliefRef ?? 900), hr = options.heightRange;
  /** 0..1: where a point sits in the map's own relief (lowlands 0, summits 1), raised on crests, lowered in valleys. */
  const reliefScore = (p: PaintSample): number => {
    const e = hr ? clamp((p.height - hr[0]) / Math.max(60, hr[1] - hr[0])) : 0, prom = clamp(reliefProminence(p) / refProm);
    return clamp(.5 * e + .3 * prom + .2 * smooth(.08, .45, p.slope)) * (.78 + .22 * smooth(-.03, .08, p.tpi ?? 0));
  };
  // Vegetation keeps its real size (a tree is a few percent of a big mountain); sub-pixel stamps are skipped at draw time.
  const treeW = CROWN_M * size, groundW = GROUND_M * size, mode = options.vegetation ?? 'all';
  const nbs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const cultivated = options.cultivated ?? ((sx: number, sy: number) => isCultivatedLanduse(sample(sx, sy)?.landuse));
  for (const pass of ['relief', 'ground', 'forest'] as const) {
    if (pass === 'forest' ? options.forests === false : options.forestsOnly) continue;
    if (pass === 'relief' && mapWidth < DOWNS_M[0]) continue;
    if (mode === 'fine' && pass === 'relief' || mode === 'coarse' && pass === 'ground') continue;
    const salt = seed ^ (pass === 'relief' ? 181 : pass === 'forest' ? 719 : 1231);
    const pad = pass === 'relief' ? MASSIF_M[1] * .6 : pass === 'ground' ? groundW * 2.6 : treeW * 4;
    // Dense candidate lattices: the Poisson rejection below sets the final packing, overlap included.
    const step = Math.max(1e-6, pass === 'relief' ? 110 * fine : pass === 'forest' ? treeW * (mode === 'coarse' ? 1.5 : .66) * fine : groundW * .3 * fine);
    const x0 = Math.floor((bounds.x - pad) / step), x1 = Math.ceil((bounds.x + bounds.width + pad) / step);
    const y0 = Math.floor((bounds.y - pad) / step), y1 = Math.ceil((bounds.y + bounds.height + pad) / step);
    const stride = Math.max(1, Math.ceil(Math.sqrt((x1 - x0 + 1) * (y1 - y0 + 1) / 420000)));
    if (![x0, x1, y0, y1, stride].every(Number.isSafeInteger)) return [];
    const candidates: Candidate[] = [];
    // Align coarse safety sampling to the world, including when cropping.
    for (let gy = Math.ceil(y0 / stride) * stride; gy <= y1; gy += stride) for (let gx = Math.ceil(x0 / stride) * stride; gx <= x1; gx += stride) {
      const x = (gx + .1 + hash(gx, gy, salt ^ 71) * .8) * step;
      const y = (gy + .1 + hash(gx, gy, salt ^ 191) * .8) * step, s = sample(x, y);
      if (!s || ![s.height, s.slope, s.temperature, s.rain].every(Number.isFinite) || s.height <= 0 || s.water || s.occupied || s.cleared) continue;
      const c = paintingCover(s), patch = noise(x / (brushPitch * 7), y / (brushPitch * 7), seed ^ 891);
      const detail = noise(x / (brushPitch * 1.8), y / (brushPitch * 1.8), seed ^ 421), grain = noise(x / (brushPitch * .55), y / (brushPitch * .55), seed ^ 5309);
      const variation = .85 + .3 * hash(gx, gy, salt ^ 319);
      let brush: number, cover: number, w: number, k: number, prio = hash(gx, gy, salt ^ 5501), edge = false, variant = Math.floor(hash(gx, gy, salt ^ 6317) * 32), opacity = 1, flip = hash(gx, gy, salt ^ 97) > .5;
      if (pass === 'relief') {
        if (isCultivatedLanduse(s.landuse) || options.cultivated?.(x, y)) continue;
        if (reliefProminence(s) < 35 || s.slope < .04) continue;
        // Tiers follow the map's own relief (elevation above the lowlands, prominence, slope, crest position)
        // and the absolute mountain cover on high maps.
        const m = c.mountain, score = Math.max(m, reliefScore(s)), valley = smooth(0, -.1, s.tpi ?? 0);
        const r1 = hash(gx, gy, salt ^ 4411), r2 = hash(gx, gy, salt ^ 4423);
        let tier: ReliefTier | undefined = score > .74 + .12 * r1 ? 'peaks' : score > .54 + .1 * r1 ? 'ridges' : score > .38 + .08 * r2 ? 'foothills'
          : score > .1 + .08 * r2 ? 'hills' : undefined;
        if (!tier || valley > .8 + .15 * r2) continue;
        // The physical relief of the kilometre decides the landform: a gently rolling high plateau carries downs, not
        // mountains; a strong relief scored low on a map of giants still reads as a foothill massif.
        const broad = massifRelief(s);
        if (broad < MIN_DOWNS_RELIEF) continue;
        if (tier !== 'hills' && broad < MIN_MASSIF_RELIEF) tier = 'hills';
        else if (tier === 'hills' && broad > 2 * MIN_MASSIF_RELIEF) tier = 'foothills';
        const [lo, hi] = TIER_SCORE[tier], level = smooth(lo, hi, score), hill = tier === 'hills';
        // Massifs overlap into continuous stacked ranges (centres about a third of a width apart); hills stand apart, sparse.
        if (tier === 'peaks') { brush = c.snow > .25 + .3 * r2 ? BRUSH.snow : BRUSH.peaks; k = .36; cover = .98; }
        else if (tier === 'ridges') { brush = c.snow > .45 + .3 * r2 ? BRUSH.snow : BRUSH.ridges; k = .36; cover = .97; }
        else if (tier === 'foothills') { brush = BRUSH.foothills; k = .4; cover = .75 + .2 * level; }
        else { brush = BRUSH.hills; k = 1.1; cover = .25 + .25 * level; }
        // Size in metres from the relief of the kilometre around, never from the map, view or raster: the core of a
        // chain (largest relief within a few kilometres) sets the big massifs; its shoulders stay at least CHAIN_EDGE of it.
        let chain = massifRelief(s);
        for (const [dx, dy] of nbs) for (const radius of CHAIN_RADII) {
          const n = sample(x + dx * radius, y + dy * radius);
          if (n && !n.water && n.height > 0) chain = Math.max(chain, massifRelief(n));
        }
        const [wMin, wMax] = hill ? DOWNS_M : MASSIF_M, per = hill ? DOWNS_PER_RELIEF : MASSIF_PER_RELIEF;
        const core = Math.max(wMin, Math.min(wMax, chain * per)), own = Math.min(core, massifRelief(s) * per * (tier === 'foothills' ? .8 : 1));
        w = Math.max(wMin, CHAIN_EDGE * core, own) * size * variation;
        w = Math.min(w, wMax * size, mapWidth * .9);
        // Big landforms first; the higher tier wins a contested spot.
        prio += w / MASSIF_M[1] + (tier === 'peaks' ? 1 : tier === 'ridges' ? .6 : tier === 'foothills' ? .3 : 0);
      } else if (pass === 'forest') {
        // Land use decides where woods stand; the shared canopy field (or the climate) decides elsewhere.
        let stray = false;
        if (s.landuse !== undefined && s.landuse !== 'forest') {
          if (s.landuse === 'field' || s.landuse === 'garden' || s.landuse === 'orchard' || mode === 'coarse' || hash(gx, gy, salt ^ 4049) > .1) continue;
          let near = 0; for (const [dx, dy] of nbs) if (sample(x + dx * treeW * 2.5, y + dy * treeW * 2.5)?.landuse === 'forest') near++;
          if (!near) continue;
          stray = true;
        }
        const potential = s.landuse === 'forest' || stray ? 1 : options.followLanduse && s.woods === undefined ? 0 : s.woods ?? c.woods;
        if (potential < .02) continue;
        const tropical = c.temperature > 13 && s.rain > 1100, conifer = c.temperature < 3 || s.height > 1100 || noise(x / (brushPitch * 5), y / (brushPitch * 5), seed ^ 2027) > .7;
        brush = tropical ? 2 : conifer ? 0 : c.temperature > 8 && s.rain < 850 ? 3 : 1;
        // Dense painted canopy with noise: full cores, thinning edges, clearings and stray trees.
        const field = clamp(potential * (.55 + 1.3 * (.6 * patch + .4 * detail - .25)));
        // Wild woods breathe: large clearings, heath and scrub between stands. Woods climb the painted slopes (drawn over
        // the massifs, they give the scale); only the bare rocky tops keep few trees.
        const glade = smooth(.28, .55, noise(x / (brushPitch * 11), y / (brushPitch * 11), seed ^ 1409));
        cover = (s.landuse === 'forest' ? .82 + .18 * detail : smooth(.32, .85, field) * (.55 + .45 * grain) * glade) * (1 - .45 * c.wet) * (1 - .75 * smooth(.35, .85, c.mountain)) * (1 - .5 * smooth(.6, .9, reliefScore(s)));
        if (stray) cover = .5;
        edge = s.landuse === 'forest'; k = .36; w = treeW * (.8 + .45 * hash(gx, gy, salt ^ 913));
        // Woodland clumps carry the mass at a distance; single crowns keep the texture.
        // 'coarse' plans the clumps alone (the far view), 'fine' the single crowns alone (tiles), 'all' mixes them.
        const clump = mode === 'coarse' ? cover > .45 : mode === 'all' && cover > .5 && hash(gx, gy, salt ^ 3301) < .3;
        if (mode === 'coarse' && !clump) continue;
        if (clump) {
          const conif = brush === 0;
          brush = BRUSH.woodland; w *= 2.4; k = .34;
          variant = conif ? [2, 3, 7][Math.floor(grain * 2.99)] : [0, 1, 4, 5, 6][Math.floor(hash(gx, gy, salt ^ 3313) * 4.99)];
        }
      } else {
        const lu = s.landuse;
        let scale: number;
        k = .44;
        if (lu === 'field') {
          // Whole holdings read as one crop: the variant follows a field-scale noise, not the stamp.
          brush = BRUSH.crops; cover = s.landuseDetail ? 0 : .15; scale = .55; k = .3; flip = noise(x / (brushPitch * .9), y / (brushPitch * .9), seed ^ 7723) > .5;
          const crops = c.temperature > 16 && c.wet > .3 ? [5, 0, 4] : s.slope > .12 ? [3, 0, 1] : [0, 2, 0, 6, 7, 0, 1, 0];
          variant = crops[Math.floor(noise(x / (brushPitch * .9), y / (brushPitch * .9), seed ^ 7717) * crops.length * .999)];
          if (s.landuseDetail) variant = 6;
        } else if (lu === 'garden') { brush = BRUSH.crops; cover = s.landuseDetail ? 0 : .15; scale = .4; variant = [4, 7, 4][Math.floor(grain * 2.99)]; }
        else if (lu === 'orchard') continue; // A dedicated parcel grid owns fruit trees.
        else if (lu === 'marsh') { brush = detail > .7 ? BRUSH.grasses : BRUSH.wetlands; cover = .9; scale = .55; }
        else if (lu === 'meadow' || lu === 'pasture') {
          brush = grain > .82 ? BRUSH.heath : BRUSH.grasses; cover = (lu === 'meadow' ? .8 : .6) * (.6 + .5 * detail); scale = brush === BRUSH.heath ? .4 : .32;
          if (brush === BRUSH.grasses) variant = Math.floor(hash(gx, gy, salt ^ 77) * 8);
        } else if (lu === 'commons') { brush = grain > .55 ? BRUSH.heath : BRUSH.shrubs; cover = .75 * (.6 + .5 * detail); scale = .42; }
        else if (options.followLanduse && lu === undefined && s.woods === undefined) continue;
        else {
          // Uncultivated ground: dense, noise-modulated plant cover by climate, scree on steep or high ground.
          const wild = .3 + .55 * smooth(.25, .75, .65 * patch + .35 * grain);
          if (c.mountain > .25 || s.slope > .45) { brush = BRUSH.rocks; cover = .35 * smooth(.2, .6, Math.max(c.mountain, s.slope)); scale = .5; }
          else if (c.wet > .35) { brush = BRUSH.wetlands; cover = c.wet * .8 * wild; scale = .5; }
          else if (c.dry > .75 && c.temperature > 6) { brush = s.slope < .03 && patch > .55 ? BRUSH.dunes : BRUSH.shrubs; cover = c.dry * .5 * wild; scale = brush === BRUSH.dunes ? 1.2 : .4; variant = 8 + Math.floor(grain * 7.99); }
          else if (c.dry > .45) { brush = grain > .5 ? BRUSH.shrubs : BRUSH.grasses; cover = .6 * wild; scale = brush === BRUSH.shrubs ? .4 : .32; if (brush === BRUSH.shrubs) variant = 8 + Math.floor(detail * 7.99); }
          else { brush = grain > .62 ? BRUSH.heath : grain > .5 ? BRUSH.shrubs : BRUSH.grasses; cover = .7 * wild * (1 - .5 * c.woods); scale = brush === BRUSH.grasses ? .32 : .4; if (brush === BRUSH.shrubs) variant = Math.floor(detail * 7.99); }
        }
        if (lu !== 'field' && lu !== 'garden') cover *= .15;
        if (brush === BRUSH.grasses) opacity = .9;
        w = groundW * scale * variation;
      }
      if (hash(gx, gy, salt ^ 9811) > clamp(cover * density)) continue;
      const tree = pass === 'forest';
      let px = x, py = y;
      if (isLandformBrush(brush)) {
        // The anchor is the foot of the silhouette (drawn upwards from it): move it south so the painted body
        // (centred about 0.2 width above the foot) sits on the sampled relief.
        py = y + .2 * w;
        // The body stays off built ground (the town is drawn over the foot); holdings are cut out of the drawn relief by the field layer
        // painted over it (fantasyRaster), so one field never removes a whole mountain. A hill keeps clear of the
        // holdings over most of its footprint (no hills on fields).
        if (cultivated(x, y) || s.occupied) continue;
        // The silhouette stays on the relief: its base must stand on land (not sea, lake or off the map). A stamp that
        // overhangs is shrunk towards its anchor until its whole base is dry land, and dropped when it cannot fit.
        const onLand = (width: number): boolean => [-.4, -.2, 0, .2, .4].every(dx => { const n = sample(px + dx * width, py); return !!n && !n.water && n.height > 0; });
        let fitted = 1;
        while (!onLand(w * fitted) && fitted > .4) fitted *= .8;
        if (!onLand(w * fitted)) continue;
        w *= fitted; py = y + .2 * w;
        if (brush === BRUSH.hills) {
          let tilled = 0;
          for (const dx of [-.3, 0, .3]) for (const dy of [-.3, -.15, 0]) if (cultivated(x + dx * w, py + dy * w)) tilled++;
          if (tilled > 3) continue;
        }
      }
      if (edge) {
        // Woodland edge: the stand thins over its last crown widths along an irregular line, crowns a little smaller.
        let inside = 0;
        for (const [dx, dy] of nbs) for (const r of [1.4, 2.8]) if (sample(x + dx * treeW * r, y + dy * treeW * r)?.landuse === 'forest') inside++;
        const f = clamp(inside / 8 + .3 * (noise(x / (treeW * 7), y / (treeW * 7), seed ^ 3907) - .5));
        if (hash(gx, gy, salt ^ 2713) > smooth(.15, .95, f)) continue;
        w *= .75 + .25 * f;
      }
      if (brush === BRUSH.woodland) {
        // A clump has several trunks spread across its base, not one central root.
        // Crowns may overhang water; every part of the root bed stays on dry ground.
        let wetRoots = false;
        for (const dx of [-.45, 0, .45]) for (const dy of [-.18, 0, .03]) {
          const root = sample(px + dx * w, py + dy * w);
          if (!root || root.water || root.height <= 0 || root.occupied || root.cleared) wetRoots = true;
        }
        if (wetRoots) continue;
      }
      // Land anchors stay on land; silhouettes intentionally overhang lakes/roads.
      candidates.push({ r: k * spacing * w / 2, prio, stamp: { x: px, y: py, width: w, height: w * (tree ? 1.15 : .78), heightScale: tree ? .9 + .2 * hash(gx, gy, salt ^ 519) : .95 + .1 * hash(gx, gy, salt ^ 619),
        brush, variant, flip, opacity } });
    }
    for (const { stamp } of suppress(candidates)) result.push(stamp);
  }
  // Orchard rows are retained even in the overview/3D scene; fine tiles never duplicate them.
  if (mode !== 'fine' && !options.forestsOnly) for (const stamp of orchardTrees(bounds, sample, options)) result.push(stamp);
  result.sort((a, b) => a.y - b.y || a.x - b.x);
  if (result.length > budget) {
    const relief = result.filter(s => isReliefBrush(s.brush)), ground = result.filter(s => !isReliefBrush(s.brush));
    const thin = (items: Stamp[], count: number) => items.filter((_, i) => Math.floor(i * count / items.length) !== Math.floor((i - 1) * count / items.length)).slice(0, count);
    const reliefBudget = Math.min(relief.length, budget);
    return [...thin(relief, reliefBudget), ...thin(ground, budget - reliefBudget)].sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return result;
}
export function atlasRect(atlas: Atlas, brush: number): [number, number, number, number] {
  if (atlas.rects?.[brush]) return atlas.rects[brush];
  const row = Math.floor(brush / 4), x = brush % 4 * atlas.width / 4, y = atlas.rows[row] * atlas.height;
  return [x, y, atlas.width / 4, (atlas.rows[row + 1] - atlas.rows[row]) * atlas.height];
}
/** One atlas embedded per scene; symbols reference it instead of duplicating bitmap data. */
export function paintingSvg(stamps: Stamp[], atlas: Atlas | BrushLibrary, namespace: string, ink = false): string {
  if (!stamps.length) return '';
  const id = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
  if ('kind' in atlas) return familyPaintingSvg(stamps, atlas, id);
  let svg = `<defs><image id="${id}-atlas" width="${atlas.width}" height="${atlas.height}" href="${atlas.url}"/>`;
  for (let i = 0; i < 16; i++) {
    const [x, y, w, h] = atlasRect(atlas, i);
    svg += `<symbol id="${id}-${i}" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none" overflow="hidden"><use href="#${id}-atlas"/></symbol>`;
  }
  svg += '</defs>';
  if (ink) svg += `<defs><filter id="${id}-gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs>`;
  svg += `<g class="fantasy-brushes"${ink ? ` filter="url(#${id}-gray)"` : ''}>`;
  const f = (n: number) => n.toFixed(2);
  for (const s of stamps) svg += `<use href="#${id}-${s.brush}" x="${f(-s.width / 2)}" y="${f(-s.height * .93)}" width="${f(s.width)}" height="${f(s.height)}" opacity="${s.opacity}" transform="translate(${f(s.x)} ${f(s.y)}) scale(${s.flip ? -1 : 1} 1)"/>`;
  return svg + '</g>';
}
/** Atlas draw calls only: no per-stamp images, filters, allocation or transforms. */
export function paintingCanvas(ctx: CanvasRenderingContext2D, stamps: Stamp[], image: CanvasImageSource | ReadonlyMap<string, CanvasImageSource>, atlas: Atlas | BrushLibrary, camera: { x: number; y: number; scale: number }, ink = false): void {
  if ('kind' in atlas) { familyPaintingCanvas(ctx, stamps, image as ReadonlyMap<string, CanvasImageSource>, atlas, camera); return; }
  ctx.save(); if (ink) ctx.filter = 'grayscale(1)';
  for (const s of stamps) {
    const [sx, sy, sw, sh] = atlasRect(atlas, s.brush), w = s.width * camera.scale, h = s.height * camera.scale;
    const x = (s.x - camera.x) * camera.scale, y = (s.y - camera.y) * camera.scale;
    ctx.globalAlpha = s.opacity;
    if (s.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(image as CanvasImageSource, sx, sy, sw, sh, -w / 2, -h * .93, w, h); ctx.restore(); }
    else ctx.drawImage(image as CanvasImageSource, sx, sy, sw, sh, x - w / 2, y - h * .93, w, h);
  }
  ctx.restore();
}
export function stampHeight(stamp: Stamp, frame: BrushFrame): number {
  const tree = isTreeBrush(stamp.brush);
  // Relief is drawn wider than tall (height 0.45-0.68 of the width): stacked ranges, never tall spikes.
  // Massifs and downs are painted wider than tall at their true proportions.
  const aspect = tree ? (frame.family === 'pines' || frame.family === 'cypress' ? 1.8 : 1.25) : isLandformBrush(stamp.brush) ? Math.max(.22, Math.min(.62, frame.aspect))
    : isReliefBrush(stamp.brush) ? Math.max(.45, Math.min(.68, frame.aspect * .75)) : frame.aspect;
  return stamp.width * aspect * (stamp.heightScale ?? 1);
}
function familyPaintingSvg(stamps: Stamp[], library: BrushLibrary, id: string): string {
  const frames = new Map<string, BrushFrame>(), families = new Map<string, Atlas>();
  for (const stamp of stamps) { const f = brushFrame(library, stamp); frames.set(f.token, f); families.set(f.family, f.atlas); }
  let svg = '<defs>';
  for (const [family, atlas] of families) svg += `<image id="${id}-sheet-${family}" width="${atlas.width}" height="${atlas.height}" href="${atlas.url}"/>`;
  for (const frame of frames.values()) {
    const [x, y, w, h] = frame.rect;
    svg += `<symbol id="${id}-${frame.token}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden" preserveAspectRatio="none"><use href="#${id}-sheet-${frame.family}"/></symbol>`;
  }
  svg += '</defs><g class="fantasy-brushes">';
  const f = (n: number) => n.toFixed(2);
  for (const s of [...stamps.filter(s => isLandformBrush(s.brush)), ...stamps.filter(s => !isLandformBrush(s.brush))]) {
    const frame = brushFrame(library, s), h = stampHeight(s, frame);
    svg += `<use class="${isReliefBrush(s.brush) ? 'fantasy-relief' : 'fantasy-landuse'}" data-brush="${frame.family}" data-variant="${frame.index % (frame.atlas.variantsPerStyle ?? 8)}" href="#${id}-${frame.token}" x="${f(-s.width / 2)}" y="${f(-h * .95)}" width="${f(s.width)}" height="${f(h)}" opacity="${s.opacity}" transform="translate(${f(s.x)} ${f(s.y)}) scale(${s.flip ? -1 : 1} 1)"/>`;
  }
  return svg + '</g>';
}
function familyPaintingCanvas(ctx: CanvasRenderingContext2D, stamps: Stamp[], images: ReadonlyMap<string, CanvasImageSource>, library: BrushLibrary, camera: { x: number; y: number; scale: number }): void {
  ctx.save();
  for (const s of [...stamps.filter(s => isLandformBrush(s.brush)), ...stamps.filter(s => !isLandformBrush(s.brush))]) {
    const frame = brushFrame(library, s), image = images.get(frame.family); if (!image) continue;
    const [sx, sy, sw, sh] = frame.rect, w = s.width * camera.scale, h = stampHeight(s, frame) * camera.scale;
    const x = (s.x - camera.x) * camera.scale, y = (s.y - camera.y) * camera.scale; ctx.globalAlpha = s.opacity;
    if (s.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h * .95, w, h); ctx.restore(); }
    else ctx.drawImage(image, sx, sy, sw, sh, x - w / 2, y - h * .95, w, h);
  }
  ctx.restore();
}
