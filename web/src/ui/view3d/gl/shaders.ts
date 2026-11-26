/**
 * GLSL of the 3D terrain view: ground vertex and fragment shaders, the draped-map fragment, the sky. The WGSL of the
 * WebGPU view is generated from these (web/scripts/wgsl_shaders_3d.ts). One shader source, kept whole.
 */
import { RENDER_3D_FOREST_GLSL } from '../../terrain/gl/shaders';
import { FOREST_PRELUDE_GLSL } from '../../../../../rust/bridge/terrainForest';
import { NEURAL_EARTH_MATERIAL_GLSL, GROUND_COVER_WATER_GLSL, groundCoverInputsGlsl } from '../../../../../rust/bridge/terrainMaterial';
import { RENDER_V2_GLSL } from '../../../../../rust/bridge/terrainRenderV2';
import { UNDERDARK_GLSL } from '../../../../../rust/bridge/terrainRenderUnderdark';
import { CROWN_WATER_GLSL } from '../../../../../rust/bridge/terrainCrownWater';
import { CAVERN_3D_GLSL } from '../../../render/underdarkCavern';
import { CITY_WATER_3D_GLSL } from '../../../../../rust/bridge/cityWater3d';
import { RENDER_3D_MATERIAL_GLSL } from '../../../../../rust/bridge/terrainMaterial3d';
import { MATERIAL_WATER_GLSL, MOONLIGHT_GLSL } from '../../../render/materialLook';
import { RAISED_MATERIAL_GLSL } from '../../terrain3dBillboards';
import { ROAD_SQUEEZE_GLSL } from '../../../render/steepRoads';

/** `pictureCoord()`: where a fragment reads the pictures of its tile. Across a road on a steep slope they are read
 * squeezed (render/steepRoads.ts), so the road draped from above keeps its width; `squeezeField` is the field of the
 * vertices, in metres, its slope as drawn. */
const PICTURE_COORD_GLSL = `${ROAD_SQUEEZE_GLSL}
vec2 pictureCoord(){return texcoord+squeezePush(squeezeField,1.)/patchRect.z;}`;

const mapWaterGlsl = `
uniform int uNaturalWater; uniform int uNight; uniform int displayWaterVisible; uniform float displayWaterBand;
uniform sampler2D canopyWater,previousCanopyWater;
uniform int hasCanopyWater,hasPreviousCanopyWater;
uniform vec3 canopyWaterRect,previousCanopyWaterRect;
${MATERIAL_WATER_GLSL}
${MOONLIGHT_GLSL}
float displayWaterCover(vec2 p){
  vec2 q=(p-canopyWaterRect.xy)/canopyWaterRect.z;
  // Extend the mask's edge for the bounded depth taps: a tile border is not a water bank.
  if(hasCanopyWater==1)return textureLod(canopyWater,clamp(q,vec2(0.),vec2(1.)),0.).r;
  q=(p-previousCanopyWaterRect.xy)/previousCanopyWaterRect.z;
  if(hasPreviousCanopyWater==1)return textureLod(previousCanopyWater,clamp(q,vec2(0.),vec2(1.)),0.).r;
  return 0.;
}
vec3 naturalMapWater(vec3 base,vec3 p,float footprint){
  if(uNaturalWater==0 || displayWaterVisible==0)return base;
  float cover=displayWaterCover(p.xz);if(cover<=0.)return base;
  // Sharpen the bilinear edge of the mask: a thin river on a coarse far tile otherwise stays a pale partial blend.
  cover=smoothstep(.2,.8,cover);
  float band=max(displayWaterBand,1.),position=0.;
  // Twelve fixed taps approximate bank depth; no view-dependent CPU raster or ray search.
  for(int i=0;i<3;i++){
    float r=band*(i==0?.025:i==1?.15:.6);
    position+=(displayWaterCover(p.xz+vec2(r,0.))+displayWaterCover(p.xz-vec2(r,0.))+displayWaterCover(p.xz+vec2(0.,r))+displayWaterCover(p.xz-vec2(0.,r)))/12.;
  }
  vec3 water=materialWater(p.xz,position,footprint);
  // Inland water, above the sea's level, takes its climate tone unless it is frozen.
  if(uWaterSeason.y<.5)water=mix(water,freshWaterTone(water),smoothstep(.1,1.,p.y));
  if(uNight==1)water=moonlight(water);
  return mix(base,water,cover);
}
`;

