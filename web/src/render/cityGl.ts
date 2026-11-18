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
  buildFillMeshSync,
  buildStreetStrokes,
  buildTowers,
  buildWallStrokes,
  cityOrigin,
  fillMesh,
  mergeTriangulations,
  packBuildings,
  packPlan,
  META,
  packBuildingsSteps,
  packPlanSteps,
  runSteps,
  slicePolygons,
  splitPolygons,
  STROKE_STRIDE,
  triangulatePolygons,
  visibleRanges,
  type CityGlFillMesh,
  type CityGlFillSource,
  type CityGlStrokes,
  type CityGlTriangulation,
} from './cityGlBuild';
import {
  buildingColors,
  buildingColorsSteps,
  DEFAULT_LAYERS,
  liveShadowTint,
  PAINTED_SHADOW,
  PARCHMENT_SHADOW,
  planColors,
  planColorsSteps,
  planMaterialTable,
  rgba01,
  roofMaterialTable,
  streetColors,
  streetColorsSteps,
  streetMaterialTable,
  wallColors,
  type CityGlDraws,
  type CityGlLiveLook,
  type CityGlStyleState,
} from './cityGlStyle';
import { PAN_EDGE, PARCHMENT_HATCH, RIM_DEVICE_MPP, SELECTION, WALL_CORE, buildingEdgePx, canalBridgeEdgePx, farTownBuildingsShown, planLineWidthPx, streetEdgePx, streetMaxRank, wallLook, wallMinPx, type StreetMode } from './city/look';
import { groundRoadLook } from './composition';
import { buildYardStrokes, yardColors } from './cityGlYards';
import { grainLevelMeans } from './cityGlGrain';
import { coverGrainFrame } from './buildingMaterials';
import type { YardBoundary } from './cityLotEnclosures';
import { isBlended } from './groundBlend';
import { roofSeasonKey } from './seasonPalette';
import { toneKey } from './groundTone';
import { RUIN_INK, RUIN_PAPER } from './cityRuins';
import { MATERIALS, loadMaterialImages, uploadMaterialArrays } from './buildingMaterials';
import { cityLegacyWalls, cityWallColors, cityWallStrokes, createCityGlWalls, type CityGlWalls } from './cityWalls'; // walls hook (cityWalls.ts)

export interface CityGlDrawOptions {
  viewport: Box;
  metresPerPixel: number;
  view: CityView;
  /** Level of detail; chosen from metresPerPixel (with hysteresis) when omitted. */
  lod?: CityLod;
  palette?: CityPalette;
  layers?: Partial<CityLayers>;
  /** Building id or parcel id to outline. */
  selectedId?: string;
  selectedParcel?: number;
  /** Flat footprint rendering skips roof faces, textures and shadows at every zoom. */
  buildingStyle?: 'geometric' | 'cartographic' | 'silhouette';
  buildingsVisible?: boolean;
  diagnostic?: 'none' | 'uses' | string;
  refusedParcels?: ReadonlySet<string>;
  /** Clear colour (straight RGBA 0–1); transparent by default so the map shows through. */
  clear?: [number, number, number, number];
  /** Bridge parapets, kerbs and deck joints; enabled by default at every LOD. */
  bridgeDeck?: boolean;
  /** Painted building silhouettes (tints, ground shadows, edges). Default: Render background. */
  paintedBuildings?: boolean;
  /** Blended ground and streets (groundBlend.ts). Default: the shared setting. */
  groundBlend?: boolean;
  /** Textured materials: roofs, streets and plazas sample the PBR albedo atlas in world metres. */
  textured?: boolean;
  /** Custom display colours (road, roadEdge, track, building, buildingEdge). */
  colors?: import('./customColors').RenderColors;
  /** The drawn rivers under the plan, in the terrain renderer's layout (`riverSegments`: x0, y0, x1, y1, w0, w1
   * and a colour per segment, map metres, full widths). Where they run, the town ground (blocks, parcels) and
   * its streets are not drawn: the river shows above them. Bridges and fords (crossing strokes), quays and
   * landings, walls and buildings are drawn as before, above the water. */
  water?: Float32Array;
  /** Shared context (live compositor): the framebuffer and its size in device pixels. The draw binds it, sets every
   * state it relies on and clears nothing; without it the draw clears and fills the renderer's own canvas. */
  target?: { framebuffer: WebGLFramebuffer | null; width: number; height: number };
  /** Live look (render/live/cityLayer.ts): the GL stand-in of the looks only Canvas 2D paints exactly (natural roads and
   * roof pans, hidden snow patches, the cast shadow tint of the Canvas path); no render background. */
  live?: CityGlLiveLook;
}
export interface CityGlFrame {
  lod: CityLod;
  drawCalls: number;
  instances: number;
  triangles: number;
  cpuMs: number;
}
export interface CityGlBuildStats {
  packMs: number;
  triangulateMs: number;
  assembleMs: number;
  uploadMs: number;
  workers: number;
  totalMs: number;
}
export interface CityGlStats {
  plan?: { vertices: number; triangles: number; edges: number; features: number };
  buildings?: { vertices: number; triangles: number; edges: number; features: number };
  streets: number;
  walls: number;
  towers: number;
  gpuBytes: number;
  build?: CityGlBuildStats;
  buildingsBuild?: CityGlBuildStats;
  frame?: CityGlFrame;
  renderer: string;
}
export interface CityGlPick extends CityPick {
  id?: string;
  kind?: 'building' | 'parcel' | 'block';
}
export interface CityGlSetOptions {
  /** Triangulation workers (0 = on this thread). Default: up to 4. */ workers?: number;
}
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
/** A cityGl renderer bound to a context it does not own (createCityGlRendererOn): no canvas, no resize, no context
 * events (the owner disposes it when the context is lost). Meshes are built by setScene / setBuildings and uploaded by
 * `upload`, which the owner calls between frames; colour tables are built by `prepare`, so a draw only binds them. */
export interface CityGlSharedRenderer extends Omit<CityGlRenderer, 'canvas' | 'resize'> {
  /** Uploads the meshes built since the last call (scene first, then buildings); true when it uploaded something. */
  upload(): boolean;
  /** Built meshes wait for `upload`. */
  readonly pendingUpload: boolean;
  /** Links the programs without blocking (KHR_parallel_shader_compile, polled; else one program per call); true while
   * some remain. Nothing draws, uploads or reports `ready` before they are all linked. */
  programsStep(): boolean;
  readonly programsLinked: boolean;
  /** What a draw with these options would have to create on the GPU first ('' when nothing: the draw only binds and
   * draws). The owner shows a stand-in and prepares the state in its work instead. */
  check(options: CityGlDrawOptions): string;
  /** `prepare` in resumable steps: the colour tables not kept yet are computed a slice at a time (a pass over every
   * block, parcel, building, pan and street), then the state is completed at once. Run it to its end before drawing
   * that state, or the draw computes what is missing. */
  prepareSteps(options: CityGlDrawOptions): Generator<void, void>;
  /** Lot enclosures of the live look (each list a town's `scene.lotEnclosures`), relative to the uploaded scene; set
   * again after each new scene. Drawn when `layers.lotEnclosures` is not false, from the mid level, as drawLotEnclosures. */
  setYards(lists: readonly (readonly YardBoundary[] | undefined)[]): void;
  /** setScene / setBuildings pack their polygons in slices (never in one long task): `step` advances them for about
   * `budgetMs` and returns true while packing remains. Triangulation then runs on the workers as before. */
  step(budgetMs: number): boolean;
  readonly packing: boolean;
  /** Builds and uploads what a draw with these options needs (colour tables, street strokes, water), without drawing. */
  prepare(options: CityGlDrawOptions): void;
}

/** Layers left for the Canvas 2D overlay (drawCity) once the GPU draws the plan:
 * diagnostics, landmark glyphs, labels and district names only. */
export function cityGlOverlayLayers(layers: CityLayers): CityLayers {
  return { ...layers, waterways: layers.waterways !== false, blocks: false, domains: false, streets: false, enclosures: false, parcels: false, gardens: false, places: false };
}

