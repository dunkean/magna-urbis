/**
 * GLSL of town buildings, for the two views that draw them: the shading shared by both (base occlusion, night,
 * underdark, the procedural grain of covers and walls, and daylight), and the program of the tilted
 * world view (buildingsLayer.ts). The separate 3D view (ui/urbanBuilding3d.ts) builds its programs from the same
 * snippets; web/scripts/wgsl_shaders_3d.ts translates those to WGSL, so the text of the snippets is theirs too.
 *
 * World program: a vertex is (block-local x, height above its seat, block-local y) with the seat, the terrain height
 * under the building as TerrainHeights gives it at full relief (buildingsMesh.ts, worldSeat in buildingsLayer.ts).
 * Seat and height rise with the relief (`uRise`), so the volumes stand on the drawn terrain at every pitch and lie
 * flat at a pitch of 0 (roofs seen from above, never hidden: volumes.ts). A roof face of a town the top view draws
 * comes painted with its pan's colour there, light and ambience included, and takes the top view's grain marks
 * (COVER_GRAIN_GLSL), so tilting keeps the town's look; other faces take the roof light of the 2D plan (buildingLight,
 * roofPlaneLight.ts) and the procedural grain. Haze as the draped ground.
 */
import { MOONLIGHT_GLSL } from '../materialLook';
import { ROOF_PLANE_LIGHT_GLSL } from '../roofPlaneLight';
import { COVER_GRAIN_GLSL } from '../buildingMaterials';
import { HOUSE_SURFACE_GLSL } from '../houseSurfaceTexture';

// Walls darken towards their foot (cheap ambient occlusion over the first 2.4 m); roofs and ground-less
// works (city walls, bridges: facadePosition.y = -10000) are left as they are.
export const BUILDING_NIGHT_GLSL = `
float baseOcclusion(vec3 normal,vec3 p){
  if(abs(normalize(normal).y)>.5||p.y<-1000.)return 1.;
  return mix(.72,1.,smoothstep(0.,2.4,p.y));
}
uniform int uNight;
${MOONLIGHT_GLSL}
${ROOF_PLANE_LIGHT_GLSL}
// Night: moonlight on every face; the mesh's own lit windows (LIT_CLASS faces, p on the facade in metres) glow,
// fading out once a window is no longer resolved (from .45 to 1.2 m per pixel).
vec3 buildingNight(vec3 color,vec3 p,bool lit){
  if(uNight==0)return color;
  color=moonlight(color);
  if(!lit||uNight==2)return color;
  return mix(color,vec3(1.,.61,.22),.93*(1.-smoothstep(.45,1.2,length(fwidth(p)))));
}
// Underdark: no sky. The town's own lanterns light it (warm, dimmed by the darkness), its lit openings glow, and
// far buildings dissolve into the cave's darkness like the ground. uCave: on, light, fog start and end (m); uCaveEye: x, z, height.
uniform vec4 uCave; uniform vec3 uCaveEye;
vec3 buildingCave(vec3 color,vec3 p,bool lit,vec3 N){
  if(uCave.x<.5)return color;
  // No sky: roofs (faces turned up) get only the lanterns' side light, darker than the walls.
  color*=vec3(1.,.84,.66)*uCave.y*mix(1.,.5,smoothstep(.45,.8,normalize(N).y));
  if(lit&&uCave.x<1.5)color=mix(color,vec3(1.,.64,.28),.9*(1.-smoothstep(.45,1.2,length(fwidth(p)))));
  vec2 d=p.xz-uCaveEye.xy;
  return mix(color,vec3(.005,.005,.007),smoothstep(uCave.z,uCave.w,sqrt(dot(d,d)+uCaveEye.z*uCaveEye.z)));
}
`;
/** Procedural grain of roof covers and wall materials for the flat-colour program: only the material's own units
 * (course and column joints, the tone of each tile / slab / board / stone, fibres, clumps or stains at that scale), as
 * factors around 1 (zero mean) whose sum stays within about ±10 %, so a building keeps its flat colour and its own
 * light and shade. `cls` is the material class of the face (ROOF_CLASS, WALL_CLASS), `p` its position in metres
 * (x, height, z; sector-local), `fp` the metres one pixel covers on it: every unit term fades out before its unit
 * reaches about four pixels, and the weathering of the material takes over at the scale of the pixel (speckle for
 * fired clay and stone, streaks down the slope for straw, reed and shingles, along the boards for timber), so every
 * material keeps a grain of its own until a metre per pixel. */