/** Same lighting, texture transitions, fog and tile diagnostics as the map branch
 * of the full material shader, without compiling unused procedural material code. */
export const TERRAIN_3D_MAP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 texcoord;
in vec3 normal;
in vec3 world;
in vec3 physical;
// Declared for its place among the inputs: the WGSL translation numbers them in order, as the outputs of the vertex shader.
in vec2 physicalSlope;
in vec4 squeezeField;
uniform sampler2D material;
uniform sampler2D previousMaterial;
uniform vec4 textureRect;
uniform vec4 previousRect;
uniform vec3 patchRect;
uniform float textureBlend;
uniform vec3 eye;
uniform float fogDistance;
uniform int showTileBounds;
out vec4 color;
${mapWaterGlsl}
${RAISED_MATERIAL_GLSL}
${PICTURE_COORD_GLSL}
void main() {
  vec2 picture=pictureCoord();
  vec3 base=mix(reliefPrevious(previousRect.xy+picture*previousRect.zw),reliefCurrent(textureRect.xy+picture*textureRect.zw),textureBlend).rgb;
  base*=.89+.11*max(0.,dot(normalize(normal),normalize(vec3(-.4,.8,-.3))));
  base=naturalMapWater(base,physical,max(length(dFdx(physical)),length(dFdy(physical))));
  float fog=1.-exp(-pow(length(world-eye)/fogDistance,2.)*.11);
  base=mix(base,uNight==1?vec3(.018,.028,.065):vec3(.77,.85,.88),min(.62,fog));
  if(showTileBounds==1){
    vec2 edge=min(texcoord,1.-texcoord)/max(fwidth(texcoord),vec2(1e-6));
    float line=1.-smoothstep(.45,1.35,min(edge.x,edge.y));
    base=mix(base,vec3(1.,.55,.12),line*.85);
  }
  color=vec4(base,1.);
}`;

export const vertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec2 gradient;
layout(location=3) in float parentHeight;
layout(location=4) in vec2 parentGradient;
layout(location=5) in vec3 seamCorrection;
// Squeeze of the roads on steep slopes at the vertex (RoadSqueeze.at): metres, and the cross slope of the natural ground.
layout(location=6) in vec4 roadSqueeze;
uniform mat4 matrix;
uniform float exaggeration;
uniform float morph;
uniform vec3 patchOffset;
uniform vec3 physicalOrigin;
out vec2 texcoord;
out vec3 normal;
out vec3 world;
out vec3 physical;
out vec2 physicalSlope;
out vec4 squeezeField;
void main() {
  float height = mix(parentHeight, position.y, morph) + seamCorrection.x;
  vec2 slope = mix(parentGradient, gradient, morph) + seamCorrection.yz;
  world = vec3(position.x, height * exaggeration, position.z) + patchOffset;
  normal = normalize(vec3(-slope.x * exaggeration, 1., -slope.y * exaggeration));
  physical=vec3(position.x,height,position.z)+physicalOrigin;
  physicalSlope=slope;
  texcoord = uv;
  squeezeField = vec4(roadSqueeze.xy, roadSqueeze.z * exaggeration, roadSqueeze.w);
  gl_Position = matrix * vec4(world, 1.);
}`;

// The map only blends resolved crowns: reuse that sample when shading the material underneath them.
const forestMaterial = `${RENDER_3D_MATERIAL_GLSL}\n${RENDER_3D_FOREST_GLSL}`.replace(
  'ForestCanopy forestCanopyAt(ForestPrep p,vec3 l){return forestCanopyNear(p,l);}',
  'ForestCanopy mapCanopy;\nForestCanopy forestCanopyAt(ForestPrep p,vec3 l){if(groundEnabled==0)return mapCanopy;return forestCanopyNear(p,l);}',
);

