/** Continuous, world-anchored shore field shared by SVG, GPU and river mouths.
 * Distances are in drainage cells. Detail stays well below one cell so it
 * cannot invent new bodies of water in the interior or outside the shore belt.
 */
export interface LakeField { values: Float32Array; distance: Float32Array; n: number }
const fields = new WeakMap<Uint8Array, LakeField>();

export function lakeField(mask: Uint8Array, n: number): LakeField {
  const cached = fields.get(mask);
  if (cached) return cached;
  const distance = new Float32Array(n * n).fill(4);
  const wet = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && !!mask[y * n + x];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inside = wet(x, y);
    if (wet(x - 1, y) !== inside || wet(x + 1, y) !== inside || wet(x, y - 1) !== inside || wet(x, y + 1) !== inside) distance[y * n + x] = 0.5;
  }
  // Two chamfer sweeps; sign is assigned afterwards, preserving islands.
  for (const direction of [1, -1]) {
    const neighbors = [[-direction, 0, 1], [0, -direction, 1], [-direction, -direction, Math.SQRT2], [direction, -direction, Math.SQRT2]];
    for (let y = direction > 0 ? 0 : n - 1; y >= 0 && y < n; y += direction) {
      for (let x = direction > 0 ? 0 : n - 1; x >= 0 && x < n; x += direction) {
        const i = y * n + x;
        for (const [dx, dy, cost] of neighbors) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) distance[i] = Math.min(distance[i], distance[yy * n + xx] + cost);
        }
      }
    }
  }
  for (let i = 0; i < distance.length; i++) if (!mask[i]) distance[i] = -distance[i];
  // Interpolating C2 B-spline coefficients: smoothing raw distance samples
  // erases small ponds/holes; prefiltering preserves each cell centre's sign
  // while retaining the broad, rounded shoreline of a cubic B-spline.
  const values = Float32Array.from(distance, value => value + 4);
  const inverse = new Float64Array(n), rhs = new Float64Array(n);
  inverse[0] = 0.25;
  for (let i = 1; i < n; i++) inverse[i] = 1 / (4 - inverse[i - 1]);
  const filter = (origin: number, stride: number): void => {
    rhs[0] = 6 * values[origin] * inverse[0];
    for (let i = 1; i < n; i++) rhs[i] = (6 * values[origin + i * stride] - rhs[i - 1]) * inverse[i];
    let next = rhs[n - 1]; values[origin + (n - 1) * stride] = next;
    for (let i = n - 2; i >= 0; i--) { next = rhs[i] - inverse[i] * next; values[origin + i * stride] = next; }
  };
  for (let y = 0; y < n; y++) filter(y * n, 1);
  for (let x = 0; x < n; x++) filter(x, n);
  for (let i = 0; i < values.length; i++) values[i] -= 4;
  const field = { values, distance, n };
  fields.set(mask, field);
  return field;
}

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
