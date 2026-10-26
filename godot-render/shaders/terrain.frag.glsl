#version 450
// Generated syntax/binding translation; original shader maths and orientation retained.
layout(set = 0, binding = 0, std140) uniform RenderUniforms {
  layout(offset = 0) vec4 uQuad;
  layout(offset = 16) vec2 uCanvas;
  layout(offset = 24) vec2 uOrigin;
  layout(offset = 32) float uPx;
  layout(offset = 36) float uDpr;
  layout(offset = 40) float uMapW;
  layout(offset = 44) int uFieldN;
  layout(offset = 48) vec2 uFieldOrigin;
  layout(offset = 56) float uFieldCell;
  layout(offset = 60) int uMaxLod;
  layout(offset = 64) float uAlpha;
  layout(offset = 68) int uBase;
  layout(offset = 72) int uHasCave;
  layout(offset = 76) int uHasLake;
  layout(offset = 80) float uLakeN;
  layout(offset = 84) int uHasOverlay;
  layout(offset = 88) int uUseWaterLayer;
  layout(offset = 92) int uWaterVisible;
  layout(offset = 96) int uRelief;
  layout(offset = 100) int uMode;
  layout(offset = 112) vec3 uPaper;
  layout(offset = 128) vec3 uSea;
  layout(offset = 144) vec3 uBackground;
  layout(offset = 160) vec3 uFrameColor;
  layout(offset = 176) vec3 uContourColor;
  layout(offset = 192) vec3 uShore;
  layout(offset = 204) int uCoastalSea;
  layout(offset = 208) float uSeaBand;
  layout(offset = 216) vec2 uCoastOrigin;
  layout(offset = 224) float uCoastWidth;
  layout(offset = 228) int uCoastN;
  layout(offset = 240) vec3 uStops[8];
  layout(offset = 368) float uStopT[8];
  layout(offset = 496) int uStopCount;
  layout(offset = 512) vec3 uLight;
  layout(offset = 528) vec3 uLight2;
  layout(offset = 540) float uExaggeration;
  layout(offset = 544) float uFlatLight;
  layout(offset = 548) float uRockStrength;
  layout(offset = 552) float uShade;
  layout(offset = 556) float uMinH;
  layout(offset = 560) float uMaxH;
  layout(offset = 564) float uGlobalMin;
  layout(offset = 568) float uFloor;
  layout(offset = 572) int uCoastal;
  layout(offset = 576) int uFrame;
  layout(offset = 580) int uContours;
  layout(offset = 584) float uStep;
  layout(offset = 588) float uThinW;
  layout(offset = 592) float uIndexW;
  layout(offset = 596) float uThinA;
  layout(offset = 600) float uIndexA;
  layout(offset = 604) float uFlatSlope;
  layout(offset = 608) int uRefine;
  layout(offset = 612) float uSourceCell;
  layout(offset = 616) uint uSeed;
  layout(offset = 620) int uEnhanced3d;
  layout(offset = 624) int uGroundCapture;
  layout(offset = 628) int uRefinementMode;
  layout(offset = 640) vec4 uRefinedRect;
  layout(offset = 656) vec4 uPreviousRefinedRect;
  layout(offset = 672) int uRefinedN;
  layout(offset = 676) int uPreviousRefinedN;
  layout(offset = 680) float uRefinedAlpha;
  layout(offset = 688) vec4 uDetailA;
  layout(offset = 704) vec3 uDetailB;
  layout(offset = 716) int uOctaves;
  layout(offset = 720) int uForest;
  layout(offset = 724) int uForestBrushes;
  layout(offset = 736) vec3 uForestRect;
  layout(offset = 748) int uHasForestBank;
  layout(offset = 752) float uForestBankDensity;
  layout(offset = 756) int uHasOccupation;
  layout(offset = 768) vec3 uOccupationRect;
  layout(offset = 780) float uOccupationN;
  layout(offset = 784) uint uMaterialSeed;
  layout(offset = 792) vec2 uMaterialClimate;
  layout(offset = 800) vec3 uWaterStops[8];
  layout(offset = 928) float uWaterStopT[8];
  layout(offset = 1056) int uWaterStopCount;
};
layout(set = 0, binding = 1) uniform sampler2D uField;
layout(set = 0, binding = 2) uniform sampler2D uCave;
layout(set = 0, binding = 3) uniform sampler2D uLake;
layout(set = 0, binding = 4) uniform sampler2D uOverlay;
layout(set = 0, binding = 5) uniform sampler2D uWaterLayer;
layout(set = 0, binding = 6) uniform sampler2D uCoastDistance;
layout(set = 0, binding = 7) uniform sampler2D uRefined;
layout(set = 0, binding = 8) uniform sampler2D uPreviousRefined;
layout(set = 0, binding = 9) uniform sampler2DArray uForestBrushAtlas;
layout(set = 0, binding = 10) uniform sampler2D uForestField;
layout(set = 0, binding = 11) uniform sampler2D uForestBank;
layout(set = 0, binding = 12) uniform sampler2D uOccupation;

layout(location = 0) out vec4 outColor;
          // device pixels
          // world position of the canvas' top-left corner
             // metres per device pixel


    
 
 
   // uHasLake: 1 procedural shore, 2 exact shore
 
 
               // 0 shaded, 1 elevation colours

 
    
  
 


 
  







// Detail noise: amplitude, Hurst, lacunarity, first wavelength (source cells); slope exponent, slope floor, shore fade (m); octaves.
  

vec4 bw(float t) { float t2 = t * t, t3 = t2 * t, u = 1.0 - t; return vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0; }
vec4 bd(float t) { float t2 = t * t, u = 1.0 - t; return vec4(-0.5 * u * u, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2); }

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
}

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

const float ROT[12] = float[12](0.300, 1.100, 2.200, 0.700, 2.900, 1.700, 0.100, 2.500, 1.400, 2.000, 0.500, 2.700);

float terrain3dBaseHeight(vec2 world) {
  float h=level(0,world).x;return uFloor>0.?max(h,uFloor):h;
}
vec3 terrain3dGradientNoise(vec2 p, uint seed) {
  vec2 cell = floor(p), f = p - cell; vec2 g[4];
  for (int k=0;k<4;k++) {
    uvec2 q=uvec2(ivec2(cell))+uvec2(k&1,k>>1);
    uint h=q.x*374761393u^q.y*668265263u^seed;
    h=(h^(h>>13u))*1274126177u;h^=h>>16u;
    float angle=float(h)/4294967296.0*6.283185307179586;g[k]=vec2(cos(angle),sin(angle));
  }
  float a=dot(g[0],f),b=dot(g[1],f-vec2(1.,0.)),c=dot(g[2],f-vec2(0.,1.)),d=dot(g[3],f-vec2(1.));
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  float value=a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y;
  vec2 gradient=g[0]+(g[1]-g[0])*u.x+(g[2]-g[0])*u.y+(g[0]-g[1]-g[2]+g[3])*u.x*u.y
    +du*vec2((b-a)+(a-b-c+d)*u.y,(c-a)+(a-b-c+d)*u.x);
  return vec3(value,gradient)*1.4;
}
vec3 terrain3dSurface(vec2 world,float sourceCell,uint seed,vec4 a,vec3 b,int octaveCount) {
  float cell=max(.25,sourceCell),h=terrain3dBaseHeight(world);if(h<=0.)return vec3(h,0.,0.);
  float probe=max(.125,cell*.25),radius=cell*4.;
  vec2 g=vec2(terrain3dBaseHeight(world+vec2(probe,0.))-terrain3dBaseHeight(world-vec2(probe,0.)),terrain3dBaseHeight(world+vec2(0.,probe))-terrain3dBaseHeight(world-vec2(0.,probe)))/(2.*probe);
  float slope=length(g),n=terrain3dBaseHeight(world-vec2(0.,radius)),s=terrain3dBaseHeight(world+vec2(0.,radius)),e=terrain3dBaseHeight(world+vec2(radius,0.)),w=terrain3dBaseHeight(world-vec2(radius,0.));
  float relief=max(max(abs(h-n),abs(h-s)),max(abs(h-e),abs(h-w)))/radius;
  float crest=smoothstep(.002,.025,(h-(n+s+e+w)*.25)/radius)*smoothstep(.04,.2,max(slope,relief));
  float mountain=smoothstep(.04,.2,slope);if(a.x==0.||(crest==0.&&mountain==0.))return vec3(h,g);
  vec2 downhill=g/max(slope,1e-6),accumulated=vec2(0.),residualGradient=vec2(0.);float wavelength=cell*8.*a.w,residual=0.;
  for(int k=0;k<12;k++) {
    if(k>=min(12,max(1,octaveCount+4))||wavelength<.125)break;
    float angle=.37+float(k)*2.399963229728653,c=cos(angle),sn=sin(angle),ratio=wavelength/cell;
    vec3 v=terrain3dGradientNoise(vec2(world.x*c-world.y*sn,world.x*sn+world.y*c)/wavelength,seed+uint(k*7919));
    float rounded=sqrt(v.x*v.x+.0025),signal=v.x*.45+(.24-rounded)*.55;
    vec2 d=vec2(v.y*c+v.z*sn,-v.y*sn+v.z*c)*(.45-.55*v.x/rounded);
    float broad=smoothstep(1.4,3.5,ratio),fine=1.-smoothstep(.045,.12,ratio);
    float envelope=broad*crest+fine*mountain*3.+(1.-max(broad,fine))*mountain*.015;
    float slopeWeight=pow(max((broad>.5?max(slope,relief):slope)+b.y,1e-6),b.x);
    accumulated+=d*(broad+fine*.15);
    float weight=1./(1.+.65*dot(accumulated,accumulated))/(1.+1.5*abs(dot(d,downhill)));
    float hurst=pow(max(ratio,1.),clamp(a.y,.7,1.3)-1.)*pow(min(ratio,1.),max(0.,a.y-1.));
    float amplitude=wavelength*a.x*hurst*envelope*slopeWeight*weight;
    residual+=signal*amplitude;residualGradient+=d*(amplitude/wavelength);
    wavelength/=clamp(a.z+.5,1.5,2.5);
  }
  float shore=b.z>0.?clamp(h/b.z,0.,1.):1.;
  return vec3(h+residual*shore,g+residualGradient*shore);
}
vec3 terrain3dDetail(vec2 world,vec3 base) {
  return terrain3dSurface(world,uSourceCell,uSeed,uDetailA,uDetailB,uOctaves)-base;
}


