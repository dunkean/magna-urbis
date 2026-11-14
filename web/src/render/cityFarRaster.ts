/** Far look of a town on the satellite grounds: its roofscape as one raster, built once per town from the building
 * footprints (area, roof and wall colours of every building), drawn as an image below the scale where single roofs
 * read. A pixel of the raster is the mean of what the detailed drawing shows there: the built share of the cell in
 * the mean roof colour of its buildings, the cast shadows on the ground left between them, the ground itself
 * (gardens, yards, streets) showing through the rest. So a dense core reads darker and closer, the suburbs looser
 * with their gardens, streets and squares as breaks, with no flat fill or outline; the detailed buildings take over
 * through a cross-fade with the same mean colour and density. Cost: the build is proportional to the buildings,
 * once per town and look; a frame draws one image (proportional to pixels). */
import type { CityBuilding, CityBuildings, CityPalette, CityScene } from './cityCanvas';
import { planBuildingColors } from './cityBuildingPalette';
import { mapGroundSnow, roofSeasonKey } from './seasonPalette';
import { toneStamp } from './groundTone';

/** Metres per CSS pixel where the raster starts to fade in over the detailed buildings, and where it replaces them. */
export const FAR_TOWN_FADE: readonly [number, number] = [1.6, 2.2];
/** Share of the raster drawn over the detailed buildings at `mpp` (0: buildings only, 1: raster only). */
export function farTownAlpha(mpp: number): number {
  const t = Math.max(0, Math.min(1, (mpp - FAR_TOWN_FADE[0]) / (FAR_TOWN_FADE[1] - FAR_TOWN_FADE[0])));
  return t * t * (3 - 2 * t);
}
/** True when the detailed buildings are drawn under the raster (or alone). */
export const farTownBuildingsShown = (mpp: number): boolean => mpp < FAR_TOWN_FADE[1];

/** Longest side of the raster in cells; the finest cell is 2 m. */
const MAX_CELLS = 2048, MIN_CELL = 2;
/** The mean of a detailed roof is darker than its base colour: shaded pans, pan joints, eave lines. */
const ROOF_MEAN = .82;
/** Ground offset of the cast shadow of a two- or three-storey house (cityMassing pieceShadows: .55 h east, .44 h south,
 * h about 8 m). Its darkness is the cast shadow fill of the detailed drawing (castShadowFill: .2 on parchment, .3 elsewhere). */
const SHADOW_EAST = 4.4, SHADOW_SOUTH = 3.5;
/** Mottle of the roofscape: tone of a whole block (±) and of a low-frequency noise (±), in relative luminance. */
const BLOCK_MOTTLE = .02, NOISE_MOTTLE = .045;

type Source = HTMLCanvasElement | OffscreenCanvas;
interface FarRaster { key: string; x0: number; y0: number; cell: number; w: number; h: number; levels: Source[]; ms: number }
const rasters = new WeakMap<CityBuildings, FarRaster>();
const pending = new WeakSet<CityBuildings>();
/** Last build time of a town raster (ms), for the shot harness and the report. */
export const farTownStats = { buildMs: 0, builds: 0 };
(globalThis as { __farTownStats?: unknown }).__farTownStats = farTownStats;

function surface(width: number, height: number): Source | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return undefined;
}
const hash = (a: number, b: number): number => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
/** Smooth value noise in [0, 1) on a lattice of `period` cells. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const u = x / period, v = y / period, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const a = hash(i + seed, j), b = hash(i + 1 + seed, j), c = hash(i + seed, j + 1), d = hash(i + 1 + seed, j + 1);
  return (a + (b - a) * su) + ((c + (d - c) * su) - (a + (b - a) * su)) * sv;
}
const rgbOf = (hex: string): [number, number, number] => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
function signedArea(ring: readonly { x: number; y: number }[]): number { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y; return s / 2; }

/** Mean colour of a building seen from above on this palette: its roof (snow on it when the ground is snowed). */
function buildingTone(b: CityBuilding, palette: CityPalette, custom?: string): [number, number, number] {
  const roof = rgbOf(custom ?? planBuildingColors(b, palette).roof), age = b.age ?? .5, k = ROOF_MEAN * (1 + (.5 - age) * .07);
  const c: [number, number, number] = [roof[0] * k, roof[1] * k, roof[2] * k];
  const snow = palette === 'terrain' ? mapGroundSnow(b.snowAltitude ?? b.building.ground_z_m) : 0;
  if (snow > 0) { const s = Math.min(1, snow) * .6; c[0] += (226 - c[0]) * s; c[1] += (231 - c[1]) * s; c[2] += (236 - c[2]) * s; }
  return c;
}