export const fragmentShader = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D material;
uniform sampler2D previousMaterial;
uniform vec4 textureRect;
uniform vec4 previousRect;
uniform float textureBlend;
uniform vec3 eye;
uniform float fogDistance;
uniform int groundEnabled;
uniform int proceduralPreview;
uniform int showTileBounds;
uniform vec3 groundEye;
uniform vec3 groundLight,groundLight2;
uniform float groundStrength;
uniform sampler2D macroField;
uniform vec3 macroRect;
uniform sampler2D uShoreRing;uniform vec3 uShoreRingRect;
uniform int macroN;
uniform vec3 patchRect;
uniform int groundContours; uniform vec3 groundContourColor;
uniform float groundContourStep,groundContourOpacity,groundFlatSlope;
uniform sampler2D semanticTile,previousSemanticTile;
uniform int hasSemanticTile,hasPreviousSemanticTile;
uniform vec4 semanticRect,previousSemanticRect;
uniform vec4 groundRect,previousGroundRect;
uniform int hasGroundTile,hasPreviousGroundTile;
// Underdark: the cave mask of the surface layer (1 = rock, same grid as macroField) takes the forest beach slot
// (uForestBeach, uForestBeachRect): no forest is drawn underground, and the WebGPU stage has no texture binding left.
uniform int uUnderdark; uniform int uHasCave; uniform vec4 uTownGlow[16]; uniform int uTownGlowCount;
in vec2 texcoord;
in vec3 normal;
in vec3 world;
in vec3 physical;
in vec2 physicalSlope;
in vec4 squeezeField;
out vec4 color;
${PICTURE_COORD_GLSL}
${mapWaterGlsl}
${RAISED_MATERIAL_GLSL}
${GROUND_COVER_WATER_GLSL}
#define PERSPECTIVE_TREE_OWNERS
${FOREST_PRELUDE_GLSL}
float forestWaterCoverage(vec2 p){
  if(surfaceGroundWaterCached&&all(equal(p,surfaceGroundWaterPoint)))return surfaceGroundWaterSample;
  vec2 current=(p-canopyWaterRect.xy)/canopyWaterRect.z;
  if(hasCanopyWater==1 && all(greaterThanEqual(current,vec2(0.))) && all(lessThanEqual(current,vec2(1.))))return surfaceGroundRetainWater(p,textureLod(canopyWater,current,0.).r);
  vec2 previous=(p-previousCanopyWaterRect.xy)/previousCanopyWaterRect.z;
  if(hasPreviousCanopyWater==1 && all(greaterThanEqual(previous,vec2(0.))) && all(lessThanEqual(previous,vec2(1.))))return surfaceGroundRetainWater(p,textureLod(previousCanopyWater,previous,0.).r);
  if(groundEnabled==0)return 0.; // Draped map alpha is opacity, not water cover.
  vec2 uv=(p-patchRect.xy)/patchRect.z;
  return surfaceGroundRetainWater(p,mix(textureLod(previousMaterial,previousRect.xy+uv*previousRect.zw,0.).a,
    textureLod(material,textureRect.xy+uv*textureRect.zw,0.).a,textureBlend));
}
${NEURAL_EARTH_MATERIAL_GLSL}
${groundCoverInputsGlsl(forestMaterial)}
${RENDER_V2_GLSL}
${CROWN_WATER_GLSL}
// Water cover (0-1) at a crown's foot: the displayed water mask (terrainCrownWater.ts).
float crownFootWater(vec2 p){return displayWaterVisible==0?0.:displayWaterCover(p);}
${UNDERDARK_GLSL}
${CAVERN_3D_GLSL}
vec4 groundTileSample(vec4 rect,bool previous,int slot){
  vec2 uv=rect.xy+pictureCoord()*rect.zw;
  if(slot<0){if(previous)return texture(previousSemanticTile,uv);return texture(semanticTile,uv);}
  vec2 size=previous?vec2(textureSize(previousSemanticTile,0)):vec2(textureSize(semanticTile,0));
  vec2 dx=dFdx(uv)*size,dy=dFdy(uv)*size;
  float lod=clamp(log2(max(max(length(dx),length(dy)),1.)),0.,max(log2(size.y)-2.,0.));
  // Stay within one atlas half, including the trilinear filter's coarser tap.
  vec2 margin=vec2(exp2(ceil(lod)))*1.25/size;
  uv=clamp(uv,vec2(float(slot)*.5+margin.x,margin.y),vec2(float(slot+1)*.5-margin.x,1.-margin.y));
  if(previous)return textureLod(previousSemanticTile,uv,lod);
  return textureLod(semanticTile,uv,lod);
}
void cityGroundMaterial(inout GroundMaterial m,vec4 tile){
  float a=clamp(tile.a,0.,1.);
  if(a<=0.)return;
  vec3 albedo=tile.rgb/max(tile.a,.001);
  // The tile supplies unlit earth/stone, with a small retained local soil tint.
  albedo*=mix(vec3(1.),clamp(renderGuideOpen/vec3(.42,.40,.30),vec3(.65),vec3(1.25)),.24);
  // Traffic compacts the mantle: retain the road mask, shaded shoulders and
  // wheel-rut luminance even at full snow cover, below overhanging crowns.
  float wear=clamp(dot(albedo,vec3(.21,.72,.07))-.5,-.4,.4);
  albedo=mix(albedo,vec3(.68,.73,.77)+wear*.18,v2GroundSnow);
  renderGuideOpen=mix(renderGuideOpen,albedo,a);
  m.albedo=mix(m.albedo,groundToLinear(albedo)*v2FloorModulation,a);
  m.roughness=mix(m.roughness,mix(.93,.74,smoothstep(.42,.72,dot(albedo,vec3(.21,.72,.07)))),a);
  m.normal=normalize(mix(m.normal,v2MacroNormal,a*.4));
  v2MeanEnabled=0.;
}
vec4 groundSpline(float t){float u=1.-t;return vec4(u*u*u,3.*t*t*t-6.*t*t+4.,-3.*t*t*t+3.*t*t+3.*t+1.,t*t*t)/6.;}
vec4 groundSplineDerivative(float t){return vec4(-.5*(1.-t)*(1.-t),1.5*t*t-2.*t,-1.5*t*t+t+.5,.5*t*t);}
vec3 groundMacroSurface(vec2 p){
  float cell=macroRect.z/float(macroN);vec2 g=(p-macroRect.xy)/cell-.5,t=fract(g);ivec2 b=ivec2(floor(g))-1;
  vec4 wx=groundSpline(t.x),wy=groundSpline(t.y),dx=groundSplineDerivative(t.x),dy=groundSplineDerivative(t.y);vec3 s=vec3(0.);
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    float h=texelFetch(macroField,clamp(b+ivec2(x,y),ivec2(0),ivec2(macroN-1)),0).r;
    s+=h*vec3(wx[x]*wy[y],dx[x]*wy[y]/cell,wx[x]*dy[y]/cell);
  }
  return s;
}
float groundMacroHeight(vec2 p){
  ivec2 q=ivec2((p-macroRect.xy)/macroRect.z*float(macroN));
  return texelFetch(macroField,clamp(q,ivec2(0),ivec2(macroN-1)),0).r;
}
// Bilinear macro height and the 2D map's topographic position (naturalTpi: 300 m ring, 6r scale), so the
// draped Render v2 snow keeps its hollows and ridges: 16 fetches, no pass, no texture.
float groundMacroBilinear(vec2 p){
  float cell=macroRect.z/float(macroN);vec2 g=(p-macroRect.xy)/cell-.5,f=fract(g);ivec2 b=ivec2(floor(g)),hi=ivec2(macroN-1);
  float h00=texelFetch(macroField,clamp(b,ivec2(0),hi),0).r,h10=texelFetch(macroField,clamp(b+ivec2(1,0),ivec2(0),hi),0).r;
  float h01=texelFetch(macroField,clamp(b+ivec2(0,1),ivec2(0),hi),0).r,h11=texelFetch(macroField,clamp(b+ivec2(1,1),ivec2(0),hi),0).r;
  return mix(mix(h00,h10,f.x),mix(h01,h11,f.x),f.y);
}
float groundTpi(vec2 p,float h){
  float r=max(300.,2.*macroRect.z/float(macroN));
  return (h-.25*(groundMacroBilinear(p+vec2(r,0.))+groundMacroBilinear(p-vec2(r,0.))+groundMacroBilinear(p+vec2(0.,r))+groundMacroBilinear(p-vec2(0.,r))))/(6.*r);
}
vec3 forestRootSurface(vec2 p){return groundMacroSurface(p);}
float forestRootCell(){return macroRect.z/float(macroN);}
${CITY_WATER_3D_GLSL}

