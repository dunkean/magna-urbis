/** City GPU renderer (WebGL2) — the plan of cityCanvas drawn on the GPU.
 *
 * Geometry is built and uploaded once per scene (setScene) and once per building set
 * (setBuildings); a camera move costs one uniform update and a fixed handful of draw
 * calls (≤ 14), whatever the city size. Fills are earcut triangles (cityGlBuild),
 * outlines are 1-pixel GL lines on the same vertices, streets and walls are segment
 * instances extruded on the GPU with round joins/caps and antialiased edges from a
 * distance field, towers are instanced discs. A view, palette, layer or level-of-detail
 * change rewrites per-feature colour textures (4 bytes per feature), never geometry.
 * The default framebuffer is multisampled (antialias: true) for fill and line edges.
 *
 * Labels, landmark glyphs, district names and diagnostics stay on Canvas 2D: draw them
 * with drawCity on a 2D canvas above this one, using cityGlOverlayLayers(layers).
 * Picking uses the scene's spatial bins (exact polygon test, µs per click). */
import type { Point } from '../../../rust/bridge/urban';
import type { Box, CityBuildings, CityLayers, CityLod, CityPalette, CityPick, CityScene, CityView } from './cityCanvas';
import { pickCity, selectCityLod } from './cityCanvas';
import {
  buildFillMeshSync, buildStreetStrokes, buildTowers, buildWallStrokes, cityOrigin, fillMesh, mergeTriangulations, packBuildings, packPlan,
  slicePolygons, splitPolygons, STROKE_STRIDE, triangulatePolygons, visibleRanges,
  type CityGlFillMesh, type CityGlFillSource, type CityGlStrokes, type CityGlTriangulation,
} from './cityGlBuild';
import { buildingColors, DEFAULT_LAYERS, PAINTED_SHADOW, planColors, rgba01, streetColors, wallColors, type CityGlDraws, type CityGlStyleState } from './cityGlStyle';
import { cityLegacyWalls, cityWallColors, cityWallStrokes, createCityGlWalls, type CityGlWalls } from './cityWalls'; // walls hook (cityWalls.ts)

export interface CityGlDrawOptions {
  viewport: Box; metresPerPixel: number; view: CityView;
  /** Level of detail; chosen from metresPerPixel (with hysteresis) when omitted. */
  lod?: CityLod; palette?: CityPalette; layers?: Partial<CityLayers>;
  /** Building id or parcel id to outline. */
  selectedId?: string; selectedParcel?: number;
  /** false when another renderer draws the buildings (e.g. detailed roofs at close zoom). */
  buildingsVisible?: boolean; diagnostic?: 'none' | 'uses' | string; refusedParcels?: ReadonlySet<string>;
  /** Clear colour (straight RGBA 0–1); transparent by default so the map shows through. */
  clear?: [number, number, number, number];
  /** Bridges as stone decks (parapets, inner kerb line, transverse joints). Default: the
   * City Bench « Rendu » background (`<html data-city-background="render">`). */
  bridgeDeck?: boolean;
  /** Painted building silhouettes (tints, ground shadows, edges). Same default as bridgeDeck. */
  paintedBuildings?: boolean;
}
export interface CityGlFrame { lod: CityLod; drawCalls: number; instances: number; triangles: number; cpuMs: number }
export interface CityGlBuildStats { packMs: number; triangulateMs: number; assembleMs: number; uploadMs: number; workers: number; totalMs: number }
export interface CityGlStats {
  plan?: { vertices: number; triangles: number; edges: number; features: number };
  buildings?: { vertices: number; triangles: number; edges: number; features: number };
  streets: number; walls: number; towers: number; gpuBytes: number;
  build?: CityGlBuildStats; buildingsBuild?: CityGlBuildStats; frame?: CityGlFrame; renderer: string;
}
export interface CityGlPick extends CityPick { id?: string; kind?: 'building' | 'parcel' | 'block' }
export interface CityGlSetOptions { /** Triangulation workers (0 = on this thread). Default: up to 4. */ workers?: number }
export interface CityGlRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  /** A retained plan is uploaded and the physical context is usable. */
  readonly ready: boolean;
  setScene(scene: CityScene, buildings?: CityBuildings, options?: CityGlSetOptions): Promise<CityGlBuildStats>;
  setBuildings(buildings: CityBuildings | undefined, options?: CityGlSetOptions): Promise<CityGlBuildStats>;
  draw(options: CityGlDrawOptions): CityGlFrame;
  pick(point: Point, options?: Pick<CityGlDrawOptions, 'view' | 'lod' | 'metresPerPixel' | 'buildingsVisible'>): CityGlPick;
  /** Drawing-buffer size; defaults to the canvas CSS size × devicePixelRatio. */
  resize(width?: number, height?: number): void;
  stats(): CityGlStats;
  dispose(): void;
}

/** Layers left for the Canvas 2D overlay (drawCity) once the GPU draws the plan:
 * diagnostics, landmark glyphs, labels and district names only. */
export function cityGlOverlayLayers(layers: CityLayers): CityLayers {
  return { ...layers, blocks: false, domains: false, streets: false, enclosures: false, parcels: false, gardens: false, places: false };
}

