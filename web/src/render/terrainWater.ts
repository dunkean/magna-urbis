import { coastDistances, SEA_BAND_WIDTH } from './terrainSea';
import { encodePng, pngDataUrl, resampleTerrainSurface, toBase64 } from './raster';
import type { World } from '../gen/types';
import type { Palette } from './styles';
import { terrainStyle, type TerrainStyle } from './terrainStyle';
import { waterSampler, waterFunctionGlsl, type WaterStyle } from './waterStyle';

// Compatibility for the Neural Earth material adapter; displayed water uses the style ramp.
export const RENDER_WATER_SHORE = terrainStyle('render').water.stops[0][1];
export const WATER_MATERIAL_GLSL = waterFunctionGlsl('materialWater', terrainStyle('render').water) + `
vec3 surfaceWater(float depth,float ice){return mix(materialWater(depth/120.),vec3(.80,.84,.88),ice);}
`;

const distances = new WeakMap<Float32Array, Map<string, Float32Array>>();
/** Distance into open water, in metres; camera-independent like the sea band. */
export function lakeDistances(field: Float32Array, n: number, width: number, referenceWidth = width): Float32Array {
  const key = `${n}:${width}:${referenceWidth}`;
  let cache = distances.get(field);
  if (!cache) { cache = new Map(); distances.set(field, cache); }
  let result = cache.get(key);
  if (!result) {
    const surface = resampleTerrainSurface({ w: n, data: field }, n);
    result = coastDistances(Float32Array.from(surface, v => -v), n, width / n, referenceWidth);
    cache.set(key, result);
  }
  return result;
}

/** Shared RGB evaluator for Canvas, SVG and neutral retained fields. */
export function waterMaterialPixels(distance: Float32Array, material: WaterStyle, referenceWidth: number): Uint8Array {
  const sample = waterSampler(material), pixels = new Uint8Array(distance.length * 3), band = referenceWidth * material.bandFraction;
  for (let i = 0; i < distance.length; i++) {
    const color = sample(Math.max(0, distance[i]) / band);
    for (let c = 0; c < 3; c++) pixels[i * 3 + c] = Math.round(color[c]);
  }
  return pixels;
}
const worldDistances = new WeakMap<World['terrain'], { width: number; values: Float32Array }>();
/** Legacy application adapter. Sea and lake masks are colored by the same ramp. */
export function worldWaterPixels(world: World, palette: Palette): { rgb: Uint8Array; n: number } {
  const t = world.terrain, n = t.height.w;
  let cached = worldDistances.get(t);
  if (!cached || cached.width !== world.mapSize) {
    const signed = Float32Array.from(t.water, value => value === 1 || value === 2 ? -1 : 1);
    cached = { width: world.mapSize, values: coastDistances(signed, n, world.mapSize / n, world.mapSize) };
    worldDistances.set(t, cached);
  }
  return { rgb: waterMaterialPixels(cached.values, palette.water, world.mapSize), n };
}

const images = new WeakMap<Float32Array, Map<string, string>>();

/** A renderer-neutral water image. Geometry clips it; the style supplies all colors. */
export function waterMaterialUrl(distance: Float32Array, n: number, width: number, material: WaterStyle, referenceWidth = width): string {
  const key = JSON.stringify([n, width, referenceWidth, material]);
  let cache = images.get(distance);
  if (!cache) { cache = new Map(); images.set(distance, cache); }
  const cached = cache.get(key);
  if (cached) return cached;
  const pixels = waterMaterialPixels(distance, material, referenceWidth);
  const url = pngDataUrl(encodePng(pixels, n, n, 3, 1));
  cache.set(key, url);
  return url;
}

/** The vector outline clips the shared material raster, retaining islands. */
export function lakeMaterialSvg(field: Float32Array, n: number, width: number, path: string, id: string, style: TerrainStyle = 'render', referenceWidth = width): string {
  const url = waterMaterialUrl(lakeDistances(field, n, width, referenceWidth), n, width, terrainStyle(style).water, referenceWidth);
  return `<defs><clipPath id="${id}"><path d="${path}" clip-rule="evenodd"/></clipPath></defs><image width="${width}" height="${width}" href="${url}" clip-path="url(#${id})"/>`;
}

/** A retained world-space material surface; crops translate its origin, never its scale. */
export interface WaterSurface { distance: Float32Array; n: number; width: number; x: number; y: number; referenceWidth: number }
const seaSurfaces = new WeakMap<Float32Array, WaterSurface>();
export function seaDistanceSurface(data: { height: Float32Array; resolution: number; width: number; x: number; y: number; field?: { data: Float32Array; n: number }; waterSurface?: WaterSurface }, referenceWidth = data.width): WaterSurface {
  if (data.waterSurface) return data.waterSurface;
  const field = data.field ?? { data: data.height, n: data.resolution };
  const cached = seaSurfaces.get(field.data);
  if (cached && cached.width === data.width && cached.referenceWidth === referenceWidth && cached.x === data.x && cached.y === data.y) return cached;
  const n = Math.min(1024, Math.max(512, field.n));
  const surface = resampleTerrainSurface({ w: field.n, data: field.data }, n);
  const result = { distance: coastDistances(surface, n, data.width / n, referenceWidth), n, width: data.width, x: data.x, y: data.y, referenceWidth };
  seaSurfaces.set(field.data, result);
  return result;
}
export function seaMaterialSvg(surface: WaterSurface, x: number, y: number, style: TerrainStyle, extent = surface.width): string {
  const url = waterMaterialUrl(surface.distance, surface.n, surface.width, terrainStyle(style).water, surface.referenceWidth);
  return `<svg width="${extent}" height="${extent}" overflow="hidden"><image x="${surface.x - x}" y="${surface.y - y}" width="${surface.width}" height="${surface.width}" href="${url}"/></svg>`;
}
/** Binary FP32 in metadata avoids megabytes of JSON decimal text; outer .decor compression remains effective. */
export const encodeWaterField = (field: Float32Array): string => toBase64(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
export function decodeWaterField(encoded: string): Float32Array {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}
