/**
 * WebGL2 renderer of the terrain bench. Everything is drawn by the GPU from
 * retained grids, so panning and zooming only change a few uniforms:
 * - relief: cubic B-spline of a control grid (the Rust engine's physical
 *   raster, or sampled heights) with its box-filtered pyramid, analytic
 *   gradient, slope-driven fractal refinement below the source cell;
 * - hypsometric tint and the bench's two-light hillshade, antialiased coast,
 *   cavern rock, contour lines of constant screen width;
 * - diagnostic rasters, lakes (smoothed mask) and rivers (instanced capsules
 *   of constant screen width).
 * Heights in metres, coordinates in metres from the map's north-west corner.
 */
import { PALETTES } from '../render/styles';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../render/strokes';
import type { View } from '../render/view';
import { FRACTAL_ROTATIONS, type FractalDetail } from '../../../rust/bridge/terrainAdjust';

export type GlStyle = 'parchment' | 'atlas' | 'topographic' | 'copernicus';

/** Control points of a height layer: `n²` values at cell centres of the square `[x, x + width]²`. */
export interface HeightLayer {
  x: number; y: number; width: number; n: number; data: Float32Array;
  /** 1 where cavern rock (same grid), optional. */
  cave?: Uint8Array;
}

export interface TerrainLook {
  style: GlStyle; mapWidth: number;
  globalMin: number; globalMax: number;
  contours: boolean; contourStep: number; flatRelief: boolean;
  /** Fractal refinement below `sourceCell` (metres), seeded. */
  refine: boolean; sourceCell: number; seed: number; detail: FractalDetail;
  /** Lower clamp of the regional reliefs (the engine keeps land at ≥ 0.3 m). */
  floor: number;
  frame: boolean; background: string;
}

export interface WaterLayer {
  /** Drawn lake cells over the map (`n²`), or none. */
  lake?: Uint8Array; n: number; lakeColor: string;
  /** Instances: x0, y0, x1, y1, width (CSS px), r, g, b (0–1). */
  rivers?: Float32Array;
}

export interface OverlayLayer { rgba: Uint8Array; n: number }

const hex = (value: string): [number, number, number] => {
  const v = value.replace('#', '');
  const full = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
};

