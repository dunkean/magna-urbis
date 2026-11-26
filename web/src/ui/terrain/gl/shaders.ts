/**
 * GLSL of the 2D ground (WebGL2 TerrainGl), and the source of the WebGPU twin: web/scripts/wgsl_shaders.ts translates
 * these literals into terrainWgsl.generated.ts. One cohesive unit: the map fragment shader (relief, hypsometry, coast,
 * sea, lakes, the material looks, Render v2 water, Underdark, contours, overlay, frame) with its auxiliary-pass and
 * aux-texture variants (#ifdef AUX_PASS / AUX_TEXTURE), the river capsules and the plain composite.
 * Chrome's shader compile time follows the inlined source: any change here is a measured change, never a cleanup.
 */
import { NEURAL_EARTH_MATERIAL_GLSL, GROUND_COVER_WATER_GLSL, groundCoverInputsGlsl } from '../../../../../rust/bridge/terrainMaterial';
import { RENDER_3D_MATERIAL_GLSL } from '../../../../../rust/bridge/terrainMaterial3d';
import { FOREST_GLSL, FOREST_PRELUDE_GLSL } from '../../../../../rust/bridge/terrainForest';
import { TREE_SYMBOLS_GLSL } from '../../../render/treeSymbolsGlsl';
import { RENDER_V2_GLSL } from '../../../../../rust/bridge/terrainRenderV2';
import { RENDER_V2_COAST_GLSL } from '../../../../../rust/bridge/terrainRenderV2Coast';
import { UNDERDARK_GLSL } from '../../../../../rust/bridge/terrainRenderUnderdark';
import { CROWN_WATER_GLSL } from '../../../../../rust/bridge/terrainCrownWater';
import { FRACTAL_ROTATIONS } from '../../../../../rust/bridge/terrainAdjust';
import { WATER_STYLE_GLSL } from '../../../render/waterStyle';
import { SHORE_DETAIL_GLSL } from '../../../render/shoreDetail';
import { MATERIAL_WATER_GLSL, MOONLIGHT_GLSL } from '../../../render/materialLook';
import { WATER_FRESH_ICE_GLSL, WATER_REGIME_GLSL } from '../../../render/waterRegime';
import { SATELLITE_FRESH_WATER_GLSL } from '../../../render/waterPalette';
import { RIVER_NOISE_GLSL } from '../../../render/riverSurface';
import { LAKE_GLSL } from '../../lakeGeometry';
import { TERRAIN_3D_NOISE_GLSL } from '../../terrain3dNoise';

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
// City Bench retained rivers (setRetainedWater city): 1 grades their depth from the bank.
uniform int uCityWater;
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

${SHORE_DETAIL_GLSL}

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
${TREE_SYMBOLS_GLSL}
${RENDER_V2_GLSL}
${WATER_FRESH_ICE_GLSL}
${WATER_REGIME_GLSL}

${WATER_STYLE_GLSL}
${MATERIAL_WATER_GLSL}
${SATELLITE_FRESH_WATER_GLSL}
${RENDER_V2_COAST_GLSL}
${MOONLIGHT_GLSL}
${CROWN_WATER_GLSL}
// Water cover (0-1) at a crown's foot: the sea below the zero level, the water layer at that point of the canvas.
float crownFootWater(vec2 p){
  float h=surface(p).x;if(uFloor>0.)h=max(h,uFloor);
  float w=h<0.?1.:0.;
  vec2 q=(p-uOrigin)/uPx;
  if(uUseWaterLayer==1&&q.x>=0.&&q.y>=0.&&q.x<uCanvas.x&&q.y<uCanvas.y)w=max(w,texelFetch(uWaterLayer,min(ivec2(q.x,uCanvas.y-q.y),ivec2(uCanvas)-1),0).a);
  return w;
}
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
    vec3 canopyHue=groundToDisplay(m.albedo);
    applyPaperMap(m,world,uPx);
    if(uPaperMap==1){
      // The ink-and-wash ramp sets value, but its olive forest must retain the seasonal crown hue, including
      // green evergreens among turned broadleaves. The unresolved V2 mean carries that same hue already.
      vec3 paper=groundToDisplay(m.albedo);vec3 luma=vec3(.2126,.7152,.0722);
      m.albedo=groundToLinear(mix(paper,canopyHue*dot(paper,luma)/max(dot(canopyHue,luma),.02),forestSeason().x*forestMapCover));
    }
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

