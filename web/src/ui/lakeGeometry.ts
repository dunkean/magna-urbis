/** Pure continuous shoreline sampling and shader helpers. Fields are retained by VectorWater. */
export interface LakeField { values: Float32Array; distance: Float32Array; n: number }
export { computeLakeField as lakeField } from '../../../rust/bridge/waterNative';

const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ 1597334677;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
}
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v)
    + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}

/** x/y in world metres. No camera-dependent geometry or shoreline popping. */
export function lakeSample(field: LakeField, width: number, x: number, y: number): number {
  const gx = x * field.n / width - 0.5, gy = y * field.n / width - 0.5;
  const ix = Math.floor(gx), iy = Math.floor(gy), wx = weights(gx - ix), wy = weights(gy - iy);
  let value = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const xx = ix + i - 1, yy = iy + j - 1;
    value += (xx < 0 || yy < 0 || xx >= field.n || yy >= field.n ? -4 : field.values[yy * field.n + xx]) * wx[i] * wy[j];
  }
  const fade = Math.max(0, Math.min(1, (0.8 - Math.abs(value)) / 0.3));
  if (fade) value += fade * fade * (3 - 2 * fade) * (0.18 * noise(gx * 0.7, gy * 0.7) + 0.055 * noise(gx * 2.3, gy * 2.3) + 0.018 * noise(gx * 6.1, gy * 6.1));
  return value;
}

/** Identical cubic interpolation and procedural detail for the fragment shader. */
export const LAKE_GLSL = `
float shoreHash(ivec2 p) {
  uint h = uint(p.x) * 374761393u ^ uint(p.y) * 668265263u ^ 1597334677u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0 * 2.0 - 1.0;
}
float shoreNoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(shoreHash(i), shoreHash(i + ivec2(1, 0)), u.x), mix(shoreHash(i + ivec2(0, 1)), shoreHash(i + ivec2(1)), u.x), u.y);
}
float lakeShore(vec2 world, bool procedural) {
  vec2 g = world * uLakeN / uMapW - 0.5, f = floor(g);
  vec4 wx = bw(g.x - f.x), wy = bw(g.y - f.y);
  ivec2 b = ivec2(f) - 1; int n = int(uLakeN); float m = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    ivec2 p = b + ivec2(i, j);
    float v = any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, ivec2(n))) ? -4.0 : texelFetch(uLake, p, 0).r;
    m += v * wx[i] * wy[j];
  }
  float fade = procedural ? 1.0 - smoothstep(0.5, 0.8, abs(m)) : 0.0;
  if (fade > 0.0) m += fade * (0.18 * shoreNoise(g * 0.7) + 0.055 * shoreNoise(g * 2.3) + 0.018 * shoreNoise(g * 6.1));
  return m;
}`;