vec3 detail(vec2 world, vec3 s) {
  float slope = length(s.yz);
  float scale = uDetailA.x * pow(max(slope + uDetailB.y, 1e-6), uDetailB.x) * uSourceCell;
  vec3 sum = vec3(0.0);
  float wavelength = uSourceCell * uDetailA.w;
  for (int k = 0; k < 12; k++) {
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


#define RENDER3D_FOREST

 
 
  
   
float forestWaterCoverage(vec2 world);
// Written by the last earthMaterial call (display RGB): Render's colour, the
// same surface without and with full canopy, and its macro woods coverage.
vec3 renderGuideColor=vec3(0.),renderGuideOpen=vec3(0.),renderGuideClosed=vec3(0.);float renderGuideWoods=0.;

float forestWaterCoverage(vec2 world) {
  if(uUseWaterLayer==0)return 0.;
  vec2 uv=(world-uOrigin)/(uPx*uCanvas);
  return textureLod(uWaterLayer,vec2(uv.x,1.-uv.y),0.).a;
}


 // sea-level temperature Celsius, annual rain mm
float sstep(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec3 surfaceMix(vec3 a,vec3 b,float t){return a*(1.-t)+b*t;}
    uint surfaceHash(ivec3 c,uint salt){
      uvec3 v=uvec3(c);
      uint h=(v.x*0x9e3779b9u)^(v.y*0x85ebca6bu)^(v.z*0xc2b2ae35u)^salt;
      h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
    }
    float surfaceCorner(ivec3 c,vec3 f,ivec3 o,uint salt){
      uint h=surfaceHash(c+o,salt);vec3 d=f-vec3(o);
      vec3 g=vec3(float(h&1023u),float((h>>10u)&1023u),float((h>>20u)&1023u))/511.5-1.;
      return g.x*d.x+g.y*d.y+g.z*d.z;
    }
    // 3D gradient noise, quintic fade, unit standard deviation.
    float surfaceNoise(vec3 p,uint salt){
      vec3 fl=floor(p);ivec3 c=ivec3(fl);vec3 f=p-fl;vec3 u=f*f*f*(f*(f*6.-15.)+10.);
      float a0=surfaceCorner(c,f,ivec3(0,0,0),salt);float a1=surfaceCorner(c,f,ivec3(1,0,0),salt);
      float a2=surfaceCorner(c,f,ivec3(0,1,0),salt);float a3=surfaceCorner(c,f,ivec3(1,1,0),salt);
      float b0=surfaceCorner(c,f,ivec3(0,0,1),salt);float b1=surfaceCorner(c,f,ivec3(1,0,1),salt);
      float b2=surfaceCorner(c,f,ivec3(0,1,1),salt);float b3=surfaceCorner(c,f,ivec3(1,1,1),salt);
      float x0=a0+(a1-a0)*u.x;float x1=a2+(a3-a2)*u.x;float x2=b0+(b1-b0)*u.x;float x3=b2+(b3-b2)*u.x;
      float y0=x0+(x1-x0)*u.y;float y1=x2+(x3-x2)*u.y;
      return (y0+(y1-y0)*u.z)*5.25;
    }
    // (unit-variance pattern of the resolved octaves, retained variance fraction).
    // Octaves under 8 samples per wavelength fade out, then are skipped: closer
    // to Nyquist they read as grain rather than detail.
    vec2 surfaceFbm(vec3 p,float scale,int octaves,float footprint,uint salt){
      float value=0.;float kept=0.;float total=0.;float s=scale;float a=1.;
      for(int i=0;i<octaves;i++){
        total+=a*a;
        if(footprint<s*.25){float fade=1.-sstep(s*.125,s*.25,footprint);value+=a*fade*surfaceNoise(p/s,salt+uint(i)*0x9e37u);kept+=a*fade*a*fade;}
        a*=.5;s*=.5;
      }
      if(kept>0.){value/=sqrt(kept);}
      return vec2(value,kept/total);
    }
    float surfaceCover(float fraction,vec2 pattern,float sharp){
      float c=clamp(fraction,0.,1.);
      float v=pattern.x/sqrt(1.+pattern.x*pattern.x)*sqrt(pattern.y);
      return c+clamp(sharp,0.,1.)*c*(1.-c)*v;
    }
    float surfaceSeason(){return 1.0;}
    float surfaceSeaIce(vec3 point,float ts0,float tw0,float footprint){
      vec2 regional=surfaceFbm(point,64000.,4,footprint,uMaterialSeed+1u);float m1=regional.x*sqrt(regional.y);
      float ts=clamp(ts0,-45.,45.);float tw=clamp(tw0,-45.,45.);float now=tw+(ts-tw)*surfaceSeason();
      return clamp(sstep(-1.5,-6.,now+.4*m1)*1.,0.,1.)*.9;
    }
    vec3 materialWater(float position){vec3 color=vec3(26.0,77.0,92.0)/255.;color=mix(color,vec3(11.0,41.0,69.0)/255.,smoothstep(0.00000000,0.40000000,position));color=mix(color,vec3(5.0,17.0,38.0)/255.,smoothstep(0.40000000,1.00000000,position));return color;}
vec3 surfaceWater(float depth,float ice){return mix(materialWater(depth/120.),vec3(.80,.84,.88),ice);}

    vec3 surfaceOcean(float height,vec3 color,float now,float m1,float variation){
      if(height>=0.){return clamp(color,vec3(0.),vec3(1.));}
      float ice=clamp(sstep(-1.5,-6.,now+.4*m1)*1.,0.,1.)*.9;
      return clamp(surfaceWater(max(-height,0.),ice)*(1.+.04*variation*m1),vec3(0.),vec3(1.));
    }
    // Climate: sea-level seasonal temperatures/lapse and seasonal precipitation.
    // bare=true returns the substrate shown by the Soil layer.
    vec3 surfaceMaterial(float height,vec2 gradient,float tpi,vec3 point,vec2 north,float footprint,vec3 soil,vec3 pedology,vec3 substrateRock,float sandFraction,float ts0,float ps,float ls,float tw0,float pw,float lw,bool bare,float shore,float openness){
      float season=.5;float variation=1.;float forestAmount=1.;float rockTan=tan(radians(40.));
      float snowAmount=1.;float moisture=0.;
      uint salt=uMaterialSeed;float fp=footprint;float phase=surfaceSeason();float h=max(height,0.);
      float materialDetail=sstep(30.,60.,fp)*(1.-sstep(120.,240.,fp));
      vec2 regional=surfaceFbm(point,64000.,4,fp,salt+1u);vec2 regional2=surfaceFbm(point+vec3(5101.,-2297.,3313.),48000.,4,fp,salt+2u);
      vec2 grove=surfaceFbm(point,4800.,4,fp,salt+3u);vec2 crag=surfaceFbm(point,700.,4,fp,salt+4u);
      vec2 fine=surfaceFbm(point,240.,4,fp,salt+5u);vec2 province=surfaceFbm(point,900000.,3,fp,salt+6u);
      float m1=regional.x*sqrt(regional.y);float m2=regional2.x*sqrt(regional2.y);float pv=province.x*sqrt(province.y);
      float ts=clamp(ts0-ls*h,-45.,45.);float tw=clamp(tw0-lw*h,-45.,45.);
      float locality=1.-sstep(600.,6000.,fp);
      float terrain=sstep(.015,.12,abs(tpi));
      float jitter=.8*m2*variation*locality*(.25+.75*terrain);float tHot=max(ts,tw)+jitter;float tCold=min(ts,tw)+jitter;
      float now=tw+(ts-tw)*phase;
      // Koppen-like aridity threshold; valleys gather water, ridges drain.
      float pth=max(20.*(ts+tw)*.5+280.,120.);
      float wetShift=exp(.6*moisture+.10*variation*m1*locality);
      float valley=sstep(0.,-.12,tpi);float ridge=sstep(0.,.12,tpi);
      float humid=max(ps+pw,0.)/pth*wetShift;
      humid=humid*(1.+.7*valley*(1.-sstep(1.5,3.,humid))-.18*ridge);
      float humidNow=max(pw+(ps-pw)*phase,0.)*2./pth*wetShift*(1.+.7*valley-.18*ridge);
      // Coarser samples see gentler slopes than the 30 m terrain they average.
      float grade=length(gradient)*pow(max(fp,30.)/30.,.3);
      float arid=1.-sstep(.35,1.,humid);
      float wTrop=sstep(13.,19.,tCold);float wBoreal=1.-sstep(-14.,-3.,tCold);
      // Substrate: transported regional soil, zonal soils, geological provinces.
      vec3 ground=(bare?soil:pedology);
      vec3 sand=surfaceMix(vec3(.80,.66,.46),vec3(.70,.50,.33),sstep(-.3,.5,pv));
      vec3 desert=surfaceMix(vec3(.55,.46,.36),sand,sstep(-.4,.4,m2+1.5*sandFraction-.5-.8*grade/rockTan));
      ground=surfaceMix(ground,desert,arid*(bare?.8:0.));
      ground=surfaceMix(ground,vec3(.50,.29,.17),wTrop*sstep(1.,2.,humid)*(bare?.6:0.));
      float steppe=(1.-arid)*(1.-wTrop)*(1.-wBoreal)*sstep(.8,1.2,humid)*(1.-sstep(1.6,2.4,humid));
      ground=surfaceMix(ground,vec3(.25,.21,.16),steppe*(bare?.5:0.));
      ground=ground*(1.-.12*valley+.08*ridge);
      ground=ground*(1.+variation*(.035*m1*locality+.025*grove.x*sqrt(grove.y)+.02*fine.x*sqrt(fine.y)));
      vec3 rock=surfaceMix(vec3(.50,.48,.45),vec3(.30,.29,.28),sstep(.15,.6,pv));
      rock=surfaceMix(rock,vec3(.66,.62,.55),sstep(-.15,-.6,pv));
      // Arid outcrops: dark desert varnish, or red sandstone in some provinces.
      rock=surfaceMix(rock,surfaceMix(vec3(.36,.30,.25),vec3(.60,.38,.25),sstep(.1,.6,m2)),arid*.85);
      rock=surfaceMix(rock,substrateRock,.35);
      if(!bare){
        // Warm stone at every LOD; regional minerals only affect brightness.
        float neutral=dot(rock,vec3(.2126,.7152,.0722));
        rock=neutral*vec3(1.04,1.,.94);
      }
      rock=rock*vec3(1.);
      // Horizontal strata, resolved only on fine tiles; strongest in arid ranges.
      float strata=sin(6.283185307*(h+120.*grove.x)/90.)*(1.-sstep(25.,45.,fp));
      rock=rock*(1.+variation*.10*strata*(.15+.85*arid)+variation*.07*crag.x*sqrt(crag.y));
      float rockTanEff=rockTan*(.55+.45*sstep(.3,1.3,humid));
      float alpine=1.-sstep(2.,9.,tHot);
      float exposure=sstep(rockTanEff*.5,rockTanEff*1.3,grade)+.45*alpine*sstep(rockTanEff*.15,rockTanEff*.7,grade)
        +.35*ridge*sstep(.35,.9,grade/rockTan)-.3*valley;
      float outcrop=surfaceCover(clamp(exposure,0.,1.),vec2(.75*crag.x+.25*grove.x*sqrt(grove.y),crag.y),.35);
      vec3 color=surfaceMix(ground,rock,outcrop);
      if(bare){return surfaceOcean(height,color,now,m1,variation);}
      // Vegetation: grasses/shrubs over soil, canopy patches over grasses.
      vec3 tint=vec3(1.);
      float green=sstep(.5,1.4,humidNow)*sstep(3.,12.,now);
      vec3 grass=surfaceMix(vec3(.60,.53,.34),vec3(.29,.37,.16),green);
      grass=surfaceMix(grass,vec3(.40,.38,.27),1.-sstep(7.,14.,tHot))*tint;
      float herbs=sstep(.2,.85,humid)*sstep(0.,7.,tHot)*(1.-sstep(rockTan*.8,rockTan*1.4,grade));
      // Grasses and shrubs thin out diffusely; only canopy forms crisp stands.
      vec2 sward=(fine.y>0.?fine:grove);
      color=surfaceMix(color,grass,surfaceCover(herbs*(1.-outcrop),sward,.12*variation));
      float dryForest=1.-sstep(1.3,3.,humid);
      vec3 canopy=surfaceMix(vec3(.20,.28,.14),vec3(.16,.255,.13),wTrop);
      canopy=surfaceMix(canopy,vec3(.15,.22,.16),wBoreal);
      canopy=surfaceMix(canopy,vec3(.27,.29,.17),dryForest*.75);
      float deciduous=(1.-wTrop)*(1.-.7*wBoreal)*(1.-.5*dryForest);
      float local=fract(season+(ts>=tw?0.:.5));
      float autumn=sstep(.66,.76,local)*(1.-sstep(.84,.92,local));
      canopy=surfaceMix(canopy,vec3(.42,.27,.11),autumn*deciduous*.6);
      float leafless=sstep(8.,2.,now)*deciduous;
      canopy=surfaceMix(canopy,vec3(.36,.33,.28),leafless*.75);
      float highland=(1.-sstep(10.,17.,tHot))*materialDetail;
      // Reuse already filtered noise; no extra FBM evaluations or reads.
      float canopyDetail=clamp(.12*highland*crag.x*sqrt(crag.y)+.025*fine.x*sqrt(fine.y),-.18,.18);
      canopy=canopy*tint*(1.-.18*highland)*(1.+variation*canopyDetail);
      float trees=sstep(.65,2.1,humid)*sstep(5.5,13.5,tHot+.8*valley)*forestAmount*(1.-sstep(rockTan*.9,rockTan*1.6,grade))*(1.-outcrop);
      // Valley stands come from relief; noise only adds gentle clearings.
      trees=trees*(1.-.22*ridge)+.14*valley*sstep(2.,10.,tHot)*sstep(.4,1.2,humid)*(1.-outcrop)*forestAmount;
      float woods=surfaceCover(clamp(trees,0.,1.),grove,.65*variation);
#ifdef RENDER3D_FOREST
      // Render3D keeps this macro canopy as its unresolved reference and
      // exports a guide: the same surface without canopy (every later step)
      // and fully canopied (snow and valley only: crowns stand above sediment).
      vec3 guideOpen=color;
#endif
      color=surfaceMix(color,canopy,woods);
      float flats=(1.-sstep(1.5,6.,height))*(1.-sstep(.05,.2,grade));
      // Beaches: an intermittent strip along open water (none beside ponds), up to
      // ~190 m wide with a ragged inner edge, as area coverage (visible at 240 m
      // samples); low flats behind it stay as wetter river/estuary bars.
      vec2 reach=surfaceFbm(point,20000.,3,fp,salt+7u);
      float width=140.*sstep(-.15,.75,.65*reach.x*sqrt(reach.y)+.5*grove.x*sqrt(grove.y))*sstep(.15,.4,openness)*(1.+.35*fine.x*sqrt(fine.y));
      float beach=clamp((min(width,20.*fp)-shore+fp)/fp,0.,1.)*(1.-sstep(4.,12.,height))*(1.-sstep(.2,.5,grade));
      // Sediment follows the coast's geology: quartz or golden sand by province,
      // tropical coral sand, and local stone on cool or rugged coasts. Summer
      // warmth preserves sandy continental coasts despite their winter frost.
      // Reuse slope/TPI and resolved noise, with no additional samples or FBM.
      float shingle=max(1.-sstep(4.,14.,tHot),sstep(.04,.22,grade)*terrain);
      vec3 sediment=surfaceMix(vec3(.80,.75,.61),vec3(.76,.63,.43),sstep(-.2,.9,pv));
      sediment=surfaceMix(sediment,vec3(.86,.84,.76),wTrop*sstep(0.,-.8,pv)*.7);
      sediment=surfaceMix(sediment,rock,shingle*.9);
      sediment=surfaceMix(sediment,surfaceMix(ground,rock,.4),sstep(-.9,-1.5,m2)*.85);
      sediment=surfaceMix(sediment,vec3(.27,.26,.25),sstep(1.25,1.75,m1+.35*shingle)*.9);
      color=surfaceMix(color,sediment*.9,flats*(1.-sstep(240.,960.,fp))*.8);
      color=surfaceMix(color,sediment,beach*.8);
#ifdef RENDER3D_FOREST
      guideOpen=surfaceMix(surfaceMix(guideOpen,sediment*.9,flats*(1.-sstep(240.,960.,fp))*.8),sediment,beach*.8);
#endif
      // Snow: seasonal and perennial, exposure-aware, sheds from steep ridges.
      float hemisphere=point.y/max(sqrt(point.y*point.y+.0064*dot(point,point)),1.);
      float aspect=dot(gradient,north)/max(length(gradient),.00001)*hemisphere;
      float sun=aspect*min(length(gradient),1.);
      float tSnow=now+2.2*sun+.45*m1*variation*locality+.25*ridge-.35*valley;
      // Snow needs supply: cold deserts stay mostly bare, wet ranges glaciate.
      float supply=sstep(60.,400.,max(ps+pw,0.)*wetShift*(1.+.5*valley-.25*ridge));
      float perennial=sstep(2.5,-2.5,max(ts,tw)+1.5*sun+.35*m1*variation*locality)*supply;
      float seasonal=sstep(1.,-4.,tSnow)*sstep(.15,.5,humid)*supply;
      float snow=clamp(max(seasonal,perennial)*snowAmount,0.,1.);
      // Physical slope: LOD compensation must not turn a ridge into a cliff.
      float slip=sstep(1.25+.65*perennial,3.5+perennial,length(gradient));
      snow=snow*(1.-(.88-.18*perennial)*slip)*(1.-.3*woods*(1.-perennial)*(1.-.7*leafless));
      color=surfaceMix(color,vec3(.94,.96,.97),surfaceCover(snow,crag,.35*variation));
      color=color*(1.-.06*valley);
#ifdef RENDER3D_FOREST
      vec3 result=surfaceOcean(height,color,now,m1,variation);
      float guideSnow=surfaceCover(snow,crag,.35*variation);
      renderGuideColor=result;renderGuideWoods=height>=0.?woods:0.;
      renderGuideOpen=height>=0.?clamp(surfaceMix(guideOpen,vec3(.94,.96,.97),guideSnow)*(1.-.06*valley),0.,1.):result;
      renderGuideClosed=height>=0.?clamp(surfaceMix(canopy,vec3(.94,.96,.97),guideSnow)*(1.-.06*valley),0.,1.):result;
      return result;
#else
      return surfaceOcean(height,color,now,m1,variation);
#endif
    }

vec3 earthMaterial(vec3 s,vec2 world,float fp,float tpi,float shore,float openness){
  float t=uMaterialClimate.x;
  float p=uMaterialClimate.y;
  // The bench has a regional annual climate, without Neural Earth's soil atlases.
  float arid=1.-sstep(.35,1.,p/max(20.*t+280.,120.));
  vec3 soil=mix(vec3(.34,.29,.22),vec3(.70,.50,.33),arid);
  return surfaceMaterial(s.x,s.yz,tpi,vec3(world,0.),vec2(0.),fp,soil,soil,vec3(.50,.48,.45),.5,t+6.,p*.5,.0065,t-6.,p*.5,.0065,false,shore,openness);
}


float groundSmooth(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec3 groundToLinear(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}
vec3 groundToDisplay(vec3 c){return pow(clamp(c,vec3(0.),vec3(1.)),vec3(1./2.2));}
uint groundHash(ivec3 cell,uint seed){
  uvec3 p=uvec3(cell);uint h=(p.x*0x9e3779b9u)^(p.y*0x85ebca6bu)^(p.z*0xc2b2ae35u)^seed;
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
}
vec4 groundNoise(vec3 point,uint seed){
  ivec3 cell=ivec3(floor(point));vec3 f=fract(point),u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  vec4 n=vec4(0.);
  for(int k=0;k<8;k++){
    ivec3 corner=ivec3(k&1,(k>>1)&1,k>>2);uint h=groundHash(cell+corner,seed);
    vec3 g=vec3(float(h&1023u),float((h>>10u)&1023u),float((h>>20u)&1023u))/511.5-1.;
    vec3 w=mix(1.-u,u,vec3(corner)),d=mix(-du,du,vec3(corner));float v=dot(g,f-vec3(corner));
    n+=vec4(v*w.x*w.y*w.z,g*w.x*w.y*w.z+v*vec3(d.x*w.y*w.z,w.x*d.y*w.z,w.x*w.y*d.z));
  }return n*1.7;
}
vec4 groundGravel(vec2 point,uint seed){
  ivec2 cell=ivec2(floor(point));vec2 f=fract(point);float sum=0.;vec2 gradient=vec2(0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ivec2 neighbour=cell+ivec2(i,j);uint h=groundHash(ivec3(neighbour.x,0,neighbour.y),seed);
    if((h&7u)>4u)continue;
    vec2 offset=vec2(i,j)+.5+(vec2(float(h&255u),float((h>>8u)&255u))/255.-.5);
    vec2 d=f-offset;int angle=int((h>>24u)&3u);
    float c=angle==0?1.:angle==2?0.:angle==1?.7071067811865476:-.7071067811865476;
    float s=angle==0?0.:angle==2?1.:.7071067811865476;
    vec2 uv=vec2(c*d.x+s*d.y,-s*d.x+c*d.y);
    vec2 radius=.10+.30*vec2(float((h>>16u)&15u),float((h>>20u)&15u))/15.;
    vec2 inverse=1./(radius*radius);float q=dot(uv*uv,inverse);if(q>=1.)continue;
    float t=1.-q,weight=.6+1.8*float(h>>28u)/15.;sum+=weight*t*t;
    gradient+=-4.*weight*t*vec2(c*uv.x*inverse.x-s*uv.y*inverse.y,s*uv.x*inverse.x+c*uv.y*inverse.y);
  }
  float attenuation=exp(-sum);return vec4(1.-attenuation,gradient.x*attenuation,0.,gradient.y*attenuation);
}
const float groundWavelength[4]=float[4](8.,2.2,0.32,0.055);
const float groundAmplitude[4]=float[4](0.17,0.04,0.012,0.002);
const float groundAspect[4]=float[4](0.35,0.24,0.85,0.72);
const float groundFilterWidth[4]=float[4](1.,0.5,0.5,1.);
const float groundRotationC[4]=float[4](0.8,-0.6,0.28,-0.96);
const float groundRotationS[4]=float[4](0.6,0.8,0.96,0.28);
const float groundVarianceFactor[4]=float[4](0.2,1.8,1.3,0.4);
float groundVisibility(float wavelength,float footprint){
  float t=clamp((footprint/wavelength-.18)/.24,0.,1.);return 1.-t*t*t*(t*(t*6.-15.)+10.);
}
float groundSlopeVariance(float footprint){
  float variance=0.;for(int k=0;k<4;k++){
    float a=groundAmplitude[k]/groundWavelength[k];
    float keep=groundVisibility(groundWavelength[k]*groundAspect[k]*groundFilterWidth[k],max(footprint,0.));
    variance+=a*a*(1.+1./(groundAspect[k]*groundAspect[k]))*groundVarianceFactor[k]*(1.-keep*keep);
  }return variance;
}
vec4 groundFieldWithClasts(vec3 point,uint seed,float footprint,out float clasts){
  vec4 sum=vec4(0.);clasts=0.;int turn=int((seed>>29u)&3u);
  for(int k=0;k<4;k++){
    float wavelength=groundWavelength[k];
    float keep=groundVisibility(wavelength*groundAspect[k]*groundFilterWidth[k],max(footprint,0.));if(keep<=0.)continue;
    float c=groundRotationC[k],s=groundRotationS[k],aspect=groundAspect[k];
    if(turn==1){float old=c;c=-s;s=old;}else if(turn==2){c=-c;s=-s;}else if(turn==3){float old=c;c=s;s=-old;}
    vec3 r=vec3(c*point.x+s*point.z,point.y,-s*point.x+c*point.z);
    if(k==2){
      vec4 cap=groundGravel(r.xz/vec2(wavelength,wavelength*aspect),seed+uint(k+1)*0x6c8e9cf5u);
      vec2 g=cap.yw/vec2(wavelength,wavelength*aspect);float a=groundAmplitude[k]*keep;
      sum+=vec4((cap.x-.1)*a,(c*g.x-s*g.y)*a,0.,(s*g.x+c*g.y)*a);clasts=cap.x*keep;continue;
    }
    vec3 q=vec3(dot(r,vec3(.36,-.8,.48)),dot(r,vec3(.48,.6,.64))/aspect,dot(r,vec3(-.8,0.,.6)))/wavelength;
    q+=vec3(17.137,3.731,-11.517)+float(k)*vec3(9.173,-5.731,7.337);
    vec4 n=groundNoise(q,seed+uint(k+1)*0x6c8e9cf5u);
    float inverse=inversesqrt(1.+n.x*n.x),v=.72*n.x*inverse,value=v,derivative=1.;
    if(k==0){float rounded=sqrt(v*v+.02);value=.3-rounded;derivative=-v/rounded;}
    else if(k==1){float groove=exp2(-32.*v*v);value=.4-groove;derivative=44.36141956*v*groove;}
    float a=groundAmplitude[k]*keep,d=a*derivative*.72*inverse*inverse*inverse/wavelength;
    vec3 g=vec3(.36*n.y+.48*n.z/aspect-.8*n.w,-.8*n.y+.6*n.z/aspect,.48*n.y+.64*n.z/aspect+.6*n.w);
    sum+=vec4(value*a,vec3(c*g.x-s*g.z,g.y,s*g.x+c*g.z)*d);
  }return sum;
}
vec4 groundField(vec3 point,uint seed,float footprint){float clasts;return groundFieldWithClasts(point,seed,footprint,clasts);}
// rock / soil / grass / snow; continuous and sums to one.
vec4 groundCover(vec3 macro,vec2 climate){
  float grade=length(macro.yz),temperature=climate.x-.0065*max(macro.x,0.),wet=groundSmooth(250.,1400.,climate.y);
  float snow=(1.-groundSmooth(-5.,1.,temperature))*(1.-groundSmooth(.55,1.3,grade));
  float exposed=1.-snow,rock=groundSmooth(.25,.9,grade)*exposed;
  float growth=groundSmooth(-8.,4.,temperature)*(1.-groundSmooth(28.,42.,temperature));
  float grass=wet*growth*(exposed-rock),soil=exposed-rock-grass;
  return vec4(rock,soil,grass,snow);
}
float groundGain(vec3 macro,vec4 cover){
  return groundSmooth(.025,.18,length(macro.yz))*groundSmooth(0.,2.,macro.x)*dot(cover,vec4(1.,.16,.045,.018));
}
// Fixed XZ reference plane prevents the displaced height feeding its own phase.
// Gradients are delta only; cover-envelope derivatives are macro approximations.
vec3 groundDisplacement(vec3 macro,vec2 world,float footprint,vec2 climate,uint seed){
  vec4 cover=groundCover(macro,climate),detail=groundField(vec3(world.x,0.,world.y),seed,footprint);
  return vec3(detail.x,detail.y,detail.w)*groundGain(macro,cover);
}
struct GroundMaterial {vec3 albedo;vec3 normal;float roughness;float occlusion;};
GroundMaterial terrainGroundMaterial(vec3 macro,vec2 world,float footprint,vec3 macroColor,vec2 climate,uint seed,float meshFootprint){
  float fp=max(0.,footprint);vec4 cover=groundCover(macro,climate);float gain=groundGain(macro,cover);
  float clasts;vec4 detail=groundFieldWithClasts(vec3(world.x,0.,world.y),seed,fp,clasts);vec2 gradient=detail.yw*gain;
  // Subtract the slope already represented by the displaced mesh. Zero means
  // an undisplaced macro surface; tiny positive means all bands represented.
  if(meshFootprint>0.)gradient-=groundField(vec3(world.x,0.,world.y),seed,meshFootprint).yw*gain;
  GroundMaterial m;m.normal=normalize(vec3(-macro.y-gradient.x,1.,-macro.z-gradient.y));
  float form=clamp(detail.x*18.,-1.,1.),cavity=clamp(-detail.x*20.,0.,1.)*cover.x;
  vec3 rock=mix(macroColor,vec3(.43,.42,.39),.7),soil=mix(macroColor,vec3(.40,.32,.22),.18);
  vec3 grass=macroColor*vec3(.96,1.02,.93),snow=mix(macroColor,vec3(.87,.91,.95),.35);
  vec3 color=rock*cover.x+soil*cover.y+grass*cover.z+snow*cover.w;
  color*=1.+form*dot(cover,vec4(.12,.055,.045,.012));
  // The visible cap that displaced this stone also lightens its mineral crest
  // and slightly polishes it. No independent high-frequency color noise.
  float cap=groundSmooth(.05,.7,clasts);color*=1.+cap*.12*cover.x;
  float grade=length(macro.yz),strataKeep=groundVisibility(.65/max(1.,grade),fp);
  float strata=sin((macro.x+.13*world.x-.09*world.y)*9.66643893+detail.x*3.);
  color*=1.+cover.x*.022*strata*strataKeep;color*=1.-cavity*.11;
  float wet=groundSmooth(500.,1800.,climate.y)*(1.-cover.w),roughness=dot(cover,vec4(.52,.83,.91,.76));
  roughness-=wet*(.08*cover.y+.10*cavity);roughness+=(form*.025-cap*.055)*cover.x;
  float alpha2=pow(clamp(roughness,.38,.98),4.)+gain*gain*groundSlopeVariance(fp);
  m.albedo=groundToLinear(clamp(color,vec3(.015),vec3(.96)));m.roughness=clamp(pow(alpha2,.25),.38,.98);
  // Local cavity approximation, not traced visibility or a shadow map.
  m.occlusion=clamp(1.-.22*cavity-.04*max(-form,0.)*cover.y,.72,1.);return m;
}
GroundMaterial terrainGroundMaterial(vec3 macro,vec2 world,float footprint,vec3 macroColor,vec2 climate,uint seed){
  return terrainGroundMaterial(macro,world,footprint,macroColor,climate,seed,0.);
}
vec3 groundBrdf(GroundMaterial m,vec3 view,vec3 light){
  vec3 n=m.normal,v=normalize(view),l=normalize(light),halfVector=normalize(v+l);
  float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,halfVector),0.),vh=max(dot(v,halfVector),0.);
  float a=m.roughness*m.roughness,a2=a*a,denominator=nh*nh*(a2-1.)+1.;
  float distribution=a2/(3.14159265*denominator*denominator);
  float visibility=.5/max(nl*sqrt(nv*nv*(1.-a2)+a2)+nv*sqrt(nl*nl*(1.-a2)+a2),.001);
  float fresnel=.04+.96*pow(1.-vh,5.);
  return ((1.-fresnel)*m.albedo/3.14159265+vec3(distribution*visibility*fresnel))*nl;
}
vec3 shadeTerrainGround(GroundMaterial m,vec3 view,vec3 light,vec3 light2,float strength){
  float amount=clamp(strength,0.,1.);vec3 ambient=m.albedo*(.34+.16*clamp(m.normal.y,0.,1.))*m.occlusion;
  vec3 direct=groundBrdf(m,view,light)*2.2+groundBrdf(m,view,light2)*.58;
  return groundToDisplay(mix(m.albedo,ambient,amount)+direct*max(strength,0.));
}


float forestResolvedCover=0.;
const float forestTauTable[33]=float[33](0.,0.0211,0.0446,0.066,0.0881,0.1113,0.1338,0.1573,0.182,0.2051,0.2303,0.2538,0.2796,0.3045,0.3293,0.3546,0.3816,0.4091,0.435,0.4636,0.4895,0.5188,0.5472,0.5668,0.586,0.6063,0.6289,0.6524,0.6805,0.7112,0.751,0.8099,1.);
const float forestPatchCdf[17]=float[17](0.,0.,0.0001,0.001,0.0085,0.0401,0.1202,0.2729,0.5009,0.7274,0.8801,0.9598,0.9914,0.999,0.9999,1.,1.);
const float forestCrownCdf[17]=float[17](0.,0.,0.,0.0005,0.0063,0.0336,0.1125,0.2742,0.4998,0.7261,0.8874,0.9665,0.9936,0.9994,1.,1.,1.);
// Patch-noise lattice; crown lattices are 2·√2^L metres (L = 0..6), all ≤ λ/3.
const float FOREST_PATCH=56.;
float forestLookup17(float x,int table){
  float u=clamp(x,0.,1.)*16.;int k=min(int(u),15);
  float a=table==0?forestPatchCdf[k]:forestCrownCdf[k],b=table==0?forestPatchCdf[k+1]:forestCrownCdf[k+1];
  return mix(a,b,u-float(k));
}
float forestTau(float d){float u=clamp(d,0.,.985)*32.;int k=min(int(u),31);return mix(forestTauTable[k],forestTauTable[k+1],u-float(k));}
float forestRho(float tau){return .5+.4*max(0.,(tau-.55)/.45);}
float forestU8(uint h,uint shift){return (float((h>>shift)&255u)+.5)/256.;}
vec2 forestGradient(ivec2 c){uint h=groundHash(ivec3(c,991),uMaterialSeed^0x6a09e667u);return vec2(float(h&255u),float((h>>8u)&255u))*(1./128.)+(.5/128.-1.);}
// 2D gradient noise from four corner gradients: (value, d/dx, d/dy) in lattice units.
vec3 forestPerlin(vec2 f,vec2 g00,vec2 g10,vec2 g01,vec2 g11){
  float n00=dot(g00,f),n10=dot(g10,f-vec2(1.,0.)),n01=dot(g01,f-vec2(0.,1.)),n11=dot(g11,f-1.),k=n00-n10-n01+n11;
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  vec2 g=g00+u.x*(g10-g00)+u.y*(g01-g00)+u.x*u.y*(g00-g10-g01+g11)+du*vec2(n10-n00+u.y*k,n01-n00+u.x*k);
  return vec3(n00+u.x*(n10-n00)+u.y*(n01-n00)+u.x*u.y*k,g);
}
// Uniform lattice threshold at p and its gradient magnitude (1/m).
vec2 forestPatchThreshold(vec2 p){
  vec2 g=p/FOREST_PATCH;ivec2 c=ivec2(floor(g));
  vec3 n=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1)));
  float u=clamp(n.x*.6+.5,0.,1.),x=u*16.;int k=min(int(x),15);
  return vec2(forestLookup17(u,0),(forestPatchCdf[k+1]-forestPatchCdf[k])*16.*.6*length(n.yz)/FOREST_PATCH);
}
// Explicit LOD: no implicit derivatives after non-uniform returns.
vec4 forestField(vec2 world,float lod){return textureLod(uForestField,(world-uForestRect.xy)/uForestRect.z,lod);}