// Distance into a lake's open water in metres (uLake g, bilinear; negative or 0 outside a lake).
float lakeDistance(vec2 world) {
  vec2 g = clamp(world * uLakeN / uMapW - 0.5, vec2(0.), vec2(uLakeN - 1.));
  ivec2 p = ivec2(floor(g)), q = min(p + 1, ivec2(int(uLakeN) - 1)); vec2 f = fract(g);
  return mix(mix(texelFetch(uLake,p,0).g,texelFetch(uLake,ivec2(q.x,p.y),0).g,f.x),mix(texelFetch(uLake,ivec2(p.x,q.y),0).g,texelFetch(uLake,q,0).g,f.x),f.y);
}

// Distance from the detailed lake outline near the edge, from the distance field
// further in. Gentle littoral shelves expose more bottom than steep banks.
float lakeBedTransmission(float shore,float inside,float fieldDistance,float slope,vec2 world) {
  float distance=mix(max(0.,inside*uPx),max(0.,fieldDistance),smoothstep(.16,.75,shore));
  float deposit=v2Pattern(vec3(world,0.),92.,uPx,uMaterialSeed+909u);
  float shelf=mix(9.,42.,smoothstep(-1.,1.,deposit))/(1.+7.*slope);
  return exp2(-distance/shelf)*(1.-smoothstep(.010*uMapW,.016*uMapW,distance));
}
vec3 satelliteBed(vec3 water,float shallow,float cover,vec2 world){
  float sediment=smoothstep(-.075,.23,water.r-water.b);
  vec3 gravel=mix(vec3(.47,.49,.33),vec3(.63,.46,.28),sediment);
  float grains=v2Pattern(vec3(world,0.),2.8,uPx,uMaterialSeed+908u);
  gravel+=vec3(.075,.067,.050)*clamp(grains,-1.2,1.2);
  float bottom=shallow*mix(sqrt(shallow),.88,sediment)*(.60-.18*sediment);
  return mix(water,gravel,bottom*cover);
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
#ifdef AUX_TEXTURE
  if(uForestTrees.w==-4.){
    uvec2 meta=texelFetch(uAux,ivec2(gl_FragCoord.xy),0).xy;
    outColor=vec4(vec3((meta.x>>16u)&255u,meta.x>>24u,meta.y>>24u)/255.,1.);
    return;
  }
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
    // The fractal shoreline below the cells (render/shoreDetail.ts): the sea polygon of the engine follows the same line.
    if (uCoastal == 1 && uUnderdark == 0) s.x += shoreOffset(world, s);
    // Contours follow the raster surface: refinement adds relief, not ink.
    vec3 raster = s;
    // The engine's shoreline (its sea polygon) is the zero level of this height: refinement adds relief, never moves the coast.
    float shoreH = s.x;
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
    s.x = shoreH > 0.0 ? max(s.x, min(shoreH, 0.05)) : min(s.x, shoreH);
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
    // Paper map woods (render/treeSymbolsGlsl.ts): their wash on the ground, then the engraved tree symbols over it.
    if(uForestBrushes==1 && uMode==0)if(uGroundCapture==0){
      // The overlay's lit land in summer (cartographyProducts landBackdrop) on the shore ring's binding, box mipmaps of
      // a transparent-on-water image: rgb / a is the land colour. Uploaded once per map: the date is laid here.
      if(uHasLandBackdrop==1){
        vec4 land=textureLod(uShoreRing,world/uMapW,max(0.,log2(uPx*float(textureSize(uShoreRing,0).x)/uMapW)));
        color=mix(color,landSeason(land.rgb/max(land.a,1e-3),world,landS.x),land.a*landCover);
      }
      color=mix(color,treeWash(color,world),landCover);
      vec4 trees=treeSymbols(world)*landCover;
      color=trees.rgb+color*(1.-trees.a);
    }
#endif
    // One V2 water evaluation per fragment (the three cases below only choose its inputs).
    bool v2w=false;vec3 wBase=color;float wCover=0.,wKind=1.,wDepth=0.;
    // Resolved crowns of the fragment, trees or Underdark mushroom caps: rooted on land, they overhang every water
    // (rivers, lakes, the sea shore) whole (terrainCrownWater.ts waterUnderCrown).
    float crownCover=underdark?udCapCover:forestResolvedCover;
#ifndef AUX_PASS
    // On open-air maps the cave binding carries the road paint of this exact tile, top row first.
    // The same seasonal crown silhouette and cast shade that cover the river also cover the travelled ground.
    if(uHasCave==2 && landCover>0.){
      ivec2 at=clamp(ivec2(px),ivec2(0),ivec2(uCanvas)-1);
      vec4 bed=texelFetch(uCave,at,0);
      color=mix(color,bed.rgb*(1.-.32*forestResolvedShade),bed.a*landCover*(1.-crownCover));
      wBase=color;
    }
#endif
    // Fresh ice of the fragment (terrainRenderV2Winter v2FreshIce): x freeze of the water's altitude, y open channel
    // of a river, z inside a lake, w lake shore; the bank line apart. One sheet evaluation below for every case.
    vec4 wIce=vec4(0.);float wIceEdge=0.;
    // Share of the water that is fresh water: its climate tone is laid after the evaluation (waterPalette.ts).
    float wFresh=0.;
    // Estuary: share of the river's own water in a sea fragment that lies under a river's ribbon. 1 at the sea-level
    // line inside the channel, 0 once the sea is 3 m deep: the river's colour runs out into the shallows and fades,
    // instead of a deep river ending against a pale wedge of sea.
    float wEst=0.;
    // Open cover of a river's water in the fragment (land side: its wet bed; sea side: its share of the estuary), kept
    // through the antialiased coastline below.
    float wRiver=0.;
    float riverLight=0.,riverFoam=0.;
    // Frozen share of a sea fragment (v2SeaIceCover of its sea evaluation): the estuary's river water, the climate tints
    // and the swell lie under the sea ice, so a frozen sea is ice to the coastline and across its river mouths.
    float wSeaIce=0.;
    // Open share of a lake fragment (0 along its shore, 1 well inside), for the lake's surface tone (v2LakeSurface).
    float wLake=0.,lakeBed=0.,inlet=0.,inletOpening=0.;
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
          float bed=waterUnderCrown(water.a,crownCover);wCover=bed;
          vec3 painted=water.rgb/max(water.a,1e-3);
          // The natural-water pass already resolved banks and individual riffles. Its blue
          // stop at the shore is 92/255. Transfer the light around that value onto the
          // satellite or paper palette; their own water hue and winter cover stay authoritative.
          if(uNaturalWater==1){
            riverLight=clamp(painted.b-92./255.,-.18,.35);
            riverFoam=clamp((painted.g-.30)/.28,0.,1.);
          }
          // Sandy beds lean red: they are ground. The compositor's damp shadow on the land beside the water (dark
          // olive, greener than any water colour) is ground too: it darkens the bank. Read as partial water it laid a
          // shallow, bed-coloured fringe along every course, most of what a narrow tributary showed beside its trunk.
          float solid=smoothstep(.05,.15,painted.r-painted.b);
          // Shallow water mixed with ochre silt can also lean green. Only the
          // dark olive land shadow should cut a hole in the water coverage.
          float shadow=1.-smoothstep(.10,.16,max(painted.g,max(painted.r,painted.b)));
          float damp=(1.-solid)*shadow*smoothstep(.005,.025,painted.g-max(painted.r,painted.b));
          // Underdark: no ice or dry beds under the vault; the whole course is cave water.
          if(underdark)solid=0.;
          // A dry course shows through the bank crowns.
          float through=uMaterialZone>0?step(.001,V2_WATER_ARIDITY[waterZone()]):0.;
          bed=mix(bed,water.a,solid*through);
          // Snow already shades the ground at this fragment, including its local drifts and relief.
          // Only the uncovered fraction receives a sediment wash. The wet channel freezes separately.
          float bareGround=underdark?1.:1.-v2Here.snow;
          wBase=mix(wBase,painted,bed*solid*bareGround*(uNaturalWater==1?.72:1.));wCover*=1.-solid;
          wBase*=1.-.3*wCover*damp;wCover*=1.-damp;
          // City Bench: a retained river reads as water at city zoom instead of a near-black ribbon. Its depth grows
          // from the bank (distance to the nearest dry pixel over 8 directions and 7 radii).
          if(uCityWater==1&&water.a>.002){
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
            wDepth=clamp(.07*bank*uPx,.4,6.)*water.a;
          }
          // Distance inside the nearest lake, in device pixels (negative outside a lake: lakeShore is positive inside).
          float m=uHasLake>0?lakeShore(world,uHasLake==1):-1e3;
          float inside=uHasLake>0?m/max(fwidth(m),1e-4):-1e3;
          // Inside a lake the water is a lake (kind 2), not a river's stream: its depth grows with the distance into the
          // lake, sooner below steep banks (terrainRenderV2 v2LakeDepth); only a wide lake's open water drifts in tone.
          if(m>0.){
            float d=lakeDistance(world);wKind=2.;wDepth=v2LakeDepth(d,grad);wLake=smoothstep(150.,600.,d);
            if(uRenderV2==1)lakeBed=lakeBedTransmission(m,inside,d,grad,world);
            // A channel crosses the old shoreline below the exposed shelf. Its depth and
            // surface colour persist into the opening, then dissipate across the lake.
            if(uHasOverlay==2){
              inletOpening=texelFetch(uOverlay,ivec2(gl_FragCoord.xy),0).g;
              inlet=inletOpening*exp2(-max(0.,inside*uPx)/22.);
              wEst=inlet;lakeBed*=1.-inlet;
              riverLight=mix(riverLight,-.10,inlet);riverFoam*=1.-inlet;
            }
          }
          // Cave water is one colour: no shallow lakes beside deep rivers.
          if(underdark)wDepth=8.;
          // Dry season of a dry climate: the lake draws down, leaving a pale exposed shore inside its rim.
          float drop=waterLakeDrop()*80.;
          if(drop>1.&&uHasLake>0){
            // Narrow, steep margins expose little sediment; shallow coves expose broad bars.
            float deposit=v2Pattern(vec3(world,0.),180.,uPx,uMaterialSeed+905u);
            float retreat=drop*mix(.16,1.,smoothstep(-1.,1.,deposit)) / (1.+8.*grad);
            float ring=step(0.,inside)*(1.-smoothstep(.58*retreat,retreat,inside*uPx));
            ring*=1.-inletOpening;
            wBase=mix(wBase,waterExposedShore(world),wCover*ring*bareGround);wCover*=1.-ring;
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
          wFresh=1.;
          wRiver=wCover;
          // The aux-texture variant only mixes wBase where water remains: a fully dry or frozen bed is the ground itself.
          color=wBase;
        } else {
          // The river ribbon and its optical plume blend into the sea by coverage and depth.
          // A dry bed (painted sandy) ends at the coastline: no bed shows under the sea.
          float running=water.a*(1.-smoothstep(.05,.15,(water.r-water.b)/max(water.a,1e-3)));
          if(uHasOverlay==2){
            // The exact shoreline selects the sea side. Surface sediment can
            // drift above a deep seabed without affecting the upstream water.
            wEst=texelFetch(uOverlay,ivec2(gl_FragCoord.xy),0).g;
          }else{
            float mixingDepth=3.;
            if(running>.002)mixingDepth+=1.4*v2Pattern(vec3(world,0.),95.,uPx,uMaterialSeed+906u);
            wEst=running*(1.-smoothstep(0.,max(1.,mixingDepth),-s.x));
          }
          wFresh=wEst;
          wRiver=running;
        }
      }
      else {
        // Rivers and dry beds stop at the coast: past it they fade into the sea over its first two metres.
        if(uCoastal==1)under*=1.-smoothstep(0.,2.,-s.x);
        color=color*(1.-water.a*under)+water.rgb*under;
      }
    } else if (uWaterVisible == 1 && uHasLake > 0) {
      float m = lakeShore(world, uHasLake == 1);
      float w = max(fwidth(m), 1e-4);
      vec3 lakeColor;
      float distance = lakeDistance(world);
      {
        float position=max(distance,0.)/uSeaBand;
        lakeColor = uNaturalWater==1?materialWater(world,position,uPx):styledWater(position);
        // The rivers' tone, except over the ice of a frozen natural lake.
        if(uNaturalWater==0||uWaterSeason.y<.5)lakeColor=freshWaterTone(lakeColor);
      }
      float a=clamp(m/w+.5,0.,1.);
      if(uRenderV2>0){
        v2w=true;wBase=color;wCover=waterUnderCrown(a,crownCover);wKind=2.;wDepth=underdark?8.:v2LakeDepth(distance,grad)*a;wLake=smoothstep(150.,600.,distance);wFresh=1.;
        if(uRenderV2==1)lakeBed=lakeBedTransmission(m,m/w,distance,grad,world);
        if(!underdark){wIce=vec4(v2WinterFresh,0.,1.,1.-smoothstep(0.,24.*uDpr,m/w));wIceEdge=1.-smoothstep(.5,3.5*uDpr,m/w);}
      }else color=mix(color,lakeColor,a);
      coverage=a+coverage*(1.-a);
    }
    // The ice lies on the ground like a dry bed (the aux-texture variant only mixes wBase where water remains);
    // only the open remainder takes the Render v2 water.
    if(uRenderV2>0)if(wIce.x>.001){
      vec4 sheet=v2FreshIce(world,uPx,wIce.x,wIce.y,wIce.z,wIce.w,wIceEdge);
      wBase=mix(wBase,sheet.rgb,wCover*sheet.a);wCover*=1.-sheet.a;wRiver*=1.-sheet.a;color=wBase;
    }
    // The antialiased coastline: a river crossing it stays water through the band, in its own colour (the estuary's
    // river share), instead of a line of land colour drawn across every mouth like a thin dam.
    if(uRenderV2>0 && landCover<1.){v2w=true;if(s.x>=0.){wEst=wRiver;wFresh=wEst;}wBase=landColor;wCover=waterUnderCrown(1.-landCover*(1.-wRiver),crownCover);wKind=1.;wDepth=max(-s.x,0.);}
