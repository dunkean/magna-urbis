import { NEURAL_EARTH_MATERIAL_GLSL } from '../../../rust/bridge/terrainMaterial';
import { RENDER_3D_MATERIAL_GLSL } from '../../../rust/bridge/terrainMaterial3d';
import { FOREST_GLSL, FOREST_PRELUDE_GLSL, type ForestField, type ForestOccupation } from '../../../rust/bridge/terrainForest';
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
import { RENDER_V2_GLSL, renderV2Number, renderV2GlacierSources } from '../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform } from '../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { isRender3dStyle, terrainStyle, type TerrainStyle } from '../render/terrainStyle';
import type { RenderColors } from '../render/customColors';
import { WATER_STYLE_GLSL, waterUniforms } from '../render/waterStyle';
import { paintRetainedWater, retainedWaterPaths, type RetainedWaterPath } from '../render/retainedWaterGeometry';
import { RENDER_WATER_FS, renderWaterRings } from '../render/renderWaterShader';
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
  colors?: RenderColors;
  /** Explicit opt-in for perspective captures; ordinary 2D styles retain their surface. */
  mesh3d?: boolean;
  v2Season?: number;
  /** Internal premultiplied water/ink pass for the physically shaded flyover. */
  groundCapture?: boolean;
  refinement3d?: TerrainRefinement;
  climate?: { temperature: number; precipitation: number };
  /** V2 climate zone (Render v2 styles); absent keeps the climate-only look. */
  climateZone?: ClimateZone;
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

/** The ground GLSL may already carry the forest functions; never declare them twice. */
export const RENDER_3D_FOREST_GLSL = RENDER_3D_MATERIAL_GLSL.includes('applyForest(') ? '' : FOREST_GLSL;

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
uniform sampler2D uLake; uniform int uHasLake; uniform float uLakeN; // uHasLake: 1 procedural shore, 2 exact shore
uniform sampler2D uOverlay; uniform int uHasOverlay;
uniform sampler2D uWaterLayer; uniform int uUseWaterLayer;
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
${TERRAIN_3D_NOISE_GLSL}

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

${FOREST_PRELUDE_GLSL}
vec3 forestRootSurface(vec2 world){return level(0,world);}
float forestRootCell(){return uFieldCell;}
float forestWaterCoverage(vec2 world) {
  if(uUseWaterLayer==0)return 0.;
  vec2 uv=(world-uOrigin)/(uPx*uCanvas);
  return textureLod(uWaterLayer,vec2(uv.x,1.-uv.y),0.).a;
}
${NEURAL_EARTH_MATERIAL_GLSL}
${RENDER_3D_MATERIAL_GLSL}
${RENDER_3D_FOREST_GLSL}
${RENDER_V2_GLSL}

