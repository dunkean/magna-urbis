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

// Spend the intermediate mesh on the silhouette: two staggered eight-sided crown rings close on
// a bottom and top point (32 triangles). The four-sided stem tapers inside the crown (4 triangles).
function middleTree(): TreeMesh {
  const vertices: number[] = [],
    indices: number[] = [];
  const ring = (profile: number, sides: number, turn = 0) => {
    const first = vertices.length / 4;
    for (let i = 0; i < sides; i++) {
      const a = ((i + turn) * 2 * Math.PI) / sides;
      vertices.push(profile, i % 2, sides === 1 ? 0 : Math.cos(a), sides === 1 ? 0 : Math.sin(a));
    }
    return first;
  };
  const foot = ring(-2, 4),
    collar = ring(-3, 1),
    base = ring(0, 1);
  const sides = 8,
    belly = ring(2, sides),
    shoulder = ring(4, sides, 0.5),
    tip = ring(5, 1);
  for (let i = 0; i < 4; i++) indices.push(foot + i, foot + ((i + 1) % 4), collar);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    indices.push(base, belly + j, belly + i, belly + i, belly + j, shoulder + i, belly + j, shoulder + j, shoulder + i, shoulder + i, shoulder + j, tip);
  }
  return { segments: sides, vertices, indices };
}