const TERRAIN_VS = `#version 300 es
precision highp float;
uniform vec4 uQuad; // device-pixel rectangle x0, y0, x1, y1 (y down)
uniform vec2 uCanvas;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 p = mix(uQuad.xy, uQuad.zw, corner);
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
out vec4 outColor;
uniform vec2 uCanvas;          // device pixels
uniform vec2 uOrigin;          // world position of the canvas' top-left corner
uniform float uPx;             // metres per device pixel
uniform float uDpr;
uniform float uMapW;
uniform sampler2D uField; uniform int uFieldN; uniform vec2 uFieldOrigin; uniform float uFieldCell; uniform int uMaxLod;
uniform float uAlpha; uniform int uBase;
uniform sampler2D uCave; uniform int uHasCave;
uniform sampler2D uLake; uniform int uHasLake; uniform float uLakeN; uniform vec3 uLakeColor;
uniform sampler2D uOverlay; uniform int uHasOverlay;
uniform int uMode;             // 0 shaded, 1 elevation colours
uniform vec3 uPaper, uSea, uBackground, uFrameColor, uContourColor;
uniform vec3 uStops[8]; uniform float uStopT[8]; uniform int uStopCount;
uniform float uShade, uMinH, uMaxH, uGlobalMin, uFloor;
uniform int uCoastal, uFrame;
uniform int uContours; uniform float uStep, uThinW, uIndexW, uThinA, uIndexA, uFlatSlope;
uniform int uRefine; uniform float uSourceCell; uniform uint uSeed;
// Detail noise: amplitude, Hurst, lacunarity, first wavelength (source cells); slope exponent, slope floor, shore fade (m); octaves.
uniform vec4 uDetailA; uniform vec3 uDetailB; uniform int uOctaves;

vec4 bw(float t) { float t2 = t * t, t3 = t2 * t, u = 1.0 - t; return vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0; }
vec4 bd(float t) { float t2 = t * t, u = 1.0 - t; return vec4(-0.5 * u * u, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2); }

// Height and gradient (metres per metre) of one pyramid level.
vec3 level(int lod, vec2 world) {
  int n = max(1, uFieldN >> lod);
  float cell = uFieldCell * float(1 << lod);
  vec2 g = (world - uFieldOrigin) / cell - 0.5;
  vec2 f = floor(g), t = g - f;
  vec4 wx = bw(t.x), wy = bw(t.y), dx = bd(t.x), dy = bd(t.y);
  ivec2 b = ivec2(f) - 1;
  float h = 0.0, gx = 0.0, gy = 0.0;
  for (int j = 0; j < 4; j++) {
    int row = clamp(b.y + j, 0, n - 1);
    float r = 0.0, rd = 0.0;
    for (int i = 0; i < 4; i++) {
      float v = texelFetch(uField, ivec2(clamp(b.x + i, 0, n - 1), row), lod).r;
      r += v * wx[i]; rd += v * dx[i];
    }
    h += r * wy[j]; gx += rd * wy[j]; gy += r * dy[j];
  }
  return vec3(h, gx / cell, gy / cell);
}

vec3 surface(vec2 world) {
  // Half a level sharper than the pixel footprint: crisp relief without shimmer.
  float lod = clamp(log2(max(1.0, uPx / uFieldCell)) - 0.5, 0.0, float(uMaxLod));
  int lower = int(floor(lod));
  vec3 a = level(lower, world);
  float t = lod - float(lower);
  if (t > 0.001 && lower < uMaxLod) a = mix(a, level(lower + 1, world), t);
  return a;
}

// Gradient noise (Perlin 2002 fade) with its derivatives; same lattice hash as the CPU bench.
vec3 gnoise(vec2 p, uint seed) {
  vec2 i = floor(p), f = p - i;
  uvec2 c = uvec2(ivec2(i));
  vec3 r = vec3(0.0);
  vec2 g[4];
  for (int k = 0; k < 4; k++) {
    uvec2 q = c + uvec2(k & 1, k >> 1);
    uint h = (q.x * 374761393u) ^ (q.y * 668265263u) ^ seed;
    h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u;
    float angle = float(h) / 4294967296.0 * 6.283185307179586;
    g[k] = vec2(cos(angle), sin(angle));
  }
  float a = dot(g[0], f), b = dot(g[1], f - vec2(1.0, 0.0)), cc = dot(g[2], f - vec2(0.0, 1.0)), d = dot(g[3], f - vec2(1.0));
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float value = a + (b - a) * u.x + (cc - a) * u.y + (a - b - cc + d) * u.x * u.y;
  vec2 grad = g[0] + (g[1] - g[0]) * u.x + (g[2] - g[0]) * u.y + (g[0] - g[1] - g[2] + g[3]) * u.x * u.y
    + du * vec2((b - a) + (a - b - cc + d) * u.y, (cc - a) + (a - b - cc + d) * u.x);
  return vec3(value, grad) * 1.4;
}

const float ROT[${FRACTAL_ROTATIONS.length}] = float[${FRACTAL_ROTATIONS.length}](${FRACTAL_ROTATIONS.map(r => r.toFixed(3)).join(', ')});

vec3 detail(vec2 world, vec3 s) {
  float slope = length(s.yz);
  float scale = uDetailA.x * pow(max(slope + uDetailB.y, 1e-6), uDetailB.x) * uSourceCell;
  vec3 sum = vec3(0.0);
  float wavelength = uSourceCell * uDetailA.w;
  for (int k = 0; k < ${FRACTAL_ROTATIONS.length}; k++) {
    if (k >= uOctaves) break;
    // Octaves fade in between four and two device pixels: no shimmer, no popping.
    float weight = clamp(wavelength / uPx * 0.5 - 1.0, 0.0, 1.0);
    if (weight <= 0.0) break;
    float c = cos(ROT[k]), sn = sin(ROT[k]);
    vec2 p = vec2(world.x * c - world.y * sn, world.x * sn + world.y * c) / wavelength;
    vec3 v = gnoise(p, uSeed + uint(k * 7919));
    float amplitude = scale * pow(wavelength / uSourceCell, uDetailA.y) * weight;
    sum += vec3(v.x, (v.y * c + v.z * sn) / wavelength, (-v.y * sn + v.z * c) / wavelength) * amplitude;
    wavelength /= uDetailA.z;
  }
  // Fade out near the shore: the coast keeps its line.
  float shore = uDetailB.z > 0.0 ? clamp(s.x / uDetailB.z, 0.0, 1.0) : 1.0;
  return vec3(sum.x * shore, sum.yz * shore);
}

vec3 hypso(float t) {
  vec3 c = uStops[0];
  if (t <= uStopT[0]) return c;
  for (int i = 1; i < 8; i++) {
    if (i >= uStopCount) break;
    if (t <= uStopT[i]) return mix(uStops[i - 1], uStops[i], (t - uStopT[i - 1]) / max(1e-6, uStopT[i] - uStopT[i - 1]));
    c = uStops[i];
  }
  return c;
}

const vec3 ELEV[6] = vec3[6](vec3(0, 32, 96) / 255.0, vec3(0, 160, 70) / 255.0, vec3(255, 230, 0) / 255.0, vec3(235, 35, 20) / 255.0, vec3(128) / 255.0, vec3(1.0));

vec3 land(vec3 s, vec2 world) {
  if (uMode == 1) {
    float landMin = uCoastal == 1 ? 0.0 : uGlobalMin;
    float t = clamp((s.x - landMin) / max(1e-6, uMaxH - landMin), 0.0, 1.0);
    float position = (uCoastal == 1 ? 1.0 : 0.0) + t * (uCoastal == 1 ? 4.0 : 5.0);
    int index = min(4, int(floor(position)));
    return mix(ELEV[index], ELEV[index + 1], position - float(index));
  }
  // The bench's two-light hillshade, vertical exaggeration 2.
  vec2 g = s.yz * 2.0;
  float inv = inversesqrt(dot(g, g) + 1.0);
  vec3 n = vec3(-g * inv, inv);
  float sh = 0.75 * dot(n, vec3(-0.5, -0.5, 0.7071)) + 0.25 * dot(n, vec3(0.2, -0.75, 0.63));
  float dd = sh - 0.7071;
  float f = clamp(1.0 + uShade * (dd > 0.0 ? 1.0 : 0.8) * dd * 1.15, 0.58, 1.25);
  float t = clamp((s.x - uMinH) / max(1.0, uMaxH - uMinH), 0.0, 1.0);
  return hypso(pow(t, 0.85)) * f;
}

vec3 sea(float h) {
  if (uMode == 1) { float d = clamp(h / min(-1e-6, uGlobalMin), 0.0, 1.0); return vec3(35.0 - 27.0 * d, 125.0 - 85.0 * d, 175.0 - 79.0 * d) / 255.0; }
  return uCoastal == 1 ? uSea : uPaper;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 world = uOrigin + px * uPx;
  bool inside = world.x >= 0.0 && world.y >= 0.0 && world.x <= uMapW && world.y <= uMapW;
  if (!inside) {
    if (uBase == 0) discard;
    outColor = vec4(uBackground, 1.0);
  } else {
    vec3 s = surface(world);
    if (uFloor > 0.0) s.x = max(s.x, uFloor);
    // Contours follow the raster surface: refinement adds relief, not ink.
    vec3 raster = s;
    if (uRefine == 1 && s.x > 0.0 && uPx * 2.0 < uSourceCell * uDetailA.w) s += detail(world, s);
    float grad = length(s.yz);
    // Antialiased coast at the zero level (screen-space width of the height ramp).
    float ramp = max(grad * uPx, 1e-4);
    float landCover = uCoastal == 1 ? clamp(s.x / ramp + 0.5, 0.0, 1.0) : (s.x > 0.0 ? 1.0 : 0.0);
    vec3 color = mix(sea(s.x), land(vec3(max(s.x, 1e-3), s.yz), world), landCover);
    if (uHasCave == 1) {
      vec2 uv = (world - uFieldOrigin) / (uFieldCell * float(uFieldN));
      float rock = smoothstep(0.35, 0.65, texture(uCave, uv).r);
      vec3 nn = normalize(vec3(-s.yz, 1.0));
      float shade = clamp(length(nn.xy) * (36.0 - 42.0 * nn.x - 42.0 * nn.y) + (1.0 - nn.z) * 12.0, 0.0, 72.0) / 255.0;
      color = mix(color, vec3(shade), rock);
    }
    if (uContours == 1 && s.x > 0.0 && uMode == 0) {
      float v = raster.x / uStep;
      float slope = length(raster.yz);
      float dv = max(slope * uPx / uStep, 1e-6);           // levels per device pixel
      float k = floor(v + 0.5);
      bool index = mod(k, 5.0) < 0.5;
      float dist = abs(v - k) / dv;                          // device pixels to the nearest level
      float line = k < 0.5 ? 0.0 : clamp((index ? uIndexW : uThinW) * 0.5 + 0.5 - dist, 0.0, 1.0);
      // Levels closer than ~2 px alias into moiré: cross-fade them to their mean ink
      // (four thin levels in five, then the index levels, five times sparser).
      float thin = mix(index ? 0.0 : line * uThinA, min(1.0, 0.8 * dv * uThinW) * uThinA, smoothstep(0.3, 0.7, dv));
      float main_ = mix(index ? line * uIndexA : 0.0, min(1.0, 0.2 * dv * uIndexW) * uIndexA, smoothstep(0.3, 0.7, dv * 5.0));
      float a = 1.0 - (1.0 - thin) * (1.0 - main_);
      // Near-flat ground draws wandering loops: keep contours on slopes.
      a *= smoothstep(0.25 * uFlatSlope, 0.5 * uFlatSlope, slope);
      color = mix(color, uContourColor, a);
    }
    if (uHasOverlay == 1) {
      vec4 o = texture(uOverlay, world / uMapW);
      color = mix(color, o.rgb, o.a);
    }
    if (uHasLake == 1) {
      // Bilinear mask at four quarter-cell offsets: rounded marching-squares shores.
      vec2 uv = world / uMapW; float q = 0.25 / uLakeN;
      float m = 0.25 * (texture(uLake, uv + vec2(q, q)).r + texture(uLake, uv + vec2(-q, q)).r + texture(uLake, uv + vec2(q, -q)).r + texture(uLake, uv + vec2(-q, -q)).r);
      float w = max(fwidth(m), 1e-4);
      color = mix(color, uLakeColor, clamp((m - 0.5) / w + 0.5, 0.0, 1.0));
    }
    if (uFrame == 1 && uBase == 1) {
      vec2 e = min(world, vec2(uMapW) - world) / uPx;
      float d = min(e.x, e.y);
      color = mix(color, uFrameColor, clamp(1.2 * uDpr * 0.5 + 0.5 - d, 0.0, 1.0));
    }
    outColor = vec4(color, uAlpha);
  }
}`;