${WATER_STYLE_GLSL}
vec3 naturalMaterial(vec3 s, vec2 world) {
  float r=max(300.,uFieldCell*2.);
  float mean=(surface(world+vec2(r,0.)).x+surface(world-vec2(r,0.)).x+surface(world+vec2(0.,r)).x+surface(world-vec2(0.,r)).x)*.25;
  float shore=1e9, openness=0.;
  if(s.x<12. && length(s.yz)<.5) for(int i=0;i<12;i++) {
    vec2 d=vec2(cos(float(i)*.523598776),sin(float(i)*.523598776));
    if(surface(world+d*r).x<0.) {shore=min(shore,r);openness+=1./12.;}
    if(surface(world+d*r*.5).x<0.) shore=min(shore,r*.5);
  }
  shore=min(shore,max(s.x,0.)/max(length(s.yz),.0001));
  if(uMode==3 || uRenderV2>0) {
    vec3 base=level(0,world);GroundMaterial m;
    vec3 macro=earthMaterial(base,world,max(uPx,1.),(base.x-mean)/(6.*r),shore,openness);
    if(uRenderV2>1)return v2Diagnostic(s,world,(s.x-mean)/(6.*r),uPx);
    if(uRenderV2>0)m=v2Ground(s,world,uPx,(s.x-mean)/(6.*r),uLight.xzy,uLight2.xzy,uRockStrength,renderGuideBaseOpen);
    else {
      m=terrainGroundMaterial(base,world,uPx,macro,uMaterialClimate,uMaterialSeed);
    }
    if(uForest==1)applyForest(m,world,uPx,uLight.xzy);
    vec3 rgb=uRenderV2>0?v2ShadeGround(m,vec3(0.,1.,0.),uLight.xzy,uLight2.xzy,uRockStrength):shadeTerrainGround(m,vec3(0.,1.,0.),uLight.xzy,uLight2.xzy,uRockStrength);
    return uRenderV2>0?v2DisplayShoulder(rgb):rgb;
  }
  return earthMaterial(s,world,max(uPx,1.),(s.x-mean)/(6.*r),shore,openness);
}
vec3 land(vec3 s, vec2 world) {
  if(uMode==3) return naturalMaterial(s,world);
  if(uMode==2) return naturalMaterial(s,world)*hillshade(s.yz);
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

vec3 sea(vec2 world) {
  float distance = uSeaBand;
  if (uCoastalSea == 1) {
    vec2 g = clamp((world - uCoastOrigin) / uCoastWidth * float(uCoastN) - .5, vec2(0.), vec2(float(uCoastN - 1)));
    ivec2 p = ivec2(floor(g)), q = min(p + 1, ivec2(uCoastN - 1)); vec2 f = fract(g);
    distance = mix(mix(texelFetch(uCoastDistance,p,0).r,texelFetch(uCoastDistance,ivec2(q.x,p.y),0).r,f.x),mix(texelFetch(uCoastDistance,ivec2(p.x,q.y),0).r,texelFetch(uCoastDistance,q,0).r,f.x),f.y);
  }
  return uWaterVisible == 1 ? styledWater(max(0., distance) / uSeaBand) : uPaper;
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
  bool inside = world.x >= 0.0 && world.y >= 0.0 && world.x <= uMapW && world.y <= uMapW;
  if (!inside) {
    if (uBase == 0) discard;
    outColor = uGroundCapture==1 ? vec4(0.) : vec4(uBackground, 1.0);
  } else {
    vec3 s = surface(world);
    if (uFloor > 0.0) s.x = max(s.x, uFloor);
    // Contours follow the raster surface: refinement adds relief, not ink.
    vec3 raster = s;
    if(uEnhanced3d==1 && uGroundCapture==0) {
      if(uRefinementMode==1 && s.x>0.) s+=terrain3dDetail(world,s);
      if(uRefinementMode==2) {
        float a=refinedCoverage(uPreviousRefinedRect,uPreviousRefinedN,world);
        if(a>0.) s=mix(s,refinedSurface(uPreviousRefined,uPreviousRefinedRect,uPreviousRefinedN,world),a);
        a=refinedCoverage(uRefinedRect,uRefinedN,world)*uRefinedAlpha;
        if(a>0.) s=mix(s,refinedSurface(uRefined,uRefinedRect,uRefinedN,world),a);
      }
      raster=s;
    } else if (uGroundCapture==0 && uRefine == 1 && s.x > 0.0 && uPx * 2.0 < uSourceCell * uDetailA.w) s += detail(world, s);
    float grad = length(s.yz);
    // Antialiased coast at the zero level (screen-space width of the height ramp).
    float ramp = max(grad * uPx, 1e-4);
    float landCover = uCoastal == 1 ? clamp(s.x / ramp + 0.5, 0.0, 1.0) : (s.x > 0.0 ? 1.0 : 0.0);
    // Hidden water keeps the cartographic paper over the submerged ground.
    // Its explicit coverage also prevents the physical material recolouring it.
    float coverage=1.-landCover;
    vec3 landColor=uGroundCapture==1 ? vec3(0.) : land(vec3(max(s.x,1e-3),s.yz),world);
    vec3 color = uGroundCapture==1 ? sea(world)*coverage : mix(sea(world),landColor,landCover);
    if (uRelief == 0) color = mix(sea(world), uPaper, landCover);
    if (uHasCave == 1 && uRelief == 1) {
      vec2 uv = (world - uFieldOrigin) / (uFieldCell * float(uFieldN));
      float rock = smoothstep(0.35, 0.65, texture(uCave, uv).r);
      vec3 nn = normalize(vec3(-s.yz * uExaggeration * 0.5, 1.0));
      float shade = clamp(uRockStrength * (length(nn.xy) * (36.0 + 84.0 * dot(nn.xy, uLight.xy)) + (1.0 - nn.z) * 12.0), 0.0, 72.0) / 255.0;
      color = mix(color, vec3(shade), rock);
      coverage=rock+coverage*(1.-rock);
    }
    if (uUseWaterLayer==1) {
      vec4 water=texelFetch(uWaterLayer,ivec2(gl_FragCoord.xy),0);
      float under=uRenderV2>0?1.:1.-forestResolvedCover;
      if(uRenderV2>0)color=v2WaterAt(color,s,world,uPx,water.a,s.x<0.?1.:3.,s.x<0.?-s.x:8.*water.a);
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
        lakeColor = styledWater(max(distance, 0.) / uSeaBand);
      }
      float a=clamp(m/w+.5,0.,1.);
      color = uRenderV2>0?v2WaterAt(color,s,world,uPx,a,2.,8.*a):mix(color,lakeColor,a);
      coverage=a+coverage*(1.-a);
    }
    if(uRenderV2>0 && landCover<1.)color=v2WaterAt(landColor,s,world,uPx,1.-landCover,1.,max(-s.x,0.));
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

const RIVER_VS = `#version 300 es
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

const RIVER_FS = `#version 300 es
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

interface GpuLayer { layer: HeightLayer; levels: Float32Array[]; texture: WebGLTexture; cave?: WebGLTexture; alpha: number; fadeStart: number }

export class TerrainGl {
  readonly gl: WebGL2RenderingContext;
  private terrain: WebGLProgram; private river: WebGLProgram; private composite: WebGLProgram;
  /** Painted water of the `render` style (renderWaterShader.ts), compiled on first use. */
  private renderWater?: { program: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
  private riverTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private waterTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private retainedWaterKey = '';
  private retainedWaterPaths: readonly RetainedWaterPath[] = [];
  private retainedWaterCanvas?: HTMLCanvasElement;
  private retainedWaterTexture?: WebGLTexture;
  private retainedWaterViewKey = '';
  private captureTarget?: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private locations = new Map<string, WebGLUniformLocation | null>();
  private riverLocations = new Map<string, WebGLUniformLocation | null>();
  private base?: GpuLayer; private details: GpuLayer[] = [];
  private enhanced: GpuLayer[] = [];
  private look?: TerrainLook;
  private surfaceCache?: { base: HeightLayer; detail?: HeightLayer; key: string; sample: (x: number, y: number, metresPerPixel?: number) => number };
  private lake?: WebGLTexture; private lakeMode = 0; private lakeN = 0;
  private overlay?: WebGLTexture;
  private coastDistance?: WebGLTexture;
  /** Canonical Render3D forest field and applied occupation, sampled by world coordinates. */
  private forest?: ForestTextures;
  private occupation?: { data: ForestOccupation; texture: WebGLTexture };
  private lakeInput?: Float32Array;
  private lakeWidth = 0;
  private seaSurface?: WaterSurface;
  private riverBuffer: WebGLBuffer; private riverVao: WebGLVertexArrayObject; private riverCount = 0;
  private view?: { view: View; width: number; height: number };
  private frame = 0;
  private disposed = false;
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
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 16); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24); gl.vertexAttribDivisor(2, 1);
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
  setRetainedWater(svg: string | undefined, width = 1): void {
    const key = svg ? `${width}:${svg}` : '';
    if (key === this.retainedWaterKey) return;
    this.retainedWaterKey = key;
    this.retainedWaterViewKey = '';
    this.retainedWaterPaths = svg ? retainedWaterPaths(svg, width) : [];
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
    this.riverCount = rivers.length / 9;
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
    occupation = field ? occupation : undefined;
    if (field !== this.forest?.field) {
      deleteForestTextures(gl, this.forest);
      this.forest = field && forestTextures(gl, field);
    }
    if (occupation !== this.occupation?.data) {
      if (this.occupation) gl.deleteTexture(this.occupation.texture);
      this.occupation = occupation && { data: occupation, texture: forestTexture(gl, occupation, false) };
    }
    this.request();
  }

  /** Reuse the map material for the perspective viewer without changing the 2D camera. */
  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (!this.look) throw new Error('Le terrain est indisponible.');
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  redrawForCapture(): void {
    if (!this.base || !this.look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    this.draw();
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
    const look=this.look;if(look?.style.startsWith('render-v2'))this.look={...look,layers:{...look.layers,water:true}};
    try{this.captureRegion(region, n, false, false, undefined, true, alpha);}finally{this.look=look;}
    return alpha;
  }

  createSurfaceSampler(): ((x: number, y: number, metresPerPixel?: number) => number) | undefined {
    if (!this.base || !this.look) return undefined;
    const base = this.base.layer, detail = this.details[this.details.length - 1]?.layer, look = this.look;
    const refine = (look.refinement3d ?? 'noise') === 'noise';
    const ground=isRender3dStyle(look.style) && (look.refinement3d??'noise')!=='source';
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
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(pixelRatio = Math.min(2, window.devicePixelRatio || 1), stylePixelRatio = pixelRatio, framebuffer: WebGLFramebuffer | null = null): void {
    const gl = this.gl, look = this.look, state = this.view;
    if (this.disposed || !look || !state || !this.base || gl.isContextLost()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    const started = performance.now();
    // Two device pixels per CSS pixel at most: 4K stays cheap on modest GPUs.
    const dpr = pixelRatio;
    const width = Math.max(1, Math.round(state.width * dpr)), height = Math.max(1, Math.round(state.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    const { view } = state, px = 1 / (view.scale * dpr);
    const origin: [number, number] = [view.cx - state.width / (2 * view.scale), view.cy - state.height / (2 * view.scale)];
    const definition = terrainStyle(look.style, look.colors), pal = definition.palette, water = terrainStyle(look.waterStyle ?? look.style, look.colors).water;
    const u = (name: string): WebGLUniformLocation | null => this.uniform(name);
    gl.useProgram(this.terrain);
    gl.uniform2f(u('uCanvas'), width, height);
    gl.uniform2f(u('uOrigin'), origin[0], origin[1]);
    gl.uniform1f(u('uPx'), px); gl.uniform1f(u('uDpr'), stylePixelRatio);
    gl.uniform1i(u('uGroundCapture'),look.groundCapture?1:0);
    gl.uniform1f(u('uMapW'), look.mapWidth);
    gl.uniform1i(u('uRelief'), look.layers.relief ? 1 : 0); gl.uniform1i(u('uWaterVisible'), look.layers.water !== false ? 1 : 0);
    gl.uniform1ui(u('uMaterialSeed'), look.seed >>> 0);
    gl.uniform2f(u('uMaterialClimate'), look.climate?.temperature ?? 18, look.climate?.precipitation ?? 1000);
    const mode = look.style === 'copernicus' ? 1 : look.layers.hypsometry && isRender3dStyle(look.style) ? 3 : look.style === 'render' && look.layers.hypsometry ? 2 : 0;
    gl.uniform1i(u('uMode'), mode);
    // Textures 7 forest field, 8 occupation, 12 banks; 10/11 belong to water.
    bindForest(gl, u, this.forest, this.occupation, this.empty, mode === 3, 7, 8, 12);
    bindForestBrushes(gl, u, look.style === 'render3d-brush' && mode === 3, 9);
    gl.uniform1i(u('uRenderV2'),renderV2Number(look.style));gl.uniform1i(u('uV2WaterVisible'),look.layers.water===false?0:1);if(this.base&&look.climate)gl.uniform4fv(u('uV2GlacierSources[0]'),renderV2GlacierSources(this.base.layer,look.climate));gl.uniform1f(u('uV2Season'),look.v2Season??.5);gl.uniform1i(u('uMaterialZone'),renderV2ZoneUniform(look.climateZone));
    gl.uniform1i(u('uEnhanced3d'), look.mesh3d || isRender3dStyle(look.style) ? 1 : 0);
    gl.uniform1i(u('uRefinementMode'), look.refinement3d === 'source' ? 0 : isNeuralRefinement(look.refinement3d ?? 'noise') ? 2 : 1);
    const refined = this.enhanced.at(-1), previousRefined = this.enhanced.at(-2);
    for (const [layer, name, unit] of [[refined, 'Refined', 5], [previousRefined, 'PreviousRefined', 6]] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, layer?.texture ?? this.empty);
      gl.uniform1i(u(`u${name}`), unit); gl.uniform1i(u(`u${name}N`), layer?.layer.n ?? 0);
      gl.uniform4f(u(`u${name}Rect`), layer?.layer.x ?? 0, layer?.layer.y ?? 0, layer?.layer.width ?? 1, 0);
    }
    const enhancedAlpha = refined ? Math.min(1, (performance.now() - refined.fadeStart) / 240) : 1;
    gl.uniform1f(u('uRefinedAlpha'), enhancedAlpha);
    gl.uniform3fv(u('uPaper'), hex(pal.paper)); gl.uniform3fv(u('uSea'), hex(pal.seaFill));
    gl.uniform3fv(u('uShore'), hex(water.stops[0][1])); gl.uniform1i(u('uCoastalSea'), this.coastDistance ? 1 : 0);
    const waterPalette = waterUniforms(water);
    gl.uniform3fv(u('uWaterStops'), waterPalette.colors); gl.uniform1fv(u('uWaterStopT'), waterPalette.positions);
    gl.uniform1i(u('uWaterStopCount'), water.stops.length);
    gl.uniform1f(u('uSeaBand'), (this.seaSurface?.referenceWidth ?? look.mapWidth) * water.bandFraction);
    gl.uniform2f(u('uCoastOrigin'), this.seaSurface?.x ?? 0, this.seaSurface?.y ?? 0); gl.uniform1f(u('uCoastWidth'), this.seaSurface?.width ?? look.mapWidth); gl.uniform1i(u('uCoastN'), this.seaSurface?.n ?? 1);
    gl.uniform3fv(u('uBackground'), hex(look.background)); gl.uniform3fv(u('uFrameColor'), hex(look.style === 'copernicus' ? '#333333' : pal.frame));
    gl.uniform3fv(u('uContourColor'), hex(pal.contour));
    const stops = look.layers.hypsometry || look.style === 'copernicus' ? pal.hypso.slice(0, 8) : [[0, pal.paper], [1, pal.paper]] as [number, string][];
    gl.uniform3fv(u('uStops'), new Float32Array(Array.from({ length: 8 }, (_, i) => hex(stops[Math.min(i, stops.length - 1)][1])).flat()));
    gl.uniform1fv(u('uStopT'), new Float32Array(Array.from({ length: 8 }, (_, i) => stops[Math.min(i, stops.length - 1)][0])));
    gl.uniform1i(u('uStopCount'), stops.length);
    const lights = terrainLights(look.lighting);
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
    gl.uniform1i(u('uOctaves'), Math.min(FRACTAL_ROTATIONS.length, Math.round(d.octaves)));
    // Textures: 0 field, 1 cave, 2 lake, 3 overlay, 4 coast distance.
    gl.uniform1i(u('uField'), 0); gl.uniform1i(u('uCave'), 1); gl.uniform1i(u('uLake'), 2); gl.uniform1i(u('uOverlay'), 3);
    gl.uniform1i(u('uCoastDistance'), 4);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.coastDistance ?? this.empty);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lake ?? this.empty);
    gl.uniform1i(u('uHasLake'), this.lake ? this.lakeMode : 0); gl.uniform1f(u('uLakeN'), this.lakeN);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.overlay ?? this.empty);
    gl.uniform1i(u('uHasOverlay'), this.overlay ? 1 : 0);
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
    const paintedWater = look.style === 'render' && !look.groundCapture;
    const waterBand = (this.seaSurface?.referenceWidth ?? look.mapWidth) * water.bandFraction;
    const renderRivers = (destination: WebGLFramebuffer | null): void => {
      if (!this.riverCount || (look.layers.water === false&&!look.style.startsWith('render-v2'))) return;
      const target = this.target(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.river);
      const r = (name: string): WebGLUniformLocation | null => this.riverUniform(name);
      gl.uniform2f(r('uCanvas'), width, height); gl.uniform2f(r('uOrigin'), origin[0], origin[1]);
      gl.uniform1f(r('uPx'), px); gl.uniform1f(r('uDpr'), stylePixelRatio);gl.uniform1i(r('uPhysicalWidth'),look.style.startsWith('render-v2')?1:0);
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
      if (paintedWater && !this.overlay) { this.paintWater(0, width, height, origin, px, stylePixelRatio, waterBand); return; }
      gl.useProgram(this.composite);
      gl.uniform1i(gl.getUniformLocation(this.composite, 'uLayer'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const renderRetainedWater = (destination: WebGLFramebuffer | null): void => {
      if (!this.retainedWaterPaths.length || (look.layers.water === false&&!look.style.startsWith('render-v2'))) return;
      const canvas = this.retainedWaterCanvas ??= document.createElement('canvas');
      this.retainedWaterTexture ??= gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, this.retainedWaterTexture);
      const key = `${origin[0]},${origin[1]},${px},${width},${height},${water.stops[0][1]}`;
      if (key !== this.retainedWaterViewKey) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        paintRetainedWater(canvas.getContext('2d')!, this.retainedWaterPaths,
          { x: origin[0], y: origin[1], width: width * px, height: height * px }, { width, height }, water.stops[0][1]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.retainedWaterViewKey = key;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (paintedWater) { this.paintWater(11, width, height, origin, px, stylePixelRatio, waterBand); return; }
      gl.useProgram(this.composite);
      gl.uniform1i(gl.getUniformLocation(this.composite, 'uLayer'), 11);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const separateWater = isRender3dStyle(look.style) && look.layers.relief && look.layers.hypsometry && (look.layers.water !== false || look.style.startsWith('render-v2')) && !look.groundCapture;
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
  }

  /** Composite a coverage layer (texture unit `unit`, bound) as painted water; blending is set by the caller. */
  private paintWater(unit: number, width: number, height: number, origin: [number, number], px: number, dpr: number, band: number): void {
    const gl = this.gl;
    if (!this.renderWater) this.renderWater = { program: compile(gl, COMPOSITE_VS, RENDER_WATER_FS), u: new Map() };
    const { program, u: cache } = this.renderWater;
    const u = (name: string): WebGLUniformLocation | null => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name)); return cache.get(name)!; };
    const water = terrainStyle(this.look?.waterStyle ?? this.look?.style ?? 'render', this.look?.colors).water, palette = waterUniforms(water), rings = renderWaterRings(px, band);
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
    gl.uniform1i(u('uWaterStopCount'), water.stops.length);
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
    this.disposed = true; cancelAnimationFrame(this.frame); this.frame = 0;
    const gl = this.gl;
    this.release(this.base); this.details.forEach(d => this.release(d));
    this.enhanced.forEach(d => this.release(d));
    if (this.lake) gl.deleteTexture(this.lake);
    if (this.overlay) gl.deleteTexture(this.overlay);
    deleteForestTextures(gl, this.forest);
    if (this.occupation) gl.deleteTexture(this.occupation.texture);
    this.forest = this.occupation = undefined;
    disposeForestBrushes(gl);
    gl.deleteBuffer(this.riverBuffer); gl.deleteVertexArray(this.riverVao);
    if (this.coastDistance) gl.deleteTexture(this.coastDistance);
    if (this.riverTarget) { gl.deleteFramebuffer(this.riverTarget.framebuffer); gl.deleteTexture(this.riverTarget.texture); }
    if (this.waterTarget) { gl.deleteFramebuffer(this.waterTarget.framebuffer); gl.deleteTexture(this.waterTarget.texture); }
    if (this.retainedWaterTexture) gl.deleteTexture(this.retainedWaterTexture);
    if (this.captureTarget) { gl.deleteFramebuffer(this.captureTarget.framebuffer); gl.deleteTexture(this.captureTarget.texture); }
    gl.deleteProgram(this.terrain); gl.deleteProgram(this.river); gl.deleteProgram(this.composite);
    if (this.renderWater) gl.deleteProgram(this.renderWater.program);
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
export interface ForestTextures { field: ForestField; texture: WebGLTexture; bank?: WebGLTexture }
export function forestTextures(gl: WebGL2RenderingContext, field: ForestField): ForestTextures {
  return { field, texture: forestTexture(gl, field, true), bank: field.bank && forestTexture(gl, { n: field.n, rgba: field.bank }, true) };
}
export function deleteForestTextures(gl: WebGL2RenderingContext, textures: ForestTextures | undefined): void {
  if (!textures) return;
  gl.deleteTexture(textures.texture); if (textures.bank) gl.deleteTexture(textures.bank);
}

/** Forest uniforms shared by the map and perspective programs; units are owned by each caller. */
export function bindForest(gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null,
  forest: ForestTextures | undefined, occupation: { data: ForestOccupation; texture: WebGLTexture } | undefined,
  empty: WebGLTexture, enabled: boolean, fieldUnit: number, occupationUnit: number, bankUnit: number): void {
  const field = enabled ? forest : undefined, applied = field ? occupation : undefined;
  gl.uniform1i(u('uForest'), field ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0 + fieldUnit); gl.bindTexture(gl.TEXTURE_2D, field?.texture ?? empty);
  gl.uniform1i(u('uForestField'), fieldUnit);
  gl.uniform3f(u('uForestRect'), field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
  gl.activeTexture(gl.TEXTURE0 + bankUnit); gl.bindTexture(gl.TEXTURE_2D, field?.bank ?? empty);
  gl.uniform1i(u('uForestBank'), bankUnit); gl.uniform1i(u('uHasForestBank'), field?.bank ? 1 : 0);
  gl.uniform1f(u('uForestBankDensity'), field?.field.bankDensity ?? 1);
  gl.activeTexture(gl.TEXTURE0 + occupationUnit); gl.bindTexture(gl.TEXTURE_2D, applied?.texture ?? empty);
  gl.uniform1i(u('uOccupation'), occupationUnit); gl.uniform1i(u('uHasOccupation'), applied ? 1 : 0);
  gl.uniform3f(u('uOccupationRect'), applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
  gl.uniform1f(u('uOccupationN'), applied?.data.n ?? 1);
}
