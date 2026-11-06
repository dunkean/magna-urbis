/** V1 cartographic appearance of retained Rust terrain. No generation. */
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import type { World } from '../gen/types';
import { DEFAULTS } from '../gen/options';
import { renderTerrainPixels } from './raster';
import { worldWaterPixels } from './terrainWater';
import { biomePalette } from './biomes';
import type { BiomeName } from '../gen/biomes';
import { PALETTES, ruralInk } from './styles';
import { regionalRoadSurface } from './roadSurfaces';

export type V1LandscapeStyle = 'parchment' | 'atlas';
export function v1RoadPaint(kind: 'major' | 'minor' | 'track', width: number, scale: number, style: V1LandscapeStyle) {
  const pal = PALETTES[style];
  if (kind === 'track') return { fill: ruralInk(pal), casing: null, width: Math.max(1.6 * scale, .9), casingWidth: 0, dash: scale >= .3 ? '7 4' : '5 3', opacity: pal.rural.track };
  const surface = regionalRoadSurface(kind, scale, width);
  return { fill: pal.roadFill, casing: pal.roadEdge, width: surface.fill * scale, casingWidth: surface.casing * scale, dash: undefined, opacity: 1 };
}
const cache = new WeakMap<SettlementRaster, Map<string, HTMLCanvasElement>>();

/** The same colour ramp, grain, light and water material used by the V1 map.
 * Terrain and hydrology buffers remain owned by the Rust generation snapshot. */
export function v1LandscapeWorld(r: SettlementRaster, biome: BiomeName = 'temperate'): World {
  const grid = { w: r.n, h: r.n, cell: r.width / r.n, data: r.height };
  const empty = { ...grid, data: new Float32Array(0) };
  return { seed: 'retained-landscape', mapSize: r.width, options: { ...DEFAULTS, biome, labels: false, legend: false }, stats: {},
    terrain: { height: grid, slope: empty, flow: empty, water: r.water, seaLevel: 0, seaFraction: 0, coastline: [], lakes: [], rivers: [], receiver: new Int32Array(0), filled: r.height, downSide: 'S', seaSide: null } };
}
export function v1LandscapePixels(r: SettlementRaster, style: V1LandscapeStyle, biome: BiomeName = 'temperate') {
  const world = v1LandscapeWorld(r, biome), pal = biomePalette(style, biome);
  const pixels = renderTerrainPixels(world, pal, { pixels: Math.min(1024, r.n * 2) });
  const water = worldWaterPixels(world, pal);
  for (let y = 0; y < pixels.h; y++) for (let x = 0; x < pixels.w; x++) {
    const i = Math.min(r.n - 1, Math.floor(y * r.n / pixels.h)) * r.n + Math.min(r.n - 1, Math.floor(x * r.n / pixels.w));
    if (r.water[i] > 0 && r.water[i] < 4) pixels.rgb.set(water.rgb.subarray(i * 3, i * 3 + 3), (y * pixels.w + x) * 3);
  }
  return pixels;
}
const rgbCanvas = (rgb: Uint8Array, w: number, h: number): HTMLCanvasElement => {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h }), ctx = canvas.getContext('2d')!, image = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { image.data.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); image.data[i * 4 + 3] = 255; }
  ctx.putImageData(image, 0, 0); return canvas;
};
/** Terrain at 2048 px with the water drawn from the vector geometry (antialiased edges at any zoom) instead of the raster cells. */
function smoothLandscape(r: SettlementRaster, geometry: { water: { x: number; y: number }[][][] }, style: V1LandscapeStyle, biome: BiomeName): HTMLCanvasElement {
  const world = v1LandscapeWorld(r, biome), pal = biomePalette(style, biome), size = 2048, k = size / r.width;
  // The land layer carries no raster water: cells of the 1024 px grid would peek out beyond the vector mask as a blocky blue fringe.
  const dry: World = { ...world, terrain: { ...world.terrain, water: new Uint8Array(r.water.length) } };
  const land = renderTerrainPixels(dry, pal, { pixels: Math.min(1024, r.n * 2) }), material = worldWaterPixels(world, pal);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size }), ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(rgbCanvas(land.rgb, land.w, land.h), 0, 0, size, size);
  const mask = Object.assign(document.createElement('canvas'), { width: size, height: size }), m = mask.getContext('2d')!;
  m.fillStyle = '#fff';
  for (const group of geometry.water) {
    const path = new Path2D();
    for (const ring of group) { if (ring.length < 3) continue; ring.forEach((p, i) => i ? path.lineTo(p.x * k, p.y * k) : path.moveTo(p.x * k, p.y * k)); path.closePath(); }
    m.fill(path, 'evenodd');
  }
  m.globalCompositeOperation = 'source-in'; m.imageSmoothingQuality = 'high'; m.drawImage(rgbCanvas(material.rgb, material.n, material.n), 0, 0, size, size);
  ctx.drawImage(mask, 0, 0);
  return canvas;
}
export function v1LandscapeCanvas(r: SettlementRaster, style: V1LandscapeStyle, biome: BiomeName = 'temperate'): HTMLCanvasElement {
  let entries = cache.get(r); if (!entries) { entries = new Map(); cache.set(r, entries); }
  const smooth = !!r.geometry?.water?.length, key = `${style}:${biome}:${smooth}`, found = entries.get(key); if (found) return found;
  if (smooth) { const canvas = smoothLandscape(r, r.geometry!, style, biome); entries.set(key, canvas); return canvas; }
  const pixels = v1LandscapePixels(r, style, biome), canvas = document.createElement('canvas');
  canvas.width = pixels.w; canvas.height = pixels.h;
  const ctx = canvas.getContext('2d')!, image = ctx.createImageData(pixels.w, pixels.h);
  for (let i = 0; i < pixels.w * pixels.h; i++) { image.data.set(pixels.rgb.subarray(i * 3, i * 3 + 3), i * 4); image.data[i * 4 + 3] = 255; }
  ctx.putImageData(image, 0, 0); entries.set(key, canvas); return canvas;
}