export const BUILDING_GRAIN_GLSL = `
float grainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float grainNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(grainHash(i),grainHash(i+vec2(1.,0.)),f.x),mix(grainHash(i+vec2(0.,1.)),grainHash(i+vec2(1.,1.)),f.x),f.y)*2.-1.;
}
float grainKeep(float wavelength,float fp){return 1.-smoothstep(.12,.3,fp/wavelength);}
// Dark band over the last share w of a cell, minus its mean.
float grainJoint(float f,float w){return smoothstep(1.-w,.98,f)-(.01+.5*w);}
vec3 materialGrain(vec3 color,float cls,vec3 N,vec3 p,float fp){
  // Past a metre per pixel no unit is resolved: far buildings pay nothing.
  if(cls<.5||fp>1.)return color;
  // Face coordinates in metres: x along the ridge or the wall; y down the slope of a pitched or flat face, up a
  // vertical one (walls, gables, the foot of a dome).
  float h=length(N.xz);
  vec2 d=vec2(1.,0.);
  if(h>.02)d=N.xz/h;
  vec2 q=vec2(dot(p.xz,vec2(-d.y,d.x)),p.y);
  if(N.y>.3)q.y=dot(p.xz,d)/N.y;
  // cw: one unit along and across the courses (m), then the width of the course and column joints as a share of it;
  // k: course joint, column joint, unit tone, soft term; run: scale (m) of the soft term along x and y; bond: shift of
  // every other course (broken bond), none where ribs, canes, seams or posts run through.
  int c=int(cls+.5);
  vec4 cw=vec4(.2,.4,.2,.12),k=vec4(.035,.012,.035,0.);vec2 run=vec2(1.);float bond=.5;                          // plain clay tiles: courses
  if(c==2){bond=0.;cw=vec4(.2,.4,.15,.35);k=vec4(.012,.035,.035,0.);}                                       // half-round tiles: ribs
  else if(c==3){bond=0.;cw=vec4(.2,.4,.12,.35);k=vec4(.006,.04,.012,0.);}                                   // glazed tiles: even ribs
  else if(c==4){cw=vec4(.25,.22,.15,.1);k=vec4(.03,.012,.02,0.);}                                   // slates
  else if(c==5){cw=vec4(.55,.4,.15,.1);k=vec4(.04,.03,.04,0.);}                                     // stone slabs, dressed courses
  else if(c==6){cw=vec4(.7,.7,.07,.07);k=vec4(.035,.035,.03,0.);}                                   // paved terrace
  else if(c==7){cw=vec4(.08,1.5,.12,.3);k=vec4(.02,0.,.03,.03);run=vec2(.12,1.2);}                  // straw thatch: strands, ledges
  else if(c==8){cw=vec4(.05,2.,.1,.3);k=vec4(.006,0.,.02,.015);run=vec2(.08,1.6);}                  // reed: fine, smooth
  else if(c==9){cw=vec4(.35,.8,.3,.2);k=vec4(.05,.012,.03,.02);run=vec2(.1,.5);}                    // palm fronds: shaggy rows
  else if(c==10){cw=vec4(.4,.4,.1,.1);k=vec4(0.,0.,0.,.05);run=vec2(.3);}                           // turf: clumps
  else if(c==11){cw=vec4(.14,.3,.2,.12);k=vec4(.035,.012,.04,0.);}                                  // shingles
  else if(c==12){cw=vec4(1.4,.8,.08,.06);k=vec4(.035,.03,.03,.012);run=vec2(.5,.07);}               // bark sheets
  else if(c==13){bond=0.;cw=vec4(.1,2.2,.05,.35);k=vec4(.012,.04,.02,0.);}                                  // split bamboo canes
  else if(c==14){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.045);run=vec2(.5);}                          // earthen terrace: stains
  else if(c==15){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.02);run=vec2(.6);}                           // lime, plaster domes
  else if(c==16){bond=0.;cw=vec4(.6,2.4,.03,.08);k=vec4(.02,.05,.012,0.);}                                  // lead, copper: seams, laps
  else if(c==17){bond=0.;cw=vec4(1.5,.8,.08,.05);k=vec4(.03,.025,0.,.012);run=vec2(.4);}                    // felt: strips, girth ropes
  else if(c==18){cw=vec4(1.4,1.3,.05,.05);k=vec4(.03,.03,.03,0.);}                                  // stitched hides
  else if(c==19){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.025);run=vec2(.3,2.2);}                      // plaster wall: rain streaks
  else if(c==20){bond=0.;cw=vec4(1.2,2.8,.06,.11);k=vec4(.05,.05,0.,.012);run=vec2(.3,2.2);}                // timber frame: posts, rails
  else if(c==21){cw=vec4(2.4,.25,.18,.04);k=vec4(.035,.012,.03,.01);run=vec2(1.2,.06);}             // boards, logs
  else if(c==22){cw=vec4(.22,.075,.2,.1);k=vec4(.025,.01,.035,0.);}                                 // brick
  else if(c==23){cw=vec4(.5,.3,.15,.1);k=vec4(.04,.02,.04,0.);}                                     // stone courses
  else if(c==24){cw=vec4(.4,.14,.2,.1);k=vec4(.015,0.,.012,.03);run=vec2(.35,2.2);}                 // adobe, rammed earth: eroded
  else if(c==25){cw=vec4(.5,.9,.1,.1);k=vec4(0.,.012,.02,.03);run=vec2(.4);}                        // wattle and daub
  else if(c==26){bond=0.;cw=vec4(.1,2.2,.05,.35);k=vec4(.012,.04,.02,0.);}                                  // bamboo wall: upright canes
  else if(c==27){cw=vec4(.4,.3,.15,.1);k=vec4(.015,.01,.03,.02);run=vec2(.5);}                      // coral rag under lime
  else if(c==28){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.03);run=vec2(.6);}                             // snow: a faint even grain, the same on every roof
  else if(c==29){cw=vec4(.9,.45,.06,.05);k=vec4(.03,.02,.025,0.);}                                   // ashlar: large dressed courses
  else if(c==30){bond=0.;cw=vec4(1.2,2.6,.03,.03);k=vec4(.012,.012,.01,.03);run=vec2(.5,2.2);}       // concrete: formwork panels, stains
  else if(c==31){bond=0.;cw=vec4(1.5,3.2,.05,.06);k=vec4(.05,.05,.012,0.);}                          // glass: mullion grid
  // Weathering once the units are no longer resolved: w.x its strength, w.yz its stretch along and down the face.
  vec3 w=vec3(.035,1.,1.);                                                                               // fired clay, stone, earth, hides: speckle
  if(c==3||c==16||c==17)w=vec3(.014,1.,2.5);                                                             // glazed tiles, metal, felt: even
  else if(c==4||c==15||c==19||c==22)w=vec3(.02,1.,1.);                                                   // slate, lime, plaster, brick: little
  else if(c==7||c==9||c==11||c==24)w=vec3(.035,.4,2.5);                                                  // straw, fronds, shingles, eroded earth: streaks down
  else if(c==8||c==13||c==26)w=vec3(.02,.3,3.);                                                          // reed, canes: fine streaks down
  else if(c==10)w=vec3(.05,1.,1.);                                                                       // turf: clumps
  else if(c==12||c==21)w=vec3(.03,2.5,.4);                                                               // bark sheets, boards, logs: along
  else if(c==29)w=vec3(.02,1.,1.);                                                                       // ashlar: little
  else if(c==31)w=vec3(.008,1.,1.);                                                                      // glass: smooth
  else if(c==28)w.x=0.;                                                                                  // snow keeps its own drifts
  float row=floor(q.y/cw.y);
  vec2 u=vec2(q.x/cw.x+bond*mod(row,2.),q.y/cw.y),f=fract(u);
  float keepRow=grainKeep(cw.y,fp),keepColumn=grainKeep(cw.x,fp);
  float g=-k.x*grainJoint(f.y,cw.z)*keepRow-k.y*grainJoint(f.x,cw.w)*keepColumn;
  g+=k.z*(grainHash(floor(u)+cls*17.)*2.-1.)*min(keepRow,keepColumn);
  g+=k.w*grainNoise(q/run+cls)*grainKeep(min(run.x,run.y),fp);
  // Two octaves around six pixels, cross-faded: the tone of groups of units, as fine as the pixel at every distance.
  float level=log2(max(fp,.002)*6.),lo=floor(level);vec2 s=q/w.yz;
  g+=w.x*(1.-min(keepRow,keepColumn))*(1.-smoothstep(.5,1.,fp))*mix(grainNoise(s*exp2(-lo)+cls*3.7),grainNoise(s*exp2(-lo-1.)+cls*9.1),level-lo);
  return color*(1.+g);
}
`;
/** V1 roof edges, antialiased in pixels. The caller selects V1 with a uniform branch. */
export const ROOF_INK_GLSL = `
float roofInk(vec3 edge, vec3 gx, vec3 gy, float dpr){
  vec3 ex=dFdx(edge),ey=dFdy(edge);
  vec3 edgePixel=sqrt(ex*ex+ey*ey);
  float reach=.32*dpr;
  if(all(greaterThanEqual(edge,edgePixel*(reach+.5))))return 0.;
  vec3 d=edge/max(edgePixel,vec3(1.e-6));
  float mpp=sqrt(max(dot(gx.xz,gx.xz),dot(gy.xz,gy.xz)))*dpr;
  return (1.-smoothstep(max(0.,reach-.5),reach+.5,min(d.x,min(d.y,d.z))))*.38*(1.-smoothstep(1.5,4.,mpp));
}
`;
export const WORLD_BUILDING_VS = `#version 300 es
precision highp float;
precision highp int;
// Block-local x, height above the seat (m), block-local y; the normal in the 3D view's frame (x, up, y south) with the
// material class on its length (classes 33 and 34: side and top of a lot boundary strip, the side it lies on instead); the colour; the terrain height under the building, metres as drawn at full relief.
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 albedo;
layout(location=4) in float seat;
uniform mat4 uProjection;
// Block origin relative to the target (x, y) and minus the target's height.
uniform vec3 uBlock;
uniform float uRise;
uniform bool uTop;
uniform float uRoofInkDpr;
// Lot boundary strips: CSS pixels per metre at a depth of one metre, pixels per metre between which they rise from the ground.
uniform vec3 uYard;
// Eye relative to the target.
uniform vec3 uEye;
out vec3 n; out vec3 base; out vec3 facadePosition; out vec3 grainPosition; flat out float materialClass; flat out float townGain; out float vDistance;
flat out float houseLayer;
out vec3 roofEdge;
void main(){
  n=normalize(normal);base=uRoofInkDpr>0.?abs(albedo):albedo;
  // Inspect the bits directly so black channels can carry a negative zero.
  roofEdge=uRoofInkDpr>0.?vec3(greaterThanEqual(floatBitsToInt(albedo),ivec3(0))):vec3(1.);
  // The normal's length carries 1 + code / 32 (buildingsMesh.ts faceCode): the material class, plus 64 x the grain gain
  // in sixteenths of a face the town look painted (0: not painted). Block-local metres keep the grain's hashes exact.
  float code=floor((length(normal)-1.)*32.+.5);
  houseLayer=floor(code/1024.);code-=houseLayer*1024.;
  float painted=floor(code/64.);
  materialClass=code-64.*painted;townGain=painted/15.;
  vec3 place=position;
  if(materialClass>32.5){
    // A strip of lot boundary: its normal is the side of the line the vertex lies on. It stays about a pixel wide however
    // far, and sinks into the ground before its block is left out: no width or presence ever jumps.
    float pixels=uYard.x/max((uProjection*vec4(uBlock.xy+place.xz,(seat+place.y)*uRise+uBlock.z,1.)).w,1.);
    float stand=smoothstep(uYard.y,uYard.z,pixels);
    place.xz+=n.xz*(stand*clamp(.42/pixels-.1,0.,1.2));
    place.y*=stand;
    n=materialClass>33.5?vec3(0.,1.,0.):n;
    materialClass=0.;
  }
  grainPosition=place;facadePosition=place;
  vec3 world=vec3(uBlock.xy+place.xz,(seat+place.y)*uRise+uBlock.z);
  vDistance=length(world-uEye);
  gl_Position=uProjection*vec4(world,1.);
  // Orthographic plan pixels ignore height; the depth buffer still chooses the uppermost roof.
  if(uTop) gl_Position.z=clamp(-(seat+place.y)*.00001,-.95,.95);
}`;

