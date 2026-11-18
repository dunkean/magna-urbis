/**
 * GLSL of the modelled trees of the world view (treesLayer.ts): the lathe of the 3D view's trees (ui/terrain3dTrees.ts,
 * TREE_3D_GLSL: the same instance of 12 floats, crown profiles, stem girth, snow, clumps and light), with the number of
 * segments around and of rings along the tree set per draw, so far blocks draw coarser trees; standing on TerrainHeights.
 *
 * The fragment shader is the 3D view's, unchanged but for the screen-door fade of the volumes (volumes.ts) while the
 * relief rises. It works in the 3D view's frame (x east, up, y south): the vertex shader hands it positions and normals
 * in that frame, relative to the target, with the eye and the light in the same frame.
 */
import { TREE_3D_GLSL, TREE_PROFILE_GLSL } from '../../ui/terrain3dTrees';
import { VOLUME_FADE_GLSL } from './volumes';

/** A level of detail of the lathe: segments around (even, for the alternating bough tips of a spire), the stem rings
 * (3: foot, breast height, crown base; 2: foot and crown base) and the crown rings, as indices of the profile tables. */
export interface TreeLathe {
  segments: number;
  stem: number;
  crown: readonly number[];
}
/** Full (the 3D view's 480 vertices), middle (180) and far (96). */
export const TREE_LATHES: readonly TreeLathe[] = [
  { segments: 10, stem: 3, crown: [0, 1, 2, 3, 4, 5] },
  { segments: 6, stem: 2, crown: [0, 2, 4, 5] },
  { segments: 4, stem: 2, crown: [0, 3, 5] },
];
export const latheVertices = (lathe: TreeLathe): number => lathe.segments * (lathe.stem + lathe.crown.length - 1) * 6;

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
// Eye relative to the target (x, y), and the distances where trees start and end growing out of the ground.
uniform vec4 uFade;
// Segments around, stem rings; the profile index of each crown ring.
uniform ivec2 uLathe;
uniform int uCrown[6];
out vec3 world;
out vec3 treeNormal;
out vec3 tint;
out float treeLevel;
out vec4 crownChart;
out vec4 crownInfo;
${TREE_PROFILE_GLSL}float profileU(bool parasol,bool spire,int k){return parasol?PARASOL_U[k]:spire?NEEDLE_U[k]:BROAD_U[k];}
float profileR(bool parasol,bool spire,int k){return parasol?PARASOL_R[k]:spire?NEEDLE_R[k]:BROAD_R[k];}
void main(){
  int segments=uLathe.x,stemRings=uLathe.y;
  int v=gl_VertexID,quad=v/6,corner=v-quad*6;
  int band=quad/segments,seg=quad-band*segments;
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring;
  vec2 place=uBlock.xy+treeBase.xy;
  float fade=(1.-smoothstep(uFade.z,uFade.w,distance(place,uFade.xy)))*uRelief.y;
  if(fade<=0.){gl_Position=vec4(2.,2.,2.,1.);world=vec3(0.);treeNormal=vec3(0.,1.,0.);tint=vec3(0.);treeLevel=0.;crownChart=vec4(0.);crownInfo=vec4(0.,1.,0.,0.);return;}
  // Form (instance z): 0 broadleaf, 1 conifer spire, 2 broadleaf parasol, 3 conifer parasol (umbrella pine).
  int form=int(treeShape.z+.5);bool needle=form==1||form==3,parasol=form>=2,spire=form==1;
  float r=treeBase.w,h=treeShape.x,bottom=clamp(h-treeShape.y,.02*h,.75*h);
  float angle=float(seg+dseg)*6.2831853/float(segments)+treeShape.w;
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
    if(spire)radius*=((seg+dseg)%2==0?1.:.68)*(1.+.045*sin(3.*angle+treeShape.w));
    else radius*=(1.+.13*sin(3.*angle+2.*treeShape.w)*(1.-abs(u-.5)*1.4))*(!needle&&treeColor.w>.5?.8:1.);
  }
  vec3 local=vec3(dir.x*radius,y*fade,dir.y*radius);
  if(trunk)treeNormal=vec3(dir.x,0.,dir.y);
  else if(spire)treeNormal=normalize(vec3(dir*(h-bottom),r).xzy);
  else {float mid=bottom+(parasol?.72:.4)*(h-bottom),hd=max(.55*(h-bottom),.1);treeNormal=normalize(vec3(local.x/(r*r),(y-mid)/(hd*hd),local.z/(r*r)));}
  vec3 position=vec3(place+local.xz,treeBase.z*uRelief.x+local.y+uBlock.z);
  world=position.xzy;
  tint=trunk?vec3(.24,.19,.14):treeColor.rgb;
  treeLevel=trunk?0.:clamp((y-bottom)/max(h-bottom,.1),0.,1.);
  crownChart=vec4(dir*arc,fract(treeShape.w*.15915494),r);
  crownInfo=vec4(needle?1.:0.,trunk||treeColor.w>.5?1.:0.,trunk?0.:min(load*cap,.95),min(arc/max(r,.1),1.));
  gl_Position=uProjection*vec4(position,1.);
}`;

/** The 3D view's tree fragment shader; `fading` adds the screen-door fade (`uShown`). */
export function worldTreeFs(fading: boolean): string {
  const source = TREE_3D_GLSL.fragment,
    main = 'void main(){',
    end = 'color=vec4(base,1.);';
  if (!source.includes(main) || !source.includes(end)) throw new Error('World trees: the tree fragment shader changed shape');
  if (!fading) return source;
  return source.replace(main, `uniform float uShown;${VOLUME_FADE_GLSL}\n${main}`).replace(end, `${end}if(volumeHidden(uShown))discard;`);
}
