import { waterSeasonUniforms } from '../render/seasonPalette';
import { ShaderVariants, finishProgram, specializeShader, startProgram } from './glVariants';
import { LiveGround } from './liveGround';
import { displayQualityUniform, onDisplayQualityChange } from '../render/displayQuality';
import { NEURAL_EARTH_MATERIAL_GLSL, GROUND_COVER_WATER_GLSL, groundCoverInputsGlsl } from '../../../rust/bridge/terrainMaterial';
import { RENDER_3D_MATERIAL_GLSL } from '../../../rust/bridge/terrainMaterial3d';
import { withoutLandDetail } from '../../../rust/bridge/terrainMaterialOccupation';
import { shoreRingPixels, shoreRingTexture } from '../../../rust/bridge/terrainForestBeach';
import { FOREST_GLSL, FOREST_PRELUDE_GLSL, forestBeachTexture, type ForestField, type ForestOccupation, type LandDetail } from '../../../rust/bridge/terrainForest';
import { bindForestBrushes, disposeForestBrushes } from '../render/forestBrushAtlas';
import { createGroundDisplacementSampler } from '../../../rust/bridge/terrainGround';
import { terrainLights, type TerrainLayers, type TerrainLighting } from '../render/terrainLighting';
import { SEA_BAND_WIDTH } from '../render/terrainSea';
import { resampleTerrainSurface } from '../render/raster';
import { LAKE_GLSL } from './lakeGeometry';
import { lakeDistances, seaDistanceSurface, type WaterSurface } from '../render/terrainWater';
/**
 * WebGL2 renderer of the terrain bench. Everything is drawn by the GPU from
 * retained grids, so panning and zooming only change a few uniforms:
 * - relief: cubic B-spline of a control grid (the Rust engine's physical
 *   raster, or sampled heights) with its box-filtered pyramid, analytic
 *   gradient, slope-driven fractal refinement below the source cell;
 * - hypsometric tint and the bench's two-light hillshade, antialiased coast,
 *   cavern rock, contour lines of constant screen width;
 * - diagnostic rasters, continuous procedural lake shores and river capsules
 *   with hydraulic widths interpolated in world metres.
 * Heights in metres, coordinates in metres from the map's north-west corner.
 */