function buildRaster(scene: CityScene, b: CityBuildings, palette: CityPalette, night: boolean, custom: string | undefined, key: string): FarRaster | undefined {
  const started = performance.now();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of b.bins.boxes) if (box.minX <= box.maxX) { minX = Math.min(minX, box.minX); minY = Math.min(minY, box.minY); maxX = Math.max(maxX, box.maxX); maxY = Math.max(maxY, box.maxY); }
  if (!(maxX > minX && maxY > minY)) return undefined;
  const cell = Math.max(MIN_CELL, Math.max(maxX - minX, maxY - minY) / (MAX_CELLS - 4));
  const x0 = minX - 2 * cell, y0 = minY - 2 * cell, w = Math.ceil((maxX - minX) / cell) + 4, h = Math.ceil((maxY - minY) / cell) + 4;
  const level0 = surface(w, h); if (!level0) return undefined;
  const ctx0 = level0.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx0 || typeof Path2D === 'undefined') return undefined;
  // The footprints filled at the cell size, anti-aliased (the canvas gives each cell its built share), one path per
  // roof tone and block shade: overlapping buildings of one group unite, courts stay open.
  ctx0.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell, -y0 / cell);
  const groups = new Map<string, { color: string; path: Path2D }>();
  const ring = (path: Path2D, points: readonly { x: number; y: number }[], hole: boolean): void => {
    if (points.length < 3) return;
    const n = points.length, reverse = (signedArea(points) < 0) !== hole, at = (i: number) => points[reverse ? n - 1 - i : i];
    path.moveTo(at(0).x, at(0).y); for (let i = 1; i < n; i++) path.lineTo(at(i).x, at(i).y); path.closePath();
  };
  b.items.forEach((item, i) => {
    if (!item.surface.length) return;
    // Neighbourhoods age together: a block takes one of three shades.
    const parcel = item.parcel === undefined ? undefined : scene.parcels[item.parcel], shade = Math.floor((parcel ? hash(parcel.layout + 1, parcel.block) : hash(i, 7)) * 3);
    const tk = `${item.material?.culture}|${item.material?.cover}|${item.material?.wall}|${Math.round((item.material?.tone ?? .5) * 20)}|${item.role}|${item.family}|${item.landmark}|${Math.round((item.age ?? .5) * 8)}|${shade}`;
    let group = groups.get(tk);
    if (!group) {
      const m = 1 + BLOCK_MOTTLE * (shade - 1), t = buildingTone(item, palette, custom).map(v => Math.round(Math.max(0, Math.min(255, v * m))));
      groups.set(tk, group = { color: `rgb(${t[0]},${t[1]},${t[2]})`, path: new Path2D() });
    }
    for (const sh of item.surface) { ring(group.path, sh.outer, false); for (const hole of sh.holes ?? []) ring(group.path, hole, true); }
  });
  for (const g of groups.values()) { ctx0.fillStyle = g.color; ctx0.fill(g.path, 'nonzero'); }
  ctx0.setTransform(1, 0, 0, 1, 0, 0);
  const shadeAlpha = palette === 'parchment' ? .2 : .3, image = ctx0.getImageData(0, 0, w, h), data = image.data, seed = Math.floor(hash(Math.round(x0), Math.round(y0)) * 4096);
  const builtAt = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) builtAt[k] = data[k * 4 + 3] / 255;
  // The ground of a cell lies in the cast shadow of the buildings north-west of it (full and half offset).
  const dx = Math.max(1, Math.round(SHADOW_EAST / cell)), dy = Math.max(1, Math.round(SHADOW_SOUTH / cell));
  const cast = (x: number, y: number): number => x < 0 || y < 0 ? 0 : builtAt[y * w + x];
  for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k++) {
    const o = k * 4, built = builtAt[k], shadow = Math.max(cast(x - dx, y - dy), cast(x - (dx >> 1), y - (dy >> 1)));
    if (built <= .004 && shadow <= .004) continue;
    const shade = (1 - built) * shadow * shadeAlpha, alpha = built + shade;
    if (built <= .004) { data[o] = data[o + 1] = data[o + 2] = 0; data[o + 3] = Math.round(shade * 255); continue; }
    // Low-frequency mottle in metres (about 60 m and 17 m), never a visible tile: value noise on the world position.
    const wx = x0 + (x + .5) * cell, wy = y0 + (y + .5) * cell;
    const n = 1 + NOISE_MOTTLE * 2 * (.6 * valueNoise(wx, wy, 60, seed) + .4 * valueNoise(wx, wy, 17, seed + 911) - .5);
    let r = data[o] * n, g = data[o + 1] * n, bl = data[o + 2] * n;
    // Night: the building ink of cityNight.nightRoof (linear, so the mean of the night roofs is the night of the mean).
    if (night) { r = 9 + r * .19; g = 15 + g * .23; bl = 24 + bl * .29; }
    // The roofs and the black of their cast shadows on the ground between them, as one colour over that ground.
    const f = built / alpha;
    data[o] = r * f; data[o + 1] = g * f; data[o + 2] = bl * f; data[o + 3] = Math.round(Math.min(1, alpha) * 255);
  }
  ctx0.putImageData(image, 0, 0);
  // Mip levels: a far frame reads the level whose cell is about one device pixel (no shimmer, no per-frame resampling of the whole town).
  const levels: Source[] = [level0];
  for (let lw = w, lh = h; Math.max(lw, lh) > 96;) {
    lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2));
    const next = surface(lw, lh), c = next?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!next || !c) break;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(levels[levels.length - 1], 0, 0, lw, lh); levels.push(next);
  }
  const ms = performance.now() - started; farTownStats.buildMs = ms; farTownStats.builds++;
  return { key, x0, y0, cell, w, h, levels, ms };
}

