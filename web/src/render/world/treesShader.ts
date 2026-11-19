/**
 * GLSL of the modelled trees of the world view (treesLayer.ts): the lathe of the 3D view's trees (ui/terrain3dTrees.ts,
 * TREE_3D_GLSL: the same instance of 12 floats, crown profiles, stem girth, snow, clumps and light), with the number of
 * segments around and of rings along the tree set per draw, so far blocks draw coarser trees; standing on TerrainHeights.
 *
 * The fragment shader adds screen-door coverage to the 3D view's lighting. It works in the 3D view's frame (x east, up, y south): the vertex shader hands it positions and normals
 * in that frame, relative to the target, with the eye and the light in the same frame.
 */
import { TREE_3D_GLSL, TREE_PROFILE_GLSL } from '../../ui/terrain3dTrees';

/** A level of detail of the lathe: segments around (even, for the alternating bough tips of a spire), the stem rings
 * (3: foot, breast height, crown base; 2: foot and crown base) and the crown rings, as indices of the profile tables.
 * An impostor is one flat band facing the camera (one segment, its two sides on the screen's right), the tree's
 * outline from the same parameters, shaded with the same light: 8 triangles. */
export interface TreeLathe {
  segments: number;
  stem: number;
  crown: readonly number[];
  impostor?: boolean;
}
/** Full (the 3D view's 480 vertices), light (96) and impostor (24). */
export const TREE_LATHES: readonly TreeLathe[] = [
  { segments: 10, stem: 3, crown: [0, 1, 2, 3, 4, 5] },
  { segments: 4, stem: 2, crown: [0, 3, 5] },
  { segments: 1, stem: 2, crown: [0, 2, 5], impostor: true },
];
export const latheVertices = (lathe: TreeLathe): number => lathe.segments * (lathe.stem + lathe.crown.length - 1) * 6;

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
// x, y relative to the block origin, ground height (m, as the terrain before exaggeration), crown radius; height,
// crown length, form, phase; colour and the leafless flag + .45 x snow load (terrain3dTrees.ts, TREE_STRIDE).
layout(location=0) in vec4 treeBase;
layout(location=1) in vec4 treeShape;
layout(location=2) in vec4 treeColor;
uniform mat4 uProjection;
// Block origin relative to the target (x, y), minus the target's height.
uniform vec3 uBlock;
// Metres drawn per metre of ground height (exaggeration x rise); share of the trees' height shown (rise).
uniform vec2 uRelief;
// The eye's ground point relative to the target (x, y), and the distances, from the nearer of it and the target, where
// trees start and end fading into the painted crowns.
uniform vec4 uFade;
uniform float uVisibility;
// Segments around, stem rings, impostor (1: one flat band facing the camera); the profile index of each crown ring.
uniform ivec3 uLathe;
uniform int uCrown[6];
// Impostors: the direction towards the eye in the 3D view's frame, and the angle of the screen's right on the ground.
uniform vec4 uFacing;
// The look's colours (TreePalette): the trunk; the repaint ramp, low and high colour with their luminance in w, and
// whether it applies.
uniform vec3 uTrunk;
uniform vec4 uRepaintLow;
uniform vec4 uRepaintHigh;
uniform int uRepaint;
out vec3 world;
out vec3 treeNormal;
out vec3 tint;
out float treeLevel;
out vec4 crownChart;
out vec4 crownInfo;
flat out float modelOpacity;
${TREE_PROFILE_GLSL}float profileU(bool parasol,bool spire,int k){return parasol?PARASOL_U[k]:spire?NEEDLE_U[k]:BROAD_U[k];}
float profileR(bool parasol,bool spire,int k){return parasol?PARASOL_R[k]:spire?NEEDLE_R[k]:BROAD_R[k];}
void main(){
  int segments=uLathe.x,stemRings=uLathe.y;bool impostor=uLathe.z==1;
  int v=gl_VertexID,quad=v/6,corner=v-quad*6;
  int band=quad/segments,seg=quad-band*segments;
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring;
  vec2 place=uBlock.xy+treeBase.xy;
  modelOpacity=(1.-smoothstep(uFade.z,uFade.w,min(distance(place,uFade.xy),length(place))))*uVisibility;
  if(modelOpacity<=0.){gl_Position=vec4(2.,2.,2.,1.);world=vec3(0.);treeNormal=vec3(0.,1.,0.);tint=vec3(0.);treeLevel=0.;crownChart=vec4(0.);crownInfo=vec4(0.,1.,0.,0.);return;}
  // Form (instance z): 0 broadleaf, 1 conifer spire, 2 broadleaf parasol, 3 conifer parasol (umbrella pine).
  int form=int(treeShape.z+.5);bool needle=form==1||form==3,parasol=form>=2,spire=form==1;
  float r=treeBase.w,h=treeShape.x,bottom=clamp(h-treeShape.y,.02*h,.75*h);
  // An impostor's two sides lie along the screen's right, at the tree's profile radius: the lathe's outline, flat.
  float angle=impostor?float(dseg)*3.1415927+uFacing.w:float(seg+dseg)*6.2831853/float(segments)+treeShape.w;
  vec2 dir=vec2(cos(angle),sin(angle));
  // Stem girth, flare and taper: TREE_3D_GLSL (terrain3dTrees.ts) gives the sources.
  float dbh=max(max(needle?h/45.:h/32.,2.*r/(needle?8.:12.)),.5),stem=.5*dbh,collar=stem*mix(1.,.65,smoothstep(1.5,10.,bottom));
  float radius,y;
  float load=fract(treeColor.w)/.45,cap=0.,arc=0.;
  // Stem rings: foot, breast height, crown base; a coarse lathe keeps the foot and the crown base.
  int stemRing=ring<stemRings?(stemRings==2&&ring==1?2:ring):-1;
  bool trunk=stemRing>=0;
  if(trunk){radius=stemRing==0?stem*(1.45+.55*smoothstep(1.,2.5,dbh)):stemRing==1?stem:collar;y=stemRing==0?-.4:stemRing==1?min(1.3,.4*bottom):bottom;}
  else {
    int k=uCrown[ring-stemRings];float u=profileU(parasol,spire,k);
    for(int j=k;j<5;j++){
      float du=(profileU(parasol,spire,j+1)-profileU(parasol,spire,j))*(h-bottom);
      float dr=(profileR(parasol,spire,j+1)-profileR(parasol,spire,j))*r;
      arc+=sqrt(du*du+dr*dr);
    }
    cap=spire?((seg+dseg)%2==0?1.3:.45)*mix(.8,1.2,u):mix(.45,1.4,u);
    radius=max(r*profileR(parasol,spire,k),k==0?collar:0.);y=bottom+u*(h-bottom);
    if(spire&&!impostor)radius*=((seg+dseg)%2==0?1.:.68)*(1.+.045*sin(3.*angle+treeShape.w));
    else radius*=(1.+.13*sin(3.*angle+2.*treeShape.w)*(1.-abs(u-.5)*1.4))*(!needle&&treeColor.w>.5?.8:1.);
  }
  vec3 local=vec3(dir.x*radius,y*uRelief.y,dir.y*radius);
  if(trunk)treeNormal=vec3(dir.x,0.,dir.y);
  else if(spire)treeNormal=normalize(vec3(dir*(h-bottom),r).xzy);
  else {float mid=bottom+(parasol?.72:.4)*(h-bottom),hd=max(.55*(h-bottom),.1);treeNormal=normalize(vec3(local.x/(r*r),(y-mid)/(hd*hd),local.z/(r*r)));}
  // A flat impostor is lit as the crown's side that faces the eye: its edge normals turned towards the camera.
  if(impostor)treeNormal=normalize(treeNormal+uFacing.xyz);
  vec3 position=vec3(place+local.xz,treeBase.z*uRelief.x+local.y+uBlock.z);
  world=position.xzy;
  tint=trunk?uTrunk:treeColor.rgb;
  if(uRepaint==1)tint=mix(uRepaintLow.rgb,uRepaintHigh.rgb,smoothstep(uRepaintLow.w,uRepaintHigh.w,dot(tint,vec3(.30,.59,.11))));
  treeLevel=trunk?0.:clamp((y-bottom)/max(h-bottom,.1),0.,1.);
  crownChart=vec4(dir*arc,fract(treeShape.w*.15915494),r);
  crownInfo=vec4(needle?1.:0.,trunk||treeColor.w>.5?1.:0.,trunk?0.:min(load*cap,.95),min(arc/max(r,.1),1.));
  gl_Position=uProjection*vec4(position,1.);
}`;

/** Screen-door coverage keeps depth writes correct while letting the painted crowns show through. The threshold is
 * stable in screen space, shared by all surfaces of a tree: overlapping back faces cannot restore its opacity.
 * Derivatives are evaluated before discarding, so the crown's clump footprint remains defined. */
// The painted crowns already carry canopy shade. Strong directional light and a second deep occlusion term darkened
// the same stand on tilt. More ambient light lifts the shadow side; weaker base occlusion keeps its mean colour,
// while directional light and the unchanged crown clumps still describe volume. Constants only: identical shader cost.
export const WORLD_TREE_FS = TREE_3D_GLSL.fragment
  .replaceAll('.5+.62*', '.90+.40*')
  .replace('mix(.58,1.,treeLevel)', 'mix(.84,1.,treeLevel)')
  .replace('out vec4 color;', 'flat in float modelOpacity;\nout vec4 color;')
  .replace(
    '  vec3 albedo=tint;',
    `  if(modelOpacity<1.&&fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))))>=modelOpacity)discard;
  vec3 albedo=tint;`,
  );
