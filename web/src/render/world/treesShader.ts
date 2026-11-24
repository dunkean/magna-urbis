/** Indexed tree silhouettes. All three levels read the same instances, palette and seasonal colours. */
import { TREE_PROFILE_GLSL } from '../../ui/terrain3dTrees';

interface TreeMesh {
  segments: number;
  vertices: number[];
  indices: number[];
}

/** Two stem rings, then the selected crown rings and a single shared tip. The index buffer is shared by all blocks. */
function solidTree(segments: number, crown: readonly number[]): TreeMesh {
  const indices: number[] = [],
    vertices: number[] = [];
  const rings = [-2, -1, ...crown];
  for (const profile of rings) {
    const sides = profile === 5 ? 1 : segments;
    for (let i = 0; i < sides; i++) {
      const angle = (2 * Math.PI * i) / segments;
      vertices.push(profile, i % 2, Math.cos(angle), Math.sin(angle));
    }
  }
  const lastRing = 2 + crown.length - 1;
  for (let ring = 0; ring < lastRing; ring++) {
    for (let i = 0; i < segments; i++) {
      const a = ring * segments + i,
        b = ring * segments + ((i + 1) % segments);
      if (ring + 1 === lastRing) indices.push(a, b, lastRing * segments);
      else indices.push(a, b, b + segments, a, b + segments, a + segments);
    }
  }
  return { segments, vertices, indices };
}

export const TREE_MESHES: readonly TreeMesh[] = [
  solidTree(6, [0, 1, 2, 3, 4, 5]),
  solidTree(4, [0, 2, 5]),
  // Upright stem and six-point crown silhouette, six triangles altogether.
  { segments: 0, vertices: Array.from({ length: 10 }, (_, id) => [id, 0, 0, 0]).flat(), indices: [0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 6, 8, 7, 7, 8, 9] },
];

type Rgb = readonly [number, number, number];
/** The colours of the trees in a look, uniforms of the vertex shader: the instances carry the satellite's crown colours
 * (season, autumn hues, leaf fall), and a look that repaints its painted crowns repaints the trees the same way. */
export interface TreePalette {
  readonly trunk: Rgb;
  /** Crowns and trunk repainted by luminance (display RGB, weights .30 .59 .11) on a ramp from `low` to `high` between
   * luminances `from` and `to`; absent, the colours stay as they are. */
  readonly repaint?: { readonly low: Rgb; readonly high: Rgb; readonly from: number; readonly to: number };
}
/** Satellite: the crown colours of the instances and the 3D view's bark. */
export const SATELLITE_TREES: TreePalette = { trunk: [0.24, 0.19, 0.14] };
/** Painted satellite: the woods of its ink and wash ground (applyPaperMap, rust/bridge/terrainMaterialOccupation.ts),
 * olive by luminance; the trunk a darker bark, so it reads under the crown. */
export const PAINTED_TREES: TreePalette = { trunk: [0.12, 0.1, 0.07], repaint: { low: [0.16, 0.18, 0.05], high: [0.31, 0.33, 0.12], from: 0.06, to: 0.3 } };