export const WORLD_BUILDING_FS = `#version 300 es
precision highp float;
in vec3 n; in vec3 base; in vec3 facadePosition; in vec3 grainPosition; flat in float materialClass; flat in float townGain; in float vDistance;
flat in float houseLayer;
in vec3 roofEdge; uniform float uRoofInkDpr;
// Haze distance (m) and share; haze colour.
uniform vec2 uAir;
uniform vec3 uHaze;
out vec4 color;
${BUILDING_NIGHT_GLSL}
${BUILDING_GRAIN_GLSL}
${COVER_GRAIN_GLSL}
${HOUSE_SURFACE_GLSL}
${ROOF_INK_GLSL}
void main(){
  vec3 N=normalize(n);
  vec3 gx=dFdx(grainPosition),gy=dFdy(grainPosition);
  float fp=length(abs(gx)+abs(gy));
  // Class 32 marks a lit window (no grain of its own).
  bool lit=materialClass>31.5;float cls=lit?0.:materialClass;
  vec3 rgb;
  if(houseLayer>.5)rgb=houseSurface(base,houseLayer,N,grainPosition);
  else if(townGain>0.&&cls>.5&&cls<18.5)rgb=coverGrainMarks(base,cls,N,grainPosition,townGain);
  else rgb=materialGrain(base,cls,N,grainPosition,fp);
  // The town look already includes slope light and ambience on faces it paints.
  if(townGain<=0.&&uCave.x>.5){
    // Underdark: no sky. The town's lanterns light the walls (warm, dimmed by the darkness), roofs get their side
    // light only, and the lit openings glow while they are resolved.
    rgb*=baseOcclusion(n,facadePosition)*vec3(1.,.84,.66)*uCave.y*mix(1.,.5,smoothstep(.45,.8,N.y));
    if(lit&&uCave.x<1.5)rgb=mix(rgb,vec3(1.,.64,.28),.9*(1.-smoothstep(.45,1.2,length(fwidth(facadePosition)))));
  }else if(townGain<=0.){
    float light=buildingLight(N);
    rgb=buildingNight(rgb*light*baseOcclusion(n,facadePosition),facadePosition,lit);
  }
  if(uRoofInkDpr>0.) rgb*=1.-roofInk(roofEdge,gx,gy,uRoofInkDpr);
  // The far town dissolves into the cave's darkness as the ground does (uHaze is that darkness then), else into the haze.
  float haze=uCave.x>.5?smoothstep(uCave.z,uCave.w,vDistance)*uAir.y:min(.62,1.-exp(-pow(vDistance/uAir.x,2.)*.11))*uAir.y;
  color=vec4(mix(rgb,uHaze,haze),1.);
}`;