export const TREE_MESHES: readonly TreeMesh[] = [
  solidTree(10, [0, 1, 2, 3, 4, 5]),
  middleTree(),
  // Upright stem and two crown bands with a curved outer contour, six triangles altogether.
  { segments: 0, vertices: Array.from({ length: 10 }, (_, id) => [id, 0, 0, 0]).flat(), indices: [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6, 6, 7, 8, 7, 9, 8] },
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
uniform vec4 uBlock; // origin relative to target, terrain height offset, unused
uniform vec2 uRelief;

uniform highp int uSegments;
uniform vec3 uFacing; // screen-right direction on the ground (xy), vertical component toward the eye (z)
uniform vec3 uTreeUp;
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
out vec3 ray;
flat out vec3 crownAlbedo;
flat out vec3 crownCentre;
flat out vec4 crownAxes; // xyz radii, w marks a distant fir
flat out float crownPhase;

${TREE_PROFILE_GLSL}
const float WORLD_NEEDLE_R[6]=float[6](1.,.69,.86,.51,.61,0.);
void main(){
  vec2 place=uBlock.xy+treeBase.xy;
  int id=int(meshVertex.x),form=int(treeShape.z+.5);
  bool spire=form==1,parasol=form>=2,needle=form==1||form==3;
  float h=treeShape.x,r=treeBase.w,bottom=clamp(h-treeShape.y,.02*h,.75*h);
  float stem=max(max(needle?h/90.:h/64.,r/(needle?8.:12.)),.17);
  float u=0.,width=stem,y=0.;
  vec3 contour=vec3(0.);
  vec2 dir,offset=vec2(0.),phase=vec2(cos(treeShape.w),sin(treeShape.w));
  vec3 normal;
  bool trunk;
  if(uSegments<0){
    vec2 limb=mat2(phase.x,phase.y,-phase.y,phase.x)*meshVertex.xz;
    if(uSegments==-2)limb+=uFacing.xy*meshVertex.w;
    y=meshVertex.y*h; u=meshVertex.y; offset=r*limb;
    width=0.; dir=vec2(0.); trunk=true;
    normal=normalize(vec3(limb,uSegments==-2?.9:meshVertex.w));
  }else if(uSegments==0){
    trunk=id<4;
    float side=(id%2==0)?-1.:1.;
    dir=uFacing.xy*side;
    if(trunk){y=id<2?-.25:bottom;width=id<2?stem*1.18:stem*.78;}
    else {
      float band=float((id-4)/2)-1.;
      u=band<0.?0.:band>0.?1.:spire?.18:parasol?.68:.45;
      width=r*(spire&&band>0.?.18:1.);
      y=mix(bottom,h,u);
      offset=vec2(uFacing.y,-uFacing.x)*r*uFacing.z*band;
      contour=vec3(side,band,1.);
    }
    normal=normalize(vec3(dir*.52+vec2(-uFacing.y,uFacing.x)*.7, trunk?.15:.24+u));
  }else{
    trunk=id<0;
    dir=mat2(phase.x,phase.y,-phase.y,phase.x)*meshVertex.zw;
    if(trunk){y=id==-2?-.25:id==-3?mix(bottom,h,.25):bottom;width=id==-2?stem*1.3:stem*.78;}
    else {
      int k=id;
      // The middle mesh has just two rim rings. Its lower rim is the skirt of the fir.
      if(spire&&uSegments==8&&k==2)k=0;
      u=parasol?PARASOL_U[k]:spire?NEEDLE_U[k]:BROAD_U[k];
      width=r*(parasol?PARASOL_R[k]:spire?WORLD_NEEDLE_R[k]:BROAD_R[k]);
      if(k==0)width=max(width,stem*.78);
      // Shallow scallops keep the fir's six-sided crown full. Dry parasols lean off-centre on their stem.
      width*=spire?mix(1.,.88,meshVertex.y):1.+.09*dot(dir,vec2(.8,-.6));
      y=mix(bottom,h,u);
    }
    normal=trunk?vec3(dir,0.):normalize(vec3(dir*(u>=1.?0.:1.),spire?.42:(u-.32)*2.6));
  }
  if(!trunk&&parasol)offset+=phase*(.14*r*u);
  vec2 local=offset+dir*width;
  vec3 pos=vec3(place+local,treeBase.z*uRelief.x+y*uRelief.y+uBlock.z);
  // Bound the solid crown; the same planes define the broadleaf silhouette at every mesh budget.
  bool firCard=spire&&!trunk&&uSegments==0;
  bool solidCrown=(form==0&&!trunk&&uSegments>=0)||firCard;
  vec2 spread=firCard?vec2(1.):vec2(.96+.04*phase.x,.89+.075*phase.y);
  crownAxes=solidCrown?vec4(r*spread,.5*(h-bottom)*uRelief.y,float(firCard)):vec4(0.);
  crownCentre=vec3(place,treeBase.z*uRelief.x+uBlock.z+.5*(h+bottom)*uRelief.y);
  crownPhase=treeShape.w;
  if(solidCrown){
    if(uSegments==0){
      float bound=length(vec2(r,crownAxes.z));
      pos=crownCentre+bound*(vec3(uFacing.xy,0.)*contour.x+uTreeUp*contour.y);
    }else{
      pos=crownCentre+vec3(dir*r*1.16,(id<=2?-1.:1.)*crownAxes.z);
    }
  }
  ray=pos-eye;
  gl_Position=uProjection*vec4(pos,1.);
  // Anisotropic bark grain, larger crown clumps. Coordinates stay in local
  // metres so the texture remains attached while the camera moves.
  vec2 chart=mat2(phase.x,-phase.y,phase.y,phase.x)*local;
  vec2 grainUv=parasol&&!trunk?vec2(chart.x,chart.y+.32*y):vec2(chart.x+.71*chart.y,y+.29*chart.y);
  grain=uSegments>0?vec3(grainUv*(trunk?vec2(3.6,.72):vec2(spire?2.1:1.42,1.56))+phase*47.,trunk?.34:spire?.26:.35):contour;
  vec3 tint=trunk?uTrunk:treeColor.rgb;
  if(uSegments<0)tint=vec3(.26,.235,.21)*(uSegments==-1?meshVertex.w:1.);
  if(uRepaint==1&&uSegments>=0)tint=mix(uRepaintLow.rgb,uRepaintHigh.rgb,smoothstep(uRepaintLow.w,uRepaintHigh.w,dot(tint,vec3(.30,.59,.11))));
  // Diffuse skylight on satellite foliage matches the lifted dark colours of the
  // terrain material. Paper foliage already carries the ink-and-wash ramp.
  vec3 sky=vec3(.77,.85,.88);
  if(!trunk&&uRepaint==0)tint=mix(tint,sky,.065);
  float snow=uSegments<0?fract(treeColor.w)*u:trunk?0.:min(fract(treeColor.w)/.45*mix(.45,1.35,u),.95);
  float lit=(.9+.4*max(dot(normal,treeLight),0.))/(.9+.4*max(treeLight.z,0.));
  colour=mix(tint,vec3(.84,.88,.90),snow)*lit*mix(.84,1.,u);
  if(solidCrown)colour=mix(tint,vec3(.84,.88,.90),min(fract(treeColor.w)/.45,.95));
  if(uNight==1)colour*=vec3(.149,.196,.31);
  vec3 d=((solidCrown?crownCentre:pos)-eye)/fogDistance;
  float fog=min(.62,1.-exp(-dot(d,d)*.11));
  colour=mix(colour,uNight==1?vec3(.018,.028,.065):sky,fog);
  crownAlbedo=colour;
}`;

/** Opaque silhouettes. Only the outside corners of the far crown card are clipped. */
export const WORLD_TREE_FS = `#version 300 es
precision highp float;
in vec3 colour;
in vec3 grain;
in vec3 ray;
flat in vec3 crownAlbedo;
flat in vec3 crownCentre;
flat in vec4 crownAxes;
flat in float crownPhase;
uniform vec3 eye;
uniform vec3 treeLight;
uniform mat4 uProjection;
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
// Clip the view ray against one crown plane. Keep the normals at both ends for views inside a tree.
void clipFace(vec3 n,float limit,vec3 p,vec3 v,inout vec2 span,inout vec3 nearN,inout vec3 farN){
  float rate=dot(n,v),gap=limit-dot(n,p);
  if(abs(rate)<.00001){if(gap<0.)span=vec2(2.,-2.);return;}
  float hit=gap/rate;
  if(rate<0.&&hit>span.x){span.x=hit;nearN=n;}
  if(rate>0.&&hit<span.y){span.y=hit;farN=n;}
}
const vec3 broadFaces[6]=vec3[6](
  vec3(0.,.52573,.85065),vec3(0.,-.52573,.85065),
  vec3(.52573,.85065,0.),vec3(-.52573,.85065,0.),
  vec3(.85065,0.,.52573),vec3(-.85065,0.,.52573));
void main(){
  vec3 base=colour;
  gl_FragDepth=gl_FragCoord.z;
  if(crownAxes.x>0.){
    vec3 d=ray/crownAxes.xyz,start=(eye-crownCentre)/crownAxes.xyz;
    float a=dot(d,d),mid=-dot(start,d)/a;
    vec3 closest=start+mid*d;
    bool fir=crownAxes.w>.5;
    float disc=(fir?2.:1.)-dot(closest,closest);
    if(disc<0.)discard;
    float invSpeed=inversesqrt(a),halfChord=sqrt(disc);
    float cs=cos(crownPhase),sn=sin(crownPhase);
    mat2 turn=mat2(cs,sn,-sn,cs);
    vec3 v=vec3(turn*d.xy,d.z)*invSpeed,p0=vec3(turn*closest.xy,closest.z);
    vec2 span=vec2(-halfChord,halfChord);
    vec3 nearN=vec3(0.),farN=vec3(0.);
    if(fir){
      // The far silhouette has a horizontal underside and a taper even when viewed obliquely.
      clipFace(vec3(0.,0.,-1.),1.,p0,v,span,nearN,farN);
      vec2 dir=vec2(1.,0.);
      for(int i=0;i<8;i++){
        clipFace(vec3(dir,.48),.48,p0,v,span,nearN,farN);
        dir=.70710678*vec2(dir.x-dir.y,dir.x+dir.y);
      }
    }else{
      // Unequally deep facets bevel the ovoid without giving every crown the same outline.
      for(int i=0;i<6;i++){
        vec3 n=broadFaces[i];
        float cut=.876+.023*n.x+.015*n.y;
        clipFace(n,cut,p0,v,span,nearN,farN);
        clipFace(-n,cut-.026*n.z,p0,v,span,nearN,farN);
      }
    }
    if(span.x>span.y)discard;
    bool inside=mid+span.x*invSpeed<=0.;
    float stepAlong=inside?span.y:span.x,t=mid+stepAlong*invSpeed;
    if(t<=0.)discard;
    vec3 surface=closest+(d*invSpeed)*stepAlong;
    vec3 face=inside?farN:nearN;
    face.xy=transpose(turn)*face.xy;
    vec3 normal=normalize((fir?face:mix(surface,face,dot(face,face)>.5?.80:0.))/crownAxes.xyz);
    vec4 clip=uProjection*vec4(eye+t*ray,1.);
    gl_FragDepth=.5+.5*clip.z/clip.w;
    // Clumps follow the surface in three dimensions, including when its silhouette is a few pixels wide.
    vec3 p=vec3(turn*surface.xy,surface.z)*4.+crownPhase*13.;
    float slice=floor(p.z),f=fract(p.z);
    float noise=mix(grainNoise(p.xy+vec2(17.,37.)*slice),grainNoise(p.xy+vec2(17.,37.)*(slice+1.)),f*f*(3.-2.*f));
    float detail=1.-smoothstep(.35,.9,max(length(dFdx(p)),length(dFdy(p))));
    float lit=(.82+.52*max(dot(normal,treeLight),0.))/(.82+.52*treeLight.z);
    color=vec4(crownAlbedo*lit*(1.+(fir?.22:.48)*detail*noise),1.);
    return;
  }
  if(uSegments==0&&grain.z>.5){
    float rr=dot(grain.xy,grain.xy);
    if(rr>1.)discard;
    base*=.87+.17*sqrt(1.-rr)-.035*grain.x;
  }
  // Billboards are too small for any grain. A derivative gate removes the
  // pattern before its clumps or strands are subpixel, including on a tilt.
  if(uSegments>0){
    vec2 fp=fwidth(grain.xy);
    float seen=1.-smoothstep(.30,.88,max(fp.x,fp.y));
    if(seen>0.)base*=1.+grain.z*seen*grainNoise(grain.xy);
  }
  color=vec4(base,1.);
}`;
