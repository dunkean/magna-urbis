import { coastDistances, SEA_BAND_WIDTH } from './terrainSea';
import { encodePng, pngDataUrl, resampleTerrainSurface } from './raster';

// One palette for sea shallows, river mouths and lake shores in Render view.
export const RENDER_WATER_SHORE = '#1a4d5c';
const shore = [26, 77, 92];
const middle = [0.045 * 255, 0.16 * 255, 0.27 * 255];
const deep = [0.018 * 255, 0.065 * 255, 0.15 * 255];
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const WATER_MATERIAL_GLSL = `
vec3 surfaceWater(float depth,float ice){
  vec3 water=mix(vec3(26.,77.,92.)/255.,vec3(.045,.16,.27),smoothstep(5.,120.,depth));
  water=mix(water,vec3(.018,.065,.15),smoothstep(150.,3000.,depth));
  return mix(water,vec3(.80,.84,.88),ice);
}`;

const distances = new WeakMap<Float32Array, Float32Array>();
/** Distance into open water, in metres; camera-independent like the sea band. */
export function lakeDistances(field: Float32Array, n: number, width: number): Float32Array {
  let result = distances.get(field);
  if (!result) {
    const surface = resampleTerrainSurface({ w: n, data: field }, n);
    result = coastDistances(Float32Array.from(surface, v => -v), n, width / n, width * SEA_BAND_WIDTH);
    distances.set(field, result);
  }
  return result;
}

const images = new WeakMap<Float32Array, string>();
/** The vector outline clips this shared material raster, retaining islands. */
export function lakeMaterialSvg(field: Float32Array, n: number, width: number, path: string, id: string): string {
  let url = images.get(field);
  if (!url) {
    const distance = lakeDistances(field, n, width), pixels = new Uint8Array(n * n * 3);
    for (let i = 0; i < distance.length; i++) {
      const depth = Math.max(0, distance[i]) * 120 / (width * SEA_BAND_WIDTH);
      const a = smooth(5, 120, depth), b = smooth(150, 3000, depth);
      for (let c = 0; c < 3; c++) pixels[i * 3 + c] = Math.round((shore[c] + (middle[c] - shore[c]) * a) * (1 - b) + deep[c] * b);
    }
    url = pngDataUrl(encodePng(pixels, n, n, 3, 1));
    images.set(field, url);
  }
  return `<defs><clipPath id="${id}"><path d="${path}" clip-rule="evenodd"/></clipPath></defs><image width="${width}" height="${width}" href="${url}" clip-path="url(#${id})"/>`;
}