#ifdef AUX_PASS
    uint auxWater = 0u;
    if(!underdark && v2w && uV2WaterVisible == 1 && wCover > 0.){
      // One call site for the water model: the second turn is the river's water of an estuary fragment.
      vec3 wc=vec3(0.);
      for(int i=0;i<2;i++){
        if(i==1&&wEst<=.002)break;
        vec3 c=v2WaterColor(v2Here, world, uPx, wCover, i==0?wKind:3., i==0?wDepth:8.);
        if(i==0&&wKind<1.5)wSeaIce=v2SeaIceCover;
        wc=i==0?c:mix(wc,c,wEst*(1.-wSeaIce));
      }
      // Alpha: 1 for open water down to 1/255 for a frozen sea (never 0, the texture's "no water" mark).
      auxWater=auxPack4x8(vec4(clamp(wc, 0., 1.), 1.-wSeaIce*254./255.));
    }
    outAux = uvec4(auxCanopy, auxWater); return;
#elif defined(AUX_TEXTURE)
    if(underdark){if(v2w && uV2WaterVisible == 1 && wCover > 0.)color = mix(wBase, underdarkWater(world, uPx, wDepth, 1.-smoothstep(0., .9, wCover)*smoothstep(0.,3.,wDepth)), wCover);}
    else if(v2w && uRenderV2 > 0 && uV2WaterVisible == 1 && wCover > 0. && uHasAux == 1){ vec4 aux = auxUnpack4x8(texelFetch(uAux, ivec2(gl_FragCoord.xy), 0).w); if(aux.a > 0.){ color = mix(wBase, aux.rgb, wCover); if(wKind < 1.5) wSeaIce = clamp((1. - aux.a) * 255. / 254., 0., 1.); } }
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
          if(i==0&&wKind<1.5)wSeaIce=v2SeaIceCover;
          wc=i==0?c:mix(wc,c,wEst*(1.-wSeaIce));
        }
        color=wc;
      }
    }
