/** Fractal shoreline below the cells of the physical field: the one definition of it, for the traced sea polygon
 * (v2/shoreline.ts: towns, harbours, vector maps, 3D water), the 2D ground shader (ui/terrain/gl/shaders.ts), the 3D mesh
 * and its CPU heights (render/world/terrainShader.ts, heights.ts), the sea distance (render/terrainWater.ts) and the
 * town's ground and the river mouths, through its Rust mirror rust/crates/terrain/src/shore_detail.rs. The two must stay
 * in step (octaves, rotations, seeds, noise): both pin the same values (web/tests/v2/shoreline.test.ts, the Rust module's tests).
 *
 * The coast plan (terrain/src/coast.rs) cuts the shore down to the cells of the field; a spline of 30 m cells then draws
 * smooth round coves. Here the height near the zero line gets an offset worth a displacement of that line: a few octaves
 * from four cells down to half a cell, deep on steep or resistant stretches and almost nothing on gentle sandy ones.
 * It is a function of the position and of the spline's value and gradient alone, so nothing is stored, and it is zero a
 * cell and a half away from the shore. */
import { FRACTAL_ROTATIONS } from '../../../rust/bridge/terrainAdjust';

/** Distance from the spline's zero line (value over gradient, in cells) at which the offset has vanished. */
export const SHORE_DETAIL_REACH = 1.5;
/** Octaves: wavelength and displacement, in cells. */
const OCTAVES: readonly (readonly [number, number])[] = [
  [4, 0.34],
  [2, 0.2],
  [1, 0.12],
  [0.5, 0.07],
];
/** Length of the alternating resistant and sandy stretches, in cells. */
const STRETCH = 40;
const STRETCH_SEED = 104729,
  OCTAVE_SEED = 7919;

const hash = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
/** Value of the ground shader's `gnoise`. */
function gnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const corner = (dx: number, dy: number): number => {
    const angle = (hash(ix + dx, iy + dy, seed) / 4294967296) * 2 * Math.PI;
    return Math.cos(angle) * (fx - dx) + Math.sin(angle) * (fy - dy);
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const north = corner(0, 0) * (1 - u) + corner(1, 0) * u,
    south = corner(0, 1) * (1 - u) + corner(1, 1) * u;
  return (north * (1 - v) + south * v) * 1.4;
}
const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Height offset (m) at a world point where the spline has this value and slope (m, m/m), on cells of `cell` metres. */
export function shoreOffset(x: number, y: number, height: number, slope: number, cell: number): number {
  if (Math.abs(height) >= slope * cell * SHORE_DETAIL_REACH) return 0;
  const rough = Math.max(0.08, Math.min(1, 0.15 + 0.6 * smoothstep(0.03, 0.22, slope) + 0.45 * gnoise(x / (cell * STRETCH), y / (cell * STRETCH), STRETCH_SEED)));
  let sum = 0;
  for (let k = 0; k < OCTAVES.length; k++) {
    const [wavelength, amplitude] = OCTAVES[k],
      c = Math.cos(FRACTAL_ROTATIONS[k]) / (wavelength * cell),
      s = Math.sin(FRACTAL_ROTATIONS[k]) / (wavelength * cell);
    sum += amplitude * gnoise(x * c - y * s, x * s + y * c, OCTAVE_SEED * (k + 1));
  }
  return slope * cell * rough * sum * smoothstep(0, 1, 1 - Math.abs(height) / (slope * cell * SHORE_DETAIL_REACH));
}

/** The same offset for a vertex of the 3D mesh (render/world/terrainShader.ts): every octave, since the mesh has no pixel
 * scale and a vertex shared by two squares must compute the same bits, with its own copy of the ground shader's noise.
 * `h`, `slope`: the spline's value and slope (m, m/m); `cell`: the field cell (m). */
export const SHORE_DETAIL_VERTEX_GLSL = `
float shoreNoise(vec2 p, uint seed) {
  vec2 i = floor(p), f = p - i;
  uvec2 c = uvec2(ivec2(i));
  float v[4];
  for (int k = 0; k < 4; k++) {
    uvec2 q = c + uvec2(k & 1, k >> 1);
    uint h = (q.x * 374761393u) ^ (q.y * 668265263u) ^ seed;
    h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u;
    float angle = float(h) / 4294967296.0 * 6.283185307179586;
    vec2 d = f - vec2(float(k & 1), float(k >> 1));
    v[k] = cos(angle) * d.x + sin(angle) * d.y;
  }
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y) * 1.4;
}
float shoreHeightOffset(vec2 world, float h, float slope, float cell) {
  float reach = slope * cell * ${SHORE_DETAIL_REACH.toFixed(2)};
  if (abs(h) >= reach) return 0.0;
  float rough = clamp(0.15 + 0.6 * smoothstep(0.03, 0.22, slope) + 0.45 * shoreNoise(world / (cell * ${STRETCH.toFixed(1)}), ${STRETCH_SEED}u), 0.08, 1.0);
  float sum = 0.0;
${OCTAVES.map(([wavelength, amplitude], k) => {
  const c = Math.cos(FRACTAL_ROTATIONS[k]).toPrecision(9),
    s = Math.sin(FRACTAL_ROTATIONS[k]).toPrecision(9);
  return `  sum += ${amplitude.toFixed(2)} * shoreNoise(vec2(world.x * ${c} - world.y * ${s}, world.x * ${s} + world.y * ${c}) / (${wavelength.toFixed(1)} * cell), ${OCTAVE_SEED * (k + 1)}u);`;
}).join('\n')}
  return slope * cell * rough * sum * smoothstep(0.0, 1.0, 1.0 - abs(h) / reach);
}`;

const vec4 = (index: 0 | 1): string => `vec4(${OCTAVES.map(o => o[index].toFixed(2)).join(', ')})`;
/** The same offset for a fragment (`s`: height and gradient). Octaves under two pixels fade out, as in `detail`. */
export const SHORE_DETAIL_GLSL = `
float shoreOffset(vec2 world, vec3 s) {
  float reach = length(s.yz) * uFieldCell * ${SHORE_DETAIL_REACH.toFixed(2)};
  if (abs(s.x) >= reach) return 0.0;
  float rough = clamp(0.15 + 0.6 * smoothstep(0.03, 0.22, length(s.yz)) + 0.45 * gnoise(world / (uFieldCell * ${STRETCH.toFixed(1)}), ${STRETCH_SEED}u).x, 0.08, 1.0);
  vec4 wave = ${vec4(0)}, size = ${vec4(1)};
  float sum = 0.0;
  for (int k = 0; k < ${OCTAVES.length}; k++) {
    float wavelength = wave[k] * uFieldCell;
    float weight = clamp(wavelength / uPx * 0.5 - 1.0, 0.0, 1.0);
    if (weight <= 0.0) break;
    float c = cos(ROT[k]), sn = sin(ROT[k]);
    sum += size[k] * weight * gnoise(vec2(world.x * c - world.y * sn, world.x * sn + world.y * c) / wavelength, uint(${OCTAVE_SEED} * (k + 1))).x;
  }
  return reach / ${SHORE_DETAIL_REACH.toFixed(2)} * rough * sum * smoothstep(0.0, 1.0, 1.0 - abs(s.x) / reach);
}`;
