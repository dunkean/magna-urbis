import { coastDistances, SEA_BAND_WIDTH } from './terrainSea';
import { encodePng, pngDataUrl, resampleTerrainSurface, toBase64 } from './raster';
import type { World } from '../gen/types';
import type { Palette } from './styles';
import type { RenderColors } from './customColors';
import { terrainStyle, type TerrainStyle } from './terrainStyle';
import { waterSampler, waterFunctionGlsl, type WaterStyle } from './waterStyle';
import { productKey, measureDisplayProduct } from './displayProduct';
import { floatPyramid } from './floatPyramid';

// Compatibility for the Neural Earth material adapter; displayed water uses the style ramp.
export const RENDER_WATER_SHORE = terrainStyle('render').water.stops[0][1];
export const WATER_MATERIAL_GLSL = waterFunctionGlsl('materialWater', terrainStyle('render').water) + `
vec3 surfaceWater(float depth,float ice){return mix(materialWater(depth/120.),vec3(.80,.84,.88),ice);}
`;

const distances = new WeakMap<Float32Array, Map<string, Float32Array>>();
export function retainLakeDistances(field: Float32Array, n: number, width: number, referenceWidth: number, result: Float32Array): void {
  if (result.length !== n * n) return;
  let entries = distances.get(field);
  if (!entries) { entries = new Map(); distances.set(field, entries); }
  const key = productKey(n, width, referenceWidth);
  if (!entries.has(key)) entries.set(key, result);
}
/** Distance into open water, in metres; camera-independent like the sea band. */
export function lakeDistances(field: Float32Array, n: number, width: number, referenceWidth = width): Float32Array {
  const key = productKey(n, width, referenceWidth);
  let cache = distances.get(field);
  if (!cache) { cache = new Map(); distances.set(field, cache); }
  let result = cache.get(key);
  if (!result) {
    result = measureDisplayProduct('lake', () => {
    const surface = resampleTerrainSurface({ w: n, data: field }, n);
    const depth = new Float32Array(surface.length);
    for (let i = 0; i < surface.length; i++) depth[i] = -surface[i];
    return coastDistances(depth, n, width / n, referenceWidth);
    });
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
/** Raw lake and distance mips share the same immutable numeric cache as terrain heights. */
export function lakeDistancePyramid(field: Float32Array, n: number, width: number, referenceWidth = width): Float32Array[] {
  return floatPyramid(lakeDistances(field, n, width, referenceWidth), n);
}
const worldDistances = new WeakMap<Uint8Array, Map<string, Float32Array>>();
export function retainPlanningWaterDistances(water: Uint8Array, n: number, width: number, values: Float32Array): void {
  if (values.length !== n * n) return;
  let entries = worldDistances.get(water);
  if (!entries) { entries = new Map(); worldDistances.set(water, entries); }
  const key = productKey(n, width);
  if (!entries.has(key)) entries.set(key, values);
}
export function planningWaterDistances(water: Uint8Array, n: number, width: number): Float32Array {
  const retained = worldDistances.get(water)?.get(productKey(n, width));
  if (retained) return retained;
  const values = measureDisplayProduct('planning-water', () => {
    const signed = Float32Array.from(water, value => value === 1 || value === 2 ? -1 : 1);
    return coastDistances(signed, n, width / n, width);
  });
  retainPlanningWaterDistances(water, n, width, values); return values;
}
/** Legacy application adapter. Sea and lake masks are colored by the same ramp. */
export function worldWaterPixels(world: World, palette: Palette): { rgb: Uint8Array; n: number } {
  const t = world.terrain, n = t.height.w;
  return { rgb: waterMaterialPixels(planningWaterDistances(t.water, n, world.mapSize), palette.water, world.mapSize), n };
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
export function lakeMaterialSvg(field: Float32Array, n: number, width: number, path: string, id: string, style: TerrainStyle = 'render', referenceWidth = width, colors?: RenderColors): string {
  const url = waterMaterialUrl(lakeDistances(field, n, width, referenceWidth), n, width, terrainStyle(style, colors).water, referenceWidth);
  return `<defs><clipPath id="${id}"><path d="${path}" clip-rule="evenodd"/></clipPath></defs><image width="${width}" height="${width}" href="${url}" clip-path="url(#${id})"/>`;
}

/** A retained world-space material surface; crops translate its origin, never its scale. */
export interface WaterSurface { distance: Float32Array; n: number; width: number; x: number; y: number; referenceWidth: number }
const seaSurfaces = new WeakMap<Float32Array, Map<string, WaterSurface>>();
export function seaDistanceSurface(data: { height: Float32Array; resolution: number; width: number; x: number; y: number; field?: { data: Float32Array; n: number }; waterSurface?: WaterSurface }, referenceWidth = data.width): WaterSurface {
  if (data.waterSurface) return data.waterSurface;
  const field = data.field ?? { data: data.height, n: data.resolution };
  const key = productKey(field.n, data.x, data.y, data.width, referenceWidth);
  let entries = seaSurfaces.get(field.data);
  if (!entries) { entries = new Map(); seaSurfaces.set(field.data, entries); }
  const cached = entries.get(key);
  if (cached) return cached;
  const result = measureDisplayProduct('sea', () => {
  const n = Math.min(1024, Math.max(512, field.n));
  const surface = resampleTerrainSurface({ w: field.n, data: field.data }, n);
  return { distance: coastDistances(surface, n, data.width / n, referenceWidth), n, width: data.width, x: data.x, y: data.y, referenceWidth };
  });
  entries.set(key, result);
  return result;
}
export function seaMaterialSvg(surface: WaterSurface, x: number, y: number, style: TerrainStyle, extent = surface.width, colors?: RenderColors): string {
  const url = waterMaterialUrl(surface.distance, surface.n, surface.width, terrainStyle(style, colors).water, surface.referenceWidth);
  return `<svg width="${extent}" height="${extent}" overflow="hidden"><image x="${surface.x - x}" y="${surface.y - y}" width="${surface.width}" height="${surface.width}" href="${url}"/></svg>`;
}
/** Binary FP32 in metadata avoids megabytes of JSON decimal text; outer .decor compression remains effective. */
export const encodeWaterField = (field: Float32Array): string => toBase64(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
export function decodeWaterField(encoded: string): Float32Array {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}