// ---------------------------------------------------------------- shaders
const FILL_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors;
uniform vec4 uTint;
out vec4 vColor;
void main() {
  int f = int(aFeature);
  vColor = texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
  bool shown = vColor.a > 0.0;
  // A tint (painted building shadows) replaces the colour of every feature drawn.
  if (uTint.a > 0.0) vColor = uTint;
  gl_Position = shown ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FILL_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;
/** Paved squares (render background, below 0.3 m/px): a second pass over the plan mesh in
 * which only the features whose alpha byte is 253 (cityGlStyle PAVED_ALPHA) survive the
 * vertex stage, so the sett pattern costs fragments on the squares alone. Rows of setts in
 * origin-relative metres, joints once a sett spans ~3 px, per-sett variation, broad wear. */
const PAVED_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors;
out vec3 vColor; out vec2 vPos;
void main() {
  int f = int(aFeature);
  vec4 c = texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
  vColor = c.rgb; vPos = aPos;
  gl_Position = abs(c.a * 255.0 - 253.0) < 0.5 ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PAVED_FS = `#version 300 es
precision highp float;
in vec3 vColor; in vec2 vPos;
uniform float uMpp;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 g = vPos / vec2(0.9, 0.6); g.x += 0.5 * floor(g.y);
  vec2 fr = fract(g);
  float shown = smoothstep(2.0, 4.5, 0.6 / uMpp), sett = 0.0;
  if (shown > 0.0) {
    float joint = min(min(fr.x, 1.0 - fr.x) * 0.9, min(fr.y, 1.0 - fr.y) * 0.6) / uMpp;
    sett = shown * (0.09 * (1.0 - smoothstep(0.25, 1.0, joint)) - 0.1 * (hash(floor(g)) - 0.5));
  }
  // Broad wear: two crossed warped waves over ~10 m (worn paths, repairs), no texture fetch.
  float wear = 0.5 * sin(vPos.x * 0.61 + 1.7 * sin(vPos.y * 0.37)) * sin(vPos.y * 0.53 + 1.3 * sin(vPos.x * 0.29));
  outColor = vec4(vColor * (1.0 - sett + 0.08 * wear), 1.0);
}`;
/** Segment instance → quad around the capsule; meta bits: 0-3 rank, 4 crossing,
 * 5/6 butt start/end, 7 dashed, 8 solid edge (bridges, quays). */
const STROKE_VS = `#version 300 es
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec3 aShape;
layout(location = 2) in uvec2 aIds;
uniform vec4 uView;
uniform float uMpp, uDevPx, uEdgePx, uInnerScale, uMinPxScale;
uniform int uPass, uMaxRank, uCrossings;
uniform vec4 uOverride;
uniform highp sampler2D uColors;
out vec4 vColor; out vec2 vLocal; out float vAlong;
flat out float vLen; flat out float vHw; flat out uint vMeta; flat out float vFoot; flat out float vBase;
void main() {
  uint meta = aIds.y;
  int f = int(aIds.x), rank = int(meta & 15u);
  vColor = uOverride.a > 0.0 ? uOverride : texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
  float hw = 0.5 * max(aShape.x, aShape.y * uMinPxScale * uMpp);
  // Painted streets of 7 m and more: flagstone footways behind a kerb, drawn by the casing
  // pass (under every carriageway) so that junctions and bends stay one clean union; the
  // carriageway pass is narrowed by the footway. Shown once a footway spans 1.5 px.
#if VARIANT > 0
  float foot = rank <= 2 && (meta & 16u) == 0u && hw >= 3.5 ? clamp(0.22 * hw, 0.9, 2.0) : 0.0;
  if (foot < 1.5 * uMpp) foot = 0.0;
#else
  float foot = 0.0;
#endif
  vFoot = foot; vBase = hw;
  if (uPass == 0) hw += (meta & 256u) != 0u && uEdgePx > 0.0 ? max(1.2, 1.4 * uMpp) : uEdgePx * uMpp;
  else hw = (hw - foot) * uInnerScale;
  bool visible = vColor.a > 0.0 && (rank <= uMaxRank || ((meta & 16u) != 0u && uCrossings == 1));
  vec2 a = aSeg.xy, d = aSeg.zw - aSeg.xy;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0), n = vec2(-dir.y, dir.x);
  float pad = hw + uDevPx;
  float s0 = (meta & 32u) != 0u ? -uDevPx : -pad, s1 = (meta & 64u) != 0u ? len + uDevPx : len + pad;
  float s = mix(s0, s1, float(gl_VertexID & 1)), t = mix(-pad, pad, float(gl_VertexID >> 1));
  vLocal = vec2(s, t); vLen = len; vHw = hw; vMeta = meta; vAlong = aShape.z + s;
  gl_Position = visible ? vec4((a + dir * s + n * t) * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
/** Stroke shaders come in three variants (VARIANT, see strokeVariant): 0 = plain strokes
 * (walls, selection, unpainted palettes), 1 = painted street casing with footways,
 * 2 = painted street surface (setts, earth, gutters, verges, kerbs). Each pass then runs
 * only its own code: SwiftShader pays for every masked-off branch of a shared shader. */
const STROKE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vColor; in vec2 vLocal; in float vAlong;
flat in float vLen; flat in float vHw; flat in uint vMeta; flat in float vFoot; flat in float vBase;
uniform float uMpp, uDevPx;
uniform int uPass, uDashKind, uBridgeDeck;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float s = vLocal.x, t = abs(vLocal.y), d;
  vec3 color = vColor.rgb;
  float cover = 1.0;
  // Painted streets (render background), in street-local metres (along, across):
  // a warmer stone tone, setts on the main streets (joints only once a sett is >= 3 px),
  // packed earth with two ruts on lanes, and worn, slightly irregular edges.
#if VARIANT == 2
  if ((vMeta & 16u) == 0u) {
    float u = t / max(vHw, 1e-3), rank = float(vMeta & 15u);
    float footway = 0.0;
    vec2 p = vec2(vAlong, vLocal.y);
    color = mix(color, vec3(0.80, 0.70, 0.52), 0.35);
    if (rank <= 2.0) {
      vec2 g = p / vec2(1.25, 0.9); g.x += 0.5 * floor(g.y);
      vec2 fr = fract(g);
      float joint = min(min(fr.x, 1.0 - fr.x) * 1.25, min(fr.y, 1.0 - fr.y) * 0.9) / uMpp;
      float shown = smoothstep(2.5, 5.0, 0.9 / uMpp);
      color *= 1.0 - shown * (0.17 * (1.0 - smoothstep(0.3, 1.1, joint)) - 0.1 * (hash(floor(g)) - 0.5) - 0.06 * (vnoise(p / 3.1) - 0.5));
      color *= 1.04 - 0.08 * u * u;
      // Streets without footways: a central gutter once the street is a few pixels wide.
      if (vFoot <= 0.0 && vHw > 5.0 * uMpp) { float g = t / max(0.3, 0.8 * uMpp); color *= 1.0 - 0.14 * smoothstep(5.0, 9.0, vHw / uMpp) * exp(-g * g); }
      footway = vFoot;
    } else {
      color = mix(color, vec3(0.66, 0.54, 0.38), 0.4);
      float rut = exp(-pow((u - 0.45) / 0.13, 2.0)) * smoothstep(1.5, 4.0, vHw / uMpp);
      float grain = vnoise(p / 1.7);
      color *= (1.0 - 0.15 * rut) * (0.93 + 0.12 * grain);
      // Grassy verges along earth lanes once the lane is a few pixels wide.
      float verge = smoothstep(0.78, 0.98, u + 0.12 * (grain - 0.5)) * smoothstep(2.0, 4.0, vHw / uMpp);
      color = mix(color, vec3(0.56, 0.56, 0.37), 0.45 * verge);
    }
    // Footways: only their outer tenth wears into the casing (flagstone kerb band) beneath.
    float wear = smoothstep(footway > 0.0 ? 0.9 : 0.72, 1.0, u + 0.1 * (vnoise(vec2(vAlong * 0.7, vLocal.y > 0.0 ? 3.0 : 9.0)) - 0.5));
    // Worn edges let the casing (drawn under every street) show through; where another street
    // passes below, its own surface shows instead, so junctions stay clean.
    cover = 1.0 - 0.5 * wear;
  }
#endif
  // Stone deck (render background): light parapets, a dark kerb line inside them, a deck a
  // shade darker with transverse joints once they are at least 3 px apart.
#if VARIANT != 1
  if (uBridgeDeck == 1 && uPass == 1 && (vMeta & 400u) == 272u) {
    float parapet = max(0.9, 1.3 * uMpp), kerb = max(0.3, 0.7 * uMpp), joint = max(1.6, 3.0 * uMpp);
    float edge = vHw - t;
    color = edge < parapet ? mix(color, vec3(0.93, 0.89, 0.80), 0.35)
      : edge < parapet + kerb ? color * 0.42
      : color * (mod(vAlong, joint) < max(0.25, 0.8 * uMpp) ? 0.7 : 0.84);
  }
#endif
  // Footways (casing pass, under every street): flagstones with transverse joints inside the
  // street's edge, the casing colour beyond it; the narrowed carriageways (pass 1) cover
  // them, so footways are one union through bends and junctions. The kerb is a radial band at
  // the footway's inner edge (caps included): the carriageways cover it where streets meet,
  // so it stays continuous through bends and opens at junctions.
#if VARIANT == 1
  if (vFoot > 0.0) {
    float r = s < 0.0 ? length(vec2(s, t)) : s > vLen ? length(vec2(s - vLen, t)) : t;
    vec3 flag = vec3(0.85, 0.79, 0.67) * (mod(vAlong, 1.3) < max(0.1, 0.6 * uMpp) ? 0.9 : 1.0);
    float inner = vBase - vFoot;
    if (r < vBase) color = r < inner + min(max(0.25, 0.9 * uMpp), 0.5 * vFoot) ? flag * 0.6 : flag;
  }
#endif
  if (s < 0.0) d = (vMeta & 32u) != 0u ? max(t - vHw, -s) : length(vec2(s, t)) - vHw;
  else if (s > vLen) d = (vMeta & 64u) != 0u ? max(t - vHw, s - vLen) : length(vec2(s - vLen, t)) - vHw;
  else d = t - vHw;
  float a = clamp(0.5 - d / uDevPx, 0.0, 1.0);
  if (uPass == 0 && (vMeta & 128u) != 0u) {
    float on = uDashKind == 2 ? max(1.3, 2.0 * uMpp) : 4.0 * uMpp, off = uDashKind == 2 ? max(0.5, uMpp) : 2.0 * uMpp;
    if (mod(vAlong, on + off) > on) a = 0.0;
  }
  if (a <= 0.0) discard;
  outColor = vec4(color, 1.0) * (vColor.a * a * cover);
}`;
const DISC_VS = `#version 300 es
layout(location = 0) in vec2 aCenter;
uniform vec4 uView;
uniform float uRadius, uDevPx;
out vec2 vLocal;
void main() {
  vLocal = vec2(float(gl_VertexID & 1) * 2.0 - 1.0, float(gl_VertexID >> 1) * 2.0 - 1.0) * (uRadius + uDevPx);
  gl_Position = vec4((aCenter + vLocal) * uView.xy + uView.zw, 0.0, 1.0);
}`;
const DISC_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform float uRadius, uDevPx, uStroke;
uniform vec4 uFill, uEdge;
out vec4 outColor;
void main() {
  float d = length(vLocal) - uRadius, a = clamp(0.5 - d / uDevPx, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec4 c = mix(uEdge, uFill, clamp(0.5 - (d + uStroke) / uDevPx, 0.0, 1.0));
  outColor = vec4(c.rgb, 1.0) * (c.a * a);
}`;

const strokeVariant = (source: string, variant: 0 | 1 | 2): string => source.replace(/^#version 300 es\n/, `#version 300 es\n#define VARIANT ${variant}\n`);
// ---------------------------------------------------------------- GL helpers
type Uniforms = Record<string, WebGLUniformLocation | null>;
interface Program { program: WebGLProgram; u: Uniforms }
function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`cityGl shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`cityGl link: ${gl.getProgramInfoLog(program)}`);
  const u: Uniforms = {}, n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(program, i)!; u[info.name] = gl.getUniformLocation(program, info.name); }
  return { program, u };
}
const TEX_W = 4096;
function uploadTable(gl: WebGL2RenderingContext, texture: WebGLTexture, rgba: Uint8Array): void {
  const rows = Math.max(1, Math.ceil(rgba.length / 4 / TEX_W)), data = rgba.length === rows * TEX_W * 4 ? rgba : new Uint8Array(rows * TEX_W * 4);
  if (data !== rgba) data.set(rgba);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

/** A fill mesh on the GPU: shared vertices, one VAO for triangles, one for lines, two colour tables. */
class FillPack {
  vbo: WebGLBuffer[] = []; tri: WebGLVertexArrayObject; line: WebGLVertexArrayObject; fill: WebGLTexture; edge: WebGLTexture; bytes: number;
  constructor(private gl: WebGL2RenderingContext, readonly mesh: CityGlFillMesh) {
    const buffer = (target: number, data: ArrayBufferView): WebGLBuffer => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); this.vbo.push(b); return b; };
    const pos = buffer(gl.ARRAY_BUFFER, mesh.positions), feat = buffer(gl.ARRAY_BUFFER, mesh.vertexFeatures);
    const vao = (indices: Uint32Array): WebGLVertexArrayObject => {
      const v = gl.createVertexArray()!; gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, feat); gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
      buffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bindVertexArray(null); return v;
    };
    this.tri = vao(mesh.triangles); this.line = vao(mesh.lines);
    this.fill = gl.createTexture()!; this.edge = gl.createTexture()!;
    this.bytes = mesh.positions.byteLength + mesh.vertexFeatures.byteLength + mesh.triangles.byteLength + mesh.lines.byteLength + Math.ceil(mesh.featureCount / TEX_W) * TEX_W * 8;
  }
  colors(fill: Uint8Array, edge: Uint8Array): void { uploadTable(this.gl, this.fill, fill); uploadTable(this.gl, this.edge, edge); }
  dispose(): void { const gl = this.gl; this.vbo.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(this.tri); gl.deleteVertexArray(this.line); gl.deleteTexture(this.fill); gl.deleteTexture(this.edge); }
}
/** Segment instances on the GPU (36-byte stride), with outer/inner colour tables. */
class StrokePack {
  vbo: WebGLBuffer; vao: WebGLVertexArrayObject; outer: WebGLTexture; inner: WebGLTexture; bytes: number;
  constructor(private gl: WebGL2RenderingContext, readonly strokes: CityGlStrokes, dynamic = false) {
    this.vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, strokes.data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!; this.bind(0);
    this.outer = gl.createTexture()!; this.inner = gl.createTexture()!;
    this.bytes = strokes.data.byteLength;
  }
  /** Attribute pointers from instance `first` (WebGL2 has no base instance). */
  bind(first: number): void {
    const gl = this.gl, stride = STROKE_STRIDE * 4, o = first * stride;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, o); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, o + 16); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, stride, o + 28); gl.vertexAttribDivisor(2, 1);
  }
  colors(outer: Uint8Array, inner: Uint8Array): void { uploadTable(this.gl, this.outer, outer); uploadTable(this.gl, this.inner, inner); }
  dispose(): void { const gl = this.gl; gl.deleteBuffer(this.vbo); gl.deleteVertexArray(this.vao); gl.deleteTexture(this.outer); gl.deleteTexture(this.inner); }
}

// ---------------------------------------------------------------- triangulation pool
class Triangulator {
  private workers: Worker[] = []; private next = 1;
  private pending = new Map<number, (r: CityGlTriangulation) => void>();
  private broken = false;
  private pool(n: number): Worker[] {
    if (this.broken || typeof Worker === 'undefined' || n <= 0) return [];
    try {
      while (this.workers.length < n) {
        const w = new Worker(new URL('./cityGlWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<CityGlTriangulation & { id: number }>) => { const done = this.pending.get(e.data.id); this.pending.delete(e.data.id); done?.(e.data); };
        w.onerror = () => { this.broken = true; };
        this.workers.push(w);
      }
    } catch { this.broken = true; return []; }
    return this.workers.slice(0, n);
  }
  /** Parallel when the packing is large and workers are available; otherwise on this thread. */
  async run(source: CityGlFillSource, workers: number): Promise<{ result: CityGlTriangulation; workers: number }> {
    const p = source.polygons, polys = p.polys.length - 1;
    const pool = polys > 3000 ? this.pool(workers) : [];
    if (!pool.length) return { result: triangulatePolygons(p), workers: 0 };
    const ranges = splitPolygons(p, pool.length);
    try {
      const parts = await Promise.all(ranges.map(([from, to], k) => {
        const slice = slicePolygons(p, from, to), id = this.next++;
        return new Promise<{ result: CityGlTriangulation; vertexOffset: number }>((resolve, reject) => {
          const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('cityGl worker timeout')); }, 60000);
          this.pending.set(id, r => { clearTimeout(timer); resolve({ result: r, vertexOffset: slice.vertexOffset }); });
          pool[k].postMessage({ id, coords: slice.coords, rings: slice.rings, polys: slice.polys }, [slice.coords.buffer, slice.rings.buffer, slice.polys.buffer]);
        });
      }));
      return { result: mergeTriangulations(parts), workers: pool.length };
    } catch { this.broken = true; return { result: triangulatePolygons(p), workers: 0 }; }
  }
  dispose(): void { this.workers.forEach(w => w.terminate()); this.workers = []; this.pending.clear(); }
}

// ---------------------------------------------------------------- renderer
const defaultWorkers = (): number => Math.max(0, Math.min(4, ((globalThis.navigator?.hardwareConcurrency ?? 2) >> 1) - 1));

/** Software rasterizers (SwiftShader, llvmpipe, WARP): measured 2–10× slower than
 * Canvas 2D for this plan, so the host should keep Canvas 2D there. */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft warp|software/i;
export interface CityGlCreateOptions {
  /** Accept a software WebGL (default false: throws, so the host falls back to Canvas 2D). */
  allowSoftware?: boolean;
  /** Multisampled default framebuffer (default true). */
  antialias?: boolean;
  /** Ask the host to repaint after context changes or an accepted GPU import. */
  onInvalidate?: () => void;
}
export function createCityGlRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, create: CityGlCreateOptions = {}): CityGlRenderer {
  const maybe = canvas.getContext('webgl2', { antialias: create.antialias ?? true, premultipliedAlpha: true, alpha: true, depth: false, stencil: false, preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: !create.allowSoftware }) as WebGL2RenderingContext | null;
  if (!maybe) throw new Error(create.allowSoftware ? 'WebGL2 indisponible' : 'WebGL2 matériel indisponible');
  const gl: WebGL2RenderingContext = maybe;
  if (!create.allowSoftware) {
    const info = gl.getExtension('WEBGL_debug_renderer_info'), name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    if (SOFTWARE_GL.test(name)) { gl.getExtension('WEBGL_lose_context')?.loseContext(); throw new Error(`WebGL2 logiciel (${name})`); }
  }
  let fillP: Program, strokeP: Program, casingP: Program, surfaceP: Program, discP: Program, pavedP: Program;
  let plan: FillPack | undefined, built: FillPack | undefined, streets: StrokePack | undefined, walls: StrokePack | undefined, selection: StrokePack | undefined;
  let towers: { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number } | undefined;
  let scene: CityScene | undefined, buildings: CityBuildings | undefined, origin: Point = { x: 0, y: 0 };
  let planMesh: CityGlFillMesh | undefined, builtMesh: CityGlFillMesh | undefined, streetData: CityGlStrokes | undefined, wallData: CityGlStrokes | undefined, towerData: Float32Array | undefined;
  let styleKey = '', streetKey = '', builtKey = '', draws: CityGlDraws | undefined, towerColors: [string, string] = ['#5a5248', '#2f2a24'];
  let selectionKey = '', lastLod: CityLod | undefined, generation = 0, buildingGeneration = 0, lost = false, disposed = false, lastFrame: CityGlFrame | undefined;
  let buildStats: CityGlBuildStats | undefined, buildingStats: CityGlBuildStats | undefined;
  const triangulator = new Triangulator();

  let wallGl: CityGlWalls; // walls hook: detailed fortifications (cityWalls.ts)
  function init(): void {
    fillP = compile(gl, FILL_VS, FILL_FS); strokeP = compile(gl, strokeVariant(STROKE_VS, 0), strokeVariant(STROKE_FS, 0));
    casingP = compile(gl, strokeVariant(STROKE_VS, 1), strokeVariant(STROKE_FS, 1)); surfaceP = compile(gl, strokeVariant(STROKE_VS, 2), strokeVariant(STROKE_FS, 2)); discP = compile(gl, DISC_VS, DISC_FS); pavedP = compile(gl, PAVED_VS, PAVED_FS);
    wallGl = createCityGlWalls(gl); // walls hook
  }
  init();
  function uploadPlan(): number {
    const t = performance.now();
    plan?.dispose(); streets?.dispose(); walls?.dispose();
    if (towers) { gl.deleteBuffer(towers.vbo); gl.deleteVertexArray(towers.vao); towers = undefined; }
    plan = planMesh && new FillPack(gl, planMesh);
    wallGl.upload(scene, origin); // walls hook
    streets = streetData && new StrokePack(gl, streetData); walls = wallData && new StrokePack(gl, wallData);
    if (towerData) {
      const vbo = gl.createBuffer()!, vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, towerData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 1); gl.bindVertexArray(null);
      towers = { vbo, vao, count: towerData.length / 2 };
    }
    styleKey = streetKey = selectionKey = '';
    return performance.now() - t;
  }
  function uploadBuildings(): number {
    const t = performance.now();
    built?.dispose(); built = builtMesh && new FillPack(gl, builtMesh); builtKey = '';
    return performance.now() - t;
  }
  const invalidate = (): void => { if (!disposed) create.onInvalidate?.(); };
  const onLost = (e: Event): void => { e.preventDefault(); lost = true; invalidate(); };
  const onRestored = (): void => {
    // Old GL objects are invalid after restoration. Keep Canvas active until
    // programmes and the latest retained CPU meshes have all been reuploaded.
    lost = true; plan = built = streets = walls = selection = undefined; towers = undefined;
    try { init(); uploadPlan(); uploadBuildings(); lost = false; }
    catch (error) { console.warn('Restauration WebGL de la ville indisponible, Canvas 2D utilisé', error); }
    finally { invalidate(); }
  };
  canvas.addEventListener('webglcontextlost', onLost as EventListener);
  canvas.addEventListener('webglcontextrestored', onRestored as EventListener);

  async function buildFill(source: CityGlFillSource, workers: number): Promise<{ mesh: CityGlFillMesh; triangulateMs: number; assembleMs: number; workers: number }> {
    let t = performance.now();
    const { result, workers: used } = await triangulator.run(source, workers);
    const triangulateMs = performance.now() - t; t = performance.now();
    return { mesh: fillMesh(source, result), triangulateMs, assembleMs: performance.now() - t, workers: used };
  }

  const renderer: CityGlRenderer = {
    canvas, gl,
    get ready() { return !disposed && !lost && !gl.isContextLost() && !!scene && !!plan; },
    async setScene(next, nextBuildings, options = {}) {
      const gen = ++generation, start = performance.now(), workers = options.workers ?? defaultWorkers();
      let t = performance.now();
      const o = cityOrigin(next), planSource = packPlan(next, o), sd = buildStreetStrokes(next, o), wd = cityWallStrokes(next, o), td = buildTowers(cityLegacyWalls(next), o); // walls hook
      const builtSource = nextBuildings ? packBuildings(nextBuildings, o) : undefined;
      const packMs = performance.now() - t;
      const [p, b] = await Promise.all([buildFill(planSource, workers), builtSource && buildFill(builtSource, workers)]);
      if (gen !== generation) return { packMs, triangulateMs: p.triangulateMs, assembleMs: p.assembleMs, uploadMs: 0, workers: p.workers, totalMs: performance.now() - start };
      scene = next; origin = o; planMesh = p.mesh; streetData = sd; wallData = wd; towerData = td;
      buildings = nextBuildings; builtMesh = b?.mesh; buildingGeneration++;
      const uploadMs = lost || gl.isContextLost() ? 0 : uploadPlan() + uploadBuildings();
      buildStats = { packMs, triangulateMs: p.triangulateMs + (b?.triangulateMs ?? 0), assembleMs: p.assembleMs + (b?.assembleMs ?? 0), uploadMs, workers: p.workers, totalMs: performance.now() - start };
      invalidate();
      return buildStats;
    },
    async setBuildings(next, options = {}) {
      const gen = ++buildingGeneration, start = performance.now(), workers = options.workers ?? defaultWorkers();
      let t = performance.now();
      const source = next && packBuildings(next, origin), packMs = performance.now() - t;
      t = performance.now();
      const b = source && await buildFill(source, workers);
      if (gen !== buildingGeneration) return { packMs, triangulateMs: b?.triangulateMs ?? 0, assembleMs: b?.assembleMs ?? 0, uploadMs: 0, workers: b?.workers ?? 0, totalMs: performance.now() - start };
      buildings = next; builtMesh = b?.mesh;
      const uploadMs = lost || gl.isContextLost() ? 0 : uploadBuildings();
      buildingStats = { packMs, triangulateMs: b?.triangulateMs ?? 0, assembleMs: b?.assembleMs ?? 0, uploadMs, workers: b?.workers ?? 0, totalMs: performance.now() - start };
      invalidate();
      return buildingStats;
    },
    draw(o) {
      const start = performance.now(), mpp = o.metresPerPixel;
      const lod = o.lod ?? selectCityLod(mpp, lastLod); lastLod = lod;
      const frame: CityGlFrame = { lod, drawCalls: 0, instances: 0, triangles: 0, cpuMs: 0 };
      if (!renderer.ready) { frame.cpuMs = performance.now() - start; lastFrame = frame; return frame; }
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      gl.viewport(0, 0, W, H);
      const c = o.clear ?? [0, 0, 0, 0];
      gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!scene || !plan) return frame;
      const palette = o.palette ?? 'growth', layers = { ...DEFAULT_LAYERS, ...o.layers };
      const renderBackground = globalThis.document?.documentElement.dataset.cityBackground === 'render', painted = o.paintedBuildings ?? renderBackground;
      const style: CityGlStyleState = { view: o.view, lod, palette, layers, buildingsVisible: o.buildingsVisible ?? true, diagnostic: o.diagnostic ?? 'none', refusedParcels: o.refusedParcels, painted };
      // Colour tables: rebuilt only when the state changes.
      const key = JSON.stringify([o.view, lod, palette, layers, style.buildingsVisible, refusedKey(o.refusedParcels), painted]);
      if (key !== styleKey) { const pc = planColors(scene, plan.mesh, style); plan.colors(pc.fill, pc.line); draws = pc.draws; styleKey = key; }
      if (palette !== streetKey) {
        const sc = streetColors(scene, palette), wc = cityWallColors(scene, palette); // walls hook
        streets?.colors(sc.outer, sc.inner); walls?.colors(wc.outer, wc.inner); towerColors = wc.tower; streetKey = palette;
      }
      const bKey = `${o.view}|${palette}|${style.diagnostic}|${buildingGeneration}|${painted}`;
      if (built && bKey !== builtKey) { const bc = buildingColors(buildings, style, scene); built.colors(bc.fill, bc.line); builtKey = bKey; }
      const d = draws!;
      const v = o.viewport, sx = 2 / (v.maxX - v.minX), sy = -2 / (v.maxY - v.minY);
      const view = [sx, sy, -1 - (v.minX - origin.x) * sx, 1 - (v.minY - origin.y) * sy];
      const devPx = (v.maxX - v.minX) / Math.max(1, W);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0);

      // Fills and outlines.
      gl.useProgram(fillP.program); gl.uniform4fv(fillP.u.uView, view); gl.uniform1i(fillP.u.uColors, 0); gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
      const fills = (pack: FillPack | undefined, layer: string, lines: boolean): void => {
        const l = pack?.mesh.layers[layer];
        if (!pack || !l || !(lines ? l.lines : l.triangles).count) return;
        gl.bindTexture(gl.TEXTURE_2D, lines ? pack.edge : pack.fill); gl.bindVertexArray(lines ? pack.line : pack.tri);
        // Only the grid chunks in view (consecutive ones merged into one call).
        for (const [first, count] of visibleRanges(l.chunks, v, c => lines ? c.lines : c.triangles)) {
          gl.drawElements(lines ? gl.LINES : gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
          frame.drawCalls++; if (!lines) frame.triangles += count / 3;
        }
      };
      if (lod === 'far') { if (d.footprint) fills(plan, 'footprint', false); if (d.footprintLines) fills(plan, 'footprint', true); }
      else {
        if (d.blocks) fills(plan, 'blocks', false); if (d.blockLines) fills(plan, 'blocks', true);
        if (d.parcels) fills(plan, 'parcels', false); if (d.parcelLines) fills(plan, 'parcels', true);
        if (d.paved && mpp < 0.3) { // setts appear below 0.3 m/px (PAVED_FS `shown`)
          gl.useProgram(pavedP.program); gl.uniform4fv(pavedP.u.uView, view); gl.uniform1i(pavedP.u.uColors, 0); gl.uniform1f(pavedP.u.uMpp, mpp);
          fills(plan, 'blocks', false); fills(plan, 'parcels', false);
          gl.useProgram(fillP.program);
        }
      }
      const wallDraw = { view, mpp, lod, palette, painted: renderBackground && palette !== 'parchment' && palette !== 'ink', enabled: layers.enclosures }; // walls hook
      frame.drawCalls += wallGl.draw('ground', wallDraw); // walls hook: ditches and glacis under the streets
      // Strokes: streets (casing then fill), walls (outer then inner line).
      let u = strokeP.u;
      const useStroke = (prog: Program): void => {
        gl.useProgram(prog.program); u = prog.u;
        gl.uniform4fv(u.uView, view); gl.uniform1i(u.uColors, 0); gl.uniform1f(u.uMpp, mpp); gl.uniform1f(u.uDevPx, devPx); gl.uniform4f(u.uOverride, 0, 0, 0, 0);
      };
      useStroke(strokeP);
      const strokes = (pack: StrokePack | undefined, first: number, pass: 0 | 1, p: { edgePx: number; inner: number; minPx: number; maxRank: number; crossings: boolean; dash: number }): void => {
        if (!pack || pack.strokes.count - first <= 0) return;
        const ranges = pack.strokes.chunks ? visibleRanges(pack.strokes.chunks, v, c => ({ start: c.first, count: c.count }), 8 * mpp, first) : [[first, pack.strokes.count - first]];
        if (!ranges.length) return;
        gl.bindTexture(gl.TEXTURE_2D, pass === 1 ? pack.inner : pack.outer);
        gl.uniform1i(u.uPass, pass); gl.uniform1f(u.uEdgePx, p.edgePx); gl.uniform1f(u.uInnerScale, p.inner); gl.uniform1f(u.uMinPxScale, p.minPx);
        gl.uniform1i(u.uMaxRank, p.maxRank); gl.uniform1i(u.uCrossings, p.crossings ? 1 : 0); gl.uniform1i(u.uDashKind, p.dash);
        for (const [start, count] of ranges) { pack.bind(start); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); frame.drawCalls++; frame.instances += count; }
      };
      if (d.streets && streets) {
        const maxRank = lod === 'far' ? 1 : lod === 'mid' ? 2 : 15, crossings = lod !== 'far';
        const first = Math.min(streets.strokes.firstWithRank[maxRank], crossings ? streets.strokes.firstWithRank[0] : Infinity);
        const s = { edgePx: lod === 'mid' ? 0.7 : 0.9, inner: 1, minPx: 1, maxRank, crossings, dash: 1 };
        const paintRoads = renderBackground && palette !== 'parchment' && palette !== 'ink';
        if (paintRoads) useStroke(casingP);
        if (d.streetCasing) strokes(streets, first, 0, s);
        if (paintRoads) useStroke(surfaceP);
        gl.uniform1i(u.uBridgeDeck, (o.bridgeDeck ?? renderBackground) ? 1 : 0);
        strokes(streets, first, 1, s);
        gl.uniform1i(u.uBridgeDeck, 0);
      }
      frame.drawCalls += wallGl.draw('shadow', wallDraw); useStroke(strokeP); // walls hook: painted wall shadows
      if (d.walls && walls) {
        const s = { edgePx: 0, inner: 0.45, minPx: lod === 'far' ? 1.6 / 2.4 : 1, maxRank: 15, crossings: false, dash: 2 };
        strokes(walls, 0, 0, s); if (d.wallInner) strokes(walls, 0, 1, s);
      }
      if (d.towers && towers?.count) {
        gl.useProgram(discP.program);
        const thick = Math.max(3.5, 2.4 * mpp), radius = Math.max(thick * 0.95, 2.2 * mpp);
        gl.uniform4fv(discP.u.uView, view); gl.uniform1f(discP.u.uRadius, radius); gl.uniform1f(discP.u.uDevPx, devPx); gl.uniform1f(discP.u.uStroke, 0.6 * mpp);
        gl.uniform4fv(discP.u.uFill, rgba01(towerColors[0])); gl.uniform4fv(discP.u.uEdge, rgba01(towerColors[1]));
        gl.bindVertexArray(towers.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, towers.count); frame.drawCalls++; frame.instances += towers.count;
      }
      frame.drawCalls += wallGl.draw('works', wallDraw); // walls hook: outworks, towers, gatehouses, lean-tos
      // Buildings above the streets (as in drawCity).
      if (d.buildings && built) {
        gl.useProgram(fillP.program);
        const pans = !!built.mesh.layers.roofs?.triangles.count;
        if (pans && palette !== 'parchment') {
          // Massing shadows: each piece's outline swept by its own height (cityMassing.ts).
          gl.uniform4fv(fillP.u.uTint, PAINTED_SHADOW);
          fills(built, 'shadows', false);
          gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
        } else if (painted && palette !== 'parchment') {
          // Ground shadow: the same triangles, shifted south-east (metres, with a 1 px floor).
          const dx = Math.max(1.6, 1.1 * mpp), dy = 0.8 * dx;
          gl.uniform4fv(fillP.u.uView, [view[0], view[1], view[2] + dx * view[0], view[3] + dy * view[1]]);
          gl.uniform4fv(fillP.u.uTint, PAINTED_SHADOW); // straight RGBA: FILL_FS premultiplies
          fills(built, 'buildings', false);
          gl.uniform4fv(fillP.u.uView, view); gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
        }
        fills(built, 'buildings', false);
        if (pans) { fills(built, 'roofs', false); if (lod === 'close') fills(built, 'roofs', true); }
        if (d.buildingLines) fills(built, 'buildings', true);
      }
      // Selection: a 2 px outline built on demand (a few segments).
      const selKey = `${o.selectedId ?? ''}|${o.selectedParcel ?? ''}|${generation}|${buildingGeneration}`;
      if (selKey !== selectionKey) { selection?.dispose(); selection = selectionStrokes(o); selectionKey = selKey; }
      if (selection) {
        useStroke(strokeP); gl.uniform4fv(u.uOverride, rgba01('#197ea4'));
        strokes(selection, 0, 1, { edgePx: 0, inner: 1, minPx: 1, maxRank: 15, crossings: true, dash: 0 });
        gl.uniform4f(u.uOverride, 0, 0, 0, 0);
      }
      gl.bindVertexArray(null);
      frame.cpuMs = performance.now() - start; lastFrame = frame;
      return frame;
    },
    pick(point, o) {
      if (!scene) return {};
      const lod = o?.lod ?? (o?.metresPerPixel ? selectCityLod(o.metresPerPixel, lastLod) : lastLod ?? 'near');
      const showBuildings = (o?.buildingsVisible ?? true) && (lod === 'near' || lod === 'close') && (!o?.view || o.view === 'buildings' || o.view === 'roles');
      return cityGlPick(scene, showBuildings ? buildings : undefined, point);
    },
    resize(width, height) {
      const el = canvas as HTMLCanvasElement, dpr = globalThis.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(width ?? (el.clientWidth || canvas.width / dpr) * dpr)), h = Math.max(1, Math.round(height ?? (el.clientHeight || canvas.height / dpr) * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },
    stats() {
      const fs = (m?: CityGlFillMesh) => m && { vertices: m.positions.length / 2, triangles: m.triangles.length / 3, edges: m.lines.length / 2, features: m.featureCount };
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        plan: fs(planMesh), buildings: fs(builtMesh), streets: streetData?.count ?? 0, walls: wallData?.count ?? 0, towers: (towerData?.length ?? 0) / 2,
        gpuBytes: (plan?.bytes ?? 0) + (built?.bytes ?? 0) + (streets?.bytes ?? 0) + (walls?.bytes ?? 0) + (towerData?.byteLength ?? 0),
        build: buildStats, buildingsBuild: buildingStats, frame: lastFrame,
        renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      };
    },
    dispose() {
      disposed = true;
      generation++; buildingGeneration++;
      triangulator.dispose();
      plan?.dispose(); built?.dispose(); streets?.dispose(); walls?.dispose(); selection?.dispose();
      if (towers) { gl.deleteBuffer(towers.vbo); gl.deleteVertexArray(towers.vao); }
      gl.deleteProgram(fillP.program); gl.deleteProgram(strokeP.program); gl.deleteProgram(casingP.program); gl.deleteProgram(surfaceP.program); gl.deleteProgram(discP.program); gl.deleteProgram(pavedP.program);
      wallGl.dispose(); // walls hook
      canvas.removeEventListener('webglcontextlost', onLost as EventListener); canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
      plan = built = streets = walls = selection = undefined; towers = undefined; scene = undefined; buildings = undefined; planMesh = builtMesh = undefined;
    },
  };

  function selectionStrokes(o: CityGlDrawOptions): StrokePack | undefined {
    if (!scene) return undefined;
    const b = o.selectedId === undefined ? undefined : buildings?.byId.get(o.selectedId);
    const parcel = o.selectedParcel ?? (o.selectedId === undefined ? undefined : scene.parcelById.get(o.selectedId));
    const shapes = b !== undefined ? buildings!.items[b].surface : parcel !== undefined && scene.parcels[parcel] ? [scene.parcels[parcel].shape] : [];
    const rings = shapes.flatMap(s => [s.outer, ...(s.holes ?? [])]).filter(r => r.length >= 2);
    if (!rings.length) return undefined;
    const n = rings.reduce((s, r) => s + r.length, 0), buffer = new ArrayBuffer(n * STROKE_STRIDE * 4), f = new Float32Array(buffer), u32 = new Uint32Array(buffer);
    let k = 0;
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length], j = k++ * STROKE_STRIDE;
      f[j] = a.x - origin.x; f[j + 1] = a.y - origin.y; f[j + 2] = c.x - origin.x; f[j + 3] = c.y - origin.y; f[j + 4] = 0; f[j + 5] = 2; f[j + 6] = 0; u32[j + 7] = 0; u32[j + 8] = 0;
    }
    return new StrokePack(gl, { data: buffer, count: k, firstWithRank: [] }, true);
  }
  return renderer;
}

const refusedIds = new WeakMap<ReadonlySet<string>, number>(); let refusedNext = 1;
function refusedKey(set?: ReadonlySet<string>): string {
  if (!set?.size) return '';
  let id = refusedIds.get(set); if (!id) { id = refusedNext++; refusedIds.set(set, id); }
  return `${id}:${set.size}`;
}

/** Topmost visible item under a world point (building, then parcel, then block), with its id. */
export function cityGlPick(scene: CityScene, buildings: CityBuildings | undefined, point: Point): CityGlPick {
  const hit: CityGlPick = pickCity(scene, buildings, point);
  if (hit.building) { hit.kind = 'building'; hit.id = hit.building.id; }
  else if (hit.parcel) { hit.kind = 'parcel'; hit.id = hit.parcel.id; }
  else if (hit.block) hit.kind = 'block';
  return hit;
}

/** Synchronous mesh of a scene (tests, tools): the plan fill mesh. */
export const cityGlPlanMesh = (scene: CityScene): CityGlFillMesh => buildFillMeshSync(packPlan(scene));