// ---------------------------------------------------------------- shaders
const FILL_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors;
uniform vec4 uTint;
// Live roof pans (cityGlGrain.ts): the mean tone of the Canvas grain, uneven snow mantle and wall rims of each pan
// (uGrainTab: family, gain, snow strength, flags; uRimTab: rim colour), with the frame's grain strength and level means.
uniform int uRoofGrain, uRims;
uniform highp sampler2D uGrainTab, uRimTab;
uniform float uGrainStrength;
uniform vec2 uGrain[18];
uniform vec4 uSnowMean[2];
out vec4 vColor;
out vec2 vPos;
void main() {
  vPos = aPos;
  int f = int(aFeature);
  ivec2 q = ivec2(f & 4095, f >> 12);
  vColor = texelFetch(uColors, q, 0);
  bool shown = vColor.a > 0.0;
  if (uRoofGrain == 1 && shown) {
    vec4 g = floor(texelFetch(uGrainTab, q, 0) * 255.0 + 0.5);
    int flags = int(g.a);
    if (uRims == 1 && (flags & 2) != 0) vColor = vec4(texelFetch(uRimTab, q, 0).rgb, 1.0);
    else if (g.b > 0.0) {
      // Snow patch: the pan at 1 - u (none from .97), then the mantle tile at u x depth; one source-over equivalent.
      float u = uGrainStrength;
      if (u > 0.03) {
        vec4 m = (flags & 1) != 0 ? uSnowMean[1] : uSnowMean[0];
        float k = u * g.b / 255.0, a = k * m.a, fillA = u < 0.97 ? 1.0 - u : 0.0, outA = 1.0 - (1.0 - fillA) * (1.0 - a);
        vColor = vec4((vColor.rgb * fillA * (1.0 - a) + k * m.rgb) / max(outA, 1e-4), outA);
      }
    } else if (g.r > 0.0) {
      float s = uGrainStrength * g.g / 255.0;
      if (s > 0.03) { vec2 m = uGrain[int(g.r) - 1]; vColor.rgb = vColor.rgb * (1.0 - s * m.x) + s * m.y; }
    }
  }
  // A tint (painted building shadows) replaces the colour of every feature drawn.
  if (uTint.a > 0.0) vColor = uTint;
  gl_Position = shown ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FILL_FS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vPos;
uniform float uRuinSpacing;
// Parchment hatching (live look): lines along x + y = const every uHatch.x metres, uHatch.y metres wide, uHatch.z
// metres per device pixel for the edge; the table alpha (hatch strength per feature) times uHatch.w.
uniform vec4 uHatch;
uniform vec3 uHatchColor;
uniform float uLineAlpha;
out vec4 outColor;
void main() {
  if (uHatch.x > 0.0) {
    float d = abs(fract((vPos.x + vPos.y) / uHatch.x + 0.5) - 0.5) * uHatch.x * 0.70710678;
    float a = vColor.a * uHatch.w * clamp((0.5 * uHatch.y - d) / uHatch.z + 0.5, 0.0, 1.0);
    if (a <= 0.0) discard;
    outColor = vec4(uHatchColor * a, a);
    return;
  }
  // uLineAlpha (live look, outline passes): the coverage of the Canvas sub-pixel stroke over a 1-pixel GL line.
  float lineAlpha = uLineAlpha > 0.0 ? uLineAlpha : 1.0;
  vec3 color = vColor.rgb;
  if (uRuinSpacing > 0.0) {
    float stripe = abs(fract((vPos.x - vPos.y) / uRuinSpacing + 0.5) - 0.5);
    float hatch = 1.0 - smoothstep(0.04, 0.13, stripe);
    color = mix(color, vec3(0.275, 0.231, 0.176), hatch);
  }
  float alpha = vColor.a * lineAlpha;
  outColor = vec4(color * alpha, alpha);
}`;
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
#if VARIANT == 3
uniform highp sampler2D uMats;
out vec2 vWorld; flat out vec2 vMat;
#endif
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
#if VARIANT == 3
  vWorld = a + dir * s + n * t;
  vec4 m = texelFetch(uMats, ivec2(f & 4095, f >> 12), 0) * 255.0;
  vMat = vec2(m.r - 1.0, m.g);
#endif
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
#if VARIANT == 3
in vec2 vWorld; flat in vec2 vMat;
uniform highp sampler2DArray uAlbedo;
uniform float uExt[32];
#endif
uniform float uMpp, uDevPx, uFade;
uniform int uPass, uDashKind, uBridgeDeck, uSingle;
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
  // Textured streets: the road layer of the street's role sampled in world metres (planks follow the street),
  // darkened toward the edge so the casing stays readable. Sampled outside any branch (derivatives).
#if VARIANT == 3
  {
    float ext = uExt[int(max(vMat.x, 0.0))];
    vec2 p = vMat.y > 0.5 ? vec2(vAlong, vLocal.y) : vWorld;
    vec3 tex = texture(uAlbedo, vec3(p / ext, max(vMat.x, 0.0))).rgb;
    if ((vMeta & 16u) == 0u && vMat.x >= 0.0) color = tex * (1.0 - 0.3 * smoothstep(0.8, 1.0, t / max(vHw, 1e-3)));
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
  // Single coverage (translucent streets under a stencil): a fragment claims its samples
  // whole, so overlapping segments of one class never blend twice; MSAA smooths the edge.
  if (uSingle == 1) a = a < 0.5 ? 0.0 : 1.0;
  if (a <= 0.0) discard;
  outColor = vec4(color, 1.0) * (vColor.a * a * cover * uFade);
}`;
/** Textured fills (roof pans, plazas): the albedo array sampled in world metres, rotated by the feature's
 * angle (roofs: u along the ridge, v down the slope), times its brightness. uOnly = 1 keeps only the features
 * that have a material (plazas over the flat plan fill); uOnly = 0 draws every feature, flat colour where none. */
const TFILL_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors, uMats;
uniform float uExt[32], uMean[32];
uniform int uOnly;
out vec4 vColor; out vec2 vUv; flat out float vLayer; flat out float vBright; flat out float vMean; flat out float vRoof;
void main() {
  int f = int(aFeature);
  ivec2 q = ivec2(f & 4095, f >> 12);
  vColor = texelFetch(uColors, q, 0);
  vec4 m = texelFetch(uMats, q, 0) * 255.0;
  float layer = m.r - 1.0, ang = m.g / 255.0 * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang)), p = aPos / uExt[int(max(layer, 0.0))];
  vUv = vec2(dot(p, vec2(-dir.y, dir.x)), dot(p, dir)); vLayer = layer; vBright = m.b / 128.0; vMean = uMean[int(max(layer, 0.0))]; vRoof = m.a;
  bool shown = vColor.a > 0.0 && (uOnly == 0 || layer >= 0.0);
  gl_Position = shown ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const TFILL_FS = `#version 300 es
precision highp float;
in vec4 vColor; in vec2 vUv; flat in float vLayer; flat in float vBright; flat in float vMean; flat in float vRoof;
uniform highp sampler2DArray uAlbedo;
out vec4 outColor;
void main() {
  vec3 tex = texture(uAlbedo, vec3(vUv, max(vLayer, 0.0))).rgb * vBright;
  // Recenter roof grain around its mean; soft light preserves the culture tint.
  float grain = clamp((dot(tex, vec3(0.3, 0.59, 0.11)) / max(vMean, 0.02) - 1.0) * 0.35 + 0.5, 0.0, 1.0);
  vec3 base = vColor.rgb, curve = mix(((16.0 * base - 12.0) * base + 4.0) * base, sqrt(base), step(vec3(0.25), base));
  vec3 roof = grain <= 0.5 ? base - (1.0 - 2.0 * grain) * base * (1.0 - base) : base + (2.0 * grain - 1.0) * (curve - base);
  vec3 c = vLayer < 0.0 ? base : vRoof > 0.0 ? roof : min(tex, vec3(1.0));
  outColor = vec4(c * vColor.a, vColor.a);
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

// Drawn river capsules into the stencil (bit 0x80): the town ground and streets are not drawn on them.
const WATER_VS = `#version 300 es
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec2 aWidth;
uniform vec4 uView;
uniform vec2 uOrigin;
out vec2 vP;
flat out vec4 vSeg;
flat out vec2 vHalf;
void main() {
  vec2 a = aSeg.xy - uOrigin, b = aSeg.zw - uOrigin, d = b - a;
  float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  vec2 half_ = aWidth * 0.5;
  float r = max(half_.x, half_.y) + 0.5;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = mix(a - dir * r, b + dir * r, corner.x) + nrm * r * (corner.y * 2.0 - 1.0);
  vP = p; vSeg = vec4(a, b); vHalf = half_;
  gl_Position = vec4(p * uView.xy + uView.zw, 0.0, 1.0);
}`;
const WATER_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vSeg;
flat in vec2 vHalf;
out vec4 outColor;
void main() {
  vec2 pa = vP - vSeg.xy, ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  if (length(pa - ba * h) > mix(vHalf.x, vHalf.y, h)) discard;
  outColor = vec4(0.0);
}`;
/** Stencil bit of the drawn water (cityGl draw: ground and streets kept off it). */
const WATER_BIT = 0x80;
/** First street stroke that is a crossing (bridge, ford, pier, boardwalk): crossings are sorted last. */
function crossingStart(strokes: CityGlStrokes | undefined): number {
  if (!strokes) return 0;
  const u = new Uint32Array(strokes.data);
  for (let i = 0; i < strokes.count; i++) if (u[i * STROKE_STRIDE + 8] & META.crossing) return i;
  return strokes.count;
}