void main() {
  vec2 picture=pictureCoord();
  vec4 projected = mix(reliefPrevious(previousRect.xy+picture*previousRect.zw),reliefCurrent(textureRect.xy+picture*textureRect.zw),textureBlend);
  // Cartographic styles retain their projected lighting. Render3D instead
  // evaluates its world-space material here, then composites water and ink.
  vec3 base=projected.rgb;
  if(groundEnabled==1) {
    float footprint=max(.001,max(length(dFdx(physical)),length(dFdy(physical))));
    if(uUnderdark==1){
      // The 2D map's underground (terrainGl.ts): occlusion rings, rim and rock from the same mask; no Render v2 material.
      vec3 s=groundMacroSurface(physical.xz);
      float rock=0.,rim=0.,ao=0.;
      if(uHasCave==1){
        vec3 rect=uForestBeachRect;float cell=rect.z/float(textureSize(uForestBeach,0).x);vec2 uv=(physical.xz-rect.xy)/rect.z;
        float raw=texture(uForestBeach,uv).r,near=0.,far=0.;
        for(int k=0;k<4;k++){
          vec2 d=k==0?vec2(1.,0.):k==1?vec2(-1.,0.):k==2?vec2(0.,1.):vec2(0.,-1.);
          near+=texture(uForestBeach,uv+d*1.5*cell/rect.z).r;far+=texture(uForestBeach,uv+vec2(d.x-d.y,d.x+d.y)*.7071*4.*cell/rect.z).r;
        }
        float edge=max(.376*footprint/cell,1e-3);
        rock=clamp((raw-.5)/edge+.5,0.,1.);
        ao=clamp(.75*near*.25+.35*far*.25,0.,1.)*(1.-rock);
        float ledge=clamp(.375*6./cell,.02,.45);
        rim=smoothstep(.5,.5+ledge*.35,raw)*(1.-smoothstep(.5+ledge*.35,.5+ledge,raw))*clamp(cell/footprint*.25,0.,1.);
      }
      float cover=displayWaterVisible==0?0.:(hasCanopyWater==1||hasPreviousCanopyWater==1)?displayWaterCover(physical.xz):projected.a;
      udPaintCaps=uFungusArea.w>0.?smoothstep(uFungusArea.z,uFungusArea.w,distance(physical.xz,uFungusArea.xy)):1.;
      base=underdarkFloor(s,physical.xz,footprint,clamp(cover*1.5,0.,1.),ao);
      float glow=0.;
      for(int k=0;k<16;k++){if(k>=uTownGlowCount)break;vec4 g=uTownGlow[k];float d=length(physical.xz-g.xy)/max(g.z,1.);glow+=exp(-d*d*.9);}
      base+=vec3(.20,.12,.05)*min(glow,1.2)*(1.-.5*ao);
      if(uRenderV2==1&&(hasGroundTile==1||hasPreviousGroundTile==1)){
        // Streets and yards of the city tiles, dimmed to the cave's light (the city lamps light them).
        vec4 tile=mix(hasPreviousGroundTile==1?groundTileSample(previousGroundRect,true,0):vec4(0.),hasGroundTile==1?groundTileSample(groundRect,false,0):vec4(0.),textureBlend);
        float a=clamp(tile.a,0.,1.);
        base=mix(base,tile.rgb/max(tile.a,.001)*.32*udLight(s.yz),a);
      }
      float depth=s.x<0.?-s.x:6.*cover;
      base=mix(base,underdarkWater(physical.xz,footprint,depth,1.-smoothstep(0.,.9,cover)*smoothstep(0.,3.,depth)),waterUnderCrown(cover,udCapCover));
      vec3 rockColor=underdarkRock(s,physical.xz,footprint,rim);
      base=uPaperMap==1?mix(underdarkPaper(base),underdarkPaper(rockColor)*vec3(.42,.38,.36),rock):mix(base,rockColor,rock);
      // The cave as a section model (render/underdarkCavern.ts): walls cut at the roof, the cave's own light.
      if(uHasCave==1&&uPaperMap==0){vec3 mn=normalize(cross(dFdx(physical),dFdy(physical)));if(mn.y<0.)mn=-mn;base=cavernSection(base,rock,physical.y,glow,physical.xz,footprint,-mn.xz/max(mn.y,.05),cover);}
    } else {
    surfaceGroundReadInputs(physical.xz,footprint);
    vec3 s=groundMacroSurface(physical.xz);
    float shore=max(s.x,0.)/max(length(s.yz),.0001);
    float openness=0.;
    if(uRenderV2>0){
      // One fetch of the baked ring per fragment: shore distance and openness (RG, read near the sea), sky
      // occlusion and horizon tangent toward the light (BA, the relief light of v2ShadeGround).
      vec4 ring=textureLod(uShoreRing,(physical.xz-uShoreRingRect.xy)/uShoreRingRect.z,0.);
      if(s.x>=0.&&s.x<12.&&length(s.yz)<.5){shore=min(shore,ring.x);openness=ring.y;}
      v2ReliefSet(ring.ba,s.yz);
    }
    GroundMaterial m;
    vec3 macro=earthMaterial(s,physical.xz,max(footprint,1.),0.,shore,openness);
    if(uRenderV2>0)m=v2Ground(s,physical.xz,footprint,groundTpi(physical.xz,s.x),groundLight,groundLight2,groundStrength,renderGuideBaseOpen);
    else {
      m=terrainGroundMaterial(s,physical.xz,footprint,macro,uMaterialClimate,uMaterialSeed);
    }
    applyGroundOccupation(m,physical.xz,footprint);
    if(uRenderV2==1&&(hasGroundTile==1||hasPreviousGroundTile==1)){
      vec4 previousGround=vec4(0.),cityGround=vec4(0.);
      if(hasPreviousGroundTile==1)previousGround=groundTileSample(previousGroundRect,true,0);
      if(hasGroundTile==1)cityGround=groundTileSample(groundRect,false,0);
      cityGroundMaterial(m,mix(previousGround,cityGround,textureBlend));
    }
    if(uForest==1)applyForest(m,physical.xz,footprint,groundLight);
    applyPaperMap(m,physical.xz,footprint);
    base=uRenderV2>0?v2ShadeGround(m,normalize(groundEye-physical),groundLight,groundLight2,groundStrength):shadeTerrainGround(m,normalize(groundEye-physical),groundLight,groundLight2,groundStrength);
    if(uRenderV2>0)base=v2DisplayShoulder(base);
    float under=uRenderV2>0?1.:1.-forestResolvedCover;
    if(uRenderV2>1)base=v2Diagnostic(s,physical.xz,0.,footprint);
    // Bank crowns lean over inland water: rooted on land (forestCrown), drawn whole above it, their shadow on it.
    if(uRenderV2>0){float cover=(hasCanopyWater==1||hasPreviousCanopyWater==1)?displayWaterCover(physical.xz):projected.a;
      float bed=s.x<0.?cover:cover*(1.-forestResolvedCover);
      base=cityWaterAt(base,s,physical.xz,footprint,bed);
      if(s.x>=0.)base*=1.-.4*forestResolvedShade*bed;}
    else base=base*(1.-projected.a*under)+projected.rgb*under;
    if(groundContours==1 && s.x>0.){
      float v=s.x/groundContourStep,dv=max(fwidth(v),1e-6),k=floor(v+.5);
      bool major=mod(k,5.)<.5;
      float line=k<.5?0.:clamp((major?1.25:.7)*.5+.5-abs(v-k)/dv,0.,1.);
      float thin=mix(major?0.:line*.5,min(1.,.8*dv*.7)*.5,smoothstep(.3,.7,dv));
      float index=mix(major?line*.75:0.,min(1.,.2*dv*1.25)*.75,smoothstep(.3,.7,dv*5.));
      float a=(1.-(1.-thin)*(1.-index))*groundContourOpacity;
      a*=smoothstep(.25*groundFlatSlope,.5*groundFlatSlope,length(s.yz));
      base=mix(base,groundContourColor,a);
    }
    if(uNight==1)base=moonlight(base);
    }
    vec4 semantic=mix(groundTileSample(previousSemanticRect,true,hasPreviousGroundTile==1?1:-1)*float(hasPreviousSemanticTile),
      groundTileSample(semanticRect,false,hasGroundTile==1?1:-1)*float(hasSemanticTile),textureBlend);
    base=base*(1.-semantic.a)+semantic.rgb;
  } else {
    // The preview receives premultiplied water over transparent land. Fill
    // only transparent land until the full material shader is ready.
    if(proceduralPreview==1){
      float altitude=smoothstep(300.,2500.,physical.y);
      float rock=smoothstep(.15,.75,length(physicalSlope));
      vec3 land=mix(vec3(.31,.38,.23),vec3(.48,.46,.39),max(altitude,rock));
      base=projected.rgb+land*(1.-projected.a);
    }
    float light=.89+.11*max(0.,dot(normalize(normal),normalize(vec3(-.4,.8,-.3))));
    base*=light;
    base=naturalMapWater(base,physical,max(length(dFdx(physical)),length(dFdy(physical))));
    if(uForest==1){
      float footprint=max(.001,max(length(dFdx(physical)),length(dFdy(physical))));
      ForestPrep prep=forestPrep(physical.xz,footprint);
      if(prep.valid && prep.reveal>0. && prep.crownVis>0.){
      mapCanopy=forestCanopyNear(prep,normalize(groundLight));
      if(mapCanopy.cover>0.){
      vec3 s=groundMacroSurface(physical.xz);
      float shore=max(s.x,0.)/max(length(s.yz),.0001);
      // applyForest reads the Render guide written by earthMaterial.
      vec3 macro=earthMaterial(s,physical.xz,max(footprint,1.),0.,shore,0.);
      GroundMaterial canopy;
      canopy.albedo=groundToLinear(base);canopy.normal=normalize(vec3(-physicalSlope.x,1.,-physicalSlope.y));
      canopy.roughness=.9;canopy.occlusion=1.;
      applyForest(canopy,physical.xz,footprint,groundLight);
      vec3 crowns=shadeTerrainGround(canopy,normalize(groundEye-physical),groundLight,groundLight2,groundStrength);
      if(uNight==1)crowns=moonlight(crowns);
      base=mix(base,crowns,forestMapCover);
      }
      }
    }
  }
  if(uUnderdark==1&&groundEnabled==1&&uHasCave==1&&uPaperMap==0)base=cavernFog(base,length(world-eye));
  else {
  float fog = 1. - exp(-pow(length(world - eye) / fogDistance, 2.) * .11);
  base=mix(base,uNight==1?vec3(.018,.028,.065):vec3(.77,.85,.88),min(.62,fog));
  }
  if(showTileBounds==1){
    vec2 edge=min(texcoord,1.-texcoord)/max(fwidth(texcoord),vec2(1e-6));
    float line=1.-smoothstep(.45,1.35,min(edge.x,edge.y));
    base=mix(base,vec3(1.,.55,.12),line*.85);
  }
  color=vec4(base,1.);
}`;

export const skyVertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., .9999, 1.);
}`;

export const skyFragment = `#version 300 es
precision highp float;
uniform float height;
uniform int uNight;
out vec4 color;
void main() {
  float t = clamp(gl_FragCoord.y / height, 0., 1.);
  color = vec4(uNight==2?mix(vec3(.022,.020,.024),vec3(.004,.004,.006),pow(t,.6)):uNight==1?mix(vec3(.035,.046,.09),vec3(.008,.014,.04),pow(t,.8)):mix(vec3(.89, .92, .91), vec3(.49, .68, .81), pow(t, .8)), 1.);
}`;

/** GLSL sources translated to WGSL for the WebGPU backend (web/scripts/wgsl_shaders_3d.ts). */
export const TERRAIN_3D_GLSL = { vertex: vertexShader, ground: fragmentShader, map: TERRAIN_3D_MAP_FRAGMENT, skyVertex, skyFragment };