#endif
#ifndef AUX_PASS
    if(uRenderV2>0&&v2w&&uV2WaterVisible==1&&!underdark){
      // Keep gallery shade on inland water. Detached crown silhouettes on the open sea read as offshore trees.
      if(wKind>1.5)color*=1.-.4*forestResolvedShade*wCover;
      // A wide lake's open water drifts in tone along the wind (terrainRenderV2 v2LakeSurface); its shore keeps the bed.
      if(wLake>0.)color=mix(color,v2LakeSurface(color,world,uPx,wLake),wCover);
      // Climate and season of the fresh water (waterPalette.ts), one tone for rivers, lakes and the estuary's river share;
      // under the ice of a frozen sea.
      if(wFresh*wCover>0.){
        vec3 toned=uRenderV2==1?satelliteFreshWater(color,world,uPx):freshWaterTone(color);
        color=mix(color,toned,wFresh*wCover*(1.-wSeaIce));
      }
      if(wKind>1.5&&wKind<2.5&&uRenderV2==1&&uNaturalWater==1&&lakeBed>.002)
        color=satelliteBed(color,lakeBed,wCover,world);
      if((wKind>2.5||inlet>.002)&&uRenderV2==1&&wCover>0.){
        float streamCover=wCover*(wKind>2.5?1.:inlet);
        // Broad sky reflections reveal the free surface even in rust-coloured water.
        vec2 wind=vec2(.89*world.x+.46*world.y,-.46*world.x+.89*world.y);
        float sheen=v2Pattern(vec3(wind*vec2(.28,1.),0.),18.,uPx,uMaterialSeed+907u);
        color=mix(color,vec3(.51,.62,.65),streamCover*(.035+.085*smoothstep(.05,1.45,sheen)));
        if(uNaturalWater==1){
          // Less bottom light returns through turbid red/brown water. Where the
          // inside of a bend shoals, the local mineral colour shows through.
          float shallow=clamp((riverLight+.105)/.26,0.,1.);
          color=satelliteBed(color*(1.-.12*streamCover*(1.-shallow)),shallow,streamCover,world);
          color+=vec3(.74,.91,1.)*(.15*riverFoam*streamCover);
        }
      }
    }
    if(uPaperMap==1&&v2w&&wCover>0.&&!underdark){
      vec3 paper=paperWater(wKind,paperShore(world));
      // The climate's fresh-water hue as a light wash, at the paper's own value.
      vec3 hue=mix(vec3(1.),uFreshWater.rgb/max(dot(uFreshWater.rgb,vec3(.2126,.7152,.0722)),.05),.3*uFreshWater.a);
      // A lake takes the sea's paper ramp over its own distance to the bank: a narrow darker margin (60 m), a calm mid-tone centre.
      if(wKind>1.5&&wKind<2.5)paper=paperWater(1.,mix(.6,1.,exp(-max(lakeDistance(world),0.)/60.)));
      if(wKind>1.5)paper*=hue;
      if(wKind>2.5)paper*=1.+.24*riverLight;
      // Parchment seas take the climate in muted paper tones: greener on warm coasts, clearer when arid, greyer when cold.
      if(wKind<1.5){
        float T=uMaterialClimate.x,warm=smoothstep(17.,25.,T),cold=1.-smoothstep(-1.,6.,T),arid=1.-smoothstep(150.,500.,uMaterialClimate.y);
        paper*=mix(vec3(1.),vec3(.93,1.03,.97),warm);
        paper=mix(paper,paper*vec3(.98,1.,1.04)+.02,arid);
        paper*=mix(vec3(1.),vec3(.90,.93,.96),cold);
        // The satellite's estuary share (wEst, the river's own water at its mouth and across the antialiased coastline),
        // in the paper river tone: the river runs into the sea instead of stopping at a line of sea colour.
        paper=mix(paper,paperWater(3.,0.)*hue,wEst*(1.-wSeaIce));
      }
      color=mix(wBase,paper,wCover);
    }
    // Coastal swell and surf on the open sea (terrainRenderV2Coast). The estuary share is not
    // read: the water layer gives it to every shallow sea fragment it covers, not only to river mouths. Sea ice damps
    // the swell and holds no surf: both fade with the frozen share, whatever the brightness of the ice.
    if(uRenderV2>0)if(v2w&&wKind<1.5&&uV2WaterVisible==1&&!underdark)color=v2CoastSwell(color,world,s,uPx,wCover*(1.-wSeaIce));
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
layout(location = 3) in vec3 aProfile;
uniform vec2 uCanvas; uniform vec2 uOrigin; uniform float uPx; uniform float uDpr;uniform int uPhysicalWidth;
out vec2 vP; flat out vec4 vSeg; flat out vec4 vWidths; flat out vec3 vColor; flat out vec3 vProfile;
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
  vP = p; vSeg = vec4(a, b); vWidths = vec4(half_,aWidth); vColor = aColor; vProfile = aProfile;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

