/**
 * Leaf-clump relief of a broadleaf crown seen from above, shared by two renderers:
 * - the elven town crowns (cityGrove.ts) bake it, with their colours and seasons, into canvas sprites;
 * - the procedural forest and orchard crowns of the terrain shader read it, tone only, from a small atlas baked here
 *   once (composition `vegetation.crownDetail: 'clumps'`, FOREST_CROWN_ATLAS_GLSL in rust/bridge/terrainForest.ts).
 * The atlas is deterministic (no asset file), built on first use and uploaded once per context, never per frame.
 * Pure module apart from the WebGL upload helper.
 */
import { boxMips } from '../ui/boxMips';

/** Close-zoom detail of the procedural broadleaf and orchard crowns (2D map), composition `vegetation.crownDetail`:
 * `plain` the lit dome with its procedural clumps, `clumps` the baked leaf masses, `clumps-fine` the elven clump size. */
export type CrownDetail = 'plain' | 'clumps' | 'clumps-fine';
export const CROWN_DETAILS: readonly CrownDetail[] = ['plain', 'clumps', 'clumps-fine'];
/** Off by default: `clumps` and `clumps-fine` (same cost, another atlas layer) are opt-in. */
export const DEFAULT_CROWN_DETAIL: CrownDetail = 'plain';

function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(Math.round(x * 8) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 8) | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35); return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
/** Smooth value noise on the integer lattice. */
function valueNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Leaf clump relief across a lobe of unit radius (0..1): a few clumps per radius and a finer second octave. */
export const leafClumps = (u: number, v: number, seed: number): number => 0.68 * valueNoise(u * 3.4 + 7, v * 3.4 + 3, seed) + 0.32 * valueNoise(u * 7.9 + 1, v * 7.9 + 5, seed + 17);

/** Atlas: CROWN_CLUMP_LAYERS layers of CROWN_CLUMP_SIZE² RGBA8 texels, each one crown of unit radius over [-1, 1]²:
 * CROWN_CLUMP_VARIANTS motifs per clump scale, the `clumps` scale first, then the `clumps-fine` one. */
export const CROWN_CLUMP_SIZE = 128, CROWN_CLUMP_VARIANTS = 4, CROWN_CLUMP_LAYERS = 2 * CROWN_CLUMP_VARIANTS;
/** Lobe radii per crown radius of each scale. One lobe per crown keeps the clumps as legible leaf masses (`clumps`);
 * 1.8 keeps the clump size of an elven crown, 4–6 lobes of about .54 of its radius, which reads as a fine grain at
 * the zooms where the map resolves crowns (`clumps-fine`). */
const LOBES_PER_RADIUS = [1, 1.8] as const;
/** Encoded range (±) of the clump gradient, per lobe radius. */
const GRADIENT_RANGE = 16;
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const byte = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, v)));

let levels: Uint8Array[] | undefined;
/** Mip chain of the atlas (box filtered, layer-major, as texImage3D and writeTexture take it). Channels:
 * R the gap tone of the clumps (darker creases between them, .74–1 as the elven sprites) over its mean inside the
 * crown, times .8 (the shader multiplies by 1.25, so the stand mean is kept); G, B the clump gradient per lobe radius,
 * .5 + g / 32, for clump faces lit by the scene's sun; A the clumped rim, .5 + 2 (rim − ρ) with rim = .8 + .2 h as
 * the elven sprites (positive inside, ρ the distance to the crown centre in radii). */
export function crownClumpLevels(): readonly Uint8Array[] {
  if (levels) return levels;
  const n = CROWN_CLUMP_SIZE, layers = CROWN_CLUMP_LAYERS, e = 0.01, data = new Uint8Array(n * n * 4 * layers);
  const height = new Float32Array(n * n * layers), texels = n * n * CROWN_CLUMP_VARIANTS;
  LOBES_PER_RADIUS.forEach((lobes, scale) => {
    let sum = 0, count = 0;
    for (let v = 0; v < CROWN_CLUMP_VARIANTS; v++) {
      // The seeds of the first green of the elven sprites (cityGrove.ts buildCrownSprites).
      const seed = 101 + v * 7, k = scale * CROWN_CLUMP_VARIANTS + v;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const u = ((x + 0.5) / n * 2 - 1) * lobes, w = ((y + 0.5) / n * 2 - 1) * lobes, i = (k * n + y) * n + x;
        const h = height[i] = leafClumps(u, w, seed);
        const gx = (leafClumps(u + e, w, seed) - leafClumps(u - e, w, seed)) / (2 * e), gy = (leafClumps(u, w + e, seed) - leafClumps(u, w - e, seed)) / (2 * e);
        const rho = Math.hypot(u, w) / lobes, rim = 0.8 + 0.2 * h, gap = 0.74 + 0.26 * smooth(0.22, 0.62, h);
        if (rho < rim) { sum += gap; count++; }
        data[i * 4 + 1] = byte(0.5 + gx / (2 * GRADIENT_RANGE)); data[i * 4 + 2] = byte(0.5 + gy / (2 * GRADIENT_RANGE));
        data[i * 4 + 3] = byte(0.5 + 2 * (rim - rho));
      }
    }
    // Each scale keeps its own stand mean.
    const mean = sum / Math.max(1, count);
    for (let i = scale * texels; i < (scale + 1) * texels; i++) data[i * 4] = byte((0.74 + 0.26 * smooth(0.22, 0.62, height[i])) / mean * 0.8);
  });
  return levels = boxMips(data, n, n, 4, layers).map(level => level.data);
}

/** `uCrownClumps` of a crown detail: 0 plain crowns (no atlas read), 1 clumps, 2 fine clumps (second half of the
 * layers). Painted brushes take the shared sampler, so they turn the clumps off. */
export function crownClumpMode(detail: CrownDetail | undefined, brushes: boolean): number {
  const d = detail ?? DEFAULT_CROWN_DETAIL;
  return brushes || d === 'plain' ? 0 : d === 'clumps-fine' ? 2 : 1;
}

const textures = new WeakMap<WebGL2RenderingContext, WebGLTexture>();
/** Map program (TerrainGl): `uCrownClumps` (crownClumpMode), and when on the atlas on the brush-atlas unit. The painted
 * brushes and the clumps never show together (the shader reads the clumps only without brushes), so they share the
 * sampler: the map program has no free texture unit on ANGLE/D3D11 (16), nor WebGPU a free sampled texture (16). */
export function bindCrownClumps(gl: WebGL2RenderingContext, uniform: (name: string) => WebGLUniformLocation | null, mode: number, unit: number): void {
  gl.uniform1i(uniform('uCrownClumps'), mode);
  if (mode === 0) return;
  gl.activeTexture(gl.TEXTURE0 + unit);
  let texture = textures.get(gl);
  if (texture) gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  else {
    const chain = crownClumpLevels(), n = CROWN_CLUMP_SIZE;
    texture = gl.createTexture()!; textures.set(gl, texture);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, chain.length, gl.RGBA8, n, n, CROWN_CLUMP_LAYERS);
    chain.forEach((level, mip) => { const s = Math.max(1, n >> mip); gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, mip, 0, 0, 0, s, s, CROWN_CLUMP_LAYERS, gl.RGBA, gl.UNSIGNED_BYTE, level); });
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.uniform1i(uniform('uForestBrushAtlas'), unit);
}