const RIVER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeg;
layout(location = 1) in float aWidth;
layout(location = 2) in vec3 aColor;
uniform vec2 uCanvas; uniform vec2 uOrigin; uniform float uPx; uniform float uDpr;
out vec2 vP; flat out vec4 vSeg; flat out float vHalf; flat out vec3 vColor;
void main() {
  vec2 a = (aSeg.xy - uOrigin) / uPx, b = (aSeg.zw - uOrigin) / uPx;
  vec2 d = b - a; float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  float half_ = aWidth * uDpr * 0.5;
  float r = half_ + 1.0;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 p = mix(a - dir * r, b + dir * r, corner.x) + nrm * r * (corner.y * 2.0 - 1.0);
  vP = p; vSeg = vec4(a, b); vHalf = half_; vColor = aColor;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

const RIVER_FS = `#version 300 es
precision highp float;
in vec2 vP; flat in vec4 vSeg; flat in float vHalf; flat in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  float d = length(pa - ba * h);
  float alpha = clamp(vHalf + 0.5 - d, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  // Premultiplied; blended with MAX so overlapping capsules cover like one stroke.
  outColor = vec4(vColor * alpha, alpha);
}`;

const COMPOSITE_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }`;
const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uLayer;
out vec4 outColor;
void main() { outColor = texelFetch(uLayer, ivec2(gl_FragCoord.xy), 0); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader : ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Programme : ${gl.getProgramInfoLog(program)}`);
  return program;
}