/** The lit V1 land alone, transparent over sea, lakes and the `rivers` segments (x0 y0 x1 y1 w0 w1 r g b, the renderers' format):
 * the backdrop the multiply tints of the land use need on a transparent overlay, with the real water left visible below. */
export function v1LandCanvas(r: SettlementRaster, style: V1LandscapeStyle, biome: BiomeName = 'temperate', rivers?: Float32Array): HTMLCanvasElement {
  let entries = cache.get(r); if (!entries) { entries = new Map(); cache.set(r, entries); }
  const key = `land:${style}:${biome}:${rivers?.length ?? 0}`, found = entries.get(key); if (found) return found;
  const world = v1LandscapeWorld(r, biome), size = 2048, k = size / r.width;
  const dry: World = { ...world, terrain: { ...world.terrain, water: new Uint8Array(r.water.length) } };
  const land = renderTerrainPixels(dry, biomePalette(style, biome), { pixels: Math.min(1024, r.n * 2) });
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size }), ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(rgbCanvas(land.rgb, land.w, land.h), 0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = ctx.strokeStyle = '#000'; ctx.lineCap = 'round';
  // The raster covers the open sea; the vector rings, where they exist, give closed water its smooth edge.
  const mask = Object.assign(document.createElement('canvas'), { width: r.n, height: r.n }), m = mask.getContext('2d')!, image = m.createImageData(r.n, r.n);
  for (let i = 0; i < r.water.length; i++) if (r.water[i] > 0 && r.water[i] < 4) image.data[i * 4 + 3] = 255;
  m.putImageData(image, 0, 0); ctx.drawImage(mask, 0, 0, size, size);
  for (const group of r.geometry?.water ?? []) {
    const path = new Path2D();
    for (const ring of group) { if (ring.length < 3) continue; ring.forEach((p, i) => i ? path.lineTo(p.x * k, p.y * k) : path.moveTo(p.x * k, p.y * k)); path.closePath(); }
    ctx.fill(path, 'evenodd');
  }
  if (rivers) for (let i = 0; i + 8 < rivers.length; i += 9) {
    ctx.lineWidth = Math.max(1, (rivers[i + 4] + rivers[i + 5]) / 2 * k);
    ctx.beginPath(); ctx.moveTo(rivers[i] * k, rivers[i + 1] * k); ctx.lineTo(rivers[i + 2] * k, rivers[i + 3] * k); ctx.stroke();
  }
  entries.set(key, canvas); return canvas;
}

export class V1LandscapeLayer {
  private image?: SVGImageElement;
  private raster?: SettlementRaster;
  private style?: V1LandscapeStyle;
  draw(map: SVGSVGElement, raster: SettlementRaster | undefined, style: V1LandscapeStyle | undefined): void {
    if (!raster || !style) { this.image?.remove(); map.removeAttribute('data-v1-landscape'); return; }
    this.image ??= document.createElementNS('http://www.w3.org/2000/svg', 'image');
    this.image.id = 'v1Landscape'; this.image.style.pointerEvents = 'none';
    if (this.raster !== raster || this.style !== style) {
      this.raster = raster; this.style = style;
      this.image.setAttribute('href', v1LandscapeCanvas(raster, style).toDataURL());
      for (const [key, value] of Object.entries({ x: 0, y: 0, width: raster.width, height: raster.width })) this.image.setAttribute(key, String(value));
    }
    const anchor = map.querySelector('#landuseLayer, #hydrologyOverlay, #urbanOverlay, #roadOverlay, #settlementOverlay');
    if (this.image.parentNode !== map || this.image.nextSibling !== anchor) map.insertBefore(this.image, anchor);
    map.dataset.v1Landscape = style;
  }
}