import { RENDER_V2_GLSL, renderV2GlacierSources } from '../../../rust/bridge/terrainRenderV2';
import { UNDERDARK_GLSL } from '../../../rust/bridge/terrainRenderUnderdark';
import { renderV2ZoneUniform, setSeasonCalendarGl, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { styleTraits, terrainStyle, type TerrainStyle } from '../render/terrainStyle';
import { biomePalette } from '../render/biomes';
import type { RenderColors } from '../render/customColors';
import { WATER_STYLE_GLSL, waterUniforms } from '../render/waterStyle';
import { MATERIAL_WATER_GLSL, MOONLIGHT_GLSL, groundCoverActive } from '../render/materialLook';
import { retainedWaterPaths, type RetainedWaterPath } from '../render/retainedWaterGeometry';
import { paintRetainedWaterView, retainedRegime, type RetainedRegime } from './retainedWaterRegime';
import { waterClimate, type WaterSeason } from '../render/waterRegime';
import { RENDER_WATER_FS, renderWaterRings } from '../render/renderWaterShader';
import { WATER_FRESH_ICE_GLSL, WATER_REGIME_GLSL } from '../render/waterRegime';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../render/strokes';
import type { View } from '../render/view';
import { FRACTAL_ROTATIONS, type FractalDetail } from '../../../rust/bridge/terrainAdjust';
import { createTerrainSurfaceSampler, heightPyramid } from './terrainSurface';
import { TERRAIN_3D_NOISE_GLSL } from './terrain3dNoise';
import { isNeuralRefinement, type TerrainRefinement } from './terrainRefinement';
export { heightPyramid } from './terrainSurface';

export type GlStyle = TerrainStyle;

/** Control points of a height layer: `n²` values at cell centres of the square `[x, x + width]²`. */
export interface HeightLayer {
  waterSurface?: WaterSurface;
  x: number; y: number; width: number; n: number; data: Float32Array;
  /** 1 where cavern rock (same grid), optional. */
  cave?: Uint8Array;
}

export interface TerrainLook {
  ambience?: 'day' | 'night'; waterLook?: 'ink' | 'natural';
  groundCover?: boolean;
  colors?: RenderColors;
  /** V2 composes the retained canopy over every ground; standalone benches keep their material-only canopy. */
  independentCanopy?: boolean;
  /** Explicit opt-in for perspective captures; ordinary 2D styles retain their surface. */
  mesh3d?: boolean;
  v2Season?: number;
  /** Edits of the zone's year (appearance panel). */
  v2Calendar?: SeasonCalendar;
  /** Internal premultiplied water/ink pass for the physically shaded flyover. */
  groundCapture?: boolean;
  refinement3d?: TerrainRefinement;
  climate?: { temperature: number; precipitation: number };
  /** V2 climate zone (Render v2 styles); absent keeps the climate-only look. */
  climateZone?: ClimateZone;
  /** Underdark world (biome 'underdark'): the satellite looks draw a cave floor, rock masses and cave water. */
  underdark?: boolean;
  /** Underdark: lantern glow on the cave floor around towns, x, y, radius (m) per town, up to 16. */
  townGlow?: Float32Array;
  /** Underdark: fungal farm lots (underdarkFarmBeds): x, y, half-size, angle per farm, up to 32. */
  farmBeds?: Float32Array;
  style: GlStyle; waterStyle?: TerrainStyle; mapWidth: number; lighting: TerrainLighting; layers: TerrainLayers;
  globalMin: number; globalMax: number;
  contours: boolean; contourStep: number; flatRelief: boolean;
  /** Fractal refinement below `sourceCell` (metres), seeded. */
  refine: boolean; sourceCell: number; seed: number; detail: FractalDetail;
  /** Lower clamp of the regional reliefs (the engine keeps land at ≥ 0.3 m). */
  floor: number;
  frame: boolean; background: string;
}

export interface WaterLayer {
  /** Prefiltered signed shore coefficients over the map (`n²`, drainage cells). */
  lake?: Float32Array; n: number;
  /** `procedural` (default) adds sub-cell shore detail; `exact` draws the B-spline's zero as is. */
  shore?: 'procedural' | 'exact';
  /** Instances: x0, y0, x1, y1, upstream/downstream width (m), r, g, b. */
  rivers?: Float32Array;
  /** The river colour carries the seasonal regime for the painted compositor (waterRegime.ts regimeRgb). */
  regime?: boolean;
}

/** Seasonal regime of retained water (City Bench): zone and season, and `city` for the city-zoom river colour. */
export interface RetainedWaterOptions { season?: WaterSeason; city?: boolean }

export interface OverlayLayer { rgba: Uint8Array; n: number }

export const hex = (value: string): [number, number, number] => {
  const v = value.replace('#', '');
  const full = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
};

export const TERRAIN_VS = `#version 300 es
precision highp float;
uniform vec4 uQuad; // device-pixel rectangle x0, y0, x1, y1 (y down)
uniform vec2 uCanvas;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 p = mix(uQuad.xy, uQuad.zw, corner);
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

/** The ground GLSL may already carry the forest functions; never declare them twice. */
export const RENDER_3D_FOREST_GLSL = RENDER_3D_MATERIAL_GLSL.includes('applyForest(') ? '' : FOREST_GLSL;

export const TERRAIN_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
#ifdef AUX_PASS
layout(location=0) out highp uvec4 outAux;
layout(location=1) out vec4 outColor;
#else
layout(location=0) out vec4 outColor;
#endif
uniform vec2 uCanvas;          // device pixels
uniform vec2 uOrigin;          // world position of the canvas' top-left corner
uniform float uPx;             // metres per device pixel
uniform float uDpr;
uniform float uMapW;
uniform sampler2D uField; uniform int uFieldN; uniform vec2 uFieldOrigin; uniform float uFieldCell; uniform int uMaxLod;
uniform float uAlpha; uniform int uBase;
uniform sampler2D uCave; uniform int uHasCave;
uniform sampler2D uLake; uniform int uHasLake; uniform float uLakeN; // uHasLake: 1 procedural shore, 2 exact shore
uniform sampler2D uOverlay; uniform int uHasOverlay;
uniform sampler2D uWaterLayer; uniform int uUseWaterLayer;
// City Bench retained rivers (setRetainedWater city): x 1 grades their depth from the bank, y their sediment tint.
uniform vec2 uCityWater;
uniform int uWaterVisible; uniform int uRelief; uniform int uMode;             // 0 shaded, 1 elevation colours
uniform vec3 uPaper, uSea, uBackground, uFrameColor, uContourColor;
uniform vec3 uShore; uniform int uCoastalSea;
uniform sampler2D uCoastDistance; uniform float uSeaBand; uniform vec2 uCoastOrigin; uniform float uCoastWidth; uniform int uCoastN;
uniform vec3 uStops[8]; uniform float uStopT[8]; uniform int uStopCount;
uniform vec3 uLight, uLight2; uniform float uExaggeration, uFlatLight, uRockStrength;
uniform float uShade, uMinH, uMaxH, uGlobalMin, uFloor;
uniform int uCoastal, uFrame;
uniform int uContours; uniform float uStep, uThinW, uIndexW, uThinA, uIndexA, uFlatSlope;
uniform int uRefine; uniform float uSourceCell; uniform uint uSeed;
uniform int uEnhanced3d;
uniform int uGroundCapture;
uniform int uNaturalWater; uniform int uNight;
uniform vec4 uTownGlow[16]; uniform int uTownGlowCount;
uniform int uUnderdark;   // Underdark world on the material looks (mode >= 2): cave floor, rock and water (UNDERDARK_GLSL)
uniform int uRefinementMode;
uniform sampler2D uRefined, uPreviousRefined;
uniform vec4 uRefinedRect, uPreviousRefinedRect;
uniform int uRefinedN, uPreviousRefinedN;
uniform float uRefinedAlpha;
// Detail noise: amplitude, Hurst, lacunarity, first wavelength (source cells); slope exponent, slope floor, shore fade (m); octaves.
uniform vec4 uDetailA; uniform vec3 uDetailB; uniform int uOctaves;

vec4 bw(float t) { float t2 = t * t, t3 = t2 * t, u = 1.0 - t; return vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0; }
vec4 bd(float t) { float t2 = t * t, u = 1.0 - t; return vec4(-0.5 * u * u, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2); }
${LAKE_GLSL}

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
  float t = lod - float(lower);
  // Both pyramid levels from one loop (one inlined level() per surface() call: the material shaders call it often).
  int levels = t > 0.001 && lower < uMaxLod ? 2 : 1;
  vec3 a = vec3(0.0);
  for (int k = 0; k < levels; k++) { vec3 v = level(lower + k, world); a = k == 0 ? v : mix(a, v, t); }
  return a;
}
// Mean height of the four neighbours at distance r (+x, -x, +y, -y), one surface() call in a loop.
float surfaceMean4(vec2 world, float r) {
  float sum = 0.0;
  for (int k = 0; k < 4; k++) sum += surface(world + (k == 0 ? vec2(r, 0.0) : k == 1 ? vec2(-r, 0.0) : k == 2 ? vec2(0.0, r) : vec2(0.0, -r))).x;
  return sum * 0.25;
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

float hillshade(vec2 gradient) {
  vec2 g = gradient * uExaggeration;
  float inv = inversesqrt(dot(g, g) + 1.0);
  vec3 n = vec3(-g * inv, inv);
  float sh = 0.75 * dot(n, uLight) + 0.25 * dot(n, uLight2);
  float dd = sh - uFlatLight;
  return clamp(1.0 + uShade * (dd > 0.0 ? 1.0 : 0.8) * dd * 1.15, 0.58, 1.25);
}

${GROUND_COVER_WATER_GLSL}
${FOREST_PRELUDE_GLSL}
vec3 forestRootSurface(vec2 world){return level(0,world);}
float forestRootCell(){return uFieldCell;}
float forestWaterCoverage(vec2 world) {
  if(surfaceGroundWaterCached&&all(equal(world,surfaceGroundWaterPoint)))return surfaceGroundWaterSample;
  // Sea is drawn from its own coastal field, outside the inland water layer. Root tests need both.
  float seaCover=0.;
  if(uCoastalSea==1){
    vec2 g=clamp((world-uCoastOrigin)/uCoastWidth*float(uCoastN)-.5,vec2(0.),vec2(float(uCoastN-1)));
    ivec2 p=ivec2(floor(g)),q=min(p+1,ivec2(uCoastN-1));vec2 f=fract(g);
    float d=mix(mix(texelFetch(uCoastDistance,p,0).r,texelFetch(uCoastDistance,ivec2(q.x,p.y),0).r,f.x),mix(texelFetch(uCoastDistance,ivec2(p.x,q.y),0).r,texelFetch(uCoastDistance,q,0).r,f.x),f.y);
    seaCover=clamp(d+.5,0.,1.);
  }
  if(uUseWaterLayer==0)return surfaceGroundRetainWater(world,seaCover);
  vec2 uv=(world-uOrigin)/(uPx*uCanvas);
  return surfaceGroundRetainWater(world,max(seaCover,textureLod(uWaterLayer,vec2(uv.x,1.-uv.y),0.).a));
}
${NEURAL_EARTH_MATERIAL_GLSL}
${TERRAIN_3D_NOISE_GLSL}
${groundCoverInputsGlsl(RENDER_3D_MATERIAL_GLSL)}
${RENDER_3D_FOREST_GLSL}
${RENDER_V2_GLSL}
${WATER_FRESH_ICE_GLSL}
${WATER_REGIME_GLSL}

${WATER_STYLE_GLSL}
${MATERIAL_WATER_GLSL}
${MOONLIGHT_GLSL}
${UNDERDARK_GLSL}
// Variant constants (terrainFragment): NATURAL compiles the material path, uRenderV2/uForest
// become constants when off, so ANGLE/D3D11 (FXC) only compiles what the look uses.
V2Env v2Here;
// Mean height of the 300 m ring around the fragment (surfaceMean4: 16 to 128 texel fetches), evaluated once in
// main and shared by the topographic position of the environment (naturalTpi) and of the material.
float naturalMean=0.;
float naturalTpi(vec3 s, vec2 world) {
  return (s.x-naturalMean)/(6.*max(300.,uFieldCell*2.));
}
uniform sampler2D uShoreRing; uniform vec3 uShoreRingRect;
#if NATURAL
vec3 naturalMaterial(vec3 s, vec2 world) {
  float r=max(300.,uFieldCell*2.);
  float mean=naturalMean;
  float shore=1e9, openness=0.;
  // One fetch of the baked ring per fragment: shore distance and openness (RG, read near the sea), sky occlusion
  // and horizon tangent toward the light (BA, the relief light of v2ShadeGround).
  vec4 ring=textureLod(uShoreRing,(world-uShoreRingRect.xy)/uShoreRingRect.z,0.);
  if(s.x<12. && length(s.yz)<.5) {
    shore=ring.x;openness=ring.y;
  }
  shore=min(shore,max(s.x,0.)/max(length(s.yz),.0001));
  if(uMode==3 || uRenderV2>0) {
    surfaceGroundReadInputs(world,uPx);
    vec3 base=level(0,world);GroundMaterial m;
    // Landform slope of the relief light: the height layer's own cell scale when zoomed in (no refinement detail),
    // the footprint-filtered surface once a pixel spans several cells.
    if(uRenderV2>0)v2ReliefSet(ring.ba,mix(base.yz,s.yz,sstep(1.5,3.,uPx/uFieldCell)));
    vec3 macro=earthMaterial(base,world,max(uPx,1.),(base.x-mean)/(6.*r),shore,openness);
    if(uRenderV2>1)return v2DiagnosticEnv(v2Here,uPx);
    if(uRenderV2>0)m=v2GroundEnv(v2Here,s,world,uPx,uLight.xzy,uLight2.xzy,uRockStrength,renderGuideBaseOpen);
    else {
      m=terrainGroundMaterial(base,world,uPx,macro,uMaterialClimate,uMaterialSeed);
    }
    applyGroundOccupation(m,world,uPx);
    if(uForest==1)applyForest(m,world,uPx,uLight.xzy);
    applyPaperMap(m,world,uPx);
    vec3 rgb=uRenderV2>0?v2ShadeGround(m,vec3(0.,1.,0.),uLight.xzy,uLight2.xzy,uRockStrength):shadeTerrainGround(m,vec3(0.,1.,0.),uLight.xzy,uLight2.xzy,uRockStrength);
    return uRenderV2>0?v2DisplayShoulder(rgb):rgb;
  }
  return earthMaterial(s,world,max(uPx,1.),(s.x-mean)/(6.*r),shore,openness);
}
#endif
vec3 land(vec3 s, vec2 world) {
#if NATURAL
  if(uMode>=2){vec3 c=naturalMaterial(s,world);return uMode==2?c*hillshade(s.yz):c;}
#endif
  if (uMode == 1) {
    float landMin = uCoastal == 1 ? 0.0 : uGlobalMin;
    float t = clamp((s.x - landMin) / max(1e-6, uMaxH - landMin), 0.0, 1.0);
    float position = (uCoastal == 1 ? 1.0 : 0.0) + t * (uCoastal == 1 ? 4.0 : 5.0);
    int index = min(4, int(floor(position)));
    return mix(ELEV[index], ELEV[index + 1], position - float(index));
  }
  // The bench's two-light hillshade, vertical exaggeration 2.
  float f = hillshade(s.yz);
  float t = clamp((s.x - uMinH) / max(1.0, uMaxH - uMinH), 0.0, 1.0);
  return hypso(pow(t, 0.85)) * f;
}

float paperShore(vec2 world) {
  if (uCoastalSea != 1) return 0.;
  vec2 g = clamp((world - uCoastOrigin) / uCoastWidth * float(uCoastN) - .5, vec2(0.), vec2(float(uCoastN - 1)));
  ivec2 p = ivec2(floor(g)), q = min(p + 1, ivec2(uCoastN - 1)); vec2 f = fract(g);
  float d = mix(mix(texelFetch(uCoastDistance,p,0).r,texelFetch(uCoastDistance,ivec2(q.x,p.y),0).r,f.x),mix(texelFetch(uCoastDistance,ivec2(p.x,q.y),0).r,texelFetch(uCoastDistance,q,0).r,f.x),f.y);
  return exp(-d / (uMapW * .011));
}

vec3 sea(vec2 world) {
  float distance = uSeaBand;
  if (uCoastalSea == 1) {
    vec2 g = clamp((world - uCoastOrigin) / uCoastWidth * float(uCoastN) - .5, vec2(0.), vec2(float(uCoastN - 1)));
    ivec2 p = ivec2(floor(g)), q = min(p + 1, ivec2(uCoastN - 1)); vec2 f = fract(g);
    distance = mix(mix(texelFetch(uCoastDistance,p,0).r,texelFetch(uCoastDistance,ivec2(q.x,p.y),0).r,f.x),mix(texelFetch(uCoastDistance,ivec2(p.x,q.y),0).r,texelFetch(uCoastDistance,q,0).r,f.x),f.y);
  }
  float position=max(0.,distance)/uSeaBand;
  return uWaterVisible == 1 ? (uNaturalWater==1?materialWater(world,position,uPx):styledWater(position)) : uPaper;
}

vec3 refinedSurface(sampler2D field, vec4 rect, int n, vec2 world) {
  float cell=rect.z/float(n); vec2 g=(world-rect.xy)/cell-.5, t=fract(g); ivec2 b=ivec2(floor(g))-1;
  vec4 wx=bw(t.x),wy=bw(t.y),dx=bd(t.x),dy=bd(t.y); vec3 s=vec3(0.);
  for(int j=0;j<4;j++) for(int i=0;i<4;i++) {
    float h=texelFetch(field,clamp(b+ivec2(i,j),ivec2(0),ivec2(n-1)),0).r;
    s+=h*vec3(wx[i]*wy[j],dx[i]*wy[j]/cell,wx[i]*dy[j]/cell);
  }
  return s;
}
float refinedCoverage(vec4 rect,int n,vec2 world) {
  if(n<4)return 0.; float cell=rect.z/float(n);
  vec2 edge=min(world-rect.xy,rect.xy+rect.zz-world)/cell;
  return smoothstep(12.,16.,min(edge.x,edge.y));
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 world = uOrigin + px * uPx;
#ifdef AUX_PASS
  // Auxiliary pass: the near crowns (words xyz) and the Render v2 water colour (word w) of this pixel,
  // read back by the map pass (forestCanopyAt, the V2 water mix below).
  uvec3 auxCanopy = uForest == 1 ? forestCanopyPack(forestCanopyNear(forestPrep(world, uPx), normalize(uLight.xzy))) : uvec3(0u);
  if (uRenderV2 == 0) { outAux = uvec4(auxCanopy, 0u); return; }
#endif
  bool inside = world.x >= 0.0 && world.y >= 0.0 && world.x <= uMapW && world.y <= uMapW;
  if (!inside) {
#ifdef AUX_PASS
    outAux = uvec4(auxCanopy, 0u); return;
#endif
    if (uBase == 0) discard;
    outColor = uGroundCapture==1 ? vec4(0.) : vec4(uBackground, 1.0);
  } else {
    vec3 s = surface(world);
    if (uFloor > 0.0) s.x = max(s.x, uFloor);
    // Contours follow the raster surface: refinement adds relief, not ink.
    vec3 raster = s;
    if(uEnhanced3d==1 && uGroundCapture==0 && (uQuality==0 || uPx<min(8.,uSourceCell*.25))) {
      if(uRefinementMode==1 && s.x>0.) s+=terrain3dDetail(world,s);
      if(uRefinementMode==2) {
        float a=refinedCoverage(uPreviousRefinedRect,uPreviousRefinedN,world);
        if(a>0.) s=mix(s,refinedSurface(uPreviousRefined,uPreviousRefinedRect,uPreviousRefinedN,world),a);
        a=refinedCoverage(uRefinedRect,uRefinedN,world)*uRefinedAlpha;
        if(a>0.) s=mix(s,refinedSurface(uRefined,uRefinedRect,uRefinedN,world),a);
      }
      raster=s;
    } else if (uGroundCapture==0 && uRefine == 1 && s.x > 0.0 && uPx * 2.0 < uSourceCell * uDetailA.w && (uQuality==0 || uPx<min(8.,uSourceCell*.25))) s += detail(world, s);
    float grad = length(s.yz);
    // Antialiased coast at the zero level (screen-space width of the height ramp).
    float ramp = max(grad * uPx, 1e-4);
    float landCover = uCoastal == 1 ? clamp(s.x / ramp + 0.5, 0.0, 1.0) : (s.x > 0.0 ? 1.0 : 0.0);
    // Hidden water keeps the cartographic paper over the submerged ground.
    // Its explicit coverage also prevents the physical material recolouring it.
    float coverage=1.-landCover;
    vec3 landS=vec3(max(s.x,1e-3),s.yz);
    // Underdark: the Render v2 environment (and its material) is never evaluated.
    bool underdark=uMode>=2 && uUnderdark==1;
    // The 300 m mean height, once per fragment, for the looks that read it (naturalTpi, naturalMaterial).
    // The look switches are tested alone, so a variant that never reads the mean compiles none of it.
    if(uRenderV2>0){if(!underdark)naturalMean=surfaceMean4(world,max(300.,uFieldCell*2.));}
    else if(uMode>=2||uForest==1){if(uGroundCapture==0&&!underdark)naturalMean=surfaceMean4(world,max(300.,uFieldCell*2.));}
    if(uRenderV2>0)if(!underdark)v2Here=v2Local(landS,world,naturalTpi(landS,world),uPx);
#ifdef AUX_PASS
    vec3 landColor=vec3(0.);
#else
    vec3 landColor=vec3(0.);
    float udRock=0.,udRim=0.;
    if(underdark && uGroundCapture==0){
      // Rock mask (1 = rock), its occlusion on the floor from two blurred rings (1.5 and 4 source cells), the rim
      // where floor meets wall; damp floor from the water layer around the pixel.
      float ao=0.,wet=0.;
      if(uHasCave==1){
        float span=uFieldCell*float(uFieldN);vec2 uv=(world-uFieldOrigin)/span;
        float raw=texture(uCave,uv).r,near=0.,far=0.;
        for(int k=0;k<4;k++){
          vec2 d=k==0?vec2(1.,0.):k==1?vec2(-1.,0.):k==2?vec2(0.,1.):vec2(0.,-1.);
          near+=texture(uCave,uv+d*1.5*uFieldCell/span).r;far+=texture(uCave,uv+vec2(d.x-d.y,d.x+d.y)*.7071*4.*uFieldCell/span).r;
        }
        // Crisp wall: the soft field is 128 on the wall and ±96 per source cell, so the edge is antialiased per pixel.
        float edge=max(.376*uPx/uFieldCell,1e-3);
        udRock=clamp((raw-.5)/edge+.5,0.,1.);
        ao=clamp(.75*near*.25+.35*far*.25,0.,1.)*(1.-udRock);
        // Rim: a lit ledge on the rock side of the wall, a few metres wide once resolved.
        float ledge=clamp(.375*6./uFieldCell,.02,.45);
        udRim=smoothstep(.5,.5+ledge*.35,raw)*(1.-smoothstep(.5+ledge*.35,.5+ledge,raw))*clamp(uFieldCell/uPx*.25,0.,1.);
      }
      if(uUseWaterLayer==1){
        float r=clamp(30./uPx,2.,24.);ivec2 here=ivec2(gl_FragCoord.xy),top=ivec2(uCanvas)-1;
        for(int k=0;k<4;k++)wet+=texelFetch(uWaterLayer,clamp(here+ivec2((k==0?vec2(r,0.):k==1?vec2(-r,0.):k==2?vec2(0.,r):vec2(0.,-r))),ivec2(0),top),0).a;
        wet=clamp(wet*.4,0.,1.);
      }
      landColor=underdarkFloor(landS,world,uPx,wet,ao);
      // Lantern light of the towns pooling on the cave floor (warm, falling off past the built extent).
      float glow=0.;
      for(int k=0;k<16;k++){if(k>=uTownGlowCount)break;vec4 g=uTownGlow[k];float d=length(world-g.xy)/max(g.z,1.);glow+=exp(-d*d*.9);}
      landColor+=vec3(.20,.12,.05)*min(glow,1.2)*(1.-.5*ao);
    }
    else if(uGroundCapture==0 && !underdark)landColor=land(landS,world);
#endif
    // One sea evaluation (natural water included) for the three uses below.
    vec3 seaColor = sea(world);
    vec3 color = uGroundCapture==1 ? seaColor*coverage : mix(seaColor,landColor,landCover);
    if (uRelief == 0) color = mix(seaColor, uPaper, landCover);
    if (uHasCave == 1 && uRelief == 1 && !underdark) {
      vec2 uv = (world - uFieldOrigin) / (uFieldCell * float(uFieldN));
      float rock = clamp((texture(uCave, uv).r - .5) / max(.376 * uPx / uFieldCell, 1e-3) + .5, 0., 1.);   // the same cut as the overlay walls
      vec3 nn = normalize(vec3(-s.yz * uExaggeration * 0.5, 1.0));
      float shade = clamp(uRockStrength * (length(nn.xy) * (36.0 + 84.0 * dot(nn.xy, uLight.xy)) + (1.0 - nn.z) * 12.0), 0.0, 72.0) / 255.0;
      color = mix(color, vec3(shade), rock);
      coverage=rock+coverage*(1.-rock);
    }
#ifndef AUX_PASS
    // Variant switches alone in their own test: mixed with a runtime uniform, the WebGPU path (Tint → DXC)
    // kept the dead branch and inlined its whole material, seconds of compilation for every variant.
    if(uForest==1 && uMode!=3 && uRenderV2==0)if(uGroundCapture==0 && !underdark){
      vec3 root=level(0,world);
      float shore=max(root.x,0.)/max(length(root.yz),.0001);
      vec3 macro=earthMaterial(root,world,max(uPx,1.),naturalTpi(root,world),shore,0.);
      GroundMaterial canopy=terrainGroundMaterial(root,world,uPx,macro,uMaterialClimate,uMaterialSeed);
      applyForest(canopy,world,uPx,uLight.xzy);
      vec3 crowns=shadeTerrainGround(canopy,vec3(0.,1.,0.),uLight.xzy,uLight2.xzy,uRockStrength);
      if(uNight==1 && uMode<2)crowns=moonlight(crowns);
      color=mix(color,crowns,forestMapCover*landCover);
    }
#endif
    // One V2 water evaluation per fragment (the three cases below only choose its inputs).
    bool v2w=false;vec3 wBase=color;float wCover=0.,wKind=1.,wDepth=0.;
    // Fresh ice of the fragment (terrainRenderV2Winter v2FreshIce): x freeze of the water's altitude, y open channel
    // of a river, z inside a lake, w lake shore; the bank line apart. One sheet evaluation below for every case.
    vec4 wIce=vec4(0.);float wIceEdge=0.;
    // Water climate tints applied after the evaluation (waterRegime.ts): x humic tea, y glacial milk, z sea sediment plume.
    vec3 wTint=vec3(0.);
    // Estuary: share of the river's own water in a sea fragment that lies under a river's ribbon. 1 at the sea-level
    // line inside the channel, 0 once the sea is 6 m deep: the river's colour runs out into the shallows and fades,
    // instead of a deep river ending against a pale wedge of sea.
    float wEst=0.;
    if (uUseWaterLayer==1) {
      vec4 water=texelFetch(uWaterLayer,ivec2(gl_FragCoord.xy),0);
      if(uNight==1 && uMode<2 && uRenderV2==0 && uNaturalWater==1)water.rgb=moonlight(water.rgb);
      float under=uRenderV2>0?1.:1.-forestResolvedCover;
      if(uRenderV2>0){
        v2w=true;wBase=color;wCover=water.a;wKind=s.x<0.?1.:3.;wDepth=s.x<0.?-s.x:8.;
        // Inland water of the seasonal regime (waterRegime.ts): the painted dry beds lie on the ground as painted
        // (sandy); the wet remainder takes the Render v2 water. Ice is not painted for this ground: it comes from
        // the land's snow at the water's altitude, below.
        if(s.x>=0.){
          // Bank crowns lean over the water: rooted on land (forestCrown), drawn whole above it.
          float bed=water.a*(1.-forestResolvedCover);wCover=bed;
          vec3 painted=water.rgb/max(water.a,1e-3);
          // Sandy beds lean red: they are ground. The compositor's damp shadow on the land beside the water (dark
          // olive, greener than any water colour) is ground too: it darkens the bank. Read as partial water it laid a
          // shallow, bed-coloured fringe along every course, most of what a narrow tributary showed beside its trunk.
          float solid=smoothstep(.05,.15,painted.r-painted.b);
          float damp=(1.-solid)*smoothstep(.005,.025,painted.g-max(painted.r,painted.b));
          // Underdark: no ice or dry beds under the vault; the whole course is cave water.
          if(underdark)solid=0.;
          // A dry course shows through the bank crowns.
          float through=uMaterialZone>0?step(.001,V2_WATER_ARIDITY[waterZone()]):0.;
          bed=mix(bed,water.a,solid*through);
          wBase=mix(wBase,painted,bed*solid);wCover*=1.-solid;
          wBase*=1.-.3*wCover*damp;wCover*=1.-damp;
          // City Bench: a retained river reads as water at city zoom instead of a near-black ribbon. Its depth grows
          // from the bank (distance to the nearest dry pixel over 8 directions and 7 radii), and the season's
          // sediment tints it (waterRegime.ts waterClimate).
          if(uCityWater.x>0.&&water.a>.002){
            float bank=128.;ivec2 here=ivec2(gl_FragCoord.xy),top=ivec2(uCanvas)-1;
            if(uQuality>0)bank=water.a/max(length(vec2(dFdx(water.a),dFdy(water.a))),.001);
            else {
            for(int k=0;k<7;k++){
              float r=exp2(float(k));
              for(int i=0;i<8;i++){
                float turn=float(i)*.7853982;
                if(texelFetch(uWaterLayer,clamp(here+ivec2(vec2(cos(turn),sin(turn))*r),ivec2(0),top),0).a<.5)bank=min(bank,r);
              }
            }
            }
            wDepth=clamp(.07*bank*uPx,.4,6.)*water.a;wTint.z=uCityWater.y*wCover;
          }
          // Distance inside the nearest lake, in device pixels (negative outside a lake: lakeShore is positive inside).
          float m=uHasLake>0?lakeShore(world,uHasLake==1):-1e3;
          float inside=uHasLake>0?m/max(fwidth(m),1e-4):-1e3;
          // Dry season of a dry climate: the lake draws down, leaving a pale exposed shore inside its rim.
          float drop=waterLakeDrop()*80.;
          if(drop>1.&&uHasLake>0){
            float ring=step(0.,inside)*(1.-smoothstep(.85*drop,drop,inside*uPx));
            wBase=mix(wBase,waterExposedShore(world),wCover*ring);wCover*=1.-ring;
          }
          // Fresh water freezes with the snow of the land at its own altitude (v2WinterFresh, set by v2Local): a lake
          // is one sheet whose shore opens first while it thaws; a river grows border ice from both banks and keeps
          // an open channel until the cold is deep, so a course is frozen above the snow line and open below it.
          float freeze=underdark?0.:v2WinterFresh;
          if(freeze>.001&&wCover>0.){
            float still=smoothstep(0.,2.,inside),channel=step(freeze,.5),rim=1.;
            // Display tier 0 reads the water layer around the fragment: four taps for the bank line, and while a river
            // is partly frozen sixteen more at the border ice's width (and half of it); all water there is open channel.
            if(uQuality==0){
              ivec2 here=ivec2(gl_FragCoord.xy),top=ivec2(uCanvas)-1;
              float reach=v2WinterShelf(freeze)/uPx,inner=1.;
              int taps=freeze<.97&&still<1.?20:4;
              for(int k=0;k<20;k++){
                if(k>=taps)break;
                float turn=k<4?float(k)*1.5707963:float(k)*.7853982+(k>=12?.3926991:0.),r=k<4?1.6*uDpr:max(k<12?reach:.5*reach,1.);
                float a=texelFetch(uWaterLayer,clamp(here+ivec2(vec2(cos(turn),sin(turn))*r),ivec2(0),top),0).a;
                if(k<4)rim=min(rim,a);else inner=min(inner,a);
              }
              // Border ice narrower than a pixel covers that share of the bank pixels.
              channel=1.-(1.-smoothstep(.35,.85,inner))*min(reach,1.);
              rim=1.-smoothstep(.2,.9,rim);
            } else rim=0.;
            wIce=vec4(freeze,channel,still,1.-smoothstep(0.,24.*uDpr,inside));
            wIceEdge=mix(rim,1.-smoothstep(.5,3.5*uDpr,inside),still);
          }
          wTint.xy=vec2(waterTea(),waterGlacial());
          // The aux-texture variant only mixes wBase where water remains: a fully dry or frozen bed is the ground itself.
          color=wBase;
        } else {
          // A river's sediment plume, painted as a silt tint over the captured sea (renderWaterShader.ts).
          vec3 painted=water.rgb/max(water.a,1e-3);
          wTint.z=smoothstep(-.12,.3,painted.r-painted.b);
          wEst=water.a*(1.-wTint.z)*(1.-smoothstep(0.,6.,-s.x));
          wTint.xy=vec2(waterTea(),waterGlacial())*wEst;
        }
      }
      else color=color*(1.-water.a*under)+water.rgb*under;
    } else if (uWaterVisible == 1 && uHasLake > 0) {
      float m = lakeShore(world, uHasLake == 1);
      float w = max(fwidth(m), 1e-4);
      vec3 lakeColor;
      {
        vec2 g = clamp(world * uLakeN / uMapW - 0.5, vec2(0.), vec2(uLakeN - 1.));
        ivec2 p = ivec2(floor(g)), q = min(p + 1, ivec2(int(uLakeN) - 1));
        vec2 f = fract(g);
        float distance = mix(mix(texelFetch(uLake,p,0).g,texelFetch(uLake,ivec2(q.x,p.y),0).g,f.x),mix(texelFetch(uLake,ivec2(p.x,q.y),0).g,texelFetch(uLake,q,0).g,f.x),f.y);
        float position=max(distance,0.)/uSeaBand;
        lakeColor = uNaturalWater==1?materialWater(world,position,uPx):styledWater(position);
      }
      float a=clamp(m/w+.5,0.,1.);
      if(uRenderV2>0){
        v2w=true;wBase=color;wCover=a;wKind=2.;wDepth=8.*a;
        if(!underdark){wIce=vec4(v2WinterFresh,0.,1.,1.-smoothstep(0.,24.*uDpr,m/w));wIceEdge=1.-smoothstep(.5,3.5*uDpr,m/w);}
      }else color=mix(color,lakeColor,a);
      coverage=a+coverage*(1.-a);
    }
    // The ice lies on the ground like a dry bed (the aux-texture variant only mixes wBase where water remains);
    // only the open remainder takes the Render v2 water.
    if(uRenderV2>0)if(wIce.x>.001){
      vec4 sheet=v2FreshIce(world,uPx,wIce.x,wIce.y,wIce.z,wIce.w,wIceEdge);
      wBase=mix(wBase,sheet.rgb,wCover*sheet.a);wCover*=1.-sheet.a;color=wBase;
    }
    if(uRenderV2>0 && landCover<1.){v2w=true;wBase=landColor;wCover=1.-landCover;wKind=1.;wDepth=max(-s.x,0.);}
#ifdef AUX_PASS
    uint auxWater = 0u;
    if(!underdark && v2w && uV2WaterVisible == 1 && wCover > 0.){
      // One call site for the water model: the second turn is the river's water of an estuary fragment.
      vec3 wc=vec3(0.);
      for(int i=0;i<2;i++){
        if(i==1&&wEst<=.002)break;
        vec3 c=v2WaterColor(v2Here, world, uPx, wCover, i==0?wKind:3., i==0?wDepth:8.);
        wc=i==0?c:mix(wc,c,wEst);
      }
      auxWater=auxPack4x8(vec4(clamp(wc, 0., 1.), 1.));
    }
    outAux = uvec4(auxCanopy, auxWater); return;
#elif defined(AUX_TEXTURE)
    if(underdark){if(v2w && uV2WaterVisible == 1 && wCover > 0.)color = mix(wBase, underdarkWater(world, uPx, wDepth, 1.-smoothstep(0., .9, wCover)*smoothstep(0.,3.,wDepth)), wCover);}
    else if(v2w && uRenderV2 > 0 && uV2WaterVisible == 1 && wCover > 0. && uHasAux == 1){ vec4 aux = auxUnpack4x8(texelFetch(uAux, ivec2(gl_FragCoord.xy), 0).w); if(aux.a > 0.) color = mix(wBase, aux.rgb, wCover); }
#else
    // v2w is only ever set under uRenderV2>0; the variant test first lets the compilers drop the whole water model.
    if(uRenderV2>0)if(v2w){
      if(underdark){if(uV2WaterVisible==1)color=mix(wBase,underdarkWater(world,uPx,wDepth,1.-smoothstep(0.,.9,wCover)*smoothstep(0.,3.,wDepth)),wCover);}
      else {
        // One call site for the water model: the second turn is the river's water of an estuary fragment.
        vec3 wc=color;
        for(int i=0;i<2;i++){
          if(i==1&&wEst<=.002)break;
          vec3 c=v2WaterAtEnv(v2Here,wBase,world,uPx,wCover,i==0?wKind:3.,i==0?wDepth:8.);
          wc=i==0?c:mix(wc,c,wEst);
        }
        color=wc;
      }
    }
#endif
#ifndef AUX_PASS
    if(uRenderV2>0&&v2w&&uV2WaterVisible==1&&!underdark){
      // Keep gallery shade on inland water. Detached crown silhouettes on the open sea read as offshore trees.
      if(wKind>1.5)color*=1.-.4*forestResolvedShade*wCover;
      // Boreal humic water darkens to tea; alpine glacial flour turns lakes milky turquoise; silt plumes off river mouths.
      color=mix(color,color*vec3(.86,.70,.48),wTint.x*wCover);
      color=mix(color,vec3(.38,.62,.62),.45*wTint.y*wCover);
      color=mix(color,vec3(.45,.38,.25),.55*wTint.z);
    }
    if(uPaperMap==1&&v2w&&wCover>0.&&!underdark){
      vec3 paper=paperWater(wKind,paperShore(world));
      // Parchment seas take the climate in muted paper tones: greener on warm coasts, clearer when arid, greyer when cold.
      if(wKind<1.5){
        float T=uMaterialClimate.x,warm=smoothstep(17.,25.,T),cold=1.-smoothstep(-1.,6.,T),arid=1.-smoothstep(150.,500.,uMaterialClimate.y);
        paper*=mix(vec3(1.),vec3(.93,1.03,.97),warm);
        paper=mix(paper,paper*vec3(.98,1.,1.04)+.02,arid);
        paper*=mix(vec3(1.),vec3(.90,.93,.96),cold);
      }
      color=mix(wBase,paper,wCover);
    }
#endif
#ifndef AUX_PASS
    if(underdark && uGroundCapture==0){
      // Rock covers everything below it, rivers and lakes in their tunnels included; the painted look turns sepia.
      vec3 rockColor=underdarkRock(s,world,uPx,udRim);
      // Painted look: sepia washes on the floor, the rock in a deep ink so the two never merge in the shade.
      color=uPaperMap==1?mix(underdarkPaper(color),underdarkPaper(rockColor)*vec3(.42,.38,.36),udRock):mix(color,rockColor,udRock);
      coverage=udRock+coverage*(1.-udRock);
    }
    // Underdark is already its own night: no moonlight on top of it.
    if(uNight==1 && uGroundCapture==0 && (uMode>=2 || uRenderV2>0) && !underdark)color=moonlight(color);   // the whole satellite / paper-map ground, whatever its elevation mode
#endif
    if (uContours == 1 && s.x > 0.0 && uMode != 1) {
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
      coverage=a+coverage*(1.-a);
    }
    if (uHasOverlay == 1) {
      vec4 o = texture(uOverlay, world / uMapW);
      color = mix(color, o.rgb, o.a);
      coverage=o.a+coverage*(1.-o.a);
    }
    if (uFrame == 1 && uBase == 1) {
      vec2 e = min(world, vec2(uMapW) - world) / uPx;
      float d = min(e.x, e.y);
      color = mix(color, uFrameColor, clamp(1.2 * uDpr * 0.5 + 0.5 - d, 0.0, 1.0));
    }
    outColor = vec4(color, uGroundCapture==1 ? coverage : uAlpha);
  }
}`;

export const RIVER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec2 aWidth;
layout(location = 2) in vec3 aColor;
uniform vec2 uCanvas; uniform vec2 uOrigin; uniform float uPx; uniform float uDpr;uniform int uPhysicalWidth;
out vec2 vP; flat out vec4 vSeg; flat out vec2 vHalf; flat out vec3 vColor;
void main() {
  vec2 a = (aSeg.xy - uOrigin) / uPx, b = (aSeg.zw - uOrigin) / uPx;
  vec2 d = b - a; float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  // Cartographic width: below its physical size on screen, a river keeps a
  // stroke growing with the logarithm of its width: hairline streams (about
  // 2 km² drained, 7 m wide), 1 px at 20 km², bold trunks.
  vec2 carto = clamp(0.35 + 0.4 * log2(max(aWidth, vec2(6.0)) / 6.0), 0.35, 3.2) * uDpr;
  vec2 half_ = (uPhysicalWidth==1?aWidth/uPx:max(aWidth/uPx,carto))*.5;
  float r = max(half_.x, half_.y) + 1.0;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 p = mix(a - dir * r, b + dir * r, corner.x) + nrm * r * (corner.y * 2.0 - 1.0);
  vP = p; vSeg = vec4(a, b); vHalf = half_; vColor = aColor;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

export const RIVER_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vP; flat in vec4 vSeg; flat in vec2 vHalf; flat in vec3 vColor;
out vec4 outColor;
uniform vec2 uOrigin; uniform float uPx; uniform float uMapW;
uniform sampler2D uOverlay; uniform int uHasOverlay;
uniform sampler2D uLake; uniform int uHasLake; uniform float uLakeN;
vec4 bw(float t) { float t2=t*t,t3=t2*t,u=1.-t; return vec4(u*u*u,3.*t3-6.*t2+4.,-3.*t3+3.*t2+3.*t+1.,t3)/6.; }
${LAKE_GLSL}
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  float d = length(pa - ba * h);
  float alpha = clamp(mix(vHalf.x, vHalf.y, h) + 0.5 - d, 0.0, 1.0);
  if (uHasLake > 0) {
    float m = lakeShore(uOrigin + vP * uPx, uHasLake == 1);
    alpha *= 1. - clamp(m / max(fwidth(m), 1e-4) + .5, 0., 1.);
  }
  if (alpha <= 0.0) discard;
  // Premultiplied; blended with MAX so overlapping capsules cover like one stroke.
  vec3 color = vColor;
  if (uHasOverlay == 1) { vec4 overlay = texture(uOverlay, (uOrigin + vP * uPx) / uMapW); color = mix(color, overlay.rgb, overlay.a); }
  outColor = vec4(color * alpha, alpha);
}`;

export const COMPOSITE_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }`;
export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uLayer;
out vec4 outColor;
void main() { outColor = texelFetch(uLayer, ivec2(gl_FragCoord.xy), 0); }`;

const compile = (gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram => finishProgram(gl, startProgram(gl, vs, fs));

/** Map program variant (glVariants.ts): the look's mode, Render v2 number, forest and brushes as constants.
 * Forest crowns and Render v2 water come from an auxiliary pass (mapPasses). Measured alone with FXC:
 * Render v2 with forest 22 s for the map and 21 s for its auxiliary pass (linking in parallel), Render v2
 * 19 s + 12 s, natural 5 s; the full shader never loaded. On FXC they link in the background. */
/** Natural water is a runtime uniform, not a variant: Satellite and Satellite-2 (ink water) share their programs. */
export interface TerrainVariant { mode: number; v2: number; forest: boolean; brushes: boolean }
export const PREVIEW_VARIANT: TerrainVariant = { mode: 0, v2: 0, forest: false, brushes: false };
const variantKey = (v: TerrainVariant): string => `${v.mode}.${v.v2}.${+v.forest}${+v.brushes}`;
/** Map passes of a look: forest crowns and Render v2 water are rendered first by an auxiliary pass
 * (one RGBA32UI texture: crowns in three words, the water colour in the fourth), then read by the map. */
export const mapPasses = (v: TerrainVariant): ('aux' | 'map')[] => v.forest || v.v2 > 0 ? ['aux', 'map'] : ['map'];
/** Holdings take a 17th texture unit. ANGLE on D3D11 stops at 16: there the shader leaves them out and fields keep their plain material. */
export const glLandDetailUnit = (gl: WebGL2RenderingContext): number | undefined => gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) > 16 ? 16 : undefined;
let glTerrainFs = TERRAIN_FS;
const terrainFragment = (v: TerrainVariant): string => specializeShader(glTerrainFs,
  { uMode: v.mode, uRenderV2: v.v2, uForest: +v.forest, uForestBrushes: +v.brushes },
  { NATURAL: v.mode >= 2 ? 1 : 0, ...(mapPasses(v).includes('aux') ? { AUX_TEXTURE: 1 } : {}) });
const auxKey = (v: TerrainVariant): string => `aux.${variantKey(v)}`;
const auxFragment = (v: TerrainVariant): string => specializeShader(glTerrainFs,
  { uMode: v.mode, uRenderV2: v.v2, uForest: +v.forest, uForestBrushes: +v.brushes }, { NATURAL: 0, AUX_PASS: 1 });
export const lookMode = (look: TerrainLook): number => styleTraits(look.style).elevation ? 1 : look.layers.hypsometry && styleTraits(look.style).ground3d ? 3 : styleTraits(look.style).neuralEarth && look.layers.hypsometry ? 2 : 0;

interface GpuLayer { layer: HeightLayer; levels: Float32Array[]; texture: WebGLTexture; cave?: WebGLTexture; alpha: number; fadeStart: number }

export class TerrainGl {
  readonly gl: WebGL2RenderingContext;
  private terrain!: WebGLProgram; private river: WebGLProgram; private composite: WebGLProgram;
  private variants: ShaderVariants;
  /** Last terrain variant drawn: it stands in while the look's own variant links. */
  private lastTerrain?: WebGLProgram;
  /** Auxiliary pass output (RGBA32UI) and the inputs it was rendered for. */
  private auxTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private auxKey = '';
  private emptyAux?: WebGLTexture;
  /** Bumped by setForest: the auxiliary pass depends on the forest field and the applied occupation. */
  private forestVersion = 0;
  private capturing = false;
  /** Painted water of the `render` style (renderWaterShader.ts), compiled on first use. */
  private renderWater?: { program: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
  private riverTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private waterTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private retainedWaterKey = '';
  private retainedWaterPaths: readonly RetainedWaterPath[] = [];
  private retainedWaterCanvas?: HTMLCanvasElement;
  private retainedWaterTexture?: WebGLTexture;
  private retainedWaterViewKey = '';
  private retainedRegime?: RetainedRegime; private retainedCity: [number, number] = [0, 0]; private retainedCoded = 0;
  private captureTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private riverLocations = new Map<string, WebGLUniformLocation | null>();
  private base?: GpuLayer; private details: GpuLayer[] = [];
  private enhanced: GpuLayer[] = [];
  private look?: TerrainLook;
  private surfaceCache?: { base: HeightLayer; detail?: HeightLayer; key: string; sample: (x: number, y: number, metresPerPixel?: number) => number };
  private lake?: WebGLTexture; private lakeMode = 0; private lakeN = 0;
  private overlay?: WebGLTexture;
  private coastDistance?: WebGLTexture;
  private shoreRing?: { layer: object; revision: number; texture: WebGLTexture; x: number; y: number; width: number };
  /** A cast-shadow bake for a new light azimuth has landed in the shore ring: draw again to upload it. */
  private readonly ringChanged = (): void => this.request();
  /** Canonical Render3D forest field and applied occupation, sampled by world coordinates. */
  private forest?: ForestTextures;
  private occupation?: { data: ForestOccupation; texture: WebGLTexture };
  private landDetail?: { data: LandDetail; texture: WebGLTexture };
  private lakeInput?: Float32Array;
  private lakeWidth = 0;
  private seaSurface?: WaterSurface;
  private riverBuffer: WebGLBuffer; private riverVao: WebGLVertexArrayObject; private riverCount = 0; private riverRegime = false;
  private view?: { view: View; width: number; height: number };
  private frame = 0;
  private disposed = false;
  private unlistenQuality?: () => void;
  private empty: WebGLTexture;
  /** Last frame's GPU submission time, ms (CPU side). */
  drawMs = 0;
  private liveGround = new LiveGround();
  private livePaused = false;
  /** Preparation can upload and compile while its previous frame stays displayed. */
  setLivePaused(paused: boolean): void {
    this.livePaused = paused;
    if (paused) { cancelAnimationFrame(this.frame); this.frame = 0; }
    else this.request();
  }

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    glTerrainFs = gl && glLandDetailUnit(gl) !== undefined ? TERRAIN_FS : withoutLandDetail(TERRAIN_FS);
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    this.variants = new ShaderVariants(gl, () => this.request());
    this.terrainVariant(PREVIEW_VARIANT, false);   // starts linking the preview
    this.river = compile(gl, RIVER_VS, RIVER_FS);
    this.composite = compile(gl, COMPOSITE_VS, COMPOSITE_FS);
    this.riverBuffer = gl.createBuffer()!;
    this.riverVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.riverVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 16); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.empty = this.texture(1, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1), gl.NEAREST);
    this.unlistenQuality = onDisplayQualityChange(() => this.request());
  }

  private uniform(name: string): WebGLUniformLocation | null {
    let cache = this.locations.get(this.terrain);
    if (!cache) this.locations.set(this.terrain, cache = new Map());
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(this.terrain, name));
    return cache.get(name)!;
  }
  private terrainVariant(v: TerrainVariant, wait: boolean): WebGLProgram | undefined {
    return this.variants.get(variantKey(v), () => [TERRAIN_VS, terrainFragment(v)], wait);
  }
  private prewarmStarted = false;
  /** Once the requested look is drawn, link the Satellite variant (the heaviest look, the usual next choice) while
   * the page is idle. Never before: on ANGLE/D3D11 a link started first delays the requested one by tens of seconds. */
  private prewarmLikely(): void {
    if (this.prewarmStarted || this.capturing) return;
    this.prewarmStarted = true;
    const start = (): void => {
      if (this.disposed || this.gl.isContextLost()) return;
      const variant: TerrainVariant = { mode: 3, v2: 1, forest: true, brushes: false };
      this.variants.start(variantKey(variant), () => [TERRAIN_VS, terrainFragment(variant)]);
      this.variants.start(auxKey(variant), () => [TERRAIN_VS, auxFragment(variant)]);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 4000 }); else setTimeout(start, 1500);
  }
  /** Auxiliary pass of the look into auxTarget, over the base layer, skipped when its inputs did not change;
   * the map program then reads it on unit 15 (uHasAux 0 while the pass is still linking). */
  private renderAux(look: TerrainLook, setup: () => void, width: number, height: number, origin: [number, number], px: number, separateWater: boolean, framebuffer: WebGLFramebuffer | null, quality: number): void {
    const gl = this.gl, v = this.lookVariant(look);
    if (!mapPasses(v).includes('aux') || !this.base) return;
    const main = this.terrain, aux = this.variants.get(auxKey(v), () => [TERRAIN_VS, auxFragment(v)], this.capturing || framebuffer !== null || look.mesh3d === true);
    const key = aux && JSON.stringify([quality, width, height, origin, px, look.seed, look.climate, look.lighting, look.v2Season, look.v2Calendar, look.layers, look.refinement3d,
      look.mesh3d, look.style, look.waterLook, this.forestVersion, this.riverCount, this.retainedWaterKey, this.lakeN, separateWater, this.base.layer.width, this.base.layer.n,
      this.enhanced.at(-1)?.fadeStart, this.coastDistance ? 1 : 0]);
    if (aux && key !== this.auxKey) {
      this.auxTarget = this.uintTarget(width, height, this.auxTarget);
      this.terrain = aux; gl.useProgram(aux); setup();
      const u = (name: string): WebGLUniformLocation | null => this.uniform(name);
      // The same water layer and base relief as the map pass.
      gl.uniform1i(u('uWaterLayer'), 10); gl.uniform1i(u('uUseWaterLayer'), separateWater ? 1 : 0);
      const base = this.base, l = base.layer;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base.texture);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, base.cave ?? this.empty);
      gl.uniform1i(u('uHasCave'), base.cave ? 1 : 0);
      gl.uniform1i(u('uFieldN'), l.n); gl.uniform2f(u('uFieldOrigin'), l.x, l.y); gl.uniform1f(u('uFieldCell'), l.width / l.n);
      gl.uniform1i(u('uMaxLod'), base.levels.length - 1); gl.uniform1i(u('uBase'), 1); gl.uniform1f(u('uAlpha'), 1);
      gl.uniform4f(u('uQuad'), 0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.auxTarget.framebuffer); gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      this.terrain = main; gl.useProgram(main);
      this.auxKey = key!;
    }
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, aux && this.auxTarget ? this.auxTarget.texture : this.emptyUint());
    gl.uniform1i(this.uniform('uAux'), 15); gl.uniform1i(this.uniform('uHasAux'), aux ? 1 : 0);
  }
  private emptyUint(): WebGLTexture {
    if (this.emptyAux) return this.emptyAux;
    const gl = this.gl, texture = this.emptyAux = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, texture);   // the auxiliary unit: never another sampler's
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, new Uint32Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }
  private uintTarget(width: number, height: number, previous?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number }): { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } {
    const gl = this.gl;
    if (previous?.width === width && previous.height === height) return previous;
    if (previous) { gl.deleteFramebuffer(previous.framebuffer); gl.deleteTexture(previous.texture); }
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.auxKey = '';
    return { framebuffer, texture, width, height };
  }
  /** The forest switch follows the look (groundCover: procedural vegetation, whose field arrives a few seconds
   * later from a worker), not the field's arrival: deciding on the field compiled a forest-off pair first, then
   * the forest-on pair, two heavy compilations for one look. Without its field the forest code finds no stand. */
  private lookVariant(look: TerrainLook): TerrainVariant {
    const mode = lookMode(look);
    return { mode, v2: styleTraits(look.style).satelliteVariant, forest: !look.underdark && !styleTraits(look.style).fantasy && (look.independentCanopy === true || mode === 3) && (look.groundCover === true || !!this.forest), brushes: styleTraits(look.style).forestBrushes && mode === 3 };
  }
  /** The look's variant once linked; meanwhile the last drawn variant, or the preview, stands in
   * (undefined if none is linked yet). Captures wait for the link. */
  private terrainProgram(look: TerrainLook, wait: boolean): WebGLProgram | undefined {
    const v = this.lookVariant(look), target = this.terrainVariant(v, wait);
    // Automated shots (v7 sheets) wait for data-map-variant-ready="1": until then a stand-in variant draws another look.
    const canvas = this.gl.canvas;
    if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
      const aux = !mapPasses(v).includes('aux') || !!this.variants.get(auxKey(v), () => [TERRAIN_VS, auxFragment(v)], wait);
      canvas.dataset.mapVariant = variantKey(v); canvas.dataset.mapVariantReady = target && aux ? '1' : '0';
    }
    if (target) { this.prewarmLikely(); return this.lastTerrain = target; }
    return this.lastTerrain ?? this.terrainVariant(PREVIEW_VARIANT, false);
  }
  /** Resolves once the current look's variant is linked, without blocking: callers that can wait
   * (3D material tiles) capture after it instead of stalling the page on the link. */
  async variantReady(): Promise<void> {
    while (this.look && !this.disposed) {
      if (this.gl.isContextLost()) throw new Error('WebGL context lost while preparing the map style.');
      const v = this.lookVariant(this.look);
      const main = this.terrainVariant(v, false);
      const aux = !mapPasses(v).includes('aux') || this.variants.get(auxKey(v), () => [TERRAIN_VS, auxFragment(v)], false);
      const waterKey = (this.look.waterLook === 'natural' || styleTraits(this.look.style).neuralEarth)
        && (this.riverCount > 0 || this.retainedWaterPaths.length > 0) ? 'water.composite' : undefined;
      const water = !waterKey || this.waterProgram(false);
      if ([variantKey(v), ...(mapPasses(v).includes('aux') ? [auxKey(v)] : []), ...(waterKey ? [waterKey] : [])].some(key => this.variants.hasFailed(key)))
        throw new Error('A WebGL map style program failed to compile.');
      if (main && aux && water) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
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
      mask.set(layer.cave);
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
    this.enhanced.forEach(d => this.release(d)); this.enhanced = [];
    this.release(this.base); this.details.forEach(d => this.release(d)); this.details = [];
    this.base = this.upload(layer, true);
    if (this.coastDistance) this.gl.deleteTexture(this.coastDistance);
    this.coastDistance = undefined;
    this.seaSurface = layer.waterSurface ?? seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y });
    if (!layer.cave?.length) {
      const surface = this.seaSurface;
      // Portable FP32 storage with explicit bilinear sampling; no 8-bit distance
      // quantization and no dependency on optional float linear filtering.
      this.coastDistance = this.texture(surface.n, surface.n, this.gl.R32F, this.gl.RED, this.gl.FLOAT, surface.distance, this.gl.NEAREST);
    }
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

  setRenderV2Season(season:number):void {if(this.look){this.look={...this.look,v2Season:season};this.request();}}
  setLook(look: TerrainLook): void { this.look = look; this.request(); }

  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): void {
    if (!layer) { this.enhanced.forEach(d => this.release(d)); this.enhanced = []; this.request(); return; }
    if (this.enhanced.at(-1)?.layer === layer) return;
    const next = this.upload(layer, false); next.fadeStart = performance.now();
    this.enhanced.push(next);
    while (this.enhanced.length > 2) this.release(this.enhanced.shift());
    this.request();
  }

  /** Retained exports keep exact SVG banks, including accumulated crop transforms.
   * Cache vector paths once; rasterize only the visible viewport, without readback. */
  setRetainedWater(svg: string | undefined, width = 1, options?: RetainedWaterOptions): void {
    const key = svg ? `${width}:${JSON.stringify(options ?? {})}:${svg}` : '';
    if (key === this.retainedWaterKey) return;
    this.retainedWaterKey = key;
    this.retainedWaterViewKey = '';
    this.retainedWaterPaths = svg ? retainedWaterPaths(svg, width) : [];
    this.retainedRegime = retainedRegime(this.retainedWaterPaths, width, options?.season);
    this.retainedCity = svg && options?.city ? [1, .5 * waterClimate(options.season ?? {}).sediment] : [0, 0];
    this.request();
  }

  setWater(water: WaterLayer | undefined): void {
    const gl = this.gl;
    const width = this.look?.mapWidth ?? this.base?.layer.width ?? 0;
    if (water?.lake !== this.lakeInput || (water?.lake && (this.lakeN !== water.n || this.lakeWidth !== width))) {
      if (this.lake) gl.deleteTexture(this.lake);
      this.lake = undefined; this.lakeInput = water?.lake; this.lakeWidth = width;
      if (water?.lake) {
        const distances = lakeDistances(water.lake, water.n, width), values = new Float32Array(water.n * water.n * 2);
        for (let i = 0; i < water.lake.length; i++) { values[i * 2] = water.lake[i]; values[i * 2 + 1] = distances[i]; }
        this.lake = this.texture(water.n, water.n, gl.RG32F, gl.RG, gl.FLOAT, values, gl.NEAREST);
        this.lakeN = water.n;
      }
    }
    this.lakeMode = water?.shore === 'exact' ? 2 : 1;
    const rivers = water?.rivers ?? new Float32Array();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rivers.byteLength ? rivers : new Float32Array(9), gl.STATIC_DRAW);
    this.riverCount = rivers.length / 9; this.riverRegime = !!water?.regime;
    this.request();
  }

  setOverlay(overlay: OverlayLayer | undefined): void {
    const gl = this.gl;
    if (this.overlay) gl.deleteTexture(this.overlay);
    this.overlay = overlay ? this.texture(overlay.n, overlay.n, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, overlay.rgba, gl.NEAREST) : undefined;
    this.request();
  }

  setView(view: View, width: number, height: number): void { this.view = { view, width, height }; this.request(); }

  /** Render3D forest: texture uploads only. `undefined` restores the legacy macro canopy exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    const gl = this.gl;
    if (field !== this.forest?.field) {
      deleteForestTextures(gl, this.forest);
      this.forest = field && forestTextures(gl, field);
    }
    if (occupation !== this.occupation?.data) {
      if (this.occupation) gl.deleteTexture(this.occupation.texture);
      this.occupation = occupation && { data: occupation, texture: forestTexture(gl, occupation, true) };
    }
    const detail = glLandDetailUnit(gl) === undefined ? undefined : occupation?.detail;
    if (detail !== this.landDetail?.data) {
      if (this.landDetail) gl.deleteTexture(this.landDetail.texture);
      this.landDetail = detail && { data: detail, texture: forestTexture(gl, detail, true) };
    }
    this.forestVersion++;
    this.request();
  }

  /** Reuse the map material for the perspective viewer without changing the 2D camera. */
  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (!this.look) throw new Error('Le terrain est indisponible.');
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  redrawForCapture(): void {
    if (!this.base || !this.look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    this.capturing = true;
    try { this.draw(); } finally { this.capturing = false; }
  }

  /** Present in the caller's animation frame; do not schedule a second draw or wait for compilation. */
  redrawNow(view?: View, width?: number, height?: number, interacting = false, pixelRatio = Math.min(2, window.devicePixelRatio || 1)): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (view && width && height) this.view = { view, width, height };
    const state = this.view;
    if (state) this.liveGround.present(this.canvas, state.view, state.width, state.height, pixelRatio, interacting, (ratio, renderWidth, renderHeight) => {
      this.view = { ...state, width: renderWidth, height: renderHeight };
      try { return this.draw(ratio, pixelRatio); } finally { this.view = state; }
    });
  }

  /** Render a world-space LOD tile with the same material and detail as the map. */
  captureRegion(region: { x: number; y: number; width: number }, size = 512, includeDetails = true, restoreDisplay = true, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (!this.base || !this.look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    const previous = this.view, details = this.details, look = this.look, enhanced = this.enhanced;
    const capturedHeight = height ? this.upload(height, false) : undefined;
    const output = document.createElement('canvas'); output.width = output.height = size;
    const context = output.getContext('2d');
    if (!context) throw new Error('Impossible de préparer le style 3D.');
    try {
      // Freeze the current regional detail at its final opacity for reproducible tiles.
      this.details = !groundOverlay && includeDetails && details.length ? [{ ...details[details.length - 1], fadeStart: -Infinity }] : [];
      this.look = { ...look, frame: false, contours: groundOverlay ? false : look.contours, mesh3d: true, groundCapture: groundOverlay };
      this.enhanced = capturedHeight ? [{ ...capturedHeight, fadeStart: -Infinity }] : [];
      this.view = { view: { cx: region.x + region.width / 2, cy: region.y + region.width / 2, scale: size / region.width }, width: size, height: size };
      if (groundOverlay) {
        this.captureTarget = this.renderTarget(size,size,this.captureTarget);
        this.draw(1,includeDetails ? Math.min(2,window.devicePixelRatio||1) : 1,this.captureTarget.framebuffer);
        const rgba=new Uint8Array(size*size*4);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,this.captureTarget.framebuffer);
        this.gl.readPixels(0,0,size,size,this.gl.RGBA,this.gl.UNSIGNED_BYTE,rgba);
        // The framebuffer and river compositor store premultiplied radiance.
        // The centre mask needs alpha only, avoiding RGB conversion and another
        // Canvas readback for its larger world-space bank halo.
        if(alphaOnly){
          for(let y=0;y<size;y++)for(let x=0;x<size;x++)alphaOnly[y*size+x]=rgba[((size-1-y)*size+x)*4+3];
        } else {
          const image=context.createImageData(size,size);
          for(let y=0;y<size;y++)for(let x=0;x<size;x++){
            const a=(y*size+x)*4,b=((size-1-y)*size+x)*4,alpha=rgba[b+3];
            for(let c=0;c<3;c++)image.data[a+c]=alpha ? Math.min(255,Math.round(rgba[b+c]*255/alpha)) : 0;
            image.data[a+3]=alpha;
          }
          context.putImageData(image,0,0);
        }
      } else {
        this.draw(1, includeDetails ? Math.min(2, window.devicePixelRatio || 1) : 1);
        context.drawImage(this.canvas, 0, 0);
      }
    } finally {
      this.view = previous; this.details = details; this.look = look; this.enhanced = enhanced;
      this.release(capturedHeight);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);
      if (restoreDisplay) this.draw();
    }
    return output;
  }

  /** Canonical 1 m water samples with a caller-supplied world-space halo. */
  captureWaterMask(region: { x: number; y: number; width: number }): Uint8Array {
    const n = Math.round(region.width), alpha = new Uint8Array(n * n);
    const look=this.look;if((look && styleTraits(look.style).waterAlwaysDrawn))this.look={...look,layers:{...look.layers,water:true}};
    try{this.captureRegion(region, n, false, false, undefined, true, alpha);}finally{this.look=look;}
    return alpha;
  }

  createSurfaceSampler(): ((x: number, y: number, metresPerPixel?: number) => number) | undefined {
    if (!this.base || !this.look) return undefined;
    const base = this.base.layer, detail = this.details[this.details.length - 1]?.layer, look = this.look;
    const refine = (look.refinement3d ?? 'noise') === 'noise';
    const ground=styleTraits(look.style).ground3d && (look.refinement3d??'noise')!=='source';
    const key = JSON.stringify([refine,ground,look.climate,look.floor,look.sourceCell,look.seed,look.detail]);
    if (!this.surfaceCache || this.surfaceCache.base !== base || this.surfaceCache.detail !== detail || this.surfaceCache.key !== key) {
      const sample=createTerrainSurfaceSampler(base,{...look,refine},detail?[detail]:[],true);
      const macroSampler=ground ? createTerrainSurfaceSampler(base,{...look,refine:false},[],false) : undefined;
      this.surfaceCache={base,detail,key,sample:ground ? createGroundDisplacementSampler(sample,{seed:look.seed,sourceCell:look.sourceCell,macroSampler,climate:look.climate ? [look.climate.temperature,look.climate.precipitation] : undefined}) : sample};
    }
    return this.surfaceCache.sample;
  }

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
    this.liveGround.invalidate(this.canvas);
    if (this.disposed || this.frame || this.livePaused) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(pixelRatio = Math.min(2, window.devicePixelRatio || 1), stylePixelRatio = pixelRatio, framebuffer: WebGLFramebuffer | null = null): boolean {
    this.liveGround.invalidate(this.canvas);
    const gl = this.gl, look = this.look, state = this.view;
    if (this.disposed || !look || !state || !this.base || gl.isContextLost()) return false;
    const quality = displayQualityUniform(!(this.capturing || framebuffer !== null || look.mesh3d === true));
    const program = this.terrainProgram(look, this.capturing || framebuffer !== null || look.mesh3d === true);
    if (!program) return false;
    this.terrain = program;
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    const started = performance.now();
    // Two device pixels per CSS pixel at most: 4K stays cheap on modest GPUs.
    const dpr = pixelRatio;
    const width = Math.max(1, Math.round(state.width * dpr)), height = Math.max(1, Math.round(state.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    const { view } = state, px = 1 / (view.scale * dpr);
    const origin: [number, number] = [view.cx - state.width / (2 * view.scale), view.cy - state.height / (2 * view.scale)];
    // Underdark map grounds take the underdark hypsometry (render/biomes.ts), as the 2D overlay does.
    const definition = terrainStyle(look.style, look.colors), pal = look.underdark && definition.traits.family === 'map' ? biomePalette(definition.palette, 'underdark') : definition.palette, water = terrainStyle(look.waterLook === 'natural' ? 'render3d' : look.waterStyle ?? look.style, look.waterLook === 'natural' ? undefined : look.colors).water;
    const u = (name: string): WebGLUniformLocation | null => this.uniform(name);
    let enhancedAlpha = 1;
    // Every uniform of the look; replayed on the canopy program (same names, same values).
    const setup = (): void => {
    gl.uniform1i(u('uQuality'), quality);
    gl.uniform2f(u('uCanvas'), width, height);
    gl.uniform2f(u('uOrigin'), origin[0], origin[1]);
    gl.uniform1f(u('uPx'), px); gl.uniform1f(u('uDpr'), stylePixelRatio);
    gl.uniform2fv(u('uWaterSeason'), waterSeasonUniforms(look.v2Season, look.climateZone, look.v2Calendar));
    gl.uniform1i(u('uGroundCapture'),look.groundCapture?1:0);
    gl.uniform1i(u('uNaturalWater'),look.waterLook==='natural'?1:0); gl.uniform1i(u('uNight'),look.ambience==='night'?1:0); gl.uniform1i(u('uUnderdark'),look.underdark?1:0);{const g=look.townGlow??new Float32Array(0),a=new Float32Array(64);for(let k=0;k<Math.min(16,g.length/3|0);k++)a.set(g.subarray(k*3,k*3+3),k*4);gl.uniform4fv(u('uTownGlow[0]'),a);gl.uniform1i(u('uTownGlowCount'),Math.min(16,g.length/3|0));}{const f=look.farmBeds??new Float32Array(128);gl.uniform4fv(u('uFarmBeds[0]'),f);let n=0;for(let k=0;k<32;k++)if(f[k*4+2]>0)n=k+1;gl.uniform1i(u('uFarmBedCount'),n);}
    gl.uniform1f(u('uMapW'), look.mapWidth);
    gl.uniform1i(u('uRelief'), look.layers.relief ? 1 : 0); gl.uniform1i(u('uWaterVisible'), look.layers.water !== false ? 1 : 0);
    gl.uniform1ui(u('uMaterialSeed'), look.seed >>> 0);
    gl.uniform2f(u('uMaterialClimate'), look.climate?.temperature ?? 18, look.climate?.precipitation ?? 1000);
    const mode = lookMode(look);
    gl.uniform1i(u('uMode'), mode);
    // Textures 7 forest field, 8 occupation, 12 banks; 10/11 belong to water.
    bindForest(gl, u, this.forest, this.occupation, this.empty, this.lookVariant(look).forest, 7, 8, 12, 13);
    bindLandDetail(gl, u, this.landDetail, this.empty);
    // Texture 14: baked shore ring and relief light (CPU, shared with the 3D view), only for the natural looks.
    // RGBA16F: shore distance, openness, sky occlusion, horizon tangent toward the light (re-baked off the frame
    // path when the light azimuth changes; the previous texture stays until the new texels are ready).
    if (mode >= 2 && this.base) {
      const pixels = shoreRingPixels(this.base.layer, look.lighting.azimuth, this.ringChanged);
      if (this.shoreRing?.layer !== this.base.layer || this.shoreRing.revision !== pixels.revision) {
        if (this.shoreRing) gl.deleteTexture(this.shoreRing.texture);
        const grid = pixels.grid;
        this.shoreRing = { layer: this.base.layer, revision: pixels.revision, texture: shoreRingTexture(gl, pixels), x: grid.x, y: grid.y, width: grid.width };
      }
    }
    gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, this.shoreRing?.texture ?? this.empty);
    gl.uniform1i(u('uShoreRing'), 14); gl.uniform3f(u('uShoreRingRect'), this.shoreRing?.x ?? 0, this.shoreRing?.y ?? 0, this.shoreRing?.width ?? 1);
    bindForestBrushes(gl, u, styleTraits(look.style).forestBrushes && mode === 3, 9);
    gl.uniform1i(u('uPaperMap'),styleTraits(look.style).paperMap?1:0);gl.uniform1i(u('uRenderV2'),styleTraits(look.style).satelliteVariant);gl.uniform1i(u('uV2WaterVisible'),look.layers.water===false?0:1);if(this.base&&look.climate)gl.uniform4fv(u('uV2GlacierSources[0]'),renderV2GlacierSources(this.base.layer,look.climate));gl.uniform1f(u('uV2Season'),look.v2Season??.5);setSeasonCalendarGl(gl,u,look.climateZone,look.v2Calendar);gl.uniform1i(u('uMaterialZone'),renderV2ZoneUniform(look.climateZone));gl.uniform2f(u('uCityWater'),this.retainedCity[0],this.retainedCity[1]);
    gl.uniform1i(u('uEnhanced3d'), look.mesh3d || styleTraits(look.style).ground3d ? 1 : 0);
    gl.uniform1i(u('uRefinementMode'), look.refinement3d === 'source' ? 0 : isNeuralRefinement(look.refinement3d ?? 'noise') ? 2 : 1);
    const refined = this.enhanced.at(-1), previousRefined = this.enhanced.at(-2);
    for (const [layer, name, unit] of [[refined, 'Refined', 5], [previousRefined, 'PreviousRefined', 6]] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, layer?.texture ?? this.empty);
      gl.uniform1i(u(`u${name}`), unit); gl.uniform1i(u(`u${name}N`), layer?.layer.n ?? 0);
      gl.uniform4f(u(`u${name}Rect`), layer?.layer.x ?? 0, layer?.layer.y ?? 0, layer?.layer.width ?? 1, 0);
    }
    enhancedAlpha = refined ? Math.min(1, (performance.now() - refined.fadeStart) / 240) : 1;
    gl.uniform1f(u('uRefinedAlpha'), enhancedAlpha);
    gl.uniform3fv(u('uPaper'), hex(pal.paper)); gl.uniform3fv(u('uSea'), hex(pal.seaFill));
    gl.uniform3fv(u('uShore'), hex(water.stops[0][1])); gl.uniform1i(u('uCoastalSea'), this.coastDistance ? 1 : 0);
    const waterPalette = waterUniforms(water);
    gl.uniform3fv(u('uWaterStops'), waterPalette.colors); gl.uniform1fv(u('uWaterStopT'), waterPalette.positions);
    gl.uniform1i(u('uWaterStopCount'), water.stops.length);
    gl.uniform1f(u('uSeaBand'), (this.seaSurface?.referenceWidth ?? look.mapWidth) * water.bandFraction);
    gl.uniform2f(u('uCoastOrigin'), this.seaSurface?.x ?? 0, this.seaSurface?.y ?? 0); gl.uniform1f(u('uCoastWidth'), this.seaSurface?.width ?? look.mapWidth); gl.uniform1i(u('uCoastN'), this.seaSurface?.n ?? 1);
    gl.uniform3fv(u('uBackground'), hex(look.background)); gl.uniform3fv(u('uFrameColor'), hex(styleTraits(look.style).elevation ? '#333333' : pal.frame));
    gl.uniform3fv(u('uContourColor'), hex(pal.contour));
    const stops = look.layers.hypsometry || styleTraits(look.style).elevation ? pal.hypso.slice(0, 8) : [[0, pal.paper], [1, pal.paper]] as [number, string][];
    gl.uniform3fv(u('uStops'), new Float32Array(Array.from({ length: 8 }, (_, i) => hex(stops[Math.min(i, stops.length - 1)][1])).flat()));
    gl.uniform1fv(u('uStopT'), new Float32Array(Array.from({ length: 8 }, (_, i) => stops[Math.min(i, stops.length - 1)][0])));
    gl.uniform1i(u('uStopCount'), stops.length);
    const lights = terrainLights(look.lighting);
    gl.uniform4f(u('uGroundCover'),lights.primary[0],lights.primary[2],lights.primary[1],groundCoverActive(definition.traits.satelliteVariant,definition.traits.forestBrushes,this.lookVariant(look).forest,mode===3&&look.groundCover!==false));
    gl.uniform3fv(u('uLight'), lights.primary); gl.uniform3fv(u('uLight2'), lights.secondary);
    gl.uniform1f(u('uRockStrength'), look.lighting.enabled ? look.lighting.strength : 0);
    gl.uniform1f(u('uFlatLight'), lights.flat); gl.uniform1f(u('uExaggeration'), look.lighting.exaggeration);
    gl.uniform1f(u('uShade'), pal.shade * (look.lighting.enabled ? look.lighting.strength : 0));
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
    gl.uniform1i(u('uOctaves'), Math.min(quality ? 2 : FRACTAL_ROTATIONS.length, Math.round(d.octaves)));
    // Textures: 0 field, 1 cave, 2 lake, 3 overlay, 4 coast distance.
    gl.uniform1i(u('uField'), 0); gl.uniform1i(u('uCave'), 1); gl.uniform1i(u('uLake'), 2); gl.uniform1i(u('uOverlay'), 3);
    gl.uniform1i(u('uCoastDistance'), 4);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.coastDistance ?? this.empty);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lake ?? this.empty);
    gl.uniform1i(u('uHasLake'), this.lake ? this.lakeMode : 0); gl.uniform1f(u('uLakeN'), this.lakeN);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.overlay ?? this.empty);
    gl.uniform1i(u('uHasOverlay'), this.overlay ? 1 : 0);
    // Auxiliary texture unit: empty (integer) until the auxiliary pass binds its result, never its own render target.
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, this.emptyUint());
    gl.uniform1i(u('uAux'), 15); gl.uniform1i(u('uHasAux'), 0);
    };
    gl.useProgram(this.terrain); setup();
    let animating = enhancedAlpha < 1;
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
    // The render style paints its water layers (depth, shelf, glint, wet banks); other styles keep the flat ink.
    const paintedWater = (look.waterLook === 'natural' || styleTraits(look.style).neuralEarth) && !look.groundCapture;
    const waterBand = (this.seaSurface?.referenceWidth ?? look.mapWidth) * water.bandFraction;
    const renderRivers = (destination: WebGLFramebuffer | null): void => {
      if (!this.riverCount || (look.layers.water === false&&!styleTraits(look.style).waterAlwaysDrawn)) return;
      const target = this.target(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.river);
      const r = (name: string): WebGLUniformLocation | null => this.riverUniform(name);
      gl.uniform2f(r('uCanvas'), width, height); gl.uniform2f(r('uOrigin'), origin[0], origin[1]);
      gl.uniform1f(r('uPx'), px); gl.uniform1f(r('uDpr'), stylePixelRatio);gl.uniform1i(r('uPhysicalWidth'),styleTraits(look.style).physicalRiverWidth?1:0);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lake ?? this.empty);
      gl.uniform1i(r('uLake'), 2); gl.uniform1f(r('uMapW'), look.mapWidth);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.overlay ?? this.empty);
      gl.uniform1i(r('uOverlay'), 3); gl.uniform1i(r('uHasOverlay'), this.overlay ? 1 : 0);
      gl.uniform1i(r('uHasLake'), this.lake ? this.lakeMode : 0); gl.uniform1f(r('uLakeN'), this.lakeN);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.riverVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.riverCount);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
      gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.texture);
      // Diagnostic colours (overlay) keep the plain composite.
      if (paintedWater && !this.overlay) { this.paintWater(0, width, height, origin, px, stylePixelRatio, waterBand, this.riverRegime); return; }
      gl.useProgram(this.composite);
      gl.uniform1i(gl.getUniformLocation(this.composite, 'uLayer'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const renderRetainedWater = (destination: WebGLFramebuffer | null): void => {
      if (!this.retainedWaterPaths.length || (look.layers.water === false&&!styleTraits(look.style).waterAlwaysDrawn)) return;
      const canvas = this.retainedWaterCanvas ??= document.createElement('canvas');
      this.retainedWaterTexture ??= gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, this.retainedWaterTexture);
      const key = `${origin[0]},${origin[1]},${px},${width},${height},${water.stops[0][1]},${paintedWater},${look.waterStyle ?? look.style}`;
      if (key !== this.retainedWaterViewKey) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        this.retainedCoded = Number(paintRetainedWaterView(canvas.getContext('2d')!, this.retainedWaterPaths,
          { x: origin[0], y: origin[1], width: width * px, height: height * px }, { width, height }, water.stops[0][1], this.retainedRegime, paintedWater, look.waterStyle ?? look.style)) * (this.retainedCity[0] ? 2 : 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.retainedWaterViewKey = key;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (paintedWater) { this.paintWater(11, width, height, origin, px, stylePixelRatio, waterBand, this.retainedCoded); return; }
      gl.useProgram(this.composite);
      gl.uniform1i(gl.getUniformLocation(this.composite, 'uLayer'), 11);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const separateWater = (look.waterLook === 'natural' || styleTraits(look.style).ground3d && look.layers.relief && look.layers.hypsometry || this.lookVariant(look).forest) && (look.layers.water !== false || styleTraits(look.style).waterAlwaysDrawn) && !look.groundCapture;
    gl.uniform1i(u('uWaterLayer'), 10); gl.uniform1i(u('uUseWaterLayer'), 0);
    gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, this.empty);
    if (separateWater) {
      this.waterTarget = this.renderTarget(width, height, this.waterTarget);
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, this.waterTarget.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, this.empty);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.waterTarget.framebuffer);
      gl.uniform1i(u('uGroundCapture'), 1);gl.uniform1i(u('uWaterVisible'),1); gl.uniform1i(u('uContours'), 0);
      gl.uniform1i(u('uHasOverlay'), 0); gl.uniform1i(u('uFrame'), 0);
      drawLayer(this.base, true);
      renderRivers(this.waterTarget.framebuffer);
      renderRetainedWater(this.waterTarget.framebuffer);
      gl.useProgram(this.terrain); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.uniform1i(u('uGroundCapture'), 0);gl.uniform1i(u('uWaterVisible'),look.layers.water===false?0:1);
      gl.uniform1i(u('uContours'), look.contours && look.contourStep > 0 ? 1 : 0);
      gl.uniform1i(u('uHasOverlay'), this.overlay ? 1 : 0); gl.uniform1i(u('uFrame'), look.frame ? 1 : 0);
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, this.waterTarget.texture);
      gl.uniform1i(u('uUseWaterLayer'), 1);
    }
    this.renderAux(look, setup, width, height, origin, px, separateWater, framebuffer, quality);
    drawLayer(this.base, true);
    for (const detail of this.details) drawLayer(detail, false);
    // A detail fully faded in hides the older ones beneath it.
    let opaque = -1;
    this.details.forEach((d, i) => { if (now - d.fadeStart >= 240) opaque = i; });
    if (opaque > 0) { this.details.slice(0, opaque).forEach(d => this.release(d)); this.details = this.details.slice(opaque); }
    if (!separateWater) { renderRivers(framebuffer); renderRetainedWater(framebuffer); }
    gl.disable(gl.BLEND);
    this.drawMs = performance.now() - started;
    if (animating) this.request();
    return true;
  }

  /** Composite a coverage layer (texture unit `unit`, bound) as painted water; blending is set by the caller. */
  private waterProgram(wait: boolean): WebGLProgram | undefined {
    const program = this.variants.get('water.composite', () => [COMPOSITE_VS, RENDER_WATER_FS], wait);
    if (program && this.renderWater?.program !== program) this.renderWater = { program, u: new Map() };
    return program;
  }
  private paintWater(unit: number, width: number, height: number, origin: [number, number], px: number, dpr: number, band: number, regime: boolean | number = false): void {
    const gl = this.gl;
    const ready = this.waterProgram(this.capturing || this.look?.mesh3d === true);
    if (!ready) {
      gl.useProgram(this.composite); gl.uniform1i(gl.getUniformLocation(this.composite, 'uLayer'), unit);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return;
    }
    const { program, u: cache } = this.renderWater!;
    const u = (name: string): WebGLUniformLocation | null => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name)); return cache.get(name)!; };
    const water = terrainStyle(this.look?.waterLook === 'natural' ? 'render3d' : this.look?.waterStyle ?? this.look?.style ?? 'render', this.look?.waterLook === 'natural' ? undefined : this.look?.colors).water, palette = waterUniforms(water), rings = renderWaterRings(px, band);
    // Bilinear taps (the bound layer is only ever read with texelFetch elsewhere).
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.useProgram(program);
    gl.uniform1i(u('uLayer'), unit);
    gl.uniform2f(u('uCanvas'), width, height); gl.uniform2f(u('uOrigin'), origin[0], origin[1]);
    gl.uniform1f(u('uPx'), px); gl.uniform1f(u('uDpr'), dpr); gl.uniform1f(u('uBand'), band);
    gl.uniform1f(u('uBankPx'), Math.min(6 * dpr, Math.max(1.5 * dpr, 7 / px)));
    gl.uniform1fv(u('uRings[0]'), rings); gl.uniform1i(u('uRingCount'), rings.length);
    gl.uniform3fv(u('uWaterStops[0]'), palette.colors); gl.uniform1fv(u('uWaterStopT[0]'), palette.positions);
    gl.uniform1i(u('uWaterStopCount'), water.stops.length); gl.uniform1i(u('uRegime'), Number(regime));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private target(width: number, height: number): { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } {
    return this.riverTarget=this.renderTarget(width,height,this.riverTarget);
  }

  private renderTarget(width: number,height: number,previous?: {framebuffer:WebGLFramebuffer;texture:WebGLTexture;width:number;height:number}): {framebuffer:WebGLFramebuffer;texture:WebGLTexture;width:number;height:number} {
    const gl = this.gl;
    if(previous?.width===width && previous.height===height)return previous;
    if(previous){gl.deleteFramebuffer(previous.framebuffer);gl.deleteTexture(previous.texture);}
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture, width, height };
  }

  dispose(): void {
    if (this.disposed) return;
    this.unlistenQuality?.();
    this.disposed = true; cancelAnimationFrame(this.frame); this.frame = 0; this.variants.reset(true);
    if (this.auxTarget) { this.gl.deleteFramebuffer(this.auxTarget.framebuffer); this.gl.deleteTexture(this.auxTarget.texture); }
    if (this.emptyAux) this.gl.deleteTexture(this.emptyAux);
    const gl = this.gl;
    this.release(this.base); this.details.forEach(d => this.release(d));
    this.enhanced.forEach(d => this.release(d));
    if (this.lake) gl.deleteTexture(this.lake);
    if (this.overlay) gl.deleteTexture(this.overlay);
    deleteForestTextures(gl, this.forest);
    if (this.occupation) gl.deleteTexture(this.occupation.texture);
    if (this.landDetail) gl.deleteTexture(this.landDetail.texture);
    this.forest = this.occupation = this.landDetail = undefined;
    disposeForestBrushes(gl);
    gl.deleteBuffer(this.riverBuffer); gl.deleteVertexArray(this.riverVao);
    if (this.coastDistance) gl.deleteTexture(this.coastDistance);
    if (this.riverTarget) { gl.deleteFramebuffer(this.riverTarget.framebuffer); gl.deleteTexture(this.riverTarget.texture); }
    if (this.waterTarget) { gl.deleteFramebuffer(this.waterTarget.framebuffer); gl.deleteTexture(this.waterTarget.texture); }
    if (this.retainedWaterTexture) gl.deleteTexture(this.retainedWaterTexture);
    if (this.captureTarget) { gl.deleteFramebuffer(this.captureTarget.framebuffer); gl.deleteTexture(this.captureTarget.texture); }
    gl.deleteProgram(this.river); gl.deleteProgram(this.composite);
    this.renderWater = undefined; // Owned and deleted by ShaderVariants.
  }
}

/** RGBA8 world raster, clamped to its edges. Box mipmaps keep the field's mean cover at coarse footprints. */
export function forestTexture(gl: WebGL2RenderingContext, raster: { n: number; rgba: Uint8Array }, mipmaps: boolean): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, raster.n, raster.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, raster.rgba);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Canonical forest field and its riparian bank envelope (same grid), uploaded and released together. */
export interface ForestTextures { field: ForestField; texture: WebGLTexture; bank?: WebGLTexture; beach?: WebGLTexture }
export function forestTextures(gl: WebGL2RenderingContext, field: ForestField): ForestTextures {
  return { field, texture: forestTexture(gl, field, true), bank: field.bank && forestTexture(gl, { n: field.n, rgba: field.bank }, true),
    beach: field.beach && forestBeachTexture(gl, field.beach) };
}
export function deleteForestTextures(gl: WebGL2RenderingContext, textures: ForestTextures | undefined): void {
  if (!textures) return;
  gl.deleteTexture(textures.texture); if (textures.bank) gl.deleteTexture(textures.bank); if (textures.beach) gl.deleteTexture(textures.beach);
}

/** Holdings uniforms of the map and perspective programs. */
export function bindLandDetail(gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null, detail: { data: LandDetail; texture: WebGLTexture } | undefined, empty: WebGLTexture): void {
  const unit = glLandDetailUnit(gl); if (unit === undefined) return;
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, detail?.texture ?? empty);
  gl.uniform1i(u('uLandDetail'), unit); gl.uniform1i(u('uHasLandDetail'), detail ? 1 : 0);
  gl.uniform3f(u('uLandDetailRect'), detail?.data.x ?? 0, detail?.data.y ?? 0, detail?.data.width ?? 1); gl.uniform1f(u('uLandDetailN'), detail?.data.n ?? 1);
}

/** Forest uniforms shared by the map and perspective programs; units are owned by each caller. */
export function bindForest(gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null,
  forest: ForestTextures | undefined, occupation: { data: ForestOccupation; texture: WebGLTexture } | undefined,
  empty: WebGLTexture, enabled: boolean, fieldUnit: number, occupationUnit: number, bankUnit: number, beachUnit: number): void {
  const field = enabled ? forest : undefined, applied = occupation;
  gl.uniform1i(u('uForest'), field ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0 + fieldUnit); gl.bindTexture(gl.TEXTURE_2D, field?.texture ?? empty);
  gl.uniform1i(u('uForestField'), fieldUnit);
  gl.uniform3f(u('uForestRect'), field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
  gl.activeTexture(gl.TEXTURE0 + bankUnit); gl.bindTexture(gl.TEXTURE_2D, field?.bank ?? empty);
  gl.uniform1i(u('uForestBank'), bankUnit); gl.uniform1i(u('uHasForestBank'), field?.bank ? 1 : 0);
  gl.uniform1f(u('uForestBankDensity'), field?.field.bankDensity ?? 1);
  const beach = field?.field.beach;
  gl.activeTexture(gl.TEXTURE0 + beachUnit); gl.bindTexture(gl.TEXTURE_2D, field?.beach ?? empty);
  gl.uniform1i(u('uForestBeach'), beachUnit); gl.uniform1i(u('uHasForestBeach'), field?.beach ? 1 : 0);
  gl.uniform3f(u('uForestBeachRect'), beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
  gl.activeTexture(gl.TEXTURE0 + occupationUnit); gl.bindTexture(gl.TEXTURE_2D, applied?.texture ?? empty);
  gl.uniform1i(u('uOccupation'), occupationUnit); gl.uniform1i(u('uHasOccupation'), applied ? 1 : 0);
  gl.uniform3f(u('uOccupationRect'), applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
  gl.uniform1f(u('uOccupationN'), applied?.data.n ?? 1);
}