float forestBankDensity(float w){float c=.55+.35*groundSmooth(8.,36.,w);return 1.-pow(1.-c,max(uForestBankDensity,0.));}
// Crown cover target at a point with (margin, reach): the outer band thins.
float forestBankGallery(vec2 b){return b.x>0.?forestBankDensity(b.y)*(1.-0.6*groundSmooth(.35,1.,1.-b.x/max(b.y,1.))):0.;}
// (envelope margin m, positive inside; reach W m) at lod 0. The bilinear
// offset to the reference point (centreline of a narrow channel, else the
// nearest bank point) is exact on straight reaches, so both banks of a channel
// narrower than one texel keep their own edge.
vec2 forestBankAt(vec2 world){
  if(uHasForestBank==0)return vec2(-1e3,0.);
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(-1e3,0.);
  float range=48.+3.*uForestRect.z/float(textureSize(uForestBank,0).x);
  vec4 t=textureLod(uForestBank,uv,0.);float w=t.b*255./2.;
  if(w<=0.)return vec2(-1e3,0.);
  return vec2(w-length((t.rg*255.-128.)*(range/127.)),w);
}
// Expected gallery canopy fraction over a footprint fp (m): the antialiased
// envelope while resolved, its mipmapped texel area beyond.
float forestBankCover(vec2 world,float fp){
  if(uHasForestBank==0)return 0.;
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
  float cell=uForestRect.z/float(textureSize(uForestBank,0).x),range=48.+3.*cell;
  vec4 t=textureLod(uForestBank,uv,0.);float w=t.b*255./2.,margin=w-length((t.rg*255.-128.)*(range/127.));
  float sharp=step(.001,w)*clamp(margin/max(fp,.05)+.5,0.,1.)*forestBankDensity(w)*(1.-0.6*groundSmooth(.35,1.,1.-max(margin,0.)/max(w,1.)));
  float area=textureLod(uForestBank,uv,max(log2(fp/cell),0.)).a;
  return mix(sharp,area,groundSmooth(.5*cell,2.*cell,fp));
}
float forestShrubShare(float h){return 1.-groundSmooth(3.,5.5,h);}