/** Draws the far raster of a town (`buildings`: the whole town, not a visible subset) in a context set to world
 * coordinates, with `alpha` of opacity. The first frame builds it; a later change of the ground tones or the season
 * rebuilds it after the view rests (the previous one is drawn meanwhile, `onReady` asks for the redraw). */
export function drawFarTown(ctx: CanvasRenderingContext2D, scene: CityScene, buildings: CityBuildings,
  o: { viewport: { minX: number; minY: number; maxX: number; maxY: number }; mpp: number; dpr: number; palette: CityPalette; night: boolean; /** One ink for every building (custom or night building colour). */ custom?: string; alpha: number; onReady?: () => void }): boolean {
  if (!(o.alpha > 0) || !buildings.items.length) return false;
  const keyNow = (): string => `${toneStamp()}|${roofSeasonKey()}|${o.palette}|${o.night ? 1 : 0}|${o.custom ?? ''}`, key = keyNow();
  let raster = rasters.get(buildings);
  if (!raster) {
    raster = buildRaster(scene, buildings, o.palette, o.night, o.custom, key); if (!raster) return false;
    rasters.set(buildings, raster);
  } else if (raster.key !== key && !pending.has(buildings)) {
    pending.add(buildings);
    setTimeout(() => {
      pending.delete(buildings);
      const next = buildRaster(scene, buildings, o.palette, o.night, o.custom, keyNow());
      if (next) { rasters.set(buildings, next); o.onReady?.(); }
    }, 250);
  }
  const r = raster, device = o.mpp / (o.dpr || 1);
  const level = Math.max(0, Math.min(r.levels.length - 1, Math.floor(Math.log2(Math.max(1, device / r.cell))))), image = r.levels[level];
  const iw = (image as { width: number }).width, ih = (image as { height: number }).height, sx = iw / r.w, sy = ih / r.h;
  // Only the visible part of the image (cells, padded by one).
  const cx0 = Math.max(0, Math.floor((o.viewport.minX - r.x0) / r.cell) - 1), cy0 = Math.max(0, Math.floor((o.viewport.minY - r.y0) / r.cell) - 1);
  const cx1 = Math.min(r.w, Math.ceil((o.viewport.maxX - r.x0) / r.cell) + 1), cy1 = Math.min(r.h, Math.ceil((o.viewport.maxY - r.y0) / r.cell) + 1);
  if (cx1 <= cx0 || cy1 <= cy0) return false;
  const lx0 = Math.floor(cx0 * sx), ly0 = Math.floor(cy0 * sy), lx1 = Math.min(iw, Math.ceil(cx1 * sx)), ly1 = Math.min(ih, Math.ceil(cy1 * sy));
  ctx.save();
  ctx.globalAlpha *= Math.min(1, o.alpha); ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(image, lx0, ly0, lx1 - lx0, ly1 - ly0, r.x0 + lx0 / sx * r.cell, r.y0 + ly0 / sy * r.cell, (lx1 - lx0) / sx * r.cell, (ly1 - ly0) / sy * r.cell);
  ctx.restore();
  return true;
}