const strokeVariant = (source: string, variant: 0 | 1 | 2 | 3): string => source.replace(/^#version 300 es\n/, `#version 300 es\n#define VARIANT ${variant}\n`);
// ---------------------------------------------------------------- GL helpers
type Uniforms = Record<string, WebGLUniformLocation | null>;
export interface Program {
  program: WebGLProgram;
  u: Uniforms;
}
/** Non-blocking program creation (shared context): `startProgram` issues the compiles and the link and reads nothing
 * back; `programLinked` polls KHR_parallel_shader_compile (`parallel` false: true at once, the caller then links one
 * program per call); `finishProgram` reads the link status and the uniform locations, once linked. */
export interface PendingProgram {
  program: WebGLProgram;
  shaders: WebGLShader[];
}
export function startProgram(gl: WebGL2RenderingContext, vs: string, fs: string): PendingProgram {
  const program = gl.createProgram()!,
    shaders: WebGLShader[] = [];
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    shaders.push(shader);
  }
  gl.linkProgram(program);
  return { program, shaders };
}
const COMPLETION_STATUS_KHR = 0x91b1;
export const programLinked = (gl: WebGL2RenderingContext, p: PendingProgram, parallel: boolean): boolean => !parallel || !!gl.getProgramParameter(p.program, COMPLETION_STATUS_KHR);
export function finishProgram(gl: WebGL2RenderingContext, p: PendingProgram): Program {
  if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) throw new Error(`cityGl link: ${gl.getProgramInfoLog(p.program)} ${p.shaders.map(s => gl.getShaderInfoLog(s) ?? '').join(' ')}`);
  for (const s of p.shaders) {
    gl.detachShader(p.program, s);
    gl.deleteShader(s);
  }
  const u: Uniforms = {},
    n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p.program, i)!;
    u[info.name] = gl.getUniformLocation(p.program, info.name);
  }
  return { program: p.program, u };
}
function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`cityGl shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`cityGl link: ${gl.getProgramInfoLog(program)}`);
  const u: Uniforms = {},
    n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)!;
    u[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u };
}
const TEX_W = 4096;
function uploadTable(gl: WebGL2RenderingContext, texture: WebGLTexture, rgba: Uint8Array): void {
  const rows = Math.max(1, Math.ceil(rgba.length / 4 / TEX_W)),
    data = rgba.length === rows * TEX_W * 4 ? rgba : new Uint8Array(rows * TEX_W * 4);
  if (data !== rgba) data.set(rgba);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

type FillExtra = 'hatch' | 'grain' | 'rim';
const FILL_EXTRAS: readonly FillExtra[] = ['hatch', 'grain', 'rim'];
/** Colour tables kept per fill mesh: the four levels of detail of a look and a previous look or two. */
const TABLES_KEPT = 6;
/** A fill mesh on the GPU: shared vertices, one VAO for triangles, one for lines, two colour tables per kept state
 * (a zoom across levels of detail, or back to a recent look, binds kept tables instead of rebuilding them). */
class FillPack {
  vbo: WebGLBuffer[] = [];
  tri: WebGLVertexArrayObject;
  line: WebGLVertexArrayObject;
  fill: WebGLTexture | null = null;
  edge: WebGLTexture | null = null;
  mats?: WebGLTexture;
  private geometryBytes: number;
  /** Extra per-feature tables of the current state (live look): parchment hatch strength (plan), roof grain data and
   * wall-rim colours (buildings, cityGlStyle CityGlRoofGrain); null when the state has none. */
  hatch: WebGLTexture | null = null;
  grain: WebGLTexture | null = null;
  rim: WebGLTexture | null = null;
  private tables = new Map<string, { fill: WebGLTexture; edge: WebGLTexture; extra: Partial<Record<FillExtra, WebGLTexture>>; draws?: CityGlDraws }>();
  constructor(
    private gl: WebGL2RenderingContext,
    readonly mesh: CityGlFillMesh,
  ) {
    const buffer = (target: number, data: ArrayBufferView): WebGLBuffer => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      this.vbo.push(b);
      return b;
    };
    const pos = buffer(gl.ARRAY_BUFFER, mesh.positions),
      feat = buffer(gl.ARRAY_BUFFER, mesh.vertexFeatures);
    const vao = (indices: Uint32Array): WebGLVertexArrayObject => {
      const v = gl.createVertexArray()!;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, feat);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
      buffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bindVertexArray(null);
      return v;
    };
    this.tri = vao(mesh.triangles);
    this.line = vao(mesh.lines);
    this.geometryBytes = mesh.positions.byteLength + mesh.vertexFeatures.byteLength + mesh.triangles.byteLength + mesh.lines.byteLength;
  }
  get bytes(): number {
    return this.geometryBytes + Math.max(1, this.tables.size) * Math.ceil(this.mesh.featureCount / TEX_W) * TEX_W * 8;
  }
  /** Uploads the tables of state `key` (and its extra tables) and makes them current. */
  colors(fill: Uint8Array, edge: Uint8Array, key: string, draws?: CityGlDraws, extra: Partial<Record<FillExtra, Uint8Array>> = {}): void {
    const gl = this.gl;
    let t = this.tables.get(key);
    if (!t) {
      if (this.tables.size >= TABLES_KEPT) {
        const [oldest, old] = this.tables.entries().next().value!;
        this.tables.delete(oldest);
        gl.deleteTexture(old.fill);
        gl.deleteTexture(old.edge);
        for (const x of Object.values(old.extra)) if (x) gl.deleteTexture(x);
      }
      t = { fill: gl.createTexture()!, edge: gl.createTexture()!, extra: {} };
      this.tables.set(key, t);
    }
    t.draws = draws;
    uploadTable(gl, t.fill, fill);
    uploadTable(gl, t.edge, edge);
    for (const name of FILL_EXTRAS) {
      const data = extra[name];
      if (data) uploadTable(gl, (t.extra[name] ??= gl.createTexture()!), data);
      else if (t.extra[name]) {
        gl.deleteTexture(t.extra[name]!);
        delete t.extra[name];
      }
    }
    this.current(t);
  }
  private current(t: { fill: WebGLTexture; edge: WebGLTexture; extra: Partial<Record<FillExtra, WebGLTexture>> }): void {
    this.fill = t.fill;
    this.edge = t.edge;
    this.hatch = t.extra.hatch ?? null;
    this.grain = t.extra.grain ?? null;
    this.rim = t.extra.rim ?? null;
  }
  /** Makes the kept tables of state `key` current; undefined when they are not kept. */
  table(key: string): { draws?: CityGlDraws } | undefined {
    const t = this.tables.get(key);
    if (t) this.current(t);
    return t;
  }
  /** The tables of state `key` are kept (nothing made current). */
  has(key: string): boolean {
    return this.tables.has(key);
  }
  materials(table: Uint8Array): void {
    uploadTable(this.gl, (this.mats ??= this.gl.createTexture()!), table);
  }
  dispose(): void {
    const gl = this.gl;
    if (this.mats) gl.deleteTexture(this.mats);
    this.vbo.forEach(b => gl.deleteBuffer(b));
    gl.deleteVertexArray(this.tri);
    gl.deleteVertexArray(this.line);
    for (const t of this.tables.values()) {
      gl.deleteTexture(t.fill);
      gl.deleteTexture(t.edge);
      for (const x of Object.values(t.extra)) if (x) gl.deleteTexture(x);
    }
    this.tables.clear();
    this.fill = this.edge = this.hatch = this.grain = this.rim = null;
  }
}
/** Segment instances on the GPU (36-byte stride), with outer/inner colour tables. */
class StrokePack {
  vbo: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  outer: WebGLTexture;
  inner: WebGLTexture;
  mats?: WebGLTexture;
  bytes: number;
  constructor(
    private gl: WebGL2RenderingContext,
    readonly strokes: CityGlStrokes,
    dynamic = false,
  ) {
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, strokes.data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    this.bind(0);
    this.outer = gl.createTexture()!;
    this.inner = gl.createTexture()!;
    this.bytes = strokes.data.byteLength;
  }
  /** Attribute pointers from instance `first` (WebGL2 has no base instance). */
  bind(first: number): void {
    const gl = this.gl,
      stride = STROKE_STRIDE * 4,
      o = first * stride;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, o);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, o + 16);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, stride, o + 28);
    gl.vertexAttribDivisor(2, 1);
  }
  colors(outer: Uint8Array, inner: Uint8Array): void {
    uploadTable(this.gl, this.outer, outer);
    uploadTable(this.gl, this.inner, inner);
  }
  materials(table: Uint8Array): void {
    uploadTable(this.gl, (this.mats ??= this.gl.createTexture()!), table);
  }
  dispose(): void {
    const gl = this.gl;
    if (this.mats) gl.deleteTexture(this.mats);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.outer);
    gl.deleteTexture(this.inner);
  }
}

// ---------------------------------------------------------------- triangulation pool
class Triangulator {
  private workers: Worker[] = [];
  private next = 1;
  private pending = new Map<number, (r: CityGlTriangulation) => void>();
  private broken = false;
  private pool(n: number): Worker[] {
    if (this.broken || typeof Worker === 'undefined' || n <= 0) return [];
    try {
      while (this.workers.length < n) {
        const w = new Worker(new URL('./cityGlWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<CityGlTriangulation & { id: number }>) => {
          const done = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          done?.(e.data);
        };
        w.onerror = () => {
          this.broken = true;
        };
        this.workers.push(w);
      }
    } catch {
      this.broken = true;
      return [];
    }
    return this.workers.slice(0, n);
  }
  /** Parallel when the packing is large and workers are available; otherwise on this thread. */
  async run(source: CityGlFillSource, workers: number): Promise<{ result: CityGlTriangulation; workers: number }> {
    const p = source.polygons,
      polys = p.polys.length - 1;
    const pool = polys > 3000 ? this.pool(workers) : [];
    if (!pool.length) return { result: triangulatePolygons(p), workers: 0 };
    const ranges = splitPolygons(p, pool.length);
    try {
      const parts = await Promise.all(
        ranges.map(([from, to], k) => {
          const slice = slicePolygons(p, from, to),
            id = this.next++;
          return new Promise<{ result: CityGlTriangulation; vertexOffset: number }>((resolve, reject) => {
            const timer = setTimeout(() => {
              this.pending.delete(id);
              reject(new Error('cityGl worker timeout'));
            }, 60000);
            this.pending.set(id, r => {
              clearTimeout(timer);
              resolve({ result: r, vertexOffset: slice.vertexOffset });
            });
            pool[k].postMessage({ id, coords: slice.coords, rings: slice.rings, polys: slice.polys }, [slice.coords.buffer, slice.rings.buffer, slice.polys.buffer]);
          });
        }),
      );
      return { result: mergeTriangulations(parts), workers: pool.length };
    } catch {
      this.broken = true;
      return { result: triangulatePolygons(p), workers: 0 };
    }
  }
  dispose(): void {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.pending.clear();
  }
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
  const maybe = canvas.getContext('webgl2', { antialias: create.antialias ?? true, premultipliedAlpha: true, alpha: true, depth: false, stencil: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: !create.allowSoftware }) as WebGL2RenderingContext | null;
  if (!maybe) throw new Error(create.allowSoftware ? 'WebGL2 indisponible' : 'WebGL2 matériel indisponible');
  const gl: WebGL2RenderingContext = maybe;
  if (!create.allowSoftware) {
    const info = gl.getExtension('WEBGL_debug_renderer_info'),
      name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    if (SOFTWARE_GL.test(name)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw new Error(`WebGL2 logiciel (${name})`);
    }
  }
  const core = cityGlCore(gl, canvas, create, false);
  return Object.assign(core, {
    canvas,
    resize(width?: number, height?: number): void {
      const el = canvas as HTMLCanvasElement,
        dpr = globalThis.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(width ?? (el.clientWidth || canvas.width / dpr) * dpr)),
        h = Math.max(1, Math.round(height ?? (el.clientHeight || canvas.height / dpr) * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },
  });
}
/** A cityGl renderer on a context owned by someone else (the live compositor's shared WebGL2 context). Throws when a
 * program does not compile. Every draw takes its target from `options.target`. */
export function createCityGlRendererOn(gl: WebGL2RenderingContext, create: Pick<CityGlCreateOptions, 'onInvalidate'> = {}): CityGlSharedRenderer {
  return cityGlCore(gl, undefined, create, true);
}
/** The renderer on `gl`. `canvas`: the renderer's own canvas (context events handled here); `deferUpload`: built meshes
 * wait for `upload()` instead of being uploaded when their build completes. */
function cityGlCore(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement | OffscreenCanvas | undefined, create: CityGlCreateOptions, deferUpload: boolean): CityGlSharedRenderer {
  let fillP: Program, strokeP: Program, casingP: Program, surfaceP: Program, discP: Program, pavedP: Program, tfillP: Program, texturedP: Program, waterP: Program;
  let water: { source: Float32Array; vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number } | undefined,
    streetCrossings = 0;
  // Textured materials: the albedo array (loaded lazily on the first textured draw) and the key of each uploaded material table.
  let albedoTex: WebGLTexture | undefined,
    albedoLoading = false,
    planMatKey = '',
    streetMatKey = '',
    builtMatKey = '';
  let plan: FillPack | undefined, built: FillPack | undefined, streets: StrokePack | undefined, walls: StrokePack | undefined, selection: StrokePack | undefined;
  let towers: { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number } | undefined;
  let scene: CityScene | undefined,
    buildings: CityBuildings | undefined,
    origin: Point = { x: 0, y: 0 };
  let streetSurface = true;
  let planMesh: CityGlFillMesh | undefined, builtMesh: CityGlFillMesh | undefined, streetData: CityGlStrokes | undefined, wallData: CityGlStrokes | undefined, towerData: Float32Array | undefined;
  let styleKey = '',
    streetKey = '',
    builtKey = '',
    draws: CityGlDraws | undefined,
    towerColors: [string, string] = ['#5a5248', '#2f2a24'];
  let selectionKey = '',
    lastLod: CityLod | undefined,
    generation = 0,
    buildingGeneration = 0,
    lost = false,
    disposed = false,
    lastFrame: CityGlFrame | undefined;
  let buildStats: CityGlBuildStats | undefined, buildingStats: CityGlBuildStats | undefined;
  // Deferred uploads (shared context): the commits of the last completed builds, run by `upload()`.
  let commitPlan: (() => number) | undefined, commitBuildings: (() => number) | undefined;
  // Lot enclosures of the live look (setYards): instances, the looks of their features, the palette of their colours.
  let yards: { runs: StrokePack; jambs: StrokePack; looks: YardBoundary[]; palette: string } | undefined;
  // Sliced packing (shared context): resumable packers advanced by `step()`, oldest first; `done(false)` drops one.
  interface PackJob {
    kind: 'scene' | 'buildings';
    steps: Generator<void, void>;
    done(finished: boolean): void;
    fail(error: unknown): void;
  }
  const packJobs: PackJob[] = [];
  const packed = (kind: PackJob['kind'], steps: Generator<void, void>): Promise<boolean> =>
    new Promise((done, fail) => {
      packJobs.push({ kind, steps, done, fail });
      invalidate();
    });
  /** Drops the packings in progress (all, or the building sets only): their setScene / setBuildings return unfinished. */
  const abortPacking = (all: boolean): void => {
    for (let i = packJobs.length - 1; i >= 0; i--)
      if (all || packJobs[i].kind === 'buildings') {
        const [job] = packJobs.splice(i, 1);
        job.done(false);
      }
  };
  const abortedStats = (start: number): CityGlBuildStats => ({ packMs: 0, triangulateMs: 0, assembleMs: 0, uploadMs: 0, workers: 0, totalMs: performance.now() - start });
  const triangulator = new Triangulator();

  let wallGl: CityGlWalls; // walls hook: detailed fortifications (cityWalls.ts)
  function init(): void {
    fillP = compile(gl, FILL_VS, FILL_FS);
    strokeP = compile(gl, strokeVariant(STROKE_VS, 0), strokeVariant(STROKE_FS, 0));
    casingP = compile(gl, strokeVariant(STROKE_VS, 1), strokeVariant(STROKE_FS, 1));
    surfaceP = compile(gl, strokeVariant(STROKE_VS, 2), strokeVariant(STROKE_FS, 2));
    discP = compile(gl, DISC_VS, DISC_FS);
    pavedP = compile(gl, PAVED_VS, PAVED_FS);
    tfillP = compile(gl, TFILL_VS, TFILL_FS);
    texturedP = compile(gl, strokeVariant(STROKE_VS, 3), strokeVariant(STROKE_FS, 3));
    waterP = compile(gl, WATER_VS, WATER_FS);
    wallGl = createCityGlWalls(gl); // walls hook
  }
  // Shared context: the same programs linked without blocking (`programsStep`, from the owner's work), never on first
  // use; the private canvas compiles them at once as before.
  const parallelLink = deferUpload && !!gl.getExtension('KHR_parallel_shader_compile');
  const programDefs: Array<[string, string, (p: Program) => void]> = [
    [
      FILL_VS,
      FILL_FS,
      p => {
        fillP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 0),
      strokeVariant(STROKE_FS, 0),
      p => {
        strokeP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 1),
      strokeVariant(STROKE_FS, 1),
      p => {
        casingP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 2),
      strokeVariant(STROKE_FS, 2),
      p => {
        surfaceP = p;
      },
    ],
    [
      DISC_VS,
      DISC_FS,
      p => {
        discP = p;
      },
    ],
    [
      PAVED_VS,
      PAVED_FS,
      p => {
        pavedP = p;
      },
    ],
    [
      TFILL_VS,
      TFILL_FS,
      p => {
        tfillP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 3),
      strokeVariant(STROKE_FS, 3),
      p => {
        texturedP = p;
      },
    ],
    [
      WATER_VS,
      WATER_FS,
      p => {
        waterP = p;
      },
    ],
  ];
  const linking: { pending: PendingProgram; set: (p: Program) => void; done: boolean }[] = [];
  let programsReady = !deferUpload,
    wallsMade = !deferUpload;
  const madePrograms = (): Program[] => [fillP, strokeP, casingP, surfaceP, discP, pavedP, tfillP, texturedP, waterP].filter(p => !!p);
  if (!deferUpload) init();
  function uploadPlan(): number {
    const t = performance.now();
    plan?.dispose();
    streets?.dispose();
    walls?.dispose();
    // Lot enclosures are relative to the scene origin: the owner sets them again for a new scene.
    if (yards) {
      yards.runs.dispose();
      yards.jambs.dispose();
      yards = undefined;
    }
    if (towers) {
      gl.deleteBuffer(towers.vbo);
      gl.deleteVertexArray(towers.vao);
      towers = undefined;
    }
    plan = planMesh && new FillPack(gl, planMesh);
    wallGl.upload(scene, origin); // walls hook
    streets = streetData && new StrokePack(gl, streetData);
    walls = wallData && new StrokePack(gl, wallData);
    streetCrossings = crossingStart(streetData);
    if (towerData) {
      const vbo = gl.createBuffer()!,
        vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, towerData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.bindVertexArray(null);
      towers = { vbo, vao, count: towerData.length / 2 };
    }
    styleKey = streetKey = selectionKey = planMatKey = streetMatKey = '';
    return performance.now() - t;
  }
  function uploadBuildings(): number {
    const t = performance.now();
    built?.dispose();
    built = builtMesh && new FillPack(gl, builtMesh);
    builtKey = builtMatKey = '';
    return performance.now() - t;
  }
  const invalidate = (): void => {
    if (!disposed) create.onInvalidate?.();
  };
  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    invalidate();
  };
  const onRestored = (): void => {
    // Old GL objects are invalid after restoration. Keep Canvas active until
    // programmes and the latest retained CPU meshes have all been reuploaded.
    lost = true;
    plan = built = streets = walls = selection = undefined;
    towers = undefined;
    water = undefined;
    albedoTex = undefined;
    albedoLoading = false;
    try {
      init();
      uploadPlan();
      uploadBuildings();
      lost = false;
    } catch (error) {
      console.warn('Restauration WebGL de la ville indisponible, Canvas 2D utilisé', error);
    } finally {
      invalidate();
    }
  };
  canvas?.addEventListener('webglcontextlost', onLost as EventListener);
  canvas?.addEventListener('webglcontextrestored', onRestored as EventListener);

  async function buildFill(source: CityGlFillSource, workers: number): Promise<{ mesh: CityGlFillMesh; triangulateMs: number; assembleMs: number; workers: number }> {
    let t = performance.now();
    const { result, workers: used } = await triangulator.run(source, workers);
    const triangulateMs = performance.now() - t;
    t = performance.now();
    return { mesh: fillMesh(source, result), triangulateMs, assembleMs: performance.now() - t, workers: used };
  }

  /** Keys and style state of a draw: the plan tables depend on the level of detail, streets and buildings do not. */
  function stateOf(o: CityGlDrawOptions, lod: CityLod) {
    const palette = o.palette ?? 'growth',
      layers = { ...DEFAULT_LAYERS, ...o.layers };
    const footprint = o.buildingStyle === 'silhouette';
    // The live look stands in for the Canvas 2D frame of the V2, which has no render background.
    const renderBackground = !o.live && globalThis.document?.documentElement.dataset.cityBackground === 'render',
      painted = !footprint && (o.paintedBuildings ?? renderBackground);
    const style: CityGlStyleState = {
      buildingStyle: o.buildingStyle,
      view: o.view,
      lod,
      palette,
      layers,
      buildingsVisible: o.buildingsVisible ?? true,
      diagnostic: o.diagnostic ?? 'none',
      refusedParcels: o.refusedParcels,
      painted,
      blended: o.groundBlend ?? isBlended(),
      colors: o.colors,
      live: o.live,
    };
    const colorKey = o.colors ? JSON.stringify(o.colors) : '',
      liveKey = o.live ? `live:${o.live.roadLook}:${o.live.emphasis}:${o.live.waterColor ?? ''}:${o.live.grain ? 1 : 0}:${o.live.farTown ? 1 : 0}` : '';
    const key = JSON.stringify([o.view, lod, palette, layers, style.buildingsVisible, o.buildingStyle, refusedKey(o.refusedParcels), painted, style.blended, toneKey()]) + liveKey;
    const softStreets = !!style.blended && !(o.textured && palette !== 'parchment' && palette !== 'ink'),
      sKey = `${palette}|${softStreets}|${colorKey}|${toneKey()}|${liveKey}`;
    const bKey = `${o.view}|${palette}|${style.diagnostic}|${o.buildingStyle}|${buildingGeneration}|${painted}|${colorKey}|${roofSeasonKey()}|${liveKey}`;
    return { palette, layers, footprint, renderBackground, painted, style, key, softStreets, sKey, bKey };
  }
  /** What a draw state needs on the GPU besides the meshes: street strokes of the road-surface switch, colour and
   * material tables, the drawn water. Each is rebuilt only when its state key changes (plan tables are kept per key),
   * so a frame of a known state only reads them; `prepareSteps` builds the heavy tables ahead in slices. Requires a
   * scene and a plan. */
  function styleFrame(o: CityGlDrawOptions, lod: CityLod) {
    const s = scene!,
      pl = plan!;
    const { palette, layers, footprint, renderBackground, painted, style, key, softStreets, sKey, bKey } = stateOf(o, lod);
    // Road surface layer toggled: rebuild the street strokes (round caps, one width when off).
    const surface = layers.roadSurface !== false;
    if (surface !== streetSurface) {
      streetSurface = surface;
      if (scene && origin && !lost && !gl.isContextLost()) {
        streetData = buildStreetStrokes(scene, origin, surface);
        streets?.dispose();
        streets = new StrokePack(gl, streetData);
        streetCrossings = crossingStart(streetData);
        streetKey = '';
      }
    }
    // Colour tables: rebuilt only when the state changes (plan tables of recent states are kept).
    if (key !== styleKey) {
      const kept = pl.table(key);
      if (kept?.draws) draws = kept.draws;
      else {
        const pc = planColors(s, pl.mesh, style);
        pl.colors(pc.fill, pc.line, key, pc.draws, { hatch: pc.hatch });
        draws = pc.draws;
      }
      styleKey = key;
    }
    if (sKey !== streetKey) {
      const sc = streetColors(s, palette, softStreets, o.colors, o.live),
        wc = cityWallColors(s, palette); // walls hook
      streets?.colors(sc.outer, sc.inner);
      walls?.colors(wc.outer, wc.inner);
      towerColors = wc.tower;
      streetKey = sKey;
    }
    if (built && bKey !== builtKey) {
      if (!built.table(bKey)) {
        const bc = buildingColors(buildings, style, s);
        built.colors(bc.fill, bc.line, bKey, undefined, { ...bc.roofGrain });
      }
      builtKey = bKey;
    }
    // Lot enclosures (live look): a few texels per look, by palette.
    if (yards && yards.palette !== palette) {
      const c = yardColors(yards.looks, palette);
      yards.runs.colors(c.line, c.line);
      yards.jambs.colors(c.jamb, c.jamb);
      yards.palette = palette;
    }
    // Textured materials: albedo array loaded once (the plan is drawn flat until it arrives, then repainted).
    const textured = !!o.textured && !!albedoTex;
    if (o.textured && !albedoTex && !albedoLoading) {
      albedoLoading = true;
      loadMaterialImages()
        .then(images => {
          if (disposed || lost || gl.isContextLost()) return;
          albedoTex = uploadMaterialArrays(gl, images, false).albedo;
          invalidate();
        })
        .catch(e => {
          console.warn('Matières texturées indisponibles', e);
        })
        .finally(() => {
          albedoLoading = false;
        });
    }
    if (textured) {
      const pk = `${styleKey}|${o.textured}`;
      if (planMatKey !== pk) {
        pl.materials(planMaterialTable(s, pl.mesh));
        planMatKey = pk;
      }
      if (streets && streetMatKey !== 'on') {
        streets.materials(streetMaterialTable(s));
        streetMatKey = 'on';
      }
      if (built && builtMatKey !== bKey) {
        built.materials(roofMaterialTable(buildings, style));
        builtMatKey = bKey;
      }
    }
    if (o.water !== water?.source) {
      if (water) {
        gl.deleteBuffer(water.vbo);
        gl.deleteVertexArray(water.vao);
        water = undefined;
      }
      if (o.water && o.water.length >= 9) {
        const vbo = gl.createBuffer()!,
          vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, o.water, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 16);
        gl.vertexAttribDivisor(1, 1);
        gl.bindVertexArray(null);
        water = { source: o.water, vbo, vao, count: Math.floor(o.water.length / 9) };
      }
    }
    return { palette, layers, footprint, renderBackground, painted, softStreets, textured, d: draws! };
  }
  const renderer: CityGlSharedRenderer = {
    gl,
    get ready() {
      return programsReady && !disposed && !lost && !gl.isContextLost() && !!scene && !!plan;
    },
    get programsLinked() {
      return programsReady;
    },
    programsStep() {
      if (programsReady || disposed || gl.isContextLost()) return false;
      if (parallelLink) {
        // All compiles and links issued at once; finished as the driver completes them, polled on later calls.
        if (!linking.length) for (const [vs, fs, set] of programDefs) linking.push({ pending: startProgram(gl, vs, fs), set, done: false });
        for (const l of linking)
          if (!l.done && programLinked(gl, l.pending, true)) {
            l.set(finishProgram(gl, l.pending));
            l.done = true;
          }
        if (linking.some(l => !l.done)) return true;
      } else if (linking.length < programDefs.length) {
        // No parallel compile: one program per call.
        const [vs, fs, set] = programDefs[linking.length],
          pending = startProgram(gl, vs, fs);
        linking.push({ pending, set, done: true });
        set(finishProgram(gl, pending));
        return true;
      }
      // The detailed walls' program (cityWalls.ts links it at once): alone in its call.
      if (!wallsMade) {
        wallGl = createCityGlWalls(gl);
        wallsMade = true;
        return true;
      } // walls hook
      programsReady = true;
      invalidate();
      return false;
    },
    check(o) {
      if (!renderer.ready) return 'scene not uploaded';
      if (o.textured) return 'textured materials'; // the albedo array loads on first use
      const lod = o.lod ?? selectCityLod(o.metresPerPixel, lastLod),
        st = stateOf(o, lod);
      if ((st.layers.roadSurface !== false) !== streetSurface) return 'street surface';
      if (st.key !== styleKey && !plan!.has(st.key)) return 'plan tables';
      if (st.sKey !== streetKey) return 'street tables';
      if (built && st.bKey !== builtKey && !built.has(st.bKey)) return 'building tables';
      if (o.water !== water?.source) return 'water';
      if (yards && yards.palette !== st.palette) return 'enclosure colours';
      return '';
    },
    get pendingUpload() {
      return !!commitPlan || !!commitBuildings;
    },
    upload() {
      if (!programsReady || disposed || lost || gl.isContextLost()) return false;
      // One commit per call: the plan (with its strokes), then the buildings, each a few buffers.
      const p = commitPlan,
        b = p ? undefined : commitBuildings;
      if (p) commitPlan = undefined;
      else commitBuildings = undefined;
      const ms = p?.() ?? b?.() ?? 0;
      gl.bindVertexArray(null); // StrokePack leaves its VAO bound: nothing of ours stays bound in the shared context
      if (p && buildStats) buildStats.uploadMs = ms;
      else if (b && buildingStats) buildingStats.uploadMs = ms;
      return !!p || !!b;
    },
    prepare(o) {
      if (!renderer.ready) return;
      styleFrame(o, o.lod ?? selectCityLod(o.metresPerPixel, lastLod));
      gl.bindVertexArray(null);
    },
    *prepareSteps(o) {
      if (!renderer.ready || commitPlan || commitBuildings) return;
      const lod = o.lod ?? selectCityLod(o.metresPerPixel, lastLod),
        st = stateOf(o, lod),
        pl = plan!,
        s = scene!;
      // The heavy tables (a pass over every block and parcel, every building and pan, every street) in slices, kept
      // per key; then the rest of the state at once, which finds them kept.
      if (!pl.has(st.key)) {
        const pc = yield* planColorsSteps(s, pl.mesh, st.style);
        if (plan !== pl) return;
        const current = styleKey;
        pl.colors(pc.fill, pc.line, st.key, pc.draws, { hatch: pc.hatch });
        if (current) pl.table(current); // `colors` made the new tables current: the draw state stays the drawn one
      }
      if (st.sKey !== streetKey) {
        const sc = yield* streetColorsSteps(s, st.palette, st.softStreets, o.colors, o.live);
        if (scene !== s) return;
        const wc = cityWallColors(s, st.palette); // walls hook
        streets?.colors(sc.outer, sc.inner);
        walls?.colors(wc.outer, wc.inner);
        towerColors = wc.tower;
        streetKey = st.sKey;
      }
      const bb = built;
      if (bb && !bb.has(st.bKey)) {
        const bc = yield* buildingColorsSteps(buildings, st.style, s);
        if (built !== bb) return;
        const current = builtKey;
        bb.colors(bc.fill, bc.line, st.bKey, undefined, { ...bc.roofGrain });
        if (current) bb.table(current);
      }
      styleFrame(o, lod);
      gl.bindVertexArray(null);
    },
    setYards(lists) {
      if (yards) {
        yards.runs.dispose();
        yards.jambs.dispose();
        yards = undefined;
      }
      if (!scene || lost || gl.isContextLost()) return;
      const y = buildYardStrokes(lists, origin);
      if (y) yards = { runs: new StrokePack(gl, y.runs), jambs: new StrokePack(gl, y.jambs), looks: y.looks, palette: '' };
      gl.bindVertexArray(null);
    },
    get packing() {
      return packJobs.length > 0;
    },
    step(budgetMs) {
      const t = performance.now();
      while (packJobs.length) {
        const job = packJobs[0];
        try {
          for (;;) {
            if (job.steps.next().done) {
              packJobs.shift();
              job.done(true);
              break;
            }
            if (performance.now() - t >= budgetMs) return true;
          }
        } catch (error) {
          packJobs.shift();
          job.fail(error);
        }
      }
      return false;
    },
    async setScene(next, nextBuildings, options = {}) {
      const gen = ++generation,
        start = performance.now(),
        workers = options.workers ?? defaultWorkers();
      const t = performance.now(),
        o = cityOrigin(next);
      const out: { plan?: CityGlFillSource; streets?: CityGlStrokes; walls?: CityGlStrokes; towers?: Float32Array; built?: CityGlFillSource } = {};
      const pack = function* (): Generator<void, void> {
        out.plan = yield* packPlanSteps(next, o);
        yield;
        out.streets = buildStreetStrokes(next, o, streetSurface);
        yield;
        out.walls = cityWallStrokes(next, o);
        out.towers = buildTowers(cityLegacyWalls(next), o);
        yield; // walls hook
        if (nextBuildings) out.built = yield* packBuildingsSteps(nextBuildings, o);
      };
      // Shared context: packed in slices by `step()`; a newer scene drops every packing in progress.
      if (deferUpload) {
        abortPacking(true);
        if (!(await packed('scene', pack()))) return abortedStats(start);
      } else runSteps(pack());
      const packMs = performance.now() - t;
      if (gen !== generation) return abortedStats(start);
      const sd = out.streets!,
        wd = out.walls!,
        td = out.towers!,
        builtSource = out.built;
      const [p, b] = await Promise.all([buildFill(out.plan!, workers), builtSource && buildFill(builtSource, workers)]);
      if (gen !== generation) return { packMs, triangulateMs: p.triangulateMs, assembleMs: p.assembleMs, uploadMs: 0, workers: p.workers, totalMs: performance.now() - start };
      const commit = (): number => {
        scene = next;
        origin = o;
        planMesh = p.mesh;
        streetData = sd;
        wallData = wd;
        towerData = td;
        buildings = nextBuildings;
        builtMesh = b?.mesh;
        return lost || gl.isContextLost() ? 0 : uploadPlan() + uploadBuildings();
      };
      buildingGeneration++;
      // Deferred: the scene (with its building set, not drawable until both are up) at one `upload()`, the building
      // buffers at the next; an earlier building set is dropped.
      let uploadMs = 0;
      if (deferUpload) {
        commitPlan = () => {
          scene = next;
          origin = o;
          planMesh = p.mesh;
          streetData = sd;
          wallData = wd;
          towerData = td;
          buildings = nextBuildings;
          builtMesh = b?.mesh;
          return lost || gl.isContextLost() ? 0 : uploadPlan();
        };
        commitBuildings = () => (lost || gl.isContextLost() ? 0 : uploadBuildings());
      } else uploadMs = commit();
      buildStats = { packMs, triangulateMs: p.triangulateMs + (b?.triangulateMs ?? 0), assembleMs: p.assembleMs + (b?.assembleMs ?? 0), uploadMs, workers: p.workers, totalMs: performance.now() - start };
      invalidate();
      return buildStats;
    },
    async setBuildings(next, options = {}) {
      const gen = ++buildingGeneration,
        start = performance.now(),
        workers = options.workers ?? defaultWorkers(),
        o = origin;
      const t = performance.now();
      const out: { built?: CityGlFillSource } = {};
      const pack = function* (): Generator<void, void> {
        if (next) out.built = yield* packBuildingsSteps(next, o);
      };
      if (deferUpload) {
        abortPacking(false);
        if (!(await packed('buildings', pack()))) return abortedStats(start);
      } else runSteps(pack());
      const packMs = performance.now() - t;
      if (gen !== buildingGeneration) return abortedStats(start);
      const source = out.built,
        b = source && (await buildFill(source, workers));
      if (gen !== buildingGeneration) return { packMs, triangulateMs: b?.triangulateMs ?? 0, assembleMs: b?.assembleMs ?? 0, uploadMs: 0, workers: b?.workers ?? 0, totalMs: performance.now() - start };
      const commit = (): number => {
        buildings = next;
        builtMesh = b?.mesh;
        return lost || gl.isContextLost() ? 0 : uploadBuildings();
      };
      let uploadMs = 0;
      if (deferUpload) commitBuildings = commit;
      else uploadMs = commit();
      buildingStats = { packMs, triangulateMs: b?.triangulateMs ?? 0, assembleMs: b?.assembleMs ?? 0, uploadMs, workers: b?.workers ?? 0, totalMs: performance.now() - start };
      invalidate();
      return buildingStats;
    },
    draw(o) {
      const start = performance.now(),
        mpp = o.metresPerPixel;
      const lod = o.lod ?? selectCityLod(mpp, lastLod);
      lastLod = lod;
      const frame: CityGlFrame = { lod, drawCalls: 0, instances: 0, triangles: 0, cpuMs: 0 };
      if (!renderer.ready) {
        frame.cpuMs = performance.now() - start;
        lastFrame = frame;
        return frame;
      }
      const target = o.target,
        W = target ? target.width : gl.drawingBufferWidth,
        H = target ? target.height : gl.drawingBufferHeight;
      if (target) {
        // Shared context: the frame's target and every state this draw relies on; nothing cleared (the owner's target).
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.STENCIL_TEST);
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0xff);
        gl.blendEquation(gl.FUNC_ADD);
        gl.viewport(0, 0, W, H);
      } else {
        gl.viewport(0, 0, W, H);
        const c = o.clear ?? [0, 0, 0, 0];
        gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (!scene || !plan) return frame;
      const { palette, layers, footprint, renderBackground, painted, softStreets, textured, d } = styleFrame(o, lod);
      const v = o.viewport,
        sx = 2 / (v.maxX - v.minX),
        sy = -2 / (v.maxY - v.minY);
      const view = [sx, sy, -1 - (v.minX - origin.x) * sx, 1 - (v.minY - origin.y) * sy];
      const devPx = (v.maxX - v.minX) / Math.max(1, W);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      // The drawn rivers above the town ground and streets: their capsules mark the stencil (WATER_BIT); blocks,
      // parcels and non-crossing streets are drawn only off it, so the river shows through, bridges and fords over it.
      const wet = !!water && water.count > 0;
      if (wet) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.clearStencil(0);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.stencilFunc(gl.ALWAYS, WATER_BIT, WATER_BIT);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.stencilMask(WATER_BIT);
        gl.colorMask(false, false, false, false);
        gl.useProgram(waterP.program);
        gl.uniform4fv(waterP.u.uView, view);
        gl.uniform2f(waterP.u.uOrigin, origin.x, origin.y);
        gl.bindVertexArray(water!.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, water!.count);
        frame.drawCalls++;
        frame.instances += water!.count;
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0xff);
        gl.disable(gl.STENCIL_TEST);
      }
      /** Draws only off the drawn water (no-op without it). */
      const dry = (on: boolean): void => {
        if (!wet) return;
        if (!on) {
          gl.disable(gl.STENCIL_TEST);
          return;
        }
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.EQUAL, 0, WATER_BIT);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      };
      gl.activeTexture(gl.TEXTURE0);
      // Binds a material table (unit 1) and the albedo array (unit 2) to a textured program.
      const extents = new Float32Array(32).fill(2);
      MATERIALS.layers.forEach((l, i) => {
        extents[i] = l.extent_m;
      });
      const means = new Float32Array(32).fill(0.5);
      MATERIALS.layers.forEach((l, i) => {
        means[i] = (l.mean_rgb[0] * 0.3 + l.mean_rgb[1] * 0.59 + l.mean_rgb[2] * 0.11) / 255;
      });
      const useTextured = (prog: Program, mats: WebGLTexture | undefined, only: boolean): void => {
        gl.useProgram(prog.program);
        gl.uniform4fv(prog.u.uView, view);
        gl.uniform1i(prog.u.uColors, 0);
        gl.uniform1i(prog.u.uMats, 1);
        gl.uniform1i(prog.u.uAlbedo, 2);
        gl.uniform1fv(prog.u['uExt[0]'], extents);
        gl.uniform1i(prog.u.uOnly, only ? 1 : 0);
        if (prog === tfillP) gl.uniform1fv(prog.u['uMean[0]'], means);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mats ?? null);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, albedoTex ?? null);
        gl.activeTexture(gl.TEXTURE0);
      };

      // Fills and outlines.
      gl.useProgram(fillP.program);
      gl.uniform4fv(fillP.u.uView, view);
      gl.uniform1i(fillP.u.uColors, 0);
      gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
      gl.uniform1f(fillP.u.uRuinSpacing, 0);
      gl.uniform4f(fillP.u.uHatch, 0, 0, 0, 0);
      gl.uniform1f(fillP.u.uLineAlpha, 0);
      gl.uniform1i(fillP.u.uRoofGrain, 0);
      // The live town: a GL line is one device pixel; the look's strokes are thinner (CSS px), drawn with coverage.
      // Building edges under roof pans show their outer half only. Factor = stroke width in device pixels.
      const dpr = mpp / Math.max(devPx, 1e-9),
        hasPans = !footprint && !!built?.mesh.layers.roofs?.triangles.count;
      const parchment = palette === 'parchment';
      const strokePx = (layer: string): number =>
        layer === 'blocks' || layer === 'parcels'
          ? planLineWidthPx(o.live?.lineWidth ?? 0.6)
          : layer === 'roofs'
            ? (parchment ? PAN_EDGE.parchment : PAN_EDGE.plan).widthPx
            : layer === 'buildings'
              ? buildingEdgePx(false, parchment) * (hasPans ? 0.5 : 1)
              : layer === 'buildingFootprints'
                ? buildingEdgePx(true, parchment)
                : layer === 'waterwayBridges'
                  ? canalBridgeEdgePx(mpp)
                  : 1;
      /** Live parchment hatching over a plan layer (drawCitySteps hatchPattern, world-anchored 7 px lines). */
      const hatch = (layer: string): void => {
        if (!d.hatch || !plan?.hatch) return;
        const [r, g, b] = rgba01(PARCHMENT_HATCH.color);
        gl.uniform4f(fillP.u.uHatch, PARCHMENT_HATCH.periodPx * mpp, PARCHMENT_HATCH.widthPx * mpp, devPx, PARCHMENT_HATCH.alpha);
        gl.uniform3f(fillP.u.uHatchColor, r, g, b);
        gl.bindTexture(gl.TEXTURE_2D, plan.hatch);
        gl.bindVertexArray(plan.tri);
        const l = plan.mesh.layers[layer];
        if (l)
          for (const [first, count] of visibleRanges(l.chunks, v, c => c.triangles)) {
            gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
            frame.drawCalls++;
            frame.triangles += count / 3;
          }
        gl.uniform4f(fillP.u.uHatch, 0, 0, 0, 0);
      };
      const fills = (pack: FillPack | undefined, layer: string, lines: boolean): void => {
        const l = pack?.mesh.layers[layer];
        if (!pack || !l || !(lines ? l.lines : l.triangles).count) return;
        gl.bindTexture(gl.TEXTURE_2D, lines ? pack.edge : pack.fill);
        gl.bindVertexArray(lines ? pack.line : pack.tri);
        if (lines && o.live) gl.uniform1f(fillP.u.uLineAlpha, Math.max(0.05, Math.min(1, strokePx(layer) * dpr)));
        // Only the grid chunks in view (consecutive ones merged into one call).
        for (const [first, count] of visibleRanges(l.chunks, v, c => (lines ? c.lines : c.triangles))) {
          gl.drawElements(lines ? gl.LINES : gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
          frame.drawCalls++;
          if (!lines) frame.triangles += count / 3;
        }
        if (lines && o.live) gl.uniform1f(fillP.u.uLineAlpha, 0);
      };
      dry(true);
      if (lod === 'far') {
        if (d.footprint) fills(plan, 'footprint', false);
        if (d.footprintLines) fills(plan, 'footprint', true);
        hatch('footprint');
      } else {
        if (d.blocks) fills(plan, 'blocks', false);
        if (d.blockLines) fills(plan, 'blocks', true);
        hatch('blocks');
        if (d.parcels) fills(plan, 'parcels', false);
        if (d.parcelLines) fills(plan, 'parcels', true);
        if (d.paved && mpp < 0.3) {
          // setts appear below 0.3 m/px (PAVED_FS `shown`)
          gl.useProgram(pavedP.program);
          gl.uniform4fv(pavedP.u.uView, view);
          gl.uniform1i(pavedP.u.uColors, 0);
          gl.uniform1f(pavedP.u.uMpp, mpp);
          fills(plan, 'blocks', false);
          fills(plan, 'parcels', false);
          gl.useProgram(fillP.program);
        }
        if (textured && plan.mats) {
          // plazas: flagstones over the flat fill, outlines redrawn on top
          useTextured(tfillP, plan.mats, true);
          fills(plan, 'blocks', false);
          fills(plan, 'parcels', false);
          gl.useProgram(fillP.program);
          gl.uniform4fv(fillP.u.uView, view);
          gl.uniform1i(fillP.u.uColors, 0);
          if (d.blockLines) fills(plan, 'blocks', true);
          if (d.parcelLines) fills(plan, 'parcels', true);
        }
      }
      dry(false);
      if (layers.streets) {
        fills(plan, 'quays', false);
        fills(plan, 'quays', true);
      }
      const wallDraw = { view, mpp, lod, palette, painted: renderBackground && palette !== 'parchment' && palette !== 'ink', enabled: layers.enclosures }; // walls hook
      frame.drawCalls += wallGl.draw('ground', wallDraw); // walls hook: ditches and glacis under the streets
      // Strokes: streets (casing then fill), walls (outer then inner line).
      let u = strokeP.u;
      const useStroke = (prog: Program): void => {
        gl.useProgram(prog.program);
        u = prog.u;
        gl.uniform4fv(u.uView, view);
        gl.uniform1i(u.uColors, 0);
        gl.uniform1f(u.uMpp, mpp);
        gl.uniform1f(u.uDevPx, devPx);
        gl.uniform4f(u.uOverride, 0, 0, 0, 0);
        gl.uniform1f(u.uFade, 1);
      };
      useStroke(strokeP);
      const strokes = (pack: StrokePack | undefined, first: number, pass: 0 | 1, p: { edgePx: number; inner: number; minPx: number; maxRank: number; crossings: boolean; dash: number }, single = false): void => {
        if (!pack || pack.strokes.count - first <= 0) return;
        const ranges = pack.strokes.chunks ? visibleRanges(pack.strokes.chunks, v, c => ({ start: c.first, count: c.count }), 8 * mpp, first) : [[first, pack.strokes.count - first]];
        if (!ranges.length) return;
        gl.bindTexture(gl.TEXTURE_2D, pass === 1 ? pack.inner : pack.outer);
        gl.uniform1i(u.uPass, pass);
        gl.uniform1f(u.uEdgePx, p.edgePx);
        gl.uniform1f(u.uInnerScale, p.inner);
        gl.uniform1f(u.uMinPxScale, p.minPx);
        gl.uniform1i(u.uMaxRank, p.maxRank);
        gl.uniform1i(u.uCrossings, p.crossings ? 1 : 0);
        gl.uniform1i(u.uDashKind, p.dash);
        gl.uniform1i(u.uSingle, single ? 1 : 0);
        // Streets stay off the drawn water up to their crossings (sorted last), which run over it.
        const wetFrom = wet && pack === streets ? streetCrossings : -1;
        if (!single) {
          for (const [start, count] of ranges) {
            const end = start + count,
              split = wetFrom < 0 ? start : Math.max(start, Math.min(end, wetFrom));
            if (split > start) {
              dry(true);
              pack.bind(start);
              gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, split - start);
              frame.drawCalls++;
              frame.instances += split - start;
              dry(false);
            }
            if (end > split) {
              pack.bind(split);
              gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - split);
              frame.drawCalls++;
              frame.instances += end - split;
            }
          }
          return;
        }
        // Translucent streets: each rank class covers a sample once (stencil ref rises with the
        // class, minor → major), a major still laid over a minor as before.
        const bounds = pack.strokes.firstWithRank;
        const rankOf = (i: number): number => {
          let r = 0;
          while (r < 15 && bounds[r] > i) r++;
          return r;
        };
        // Over the drawn water the rank bits are cleared, the water bit kept: a sample marked water (≥ WATER_BIT)
        // never passes GREATER against a rank reference, except for the crossings, which compare the rank bits only.
        gl.enable(gl.STENCIL_TEST);
        gl.clearStencil(0);
        gl.stencilMask(wet ? WATER_BIT - 1 : 0xff);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        for (const [start, count] of ranges) {
          for (let i = start, end = start + count; i < end;) {
            const r = rankOf(i),
              stop = Math.min(end, r > 0 ? bounds[r - 1] : end);
            let next = stop > i ? stop : end;
            if (wetFrom >= 0 && i < wetFrom && next > wetFrom) next = wetFrom;
            gl.stencilFunc(gl.GREATER, 16 - r, wetFrom >= 0 && i >= wetFrom ? WATER_BIT - 1 : 0xff);
            pack.bind(i);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, next - i);
            frame.drawCalls++;
            frame.instances += next - i;
            i = next;
          }
        }
        gl.stencilMask(0xff);
        gl.disable(gl.STENCIL_TEST);
        gl.uniform1i(u.uSingle, 0);
      };
      if (d.streets && streets) {
        const maxRank = streetMaxRank(lod),
          crossings = true;
        const first = Math.min(streets.strokes.firstWithRank[maxRank], crossings ? streets.strokes.firstWithRank[0] : Infinity);
        // Casing, soft edge or shoulder width of the frame's street paint (the look's streetEdgePx; none far).
        const mode: StreetMode = o.live && groundRoadLook(o.live.roadLook) ? 'natural' : softStreets ? 'soft' : 'ink';
        const s = { edgePx: lod === 'far' ? 0 : streetEdgePx(mode, lod) * (mode === 'ink' ? Math.max(1, o.live?.emphasis ?? 1) : 1), inner: 1, minPx: 1, maxRank, crossings, dash: 1 };
        const paintRoads = renderBackground && palette !== 'parchment' && palette !== 'ink' && !softStreets;
        if (paintRoads) useStroke(casingP);
        if (d.streetCasing) strokes(streets, first, 0, s, softStreets && streetSurface);
        if (textured && streets.mats && palette !== 'parchment' && palette !== 'ink' && !o.colors?.road) {
          useStroke(texturedP);
          useTextured(texturedP, streets.mats, false);
          u = texturedP.u;
        } else if (paintRoads) useStroke(surfaceP);
        // The stone deck is render-background art: the look's bridges are their flat fill.
        gl.uniform1i(u.uBridgeDeck, (o.bridgeDeck ?? !o.live) ? 1 : 0);
        strokes(streets, first, 1, s, softStreets && streetSurface);
        gl.uniform1i(u.uBridgeDeck, 0);
      }
      // Lot enclosures (live look; drawLotEnclosures): from the mid level, thinner and fading out across mid; gate jambs
      // near (cart gates) and close (doors). After the streets and quays, before the town walls.
      if (yards && layers.lotEnclosures !== false && !layers.lotEnclosureMeshes && lod !== 'far') {
        useStroke(strokeP);
        const mid = lod === 'mid',
          fade = mid ? 1 - 0.65 * Math.max(0, Math.min(1, Math.log(mpp / 2.2) / Math.log(9 / 2.2))) : 1;
        gl.uniform1f(u.uFade, fade);
        strokes(yards.runs, 0, 1, { edgePx: 0, inner: 1, minPx: mid ? 0.7 : 1, maxRank: 15, crossings: false, dash: 0 });
        gl.uniform1f(u.uFade, 1);
        if (!mid) strokes(yards.jambs, 0, 1, { edgePx: 0, inner: 1, minPx: 1, maxRank: lod === 'close' ? 1 : 0, crossings: false, dash: 0 });
      }
      frame.drawCalls += wallGl.draw('shadow', wallDraw);
      useStroke(strokeP); // walls hook: painted wall shadows
      if (d.walls && walls) {
        // Wall instances carry the near minimum width; far walls are thinner (the look's wallMinPx).
        const s = { edgePx: 0, inner: WALL_CORE, minPx: wallMinPx(lod) / wallMinPx('near'), maxRank: 15, crossings: false, dash: 2 };
        strokes(walls, 0, 0, s);
        if (d.wallInner) strokes(walls, 0, 1, s);
      }
      if (d.towers && towers?.count) {
        gl.useProgram(discP.program);
        const tower = wallLook('stone', palette, lod, mpp).tower;
        gl.uniform4fv(discP.u.uView, view);
        gl.uniform1f(discP.u.uRadius, tower?.radius ?? 0);
        gl.uniform1f(discP.u.uDevPx, devPx);
        gl.uniform1f(discP.u.uStroke, (tower?.strokePx ?? 0) * mpp);
        gl.uniform4fv(discP.u.uFill, rgba01(towerColors[0]));
        gl.uniform4fv(discP.u.uEdge, rgba01(towerColors[1]));
        gl.bindVertexArray(towers.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, towers.count);
        frame.drawCalls++;
        frame.instances += towers.count;
      }
      frame.drawCalls += wallGl.draw('works', wallDraw); // walls hook: outworks, towers, gatehouses, lean-tos
      // Canals (live look; drawCityWaterways): water ribbons, then bridges and lock gates with their edge, above the
      // walls and below the buildings.
      if (d.waterways) {
        gl.useProgram(fillP.program);
        gl.uniform4fv(fillP.u.uView, view);
        gl.uniform1i(fillP.u.uColors, 0);
        fills(plan, 'waterways', false);
        fills(plan, 'waterwayBridges', false);
        fills(plan, 'waterwayBridges', true);
      }
      // Buildings above the streets (as in drawCity). On satellite grounds the far raster stands for them above its
      // fade band, whatever the level of detail.
      if (d.buildings && built && (!o.live?.farTown || farTownBuildingsShown(mpp))) {
        gl.useProgram(fillP.program);
        const pans = !footprint && !!built.mesh.layers.roofs?.triangles.count;
        const buildingLayer = footprint ? 'buildingFootprints' : 'buildings';
        if (pans) {
          // Massing shadows: each piece's outline swept by its own height (cityMassing.ts).
          gl.uniform4fv(fillP.u.uTint, palette === 'parchment' ? PARCHMENT_SHADOW : o.live ? liveShadowTint(palette, buildings?.items[0]) : PAINTED_SHADOW);
          // Live look: each sample shaded once, as the Canvas fills one path per building (its pieces' shadows overlap).
          if (o.live) {
            gl.enable(gl.STENCIL_TEST);
            gl.stencilMask(0xff);
            gl.clearStencil(0);
            gl.clear(gl.STENCIL_BUFFER_BIT);
            gl.stencilFunc(gl.EQUAL, 0, 0xff);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
          }
          fills(built, 'shadows', false);
          if (o.live) gl.disable(gl.STENCIL_TEST);
          gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
        } else if (painted && palette !== 'parchment') {
          // Ground shadow: the same triangles, shifted south-east (metres, with a 1 px floor).
          const dx = Math.max(1.6, 1.1 * mpp),
            dy = 0.8 * dx;
          gl.uniform4fv(fillP.u.uView, [view[0], view[1], view[2] + dx * view[0], view[3] + dy * view[1]]);
          gl.uniform4fv(fillP.u.uTint, PAINTED_SHADOW); // straight RGBA: FILL_FS premultiplies
          fills(built, buildingLayer, false);
          gl.uniform4fv(fillP.u.uView, view);
          gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
        }
        fills(built, buildingLayer, false);
        if (pans) {
          if (textured && built.mats && palette !== 'parchment' && palette !== 'ink') {
            useTextured(tfillP, built.mats, false);
            fills(built, 'roofs', false);
            gl.useProgram(fillP.program);
            gl.uniform4fv(fillP.u.uView, view);
            gl.uniform1i(fillP.u.uColors, 0);
          } else {
            // Live look on natural grounds: the mean tone of the Canvas grain, uneven snow and wall rims (cityGlGrain.ts) at
            // this frame's grain level and strength (coverGrainFrame of the device metres per pixel, as drawPlanRoofsSteps).
            const grain = !!o.live?.grain && !!built.grain && !!built.rim;
            if (grain) {
              const gf = coverGrainFrame(devPx),
                means = grainLevelMeans(gf?.level ?? 0);
              gl.uniform1i(fillP.u.uRoofGrain, 1);
              gl.uniform1i(fillP.u.uRims, devPx <= RIM_DEVICE_MPP ? 1 : 0);
              gl.uniform1f(fillP.u.uGrainStrength, gf?.alpha[0] ?? 0);
              gl.uniform2fv(fillP.u['uGrain[0]'], means.grain);
              gl.uniform4fv(fillP.u['uSnowMean[0]'], means.snow);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, built.grain);
              gl.activeTexture(gl.TEXTURE4);
              gl.bindTexture(gl.TEXTURE_2D, built.rim);
              gl.activeTexture(gl.TEXTURE0);
              gl.uniform1i(fillP.u.uGrainTab, 3);
              gl.uniform1i(fillP.u.uRimTab, 4);
            }
            fills(built, 'roofs', false);
            if (grain) gl.uniform1i(fillP.u.uRoofGrain, 0);
          }
          fills(built, 'roofs', true);
        }
        if (d.buildingLines) fills(built, buildingLayer, true);
        if (footprint && built.mesh.layers.ruins?.triangles.count) {
          // Only native ruin pieces: roofed parts of a decaying lot stay intact.
          gl.uniform4fv(fillP.u.uTint, rgba01(RUIN_PAPER));
          gl.uniform1f(fillP.u.uRuinSpacing, 3 * mpp);
          fills(built, 'ruins', false);
          gl.uniform1f(fillP.u.uRuinSpacing, 0);
          gl.uniform4fv(fillP.u.uTint, rgba01(RUIN_INK));
          fills(built, 'ruins', true);
          gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
        }
      }
      // Selection: a 2 px outline built on demand (a few segments).
      const selKey = `${o.buildingStyle ?? ''}|${o.selectedId ?? ''}|${o.selectedParcel ?? ''}|${generation}|${buildingGeneration}`;
      if (selKey !== selectionKey) {
        selection?.dispose();
        selection = selectionStrokes(o);
        selectionKey = selKey;
      }
      if (selection) {
        useStroke(strokeP);
        gl.uniform4fv(u.uOverride, rgba01(SELECTION.stroke!));
        strokes(selection, 0, 1, { edgePx: 0, inner: 1, minPx: 1, maxRank: 15, crossings: true, dash: 0 });
        gl.uniform4f(u.uOverride, 0, 0, 0, 0);
      }
      gl.bindVertexArray(null);
      frame.cpuMs = performance.now() - start;
      lastFrame = frame;
      return frame;
    },
    pick(point, o) {
      if (!scene) return {};
      const lod = o?.lod ?? (o?.metresPerPixel ? selectCityLod(o.metresPerPixel, lastLod) : (lastLod ?? 'near'));
      const showBuildings = (o?.buildingsVisible ?? true) && (lod === 'near' || lod === 'close') && (!o?.view || o.view === 'buildings' || o.view === 'roles');
      return cityGlPick(scene, showBuildings ? buildings : undefined, point);
    },
    stats() {
      const fs = (m?: CityGlFillMesh) => m && { vertices: m.positions.length / 2, triangles: m.triangles.length / 3, edges: m.lines.length / 2, features: m.featureCount };
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        plan: fs(planMesh),
        buildings: fs(builtMesh),
        streets: streetData?.count ?? 0,
        walls: wallData?.count ?? 0,
        towers: (towerData?.length ?? 0) / 2,
        gpuBytes: (plan?.bytes ?? 0) + (built?.bytes ?? 0) + (streets?.bytes ?? 0) + (walls?.bytes ?? 0) + (towerData?.byteLength ?? 0) + (wallGl?.bytes ?? 0) + (water?.source.byteLength ?? 0),
        build: buildStats,
        buildingsBuild: buildingStats,
        frame: lastFrame,
        renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      };
    },
    dispose() {
      disposed = true;
      generation++;
      buildingGeneration++;
      triangulator.dispose();
      plan?.dispose();
      built?.dispose();
      streets?.dispose();
      walls?.dispose();
      selection?.dispose();
      if (towers) {
        gl.deleteBuffer(towers.vbo);
        gl.deleteVertexArray(towers.vao);
      }
      for (const p of madePrograms()) gl.deleteProgram(p.program);
      for (const l of linking)
        if (!l.done) {
          gl.deleteProgram(l.pending.program);
          l.pending.shaders.forEach(s => gl.deleteShader(s));
        }
      if (water) {
        gl.deleteBuffer(water.vbo);
        gl.deleteVertexArray(water.vao);
        water = undefined;
      }
      if (albedoTex) gl.deleteTexture(albedoTex);
      if (wallsMade) wallGl.dispose(); // walls hook
      canvas?.removeEventListener('webglcontextlost', onLost as EventListener);
      canvas?.removeEventListener('webglcontextrestored', onRestored as EventListener);
      commitPlan = commitBuildings = undefined;
      abortPacking(true);
      if (yards) {
        yards.runs.dispose();
        yards.jambs.dispose();
        yards = undefined;
      }
      plan = built = streets = walls = selection = undefined;
      towers = undefined;
      scene = undefined;
      buildings = undefined;
      planMesh = builtMesh = undefined;
    },
  };

  function selectionStrokes(o: CityGlDrawOptions): StrokePack | undefined {
    if (!scene) return undefined;
    const b = o.selectedId === undefined ? undefined : buildings?.byId.get(o.selectedId);
    const parcel = o.selectedParcel ?? (o.selectedId === undefined ? undefined : scene.parcelById.get(o.selectedId));
    const shapes = b !== undefined ? (o.buildingStyle === 'silhouette' ? (buildings!.items[b].footprint ?? buildings!.items[b].building.footprint) : buildings!.items[b].surface) : parcel !== undefined && scene.parcels[parcel] ? [scene.parcels[parcel].shape] : [];
    const rings = shapes.flatMap(s => [s.outer, ...(s.holes ?? [])]).filter(r => r.length >= 2);
    if (!rings.length) return undefined;
    const n = rings.reduce((s, r) => s + r.length, 0),
      buffer = new ArrayBuffer(n * STROKE_STRIDE * 4),
      f = new Float32Array(buffer),
      u32 = new Uint32Array(buffer);
    let k = 0;
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const a = r[i],
          c = r[(i + 1) % r.length],
          j = k++ * STROKE_STRIDE;
        f[j] = a.x - origin.x;
        f[j + 1] = a.y - origin.y;
        f[j + 2] = c.x - origin.x;
        f[j + 3] = c.y - origin.y;
        f[j + 4] = 0;
        f[j + 5] = SELECTION.widthPx!;
        f[j + 6] = 0;
        u32[j + 7] = 0;
        u32[j + 8] = 0;
      }
    return new StrokePack(gl, { data: buffer, count: k, firstWithRank: [] }, true);
  }
  return renderer;
}

const refusedIds = new WeakMap<ReadonlySet<string>, number>();
let refusedNext = 1;
function refusedKey(set?: ReadonlySet<string>): string {
  if (!set?.size) return '';
  let id = refusedIds.get(set);
  if (!id) {
    id = refusedNext++;
    refusedIds.set(set, id);
  }
  return `${id}:${set.size}`;
}

/** Topmost visible item under a world point (building, then parcel, then block), with its id. */
export function cityGlPick(scene: CityScene, buildings: CityBuildings | undefined, point: Point): CityGlPick {
  const hit: CityGlPick = pickCity(scene, buildings, point);
  if (hit.building) {
    hit.kind = 'building';
    hit.id = hit.building.id;
  } else if (hit.parcel) {
    hit.kind = 'parcel';
    hit.id = hit.parcel.id;
  } else if (hit.block) hit.kind = 'block';
  return hit;
}

/** Synchronous mesh of a scene (tests, tools): the plan fill mesh. */
export const cityGlPlanMesh = (scene: CityScene): CityGlFillMesh => buildFillMeshSync(packPlan(scene));