// Filtered per-fragment state for the far material. Resolved crowns sample
// their fixed world centres so every pixel takes the same candidate decision.
struct ForestStand{
  vec2 p;float cover;float height;float needle;float tone;
  float kappa;float trop;float dry;
  float open;float forced;float allow;float hedge;
};
float forestDensity(float c,float kappa){return clamp(c+kappa*(.985-c),c,.985);}
// Field heights vanish where Render's eligibility does: planted trees need ground where trees can grow.
float forestHeightGate(float h){return groundSmooth(2.,6.,h);}
// Applied woods are a weak prior: a 25 % cover floor where trees grow, natural variation above it.
float forestWoods(float c,float h){return max(c,.25*forestHeightGate(h));}
// Render3D level of detail: 0 keeps Render's colour and macro woods (fully
// unresolved, >= 32 m/px), 1 the canonical forest (<= 2 m/px), log-smooth between.
float forestReveal(float fp){return 1.-groundSmooth(1.,5.,log2(max(fp,.001)));}
// Shared corner gradients of the lattice noise around one 3×3 crown neighbourhood.
struct ForestPatch{ivec2 base;vec2 g[9];};
ForestPatch forestPatchAround(ivec2 cell,float s){
  ForestPatch q;q.base=ivec2(floor(vec2(cell-1)*s/FOREST_PATCH));
  for(int j=0;j<3;j++)for(int i=0;i<3;i++)q.g[j*3+i]=forestGradient(q.base+ivec2(i,j));
  return q;
}
float forestPatchValue(ForestPatch q,vec2 p){
  vec2 g=p/FOREST_PATCH-vec2(q.base);ivec2 c=clamp(ivec2(floor(g)),ivec2(0),ivec2(1));int k=c.y*3+c.x;
  return clamp(forestPerlin(g-vec2(c),q.g[k],q.g[k+1],q.g[k+3],q.g[k+4]).x*.6+.5,0.,1.);
}
// One crown: centre, mean radius, outline harmonics, height, crown depth.
struct ForestCrown{vec2 c;float r;float h;float depth;bool needle;bool alive;bool riparian;float edge;uint id;};
ForestCrown forestCrown(ivec2 cell,int level,float s,ForestStand st,ForestPatch lattice){
  ForestCrown k;uint seed=uMaterialSeed^0x2c1b3c6du;k.riparian=false;
  uint h=groundHash(ivec3(cell,level*2),seed),h2=groundHash(ivec3(cell,level*2+1),seed);k.id=h2;
  k.c=(vec2(cell)+.15+.7*vec2(forestU8(h,0u),forestU8(h,8u)))*s;
  // Sample a candidate at its fixed world centre. Fragment-varying lattice
  // probabilities/radii can otherwise switch half-way through a drawing,
  // leaving a sliced crown or only a thin strip of its painted foot.
  vec4 centre=forestField(k.c,0.);float cover=centre.r,height=centre.g*50.,needle=centre.b;
  float open=-1e3,forced=-1e3,allow=0.,hedge=0.,openGallery=.5;bool occupied=false;
  if(uHasOccupation==1){
    vec2 ouv=(k.c-uOccupationRect.xy)/uOccupationRect.z;
    if(all(greaterThanEqual(ouv,vec2(0.)))&&all(lessThanEqual(ouv,vec2(1.)))){
      vec2 dist=(textureLod(uOccupation,ouv,0.).rg*255.-128.)/16.*uOccupationRect.z/uOccupationN;
      open=dist.x;forced=dist.y;
      int cls=int(texelFetch(uOccupation,clamp(ivec2(ouv*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.+.5);
      allow=(cls==4?.45:cls==5?.22:cls==6?.12:cls==3?.05:cls==2?.02:cls==7?.03:0.)*forestHeightGate(height);
      hedge=(cls>=1&&cls<=3?.6:0.)*groundSmooth(3.,8.,height)*(1.-st.dry);
      if(cls==7||cls==8)openGallery=0.;
      occupied=cls==8;
    }
  }
  if(forced>0.)cover=forestWoods(cover,height);
  float kappa=st.kappa*mix(.55,1.,groundSmooth(3.,10.,height))/mix(.55,1.,groundSmooth(3.,10.,st.height))
    *mix(1.,.6,needle)/mix(1.,.6,st.needle);
  // Riparian gallery: a centre inside the narrow bank envelope (already gated
  // by Render's eligibility) takes the gallery density with no stand clumping,
  // so no stand threshold chops the ribbon into islands. Broadleaf-biased.
  float gallery=forestBankGallery(forestBankAt(k.c));
  if(gallery>cover){k.riparian=true;cover=gallery;kappa=0.;needle*=.3;}
  float density=forestDensity(cover,kappa),share=cover/max(density,1e-3);
  float radius=mix((.24*height+1.)*(1.+.45*st.dry),.14*height+.9,needle);
  float centreLevel=clamp(2.*log2(radius/forestRho(forestTau(density))/2.),0.,5.999);
  float weight=max(0.,1.-abs(centreLevel-float(level)));
  float tau=forestTau(1.-pow(1.-density,weight)),q=min(1.,tau/.55),rho=forestRho(tau);
  float threshold=forestLookup17(.8*forestPatchValue(lattice,k.c)+.2*forestU8(h2,0u),1);
  k.alive=false;
  if(open>0.){
    // Trees left in open land: scattered field trees, orchards, hedgerows.
    // Bank strips persist in farmland at half density, not in built land.
    k.alive=forestU8(h2*0x27d4eb2du,24u)<max(allow+(open<5.?hedge:0.),openGallery*gallery);k.edge=1.;
  } else {
    k.alive=forestU8(h,16u)<q&&threshold<share;
    // Harper et al.: stand margins are denser and darker.
    k.edge=1.-groundSmooth(0.,.1,share-threshold);
  }
  // A tree's centre stays on land; its complete crown can overhang the bank.
  if(occupied||(k.alive && forestWaterCoverage(k.c)>=.5))k.alive=false;
  k.riparian=k.riparian&&k.alive;
  // Geometry only for live crowns. No early return: ANGLE/D3D11 miscompiled it here.
  k.needle=false;k.r=0.;k.h=0.;k.depth=0.;
  if(k.alive){
    k.needle=forestU8(h2,8u)<needle;
    k.r=rho*s*(.8+.4*forestU8(h,24u))*(1.+.1*k.edge)*(open>0.?.75:1.);
    float emergent=st.trop*groundSmooth(.9,.97,forestU8(h2,24u));
    k.h=height*(.82+.36*forestU8(h2,16u))*(1.+.35*emergent);
    k.depth=k.r*(k.needle?1.6:.55);
  }
  return k;
}
// Outline radius along the unit direction n: elliptic and trefoil harmonics, smaller for conifers.
float forestOutline(ForestCrown k,vec2 n){
  uint h=k.id*0x9e3779b9u;vec2 a=vec2(forestU8(h,0u),forestU8(h,8u))*6.2831853;float amp=k.needle?.07:.13;
  vec4 shape=vec4(cos(a.x),sin(a.x),.6*cos(a.y),.6*sin(a.y))*amp;
  vec2 c2=vec2(n.x*n.x-n.y*n.y,2.*n.x*n.y),c3=vec2(n.x*(4.*n.x*n.x-3.),n.y*(3.-4.*n.y*n.y));
  return k.r*(1.+dot(c2,shape.xy)+dot(c3,shape.zw));
}
struct ForestHit{float cover;float top;float second;vec2 slope;float rel;vec2 local;float r;bool needle;bool riparian;float edge;uint id;int level;float near;float ink;};
// Overhead canopy and shrub watercolor sprites, stripped of hue at packing time.
// Same crown hash, two levels and 3x3 neighbourhood as the analytic Render3D.
vec2 forestBrush(ForestCrown k,ForestStand st,vec2 d,float aa,float s){
  float extent=min(1.22*k.r,1.12*s);vec2 uv=d/(2.*extent)+.5;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(0.,.5);
  int family=st.trop>.5?2:k.needle?0:1;
  if(st.dry>.35&&uMaterialClimate.x>10.&&forestU8(k.id,16u)<.35)family=3;
  // Low physical canopies are shrubs, chosen from the candidate's own height
  // (fixed centre and hash), never from its screen size: shrubs up to 3 m,
  // trees from 5.5 m. Dry scrub in arid climates, greener bank shrubs.
  uint hs=k.id*0x85ebca6bu;
  if(forestU8(hs,8u)<forestShrubShare(k.h))family=forestU8(hs,16u)<groundSmooth(.2,.7,st.dry)*(k.riparian?.3:1.)?5:4;
  // Mirror only: random rotations would turn trunks upside down.
  if((k.id&1u)==1u)uv.x=1.-uv.x;
  float layer=float(family*8+int((k.id>>4u)&7u));
  float lod=max(0.,log2(128.*aa/(2.*extent)));
  return textureLod(uForestBrushAtlas,vec3(uv,layer),lod).rg;
}
void forestCrowns(inout ForestHit hit,int level,float s,ForestStand st,float aa){
  ivec2 cell=ivec2(floor(st.p/s));ForestPatch lattice=forestPatchAround(cell,s);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ForestCrown k=forestCrown(cell+ivec2(i,j),level,s,st,lattice);if(!k.alive)continue;
    vec2 d=st.p-k.c;float dist=length(d);
    if(dist>=2.*k.r+aa)continue;
    float r=k.r,a=0.,ink=.5;
    if(uForestBrushes==1){vec2 brushTexel=forestBrush(k,st,d,aa,s);a=brushTexel.r;ink=brushTexel.g;hit.near=min(hit.near,dist/r);if(a<.002)continue;}
    else {r=forestOutline(k,d/max(dist,1e-4));hit.near=min(hit.near,dist/r);if(dist>=r+aa)continue;a=clamp((r-dist)/aa+.5,0.,1.);}
    float delta=min(dist/r,1.);
    float z=k.h-k.depth*(k.needle?sqrt(delta*delta+.015):delta*delta);
    // Union of translucent layers: overlapping painted foliage closes the
    // canopy as the Boolean model behind the τ table assumes (max() did not).
    hit.cover=1.-(1.-hit.cover)*(1.-a);
    if(z>hit.top){
      hit.second=hit.top;hit.top=z;
      float g=k.needle?1.6*delta/sqrt(delta*delta+.015):1.1*delta;
      hit.slope=-g*d/max(dist,1e-4);hit.rel=delta;hit.local=d/r;hit.r=r;hit.needle=k.needle;hit.riparian=k.riparian;hit.edge=k.edge;hit.id=k.id;hit.level=level;hit.ink=ink;
    } else hit.second=max(hit.second,z);
  }
}
// Cast shadow of the crowns around the sunward point onto height zp.
float forestShadow(ForestHit hit,int level,float s,ForestStand st,float aa,float zp,vec2 sun,float cot){
  vec2 from=st.p+sun*max(st.height*.75-zp,0.)*cot;
  ivec2 cell=ivec2(floor(from/s));ForestPatch lattice=forestPatchAround(cell,s);float shade=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ForestCrown k=forestCrown(cell+ivec2(i,j),level,s,st,lattice);
    if(!k.alive||(hit.level==level&&k.id==hit.id&&hit.cover>0.))continue;
    float caster=k.h-.5*k.depth,o=(caster-zp)*cot;if(o<=0.)continue;
    // A crown is a translucent volume, not an opaque disc: its ground shadow
    // has a broad penumbra even when the display resolves individual leaves.
    float penumbra=max(aa,.22*k.r+.055*o);
    vec2 d=st.p-(k.c-sun*o);float sd=length(d);if(sd>=1.3*k.r+penumbra)continue;
    shade=max(shade,clamp((.92*forestOutline(k,d/max(sd,1e-4))-sd)/penumbra+.5,0.,1.));
  }
  return shade;
}
// Absolute climate palette of one crown type; only its ratios reach the display.
vec3 forestPalette(ForestStand st,float needle){
  vec3 broad=mix(vec3(.21,.31,.13),vec3(.16,.30,.11),st.trop);
  broad=mix(broad,vec3(.31,.32,.19),st.dry*(1.-.5*st.trop));
  return mix(broad,mix(vec3(.15,.25,.16),vec3(.20,.24,.15),st.dry),needle);
}
vec3 forestCanopy(ForestStand st,float needle,vec2 jitter,float special){
  vec3 c=forestPalette(st,needle);
  // Stand tone: young or disturbed stands lighter and yellower, old ones darker and bluer.
  float t=st.tone-.5;c*=1.+.34*t;
  c=mix(c,c*vec3(1.12,1.07,.78),max(t,0.)*.9);c=mix(c,c*vec3(.9,.97,1.08),max(-t,0.)*.7);
  float amp=mix(.09,.2,st.trop)*(1.-.45*needle);
  c*=1.+amp*jitter.x;
  c=mix(c,c*vec3(1.12,1.06,.72),max(jitter.y,0.)*amp*2.2);c=mix(c,c*vec3(.84,.97,1.12),max(-jitter.y,0.)*amp*1.6);
  // Tropical canopies: a few flushing, flowering or senescent crowns.
  vec3 accent=special<.45?vec3(.40,.42,.19):special<.8?vec3(.40,.30,.22):vec3(.36,.38,.32);
  return mix(c,accent,st.trop*groundSmooth(.965,.99,fract(special*7.31))*.6);
}
// Crown colour as a residual of Render's own canopy colour (guide): the
// stand's mean palette maps onto it, crown type/tone/jitter modulate it.
vec3 forestCrownColor(ForestStand st,vec3 guide,float needle,vec2 jitter,float special){
  return guide*forestCanopy(st,needle,jitter,special)/max(forestPalette(st,st.needle),vec3(.02));
}
vec3 forestFloor(vec3 ground,ForestStand st,float cold){
  vec3 litter=mix(vec3(.26,.21,.15),vec3(.24,.21,.15),st.needle);
  litter=mix(litter,vec3(.15,.24,.10),st.trop);
  // Boreal floors: moss in wet stands, pale lichen in dry ones.
  litter=mix(litter,mix(vec3(.27,.32,.18),vec3(.58,.58,.48),.7*st.dry),cold*st.needle);
  return mix(ground,litter,.65*(1.-.6*st.dry));
}
// Bank vegetation keeps its foliage greener than the dry climate palette.
vec3 forestRiparianTint(ForestStand st){ForestStand w=st;w.dry*=.45;return forestPalette(w,0.)/max(forestPalette(st,0.),vec3(.02));}
// Shadowed fraction s: remove the direct-light component of the normal.
vec3 forestTilt(vec3 n,vec3 l,float s){return normalize(mix(n,normalize(n-l*max(dot(n,l),0.)),clamp(s,0.,1.)));}
void applyForest(inout GroundMaterial m,vec2 world,float footprint,vec3 light){
  forestResolvedCover=0.;
  vec2 uv=(world-uForestRect.xy)/uForestRect.z;
  if(uForest==0||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return;
  float fp=max(footprint,.02);vec2 fsize=vec2(textureSize(uForestField,0));float fcell=uForestRect.z/fsize.x;
  float reveal=forestReveal(fp);
  // While partly revealed, stands come from a coarser (box, mean-preserving)
  // mip: clearings start as a soft low-frequency guide, then sharpen.
  float lod=max(log2(fp/fcell),0.),standLod=lod+2.*(1.-reveal);vec4 f=forestField(world,standLod);
  ForestStand st;st.p=world;st.cover=f.r;st.height=f.g*50.;st.needle=f.b;st.tone=f.a;
  float T=uMaterialClimate.x,P=uMaterialClimate.y,humid=P/max(20.*T+280.,120.);
  st.trop=groundSmooth(13.,19.,T-6.);st.dry=1.-groundSmooth(.8,2.,humid);
  float cold=1.-groundSmooth(8.,16.,T+6.);
  // Clumping: savanna/dehesa trees scatter, closed forests form solid stands; conifer stands stay open.
  // Wet tropical canopies stay continuous: their deficit shows as crown gaps, not stand holes.
  st.kappa=mix(.25,.78,groundSmooth(.9,1.8,humid))*mix(.55,1.,groundSmooth(3.,10.,st.height))*mix(1.,.6,st.needle)*(1.-.6*st.trop);
  st.open=-1e3;st.forced=-1e3;st.allow=0.;st.hedge=0.;
  float openA=0.,forcedA=0.,hedgeA=0.;bool occupied=false;
  if(uHasOccupation==1){
    vec2 ouv=(world-uOccupationRect.xy)/uOccupationRect.z;
    if(all(greaterThanEqual(ouv,vec2(0.)))&&all(lessThanEqual(ouv,vec2(1.)))){
      float texel=uOccupationRect.z/uOccupationN;
      vec2 o=textureLod(uOccupation,ouv,0.).rg;
      // Signed distances in metres (positive inside).
      vec2 dist=(o*255.-128.)/16.*texel;
      st.open=dist.x;st.forced=dist.y;
      int cls=int(texelFetch(uOccupation,clamp(ivec2(ouv*uOccupationN),ivec2(0),ivec2(int(uOccupationN)-1)),0).b*255.+.5);
      // Construction class 8 forbids crowns, including overhang from neighbours.
      occupied=cls==8;
      // Trees retained in general open land and built reserves (class 7).
      st.allow=(cls==4?.45:cls==5?.22:cls==6?.12:cls==3?.05:cls==2?.02:cls==7?.03:0.)*forestHeightGate(st.height);
      st.hedge=(cls>=1&&cls<=3?.6:0.)*groundSmooth(3.,8.,st.height)*(1.-st.dry);
      float w=max(fp,.5*texel);openA=clamp(st.open/w+.5,0.,1.);forcedA=clamp(st.forced/w+.5,0.,1.)*(1.-openA);
      hedgeA=openA-clamp((st.open-5.)/w+.5,0.,1.);
    }
  }
  // Render reference. Its colour, macro woods included, stays authoritative
  // while the forest is unresolved; k carries the Render3D ground detail
  // (rock tint, clasts, strata) from Render's colour onto its open guide.
  vec3 ground=groundToDisplay(m.albedo);
  vec3 k=clamp(ground/max(renderGuideColor,vec3(.02)),vec3(.25),vec3(4.));
  vec3 openGround=clamp(renderGuideOpen*k,0.,1.);
  vec3 refAlbedo=m.albedo;
  // The same nearest-class mask applies in 2D, perspective and raster exports.
  // Return before gallery, neighbouring crowns and shadows are evaluated.
  if(occupied){m.albedo=groundToLinear(openGround);return;}
  // Applied occupation acts at every distance: open land replaces Render's
  // macro woods by its own tree share, applied woods add their weak prior.
  if(uHasOccupation==1&&openA+forcedA>0.){
    float woods=mix(renderGuideWoods,st.allow*.7+hedgeA/max(openA,1e-3)*st.hedge*.6,openA);
    woods=mix(woods,max(woods,.25*forestHeightGate(st.height)),forcedA);
    refAlbedo=groundToLinear(ground+(woods-renderGuideWoods)*(renderGuideClosed*k-openGround));
  }
  // Riparian gallery over the reference: an area-filtered hint of the narrow
  // bank envelope, colour only (no stand paint, normal or shadow). Weak (50 %)
  // when far, the full expected cover by 2 m/px whether or not its small
  // crowns are legible yet, so the ribbon never jumps when they resolve.
  vec3 galleryMean=groundToLinear(forestCrownColor(st,renderGuideClosed,0.,vec2(0.),0.)*forestRiparianTint(st));
  float galleryArea=forestBankCover(world,fp)*(1.-.5*openA);
  refAlbedo=mix(refAlbedo,galleryMean,mix(.5,1.,reveal)*galleryArea);
  // Stand statistics: share s = c/d of the ground in stands, crown cover d inside them.
  float radius=mix((.24*st.height+1.)*(1.+.45*st.dry),.14*st.height+.9,st.needle);
  // Stand patches keep full contrast only while their crowns are resolved: small unresolved crowns
  // (short boreal stands) fade to softer, mean-preserving patches instead of flat hard blobs.
  // At distance use a broad, softly filtered stand boundary rather than a binary
  // threshold. Keep real applied field edges in their own signed-distance mask.
  // The illustrated sprites need more pixels than an analytic crown. Keep their
  // alpha holes out of the unresolved band instead of a dot grid.
  float crownVis=uForestBrushes==1?groundSmooth(2.,5.,radius/fp):groundSmooth(.9,2.,radius/fp);
  // The whole material leaves the Render reference only as crowns become
  // legible: a small (6 %) residual of the canonical stands while they are
  // unreadable, so no spotted stand pattern replaces Render's coherent guide.
  reveal*=mix(.06,1.,crownVis*crownVis);
  if(reveal<=0.){m.albedo=refAlbedo;return;}
  // A zero-cover fragment can still lie under a crown centred across the
  // clearing boundary. The coarser mip covers that neighbouring support;
  // rejecting from the current texel alone slices otherwise stable crowns.
  // Beyond it, Render's macro woods give way to its open ground. Gallery
  // crowns reach 16 m beyond their envelope at most.
  vec2 bank=forestBankAt(world);float galleryNear=bank.x>-16.?forestBankDensity(bank.y):0.;
  if(st.cover<.002&&galleryNear<=0.&&uHasOccupation==0&&forestField(world,max(lod,1.)).r<.00001){m.albedo=mix(refAlbedo,groundToLinear(openGround),reveal);return;}
  vec3 l=normalize(light);vec2 sun=length(l.xz)>1e-4?normalize(l.xz):vec2(0.);float cot=clamp(length(l.xz)/max(l.y,.05),0.,4.);
  float patchDetail=uForestBrushes==1?crownVis:groundSmooth(.6,2.5,radius/fp);
  float patchVis=(1.-groundSmooth(6.,14.,fp))*mix(.18,1.,patchDetail);
  // Sparse arid cover resolves to a fine mottled trace, not broad flat
  // paint: taper its unresolved fringe continuously; near crowns and the
  // canonical field keep their real cover.
  float fringe=(1.-groundSmooth(.38,.85,humid))*(1.-crownVis);
  float cover=mix(st.cover,forestWoods(st.cover,st.height),forcedA);
  cover=mix(cover,cover*cover,fringe);
  float d=forestDensity(cover,st.kappa),share=cover/max(d,1e-3);
  vec3 nGround=m.normal;
  // Mid/far: AA stand mask over its mean, one sunward probe for stand shadows.
  vec2 q=world+sun*st.height*.6*cot;vec4 fq=forestField(q,standLod);
  float cq=mix(fq.r,fq.r*fq.r,fringe),dq=forestDensity(cq,st.kappa),sq=cq/max(dq,1e-3),mask=share,maskQ=sq;
  if(patchVis>0.){
    vec2 pv=forestPatchThreshold(world),pq=forestPatchThreshold(q);
    float feather=mix(.16,.015,crownVis);
    mask=mix(share,clamp((share-pv.x)/max(pv.y*fp,feather)+.5,0.,1.),patchVis);
    maskQ=mix(sq,clamp((sq-pq.x)/max(pq.y*fp,feather)+.5,0.,1.),patchVis);
  }
  // Sub-crown grain between the crown band and the mean: crown-scale noise whose amplitude fades
  // with spacing/footprint (≈ the variance of unresolved crowns), so the transition never aliases.
  float grainVis=(1.-crownVis)*groundSmooth(.35,1.2,radius/fp),grain=0.;
  if(grainVis>0.){vec2 g=world/(1.6*radius)+vec2(17.3,-41.9);ivec2 c=ivec2(floor(g));
    grain=forestPerlin(g-vec2(c),forestGradient(c),forestGradient(c+ivec2(1,0)),forestGradient(c+ivec2(0,1)),forestGradient(c+ivec2(1,1))).x*grainVis;}
  float natural=mask*d*(1.-openA),openTrees=openA*(st.allow*.7+hedgeA/max(openA,1e-3)*st.hedge*.6);
  float canopy=clamp(natural+openTrees,0.,1.),stand=mask*(1.-openA);
  float groundShadow=clamp(maskQ*dq*(1.-openA)+openTrees*.6,0.,1.);
  vec3 litter=forestFloor(openGround,st,cold);
  // Render's canopy colour (its snow included) with the stand's tone residual.
  vec3 mean=forestCrownColor(st,renderGuideClosed,st.needle,vec2(0.),0.);
  // Mean crown self-shading (normal tilt) and occlusion, matched to the crown band.
  float selfShade=mix(.24,.42,st.needle);
  vec3 albedo=mix(groundToLinear(mix(openGround,litter,stand)),groundToLinear(mean)*(1.+.5*grain),canopy);
  // Unresolved gallery crowns: their expected canopy fraction, colour and a
  // slight occlusion only.
  albedo=mix(albedo,galleryMean,galleryArea*(1.-canopy));
  // Distant stand probes are an average, not a second hard cast-shadow motif.
  vec3 normal=forestTilt(nGround,l,clamp(canopy*selfShade*(1.-.8*grain)+(1.-canopy)*groundShadow*.25,0.,1.));
  float occlusion=mix(m.occlusion*mix(1.,.72,stand),.8,canopy)*(1.-.08*galleryArea);
  float roughness=mix(m.roughness,.9,canopy);
  if(crownVis>0.){
    // Near: explicit crowns on two lattice levels whose union keeps cover d,
    // or the gallery density near a bank envelope.
    float dl=max(d,galleryNear),rho=forestRho(forestTau(dl));
    float level=clamp(2.*log2(radius/rho/2.),0.,5.999),l0=floor(level),w=level-l0;
    float s0=2.*exp2(l0*.5),s1=s0*1.41421356;
    float d0=1.-pow(1.-dl,1.-w),d1=1.-pow(1.-dl,w);
    float aa=fp*.75;
    ForestHit hit;hit.cover=0.;hit.top=-1e9;hit.second=-1e9;hit.slope=vec2(0.);hit.rel=1.;hit.local=vec2(0.);hit.r=1.;hit.needle=false;hit.riparian=false;hit.edge=0.;hit.id=0u;hit.level=-1;hit.near=9.;hit.ink=.5;
    if(d0>.002)forestCrowns(hit,int(l0),s0,st,aa);
    if(d1>.002)forestCrowns(hit,int(l0)+1,s1,st,aa);
    // Water sees the crowns as displayed: resolved and revealed.
    forestResolvedCover=hit.cover*crownVis*reveal;
    float zp=hit.cover>0.?hit.top:0.,shade=0.;
    // Analytic crowns cast a soft dominant-level shadow. Fantasy motifs already
    // contain an oblique painted contact shade: projecting that drawing again
    // creates detached copies of trees rather than a coherent ground shadow.
    if(uForestBrushes==0){
      if(w<.5)shade=forestShadow(hit,int(l0),s0,st,aa,zp,sun,cot);else shade=forestShadow(hit,int(l0)+1,s1,st,aa,zp,sun,cot);
    }
    // Crown surface: leaf clumps (broadleaf) or branch whorls (conifers), rim and trough occlusion.
    uint hc=hit.id*0x9e3779b9u;
    vec2 jitter=vec2(forestU8(hc,0u),forestU8(hc,8u))*2.-1.;float special=forestU8(hc,16u),phase=forestU8(hc,24u)*6.2831853;
    float clumpVis=groundSmooth(2.5,7.,hit.r/fp),clump;vec2 dClump;
    if(uForestBrushes==1){
      // Reuse the selected crown's alpha/luminance sample: no reconstruction or
      // lookup whose biome, scale or coordinates could drift at a stand edge.
      clump=(hit.ink-.5)*2.;dClump=vec2(0.);
    } else if(hit.needle){
      // Straight radial branch ridges seen from above (a twist reads as a pinwheel).
      float rel=length(hit.local),angle=atan(hit.local.y,hit.local.x)*7.+phase;
      clump=cos(angle)*rel;
      vec2 radial=hit.local/max(rel,1e-3),tangent=vec2(-radial.y,radial.x);
      dClump=(-sin(angle)*7.*tangent*rel/max(rel,.05)+cos(angle)*radial)/hit.r;
    } else {
      vec2 a=hit.local*6.5;
      vec3 ph=vec3(phase,phase*1.7,phase*2.3),arg=vec3(a.x,.5*a.x+.866*a.y,-.5*a.x+.866*a.y)+ph;
      clump=(cos(arg.x)+cos(arg.y)+cos(arg.z))/3.;
      vec3 sn=sin(arg);dClump=-6.5*vec2(sn.x+.5*sn.y-.5*sn.z,.866*(sn.y+sn.z))/(3.*hit.r);
      // Finer leaf clusters (rotated, ~2.3× frequency), only once a crown spans many pixels.
      float fine=groundSmooth(8.,20.,hit.r/fp);
      if(fine>0.){
        vec2 b=mat2(.62,-.78,.78,.62)*hit.local*15.;
        vec3 arg2=vec3(b.x,.5*b.x+.866*b.y,-.5*b.x+.866*b.y)+ph.zxy*1.3;
        vec3 sn2=sin(arg2);clump=mix(clump,.65*clump+.35*(cos(arg2.x)+cos(arg2.y)+cos(arg2.z))/3.,fine);
        dClump+=fine*.35*(-15./(3.*hit.r))*(mat2(.62,.78,-.78,.62)*vec2(sn2.x+.5*sn2.y-.5*sn2.z,.866*(sn2.y+sn2.z)));
      }
    }
    // The artwork supplies most of its shading; a shallow crown normal retains
    // volume without wrapping a full circular dome over an oblique drawing.
    vec2 slope=uForestBrushes==1?.25*hit.slope:hit.slope+clumpVis*dClump*hit.r*(hit.needle?.14:.16);
    vec2 macroSlope=-nGround.xz/max(nGround.y,.2);
    vec3 nCrown=normalize(vec3(-(macroSlope.x+slope.x),1.,-(macroSlope.y+slope.y)));
    // Shaded crowns keep their sky light (no black caps).
    nCrown=forestTilt(nCrown,l,shade*.3);
    float trough=hit.second>-1e8?1.-.3*exp(-(hit.top-hit.second)/max(.25*hit.r,.1)):1.;
    float occCrown=uForestBrushes==1?.94:max((.6+.4*(1.-hit.rel*hit.rel))*trough*(1.-.25*clumpVis*max(-clump-.15,0.)),.5);
    float detailGain=uForestBrushes==1?.36:.12;
    vec3 crown=forestCrownColor(st,renderGuideClosed,hit.needle?1.:0.,jitter,special)*(1.+detailGain*clumpVis*clump)*(1.-.12*hit.edge);
    if(hit.riparian)crown*=forestRiparianTint(st);
    // Forest floor under and right around crowns; open ground beyond.
    float under=uForestBrushes==1?hit.cover:1.-groundSmooth(1.,1.8,hit.near);
    vec3 nearAlbedo=mix(groundToLinear(mix(openGround,litter,under)),groundToLinear(crown),hit.cover);
    vec3 nearNormal=normalize(mix(forestTilt(nGround,l,shade*.3),nCrown,hit.cover));
    float nearOcc=mix(m.occlusion*mix(1.,.72,under),occCrown,hit.cover);
    float nearRough=mix(m.roughness,.9,hit.cover);
    albedo=mix(albedo,nearAlbedo,crownVis);normal=normalize(mix(normal,nearNormal,crownVis));
    occlusion=mix(occlusion,nearOcc,crownVis);roughness=mix(roughness,nearRough,crownVis);
  }
  // The whole material response, not only its colour, leaves the Render reference.
  m.albedo=mix(refAlbedo,albedo,reveal);m.normal=normalize(mix(m.normal,normal,reveal));
  m.occlusion=mix(m.occlusion,occlusion,reveal);m.roughness=mix(m.roughness,roughness,reveal);
}

float forestRasterLight(GroundMaterial m,vec3 l){return (.34+.16*clamp(m.normal.y,0.,1.))*m.occlusion+.7*max(dot(m.normal,l),0.);}
// light: X/up/Z sun direction. The raster stays unlit, so forest crowns, stand
// shadows and occlusion are baked relative to the bare ground's own lighting.
vec3 terrain3dMaterial(vec3 s,vec2 world,float footprint,float tpi,float shore,float openness,vec3 light){
  vec3 macroColor=earthMaterial(s,world,max(footprint,1.),tpi,shore,openness);
  GroundMaterial material=terrainGroundMaterial(s,world,footprint,macroColor,uMaterialClimate,uMaterialSeed);
  if(uForest==1){
    vec3 l=normalize(light);float bare=forestRasterLight(material,l);
    applyForest(material,world,footprint,l);
    return groundToDisplay(material.albedo*forestRasterLight(material,l)/max(bare,1e-3));
  }
  return groundToDisplay(material.albedo);
}
vec3 terrain3dMaterial(vec3 s,vec2 world,float footprint,float tpi,float shore,float openness){
  return terrain3dMaterial(s,world,footprint,tpi,shore,openness,vec3(-.5,.70710678,-.5));
}



  
vec3 styledWater(float position) {
  vec3 color = uWaterStops[0];
  for (int i = 1; i < 8; i++) {
    if (i >= uWaterStopCount) break;
    float t = smoothstep(uWaterStopT[i-1], uWaterStopT[i], position);
    color = mix(color, uWaterStops[i], t);
  }
  return color;
}
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
  if(uMode==3) {
    vec3 base=level(0,world);
    vec3 macro=earthMaterial(base,world,max(uPx,1.),(base.x-mean)/(6.*r),shore,openness);
    GroundMaterial m=terrainGroundMaterial(base,world,uPx,macro,uMaterialClimate,uMaterialSeed);
    if(uForest==1) applyForest(m,world,uPx,uLight.xzy);
    return shadeTerrainGround(m,vec3(0.,1.,0.),uLight.xzy,uLight2.xzy,uRockStrength);
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
      float under=1.-forestResolvedCover;
      color=color*(1.-water.a*under)+water.rgb*under;
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
      color = mix(color,lakeColor,a);
      coverage=a+coverage*(1.-a);
    }
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
}