/** Box-filtered pyramid of a square grid, largest first (the engine's `Surface`). */
export function heightPyramid(data: Float32Array, n: number): Float32Array[] {
  const levels = [data];
  let size = n;
  while (size > 1 && size % 2 === 0) {
    const previous = levels[levels.length - 1], half = size / 2, next = new Float32Array(half * half);
    for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
      const i = 2 * y * size + 2 * x;
      next[y * half + x] = (previous[i] + previous[i + 1] + previous[i + size] + previous[i + size + 1]) * 0.25;
    }
    levels.push(next); size = half;
  }
  return levels;
}

interface GpuLayer { layer: HeightLayer; levels: Float32Array[]; texture: WebGLTexture; cave?: WebGLTexture; alpha: number; fadeStart: number }

export class TerrainGl {
  readonly gl: WebGL2RenderingContext;
  private terrain: WebGLProgram; private river: WebGLProgram; private composite: WebGLProgram;
  private riverTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private locations = new Map<string, WebGLUniformLocation | null>();
  private riverLocations = new Map<string, WebGLUniformLocation | null>();
  private base?: GpuLayer; private details: GpuLayer[] = [];
  private look?: TerrainLook;
  private lake?: WebGLTexture; private lakeN = 0; private lakeColor: [number, number, number] = [0, 0, 0];
  private overlay?: WebGLTexture;
  private riverBuffer: WebGLBuffer; private riverVao: WebGLVertexArrayObject; private riverCount = 0;
  private view?: { view: View; width: number; height: number };
  private frame = 0;
  private empty: WebGLTexture;
  /** Last frame's GPU submission time, ms (CPU side). */
  drawMs = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    this.terrain = compile(gl, TERRAIN_VS, TERRAIN_FS);
    this.river = compile(gl, RIVER_VS, RIVER_FS);
    this.composite = compile(gl, COMPOSITE_VS, COMPOSITE_FS);
    this.riverBuffer = gl.createBuffer()!;
    this.riverVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.riverVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.empty = this.texture(1, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1), gl.NEAREST);
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.terrain, name));
    return this.locations.get(name)!;
  }
  private riverUniform(name: string): WebGLUniformLocation | null {
    if (!this.riverLocations.has(name)) this.riverLocations.set(name, this.gl.getUniformLocation(this.river, name));
    return this.riverLocations.get(name)!;
  }

  private texture(w: number, h: number, internal: number, format: number, type: number, data: ArrayBufferView, filter: number): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private upload(layer: HeightLayer, pyramid: boolean): GpuLayer {
    const gl = this.gl, levels = pyramid ? heightPyramid(layer.data, layer.n) : [layer.data];
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texStorage2D(gl.TEXTURE_2D, levels.length, gl.R32F, layer.n, layer.n);
    levels.forEach((values, lod) => gl.texSubImage2D(gl.TEXTURE_2D, lod, 0, 0, layer.n >> lod, layer.n >> lod, gl.RED, gl.FLOAT, values));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    let cave: WebGLTexture | undefined;
    if (layer.cave?.length) {
      const mask = new Uint8Array(layer.cave.length);
      for (let i = 0; i < mask.length; i++) if (layer.cave[i]) mask[i] = 255;
      cave = this.texture(layer.n, layer.n, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mask, gl.LINEAR);
    }
    return { layer, levels, texture, cave, alpha: 1, fadeStart: 0 };
  }

  private release(layer: GpuLayer | undefined): void {
    if (!layer) return;
    this.gl.deleteTexture(layer.texture);
    if (layer.cave) this.gl.deleteTexture(layer.cave);
  }

  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): void {
    this.release(this.base); this.details.forEach(d => this.release(d)); this.details = [];
    this.base = this.upload(layer, true);
    this.request();
  }

  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): void {
    if (!layer) { this.details.forEach(d => this.release(d)); this.details = []; this.request(); return; }
    const next = this.upload(layer, false);
    next.alpha = 0; next.fadeStart = performance.now();
    this.details.push(next);
    while (this.details.length > 2) this.release(this.details.shift());
    this.request();
  }

  setLook(look: TerrainLook): void { this.look = look; this.request(); }

  setWater(water: WaterLayer | undefined): void {
    const gl = this.gl;
    if (this.lake) gl.deleteTexture(this.lake);
    this.lake = undefined;
    if (water?.lake) {
      const mask = new Uint8Array(water.lake.length);
      for (let i = 0; i < mask.length; i++) if (water.lake[i]) mask[i] = 255;
      this.lake = this.texture(water.n, water.n, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mask, gl.LINEAR);
      this.lakeN = water.n; this.lakeColor = hex(water.lakeColor);
    }
    const rivers = water?.rivers ?? new Float32Array();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rivers.byteLength ? rivers : new Float32Array(8), gl.STATIC_DRAW);
    this.riverCount = rivers.length / 8;
    this.request();
  }

  setOverlay(overlay: OverlayLayer | undefined): void {
    const gl = this.gl;
    if (this.overlay) gl.deleteTexture(this.overlay);
    this.overlay = overlay ? this.texture(overlay.n, overlay.n, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, overlay.rgba, gl.NEAREST) : undefined;
    this.request();
  }

  setView(view: View, width: number, height: number): void { this.view = { view, width, height }; this.request(); }

  /** Height (metres) the renderer shows at a world point, from the finest layer covering it. */
  heightAt(x: number, y: number): number | undefined {
    const layers = [...this.details].reverse().concat(this.base ? [this.base] : []);
    for (const l of layers) {
      const { layer } = l, cell = layer.width / layer.n;
      if (x < layer.x || y < layer.y || x > layer.x + layer.width || y > layer.y + layer.width) continue;
      const gx = (x - layer.x) / cell - 0.5, gy = (y - layer.y) / cell - 0.5, fx = Math.floor(gx), fy = Math.floor(gy);
      const w = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
      const wx = w(gx - fx), wy = w(gy - fy), n = layer.n;
      let h = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const cx = Math.max(0, Math.min(n - 1, fx + i - 1)), cy = Math.max(0, Math.min(n - 1, fy + j - 1));
        h += layer.data[cy * n + cx] * wx[i] * wy[j];
      }
      return Math.max(h, this.look?.floor ?? 0);
    }
    return undefined;
  }

  private request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(): void {
    const gl = this.gl, look = this.look, state = this.view;
    if (!look || !state || !this.base || gl.isContextLost()) return;
    const started = performance.now();
    // Two device pixels per CSS pixel at most: 4K stays cheap on modest GPUs.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(state.width * dpr)), height = Math.max(1, Math.round(state.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    const { view } = state, px = 1 / (view.scale * dpr);
    const origin: [number, number] = [view.cx - state.width / (2 * view.scale), view.cy - state.height / (2 * view.scale)];
    const pal = PALETTES[look.style === 'copernicus' ? 'parchment' : look.style];
    const u = (name: string): WebGLUniformLocation | null => this.uniform(name);
    gl.useProgram(this.terrain);
    gl.uniform2f(u('uCanvas'), width, height);
    gl.uniform2f(u('uOrigin'), origin[0], origin[1]);
    gl.uniform1f(u('uPx'), px); gl.uniform1f(u('uDpr'), dpr);
    gl.uniform1f(u('uMapW'), look.mapWidth);
    gl.uniform1i(u('uMode'), look.style === 'copernicus' ? 1 : 0);
    gl.uniform3fv(u('uPaper'), hex(pal.paper)); gl.uniform3fv(u('uSea'), hex(pal.seaFill));
    gl.uniform3fv(u('uBackground'), hex(look.background)); gl.uniform3fv(u('uFrameColor'), hex(look.style === 'copernicus' ? '#333333' : pal.frame));
    gl.uniform3fv(u('uContourColor'), hex(pal.contour));
    const stops = pal.hypso.slice(0, 8);
    gl.uniform3fv(u('uStops'), new Float32Array(Array.from({ length: 8 }, (_, i) => hex(stops[Math.min(i, stops.length - 1)][1])).flat()));
    gl.uniform1fv(u('uStopT'), new Float32Array(Array.from({ length: 8 }, (_, i) => stops[Math.min(i, stops.length - 1)][0])));
    gl.uniform1i(u('uStopCount'), stops.length);
    gl.uniform1f(u('uShade'), pal.shade);
    const coastal = look.globalMin < 0;
    gl.uniform1f(u('uMinH'), Math.max(0, look.globalMin)); gl.uniform1f(u('uMaxH'), look.globalMax); gl.uniform1f(u('uGlobalMin'), look.globalMin);
    gl.uniform1f(u('uFloor'), look.floor);
    gl.uniform1i(u('uCoastal'), coastal ? 1 : 0); gl.uniform1i(u('uFrame'), look.frame ? 1 : 0);
    // Contour weights of the Canvas renderer, in device pixels.
    const thin = mapStrokeWidth(CANVAS_MAP_STROKES.contour, view.scale) * view.scale * dpr;
    const index = mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, view.scale, pal.contourIndexW / 1.6) * view.scale * dpr;
    gl.uniform1i(u('uContours'), look.contours && look.contourStep > 0 ? 1 : 0);
    gl.uniform1f(u('uStep'), Math.max(1e-3, look.contourStep)); gl.uniform1f(u('uThinW'), thin); gl.uniform1f(u('uIndexW'), index);
    gl.uniform1f(u('uThinA'), pal.contourOpacity * 0.5); gl.uniform1f(u('uIndexA'), pal.contourOpacity * 0.75);
    gl.uniform1f(u('uFlatSlope'), look.flatRelief ? 0.004 : 0.012);
    gl.uniform1i(u('uRefine'), look.refine ? 1 : 0); gl.uniform1f(u('uSourceCell'), look.sourceCell); gl.uniform1ui(u('uSeed'), look.seed >>> 0);
    const d = look.detail;
    gl.uniform4f(u('uDetailA'), d.amplitude, d.hurst, Math.max(1.1, d.lacunarity), d.start);
    gl.uniform3f(u('uDetailB'), d.slope, d.flat, d.shore);
    gl.uniform1i(u('uOctaves'), Math.min(FRACTAL_ROTATIONS.length, Math.round(d.octaves)));
    // Textures: 0 field, 1 cave, 2 lake, 3 overlay.
    gl.uniform1i(u('uField'), 0); gl.uniform1i(u('uCave'), 1); gl.uniform1i(u('uLake'), 2); gl.uniform1i(u('uOverlay'), 3);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lake ?? this.empty);
    gl.uniform1i(u('uHasLake'), this.lake ? 1 : 0); gl.uniform1f(u('uLakeN'), this.lakeN); gl.uniform3fv(u('uLakeColor'), this.lakeColor);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.overlay ?? this.empty);
    gl.uniform1i(u('uHasOverlay'), this.overlay ? 1 : 0);
    let animating = false;
    const now = performance.now();
    const drawLayer = (layer: GpuLayer, base: boolean): void => {
      const l = layer.layer;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, layer.cave ?? this.empty);
      gl.uniform1i(u('uHasCave'), layer.cave ? 1 : 0);
      gl.uniform1i(u('uFieldN'), l.n); gl.uniform2f(u('uFieldOrigin'), l.x, l.y); gl.uniform1f(u('uFieldCell'), l.width / l.n);
      gl.uniform1i(u('uMaxLod'), layer.levels.length - 1);
      gl.uniform1i(u('uBase'), base ? 1 : 0);
      if (base) {
        gl.uniform1f(u('uAlpha'), 1); gl.disable(gl.BLEND);
        gl.uniform4f(u('uQuad'), 0, 0, width, height);
      } else {
        const alpha = Math.min(1, (now - layer.fadeStart) / 240);
        animating ||= alpha < 1;
        gl.uniform1f(u('uAlpha'), 1 - (1 - alpha) ** 2);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        // Inset by two cells: the clamped B-spline edge never shows.
        const inset = 2 * l.width / l.n;
        gl.uniform4f(u('uQuad'), (l.x + inset - origin[0]) / px, (l.y + inset - origin[1]) / px, (l.x + l.width - inset - origin[0]) / px, (l.y + l.width - inset - origin[1]) / px);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    drawLayer(this.base, true);
    for (const detail of this.details) drawLayer(detail, false);
    // A detail fully faded in hides the older ones beneath it.
    let opaque = -1;
    this.details.forEach((d, i) => { if (now - d.fadeStart >= 240) opaque = i; });
    if (opaque > 0) { this.details.slice(0, opaque).forEach(d => this.release(d)); this.details = this.details.slice(opaque); }
    if (this.riverCount) {
      const target = this.target(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.river);
      const r = (name: string): WebGLUniformLocation | null => this.riverUniform(name);
      gl.uniform2f(r('uCanvas'), width, height); gl.uniform2f(r('uOrigin'), origin[0], origin[1]);
      gl.uniform1f(r('uPx'), px); gl.uniform1f(r('uDpr'), dpr);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.riverVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.riverCount);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.composite);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform1i(gl.getUniformLocation(this.composite, 'uLayer'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    this.drawMs = performance.now() - started;
    if (animating) this.request();
  }

  private target(width: number, height: number): { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } {
    const gl = this.gl;
    if (this.riverTarget && this.riverTarget.width === width && this.riverTarget.height === height) return this.riverTarget;
    if (this.riverTarget) { gl.deleteFramebuffer(this.riverTarget.framebuffer); gl.deleteTexture(this.riverTarget.texture); }
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.riverTarget = { framebuffer, texture, width, height };
  }

  dispose(): void {
    const gl = this.gl;
    this.release(this.base); this.details.forEach(d => this.release(d));
    if (this.lake) gl.deleteTexture(this.lake);
    if (this.overlay) gl.deleteTexture(this.overlay);
    gl.deleteBuffer(this.riverBuffer); gl.deleteVertexArray(this.riverVao);
    if (this.riverTarget) { gl.deleteFramebuffer(this.riverTarget.framebuffer); gl.deleteTexture(this.riverTarget.texture); }
    gl.deleteProgram(this.terrain); gl.deleteProgram(this.river); gl.deleteProgram(this.composite);
  }
}