export const WORLD_TREE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 treeBase;
layout(location=1) in vec4 treeShape;
layout(location=2) in vec4 treeColor;
layout(location=3) in vec4 meshVertex; // profile ring, bough parity, unit cross-section direction
uniform mat4 uProjection;
uniform vec4 uBlock; // origin relative to target, terrain height offset, streaming opacity
uniform vec2 uRelief;
uniform vec4 uFade; // local eye, start and end of the horizontal fade
uniform float uVisibility;
uniform highp int uSegments;
uniform vec3 uFacing; // screen-right direction on the ground (xy), vertical component toward the eye (z)
uniform vec3 uTrunk;
uniform vec4 uRepaintLow;
uniform vec4 uRepaintHigh;
uniform int uRepaint;
uniform vec3 eye;
uniform vec3 treeLight;
uniform float fogDistance;
uniform int uNight;
out vec3 colour;
out vec3 grain;
flat out float modelOpacity;
flat out float bareCrown; // leafless crown of the season
${TREE_PROFILE_GLSL}
const float WORLD_NEEDLE_R[6]=float[6](1.,.69,.86,.51,.61,0.);
void main(){
  vec2 place=uBlock.xy+treeBase.xy;
  modelOpacity=(1.-smoothstep(uFade.z,uFade.w,min(distance(place,uFade.xy),length(place))))*uVisibility*uBlock.w;
  int id=int(meshVertex.x),form=int(treeShape.z+.5);
  bool spire=form==1,parasol=form>=2,needle=form==1||form==3;
  float h=treeShape.x,r=treeBase.w,bottom=clamp(h-treeShape.y,.02*h,.75*h);
  float stem=max(max(needle?h/90.:h/64.,r/(needle?8.:12.)),.17);
  float u=0.,width=stem,y=0.;
  bareCrown=0.;
  vec2 dir,offset=vec2(0.),phase=vec2(cos(treeShape.w),sin(treeShape.w));
  vec3 normal;
  bool trunk;
  if(uSegments==0){
    trunk=id<4;
    float side=(id==0||id==2||id==5||id==7)?-1.:1.;
    dir=uFacing.xy*side;
    if(trunk){y=id<2?-.25:bottom;width=id<2?stem*1.18:stem*.78;}
    else {
      // The two crown ends separate along the ground when seen from above. A pitched card therefore
      // retains a crown footprint even when the terrain flattens in an overhead orbit.
      bool tip=id==9,base=id==4,lower=id==5||id==6;
      u=base?0.:tip?1.:lower?(spire?.10:parasol?.60:.34):(spire?.55:parasol?.86:.73);
      width=(base||tip)?0.:r*(lower?1.:spire?.58:parasol?.86:.78);
      y=mix(bottom,h,u);
      offset=vec2(uFacing.y,-uFacing.x)*r*uFacing.z*(2.*u-1.);
    }
    normal=normalize(vec3(dir*.52+vec2(-uFacing.y,uFacing.x)*.7, trunk?.15:.24+u));
  }else{
    trunk=id<0;
    dir=mat2(phase.x,phase.y,-phase.y,phase.x)*meshVertex.zw;
    if(trunk){y=id==-2?-.25:bottom;width=id==-2?stem*1.3:stem*.78;}
    else {
      int k=id;
      if(uSegments==4&&parasol&&k==2)k=3;
      u=parasol?PARASOL_U[k]:spire?NEEDLE_U[k]:BROAD_U[k];
      width=r*(parasol?PARASOL_R[k]:spire?WORLD_NEEDLE_R[k]:BROAD_R[k]);
      if(k==0)width=max(width,stem*.78);
      // Shallow scallops keep the fir's six-sided crown full. Dry parasols lean off-centre on their stem.
      width*=spire?mix(1.,.88,meshVertex.y):1.+.09*dot(dir,vec2(.8,-.6));
      y=mix(bottom,h,u);
    }
    normal=trunk?vec3(dir,0.):normalize(vec3(dir*(u>=1.?0.:1.),spire?.42:(u-.32)*2.6));
  }
  if(!trunk){
    if(!needle && treeColor.w>.5)width*=.8;
    bareCrown=treeColor.w>.5?1.:0.;
    if(parasol)offset+=phase*(.14*r*u);
  }
  vec2 local=offset+dir*width;
  vec3 pos=vec3(place+local,treeBase.z*uRelief.x+y*uRelief.y+uBlock.z);
  gl_Position=uProjection*vec4(pos,1.);
  // Anisotropic bark grain, larger crown clumps. Coordinates stay in local
  // metres so the texture remains attached while the camera moves.
  grain=uSegments>0?vec3(vec2(local.x+.71*local.y,y+.29*local.y)*(trunk?vec2(3.6,.72):vec2(spire?2.1:1.42,1.56))+phase*47.,trunk?.34:spire?.26:.35):vec3(0.);
  vec3 tint=trunk?uTrunk:treeColor.rgb;
  if(uRepaint==1)tint=mix(uRepaintLow.rgb,uRepaintHigh.rgb,smoothstep(uRepaintLow.w,uRepaintHigh.w,dot(tint,vec3(.30,.59,.11))));
  float snow=trunk?0.:min(fract(treeColor.w)/.45*mix(.45,1.35,u),.95);
  float lit=(.9+.4*max(dot(normal,treeLight),0.))/(.9+.4*max(treeLight.z,0.));
  colour=mix(tint,vec3(.84,.88,.90),snow)*lit*mix(.84,1.,u);
  if(uNight==1)colour*=vec3(.149,.196,.31);
  vec3 d=(pos-eye)/fogDistance;
  float fog=min(.62,1.-exp(-dot(d,d)*.11));
  colour=mix(colour,uNight==1?vec3(.018,.028,.065):vec3(.77,.85,.88),fog);
}`;

/** Screen-door coverage preserves the depth buffer through range and streaming fades. */
export const WORLD_TREE_FS = `#version 300 es
precision highp float;
in vec3 colour;
in vec3 grain;
flat in float modelOpacity;
flat in float bareCrown;
uniform highp int uSegments;
out vec4 color;
float grainHash(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float grainNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(grainHash(i),grainHash(i+vec2(1.,0.)),f.x),mix(grainHash(i+vec2(0.,1.)),grainHash(i+1.),f.x),f.y)-.5;
}
void main(){
  vec3 base=colour;
  // A leafless crown is the web of its branches: limbs and twigs along the zero lines of two octaves of noise, the sky
  // and the ground between them. Once twigs are under a pixel, the same share of the crown is kept as a screen.
  if(bareCrown>.5){
    float kept=.5;
    if(uSegments>0){
      vec2 q=grain.xy*vec2(1.15,.62);
      float twig=min(abs(grainNoise(q)),1.3*abs(grainNoise(q*2.1+11.3)));
      vec2 size=fwidth(q);
      kept=mix(1.-step(.085,twig),.5,smoothstep(.25,.7,max(size.x,size.y)));
    }
    if(kept<=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.00583715,.06711056)))))discard;
  }
  // Billboards are too small for any grain. A derivative gate removes the
  // pattern before its clumps or strands are subpixel, including on a tilt.
  if(uSegments>0){
    vec2 fp=fwidth(grain.xy);
    float seen=1.-smoothstep(.30,.88,max(fp.x,fp.y));
    if(seen>0.)base*=1.+grain.z*seen*grainNoise(grain.xy);
  }
  if(modelOpacity<1.&&fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))))>=modelOpacity)discard;
  color=vec4(base,1.);
}`;