export const RIVER_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 vP; flat in vec4 vSeg; flat in vec4 vWidths; flat in vec3 vColor; flat in vec3 vProfile;
out vec4 outColor;
uniform vec2 uOrigin; uniform float uPx; uniform float uMapW;
// Unpainted water keeps coverage and replaces encoded seasonal RGB with one palette colour.
uniform vec4 uFlatWater;
${RIVER_NOISE_GLSL}
uniform sampler2D uOverlay; uniform int uHasOverlay;
uniform sampler2D uLake; uniform int uHasLake; uniform float uLakeN;
vec4 bw(float t) { float t2=t*t,t3=t2*t,u=1.-t; return vec4(u*u*u,3.*t3-6.*t2+4.,-3.*t3+3.*t2+3.*t+1.,t3)/6.; }
${LAKE_GLSL}
void main() {
  // Sediment capsules are data for the material water compositor, not standalone blue blobs offshore.
  if (uFlatWater.a > 0. && vColor.b >= .5) discard;
  vec2 a = vSeg.xy, b = vSeg.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  float d = length(pa - ba * h);
  float alpha = clamp(mix(vWidths.x, vWidths.y, h) + 0.5 - d, 0.0, 1.0);
  // One optical channel holds lake inlet coverage on lakes and sediment concentration at sea.
  if(vColor.b < -1.5){
    if(uFlatWater.a>=-1.5 || uHasLake==0 || alpha<=0.) discard;
    float shore=lakeShore(uOrigin+vP*uPx,uHasLake==1);
    float halfWidth=max(.5,mix(vWidths.x,vWidths.y,h));
    float mixing=(1.-smoothstep(.56,1.,h))*(1.-smoothstep(.68,1.04,d/halfWidth));
    outColor=vec4(0.,alpha*mixing*clamp(shore/max(fwidth(shore),1e-4)+.5,0.,1.),0.,0.);
    return;
  }
  if (uHasLake > 0) {
    float m = lakeShore(uOrigin + vP * uPx, uHasLake == 1);
    alpha *= 1. - clamp(m / max(fwidth(m), 1e-4) + .5, 0., 1.);
  }
  // Marine concentration has its own channel in the satellite's raw material
  // target. Its footprint never changes the land, lake, or physical river mask.
  if(vColor.b<0.){
    if(uFlatWater.a>=-1.5) discard;
    vec2 dir=ba/max(length(ba),.001);
    float reach=max(length(ba)*uPx,1.);
    float width=max(1.,vWidths.z);
    float along=dot(pa,dir)*uPx, across=dot(pa,vec2(-dir.y,dir.x))*uPx;
    float travel=max(0.,along-vColor.g*clamp(across,-.5*width,.5*width));
    float t=travel/reach;
    if(along < -1.5*width || t>=1.) discard;
    vec2 origin=(uOrigin+a*uPx)/197.;
    float drift=2.*riverNoise(origin)-1.;
    float current=riverNoise(origin+vec2(t*2.7,4.1))-.5;
    float sweep=travel*(.36*drift+.52*current);
    float spread=.5*width+travel*(.24+.14*riverNoise(origin+vec2(3.2,t*3.)));
    float lateral=(across-sweep)/spread;
    float eddy=riverNoise(origin+vec2(t*4.,lateral*1.4));
    lateral+=min(1.,travel/width)*(.52*(eddy-.5)+.23*(riverNoise(origin+vec2(t*8.,lateral*2.3)+eddy)-.5));
    float softness=clamp(max(uPx/width,.025)+travel/width*.55,.025,1.);
    float sides=1.-smoothstep(1.-softness,1.+.60*softness,abs(lateral));
    float concentration=vColor.r*sides*exp2(-2.6*t)*(1.-smoothstep(.62,1.,t));
    outColor=vec4(0.,concentration,0.,0.);
    return;
  }
  if (alpha <= 0.0) discard;
  if(uFlatWater.a < -1.5 && vColor.r<.001 && uPx<4.){
    // Sand spills onto the bank in uneven tongues. The inset is measured in metres and
    // disappears on narrow channels, where a pixel already spans the margin.
    float halfWidth=mix(vWidths.x,vWidths.y,h),room=min(6./uPx,.16*halfWidth);
    vec2 world=uOrigin+vP*uPx;
    float margin=room*(.50*riverNoise(world/16.)+.35*riverNoise(world/5.));
    alpha*=smoothstep(-.5,1.+.45*room,halfWidth-d-margin);
  }
  // Premultiplied; blended with MAX so overlapping capsules cover like one stroke.
  vec3 color = uFlatWater.a > 0. ? uFlatWater.rgb : vColor;
  // Material capsules already know their bank in metres. Retain that distance cue
  // with the seasonal channels so it survives tile cuts, overlaps and changes of scale.
  if (uFlatWater.a < 0.) {
    float bank=max(0.,(mix(vWidths.x,vWidths.y,h)-d)*uPx);
    float core=.30*smoothstep(0.,20.,bank);
    if(uFlatWater.a < -1.5 && vColor.r>.1){
      float radius=max(.5,mix(vWidths.x,vWidths.y,h));
      vec2 tangent=ba/max(length(ba),.001);
      float offset=dot(pa-ba*h,vec2(-tangent.y,tangent.x));
      float side=clamp(offset/radius,-1.,1.);
      float bend=mix(vProfile.x,vProfile.y,h);
      // The bed shelves gradually on the inside of a turn and drops steeply
      // under the cutbank. Use radial distance so the end caps join smoothly.
      float bed=max(0.,1.-pow(min(d/radius,1.),2.8));
      float run=vProfile.z+h*length(ba)*uPx;
      vec2 bedCoord=vec2(run/42.,offset*uPx/8.);
      float bars=riverNoise(bedCoord+vec2(0.,1.7*riverNoise(vec2(run/99.,.7))));
      // Flow stretches suspended sediment into intermittent streaks. Warp their
      // cross-channel position so they follow the bend without striping its whole length.
      float filament=riverNoise(vec2(run/24.,offset*uPx/2.9)+vec2(.7,3.1)*bars);
      float resolved=1.-smoothstep(.7,2.9,uPx);
      float streak=smoothstep(.48,.82,filament)*smoothstep(.26,.67,bars)*resolved;
      float depth=min(1.,bed*exp2(-2.8*bend*side+.9*(bars-.55)))*(1.-.29*streak);
      // At overview scale a subpixel channel integrates to its open-water tone.
      core=.30*mix(.77,min(1.,depth),smoothstep(1.3,5.,radius));
    }
    float glint=0.;
    if(vColor.b>0. && vColor.r>.1 && uPx<2.) {
      vec2 world=uOrigin+vP*uPx;
      float pocket=riverNoise(world*.049);
      // Sparse light on riffle crests. The second field is stretched and warped in
      // world space; its phase never restarts at the end of a river segment or tile.
      vec2 q=vec2(dot(world,vec2(.19,.12)),dot(world,vec2(-.26,.41)))+vec2(2.7,-1.3)*pocket;
      float crest=1.-smoothstep(.025,.14,abs(riverNoise(q)-.54));
      glint=vColor.b/.45*smoothstep(.48,.80,pocket)*crest
           *smoothstep(.4,2.,bank)*(1.-smoothstep(.45,2.,uPx));
    }
    if(vColor.r<.001){
      // The radial distance includes each round cap. Adjacent reaches can MAX
      // their interiors without projecting a different stripe across each join.
      float halfWidth=max(mix(vWidths.x,vWidths.y,h),.5);
      float hollow=riverNoise((uOrigin+vP*uPx)/39.);
      float spread=mix(vWidths.z,vWidths.w,h)*vColor.b/.45;
      float pool=smoothstep(.97,1.14,spread)*smoothstep(.26,.77,hollow);
      float radius=halfWidth*(.11+.34*pool);
      // A soft transverse profile fades continuously through a round end cap.
      float damp=exp2(-1.4*d*d/(radius*radius+.25))*min(1.,radius/.65);
      float scour=damp*(.58+.42*pool);
      float nearBed=smoothstep(2.,8.,halfWidth)*(1.-smoothstep(2.,7.,uPx));
      if(nearBed>0.){
        vec2 world=uOrigin+vP*uPx, tangent=ba/max(length(ba),.001);
        float side=dot(pa-ba*h,vec2(-tangent.y,tangent.x))/halfWidth;
        float bend=mix(vProfile.x,vProfile.y,h);
        float wander=riverNoise(world/65.)-.5;
        float axis=clamp(.72*wander-.53*bend+.19*(riverNoise(world/17.)-.5),-.72,.72);
        float split=smoothstep(8.,26.,halfWidth*uPx)*smoothstep(.28,.78,hollow);
        float flank=axis<0.?1.:-1.;
        float gut=side-axis, bypass=side-(axis+flank*.62*split);
        float cut=exp2(-25.*gut*gut);
        float chute=split*exp2(-68.*bypass*bypass);
        float margin=smoothstep(.67,.91,d/halfWidth)*(1.-smoothstep(.92,1.03,d/halfWidth));
        float scarp=margin*(.24+.48*max(0.,-side*bend))*(.45+.55*hollow);
        // A gravel bar parts the narrow threads. Only hollows with actual pool retention
        // can reach the compositor's wet threshold; a dark groove alone stays dry.
        float form=max(.56*cut,max(.37*chute,scarp))*(1.-smoothstep(.95,1.04,d/halfWidth));
        float pastEnd=abs(dot(pa,tangent)-h*length(ba))/halfWidth;
        scour=mix(scour,max(form,cut*pool)*(1.-smoothstep(.04,.4,pastEnd)),nearBed);
      }
      core=.30*scour;
    }
    color.b=core+.70*glint;
    if(uFlatWater.a < -1.5)color.g=0.; // Reserved for the sea-side concentration above.
  }
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
