// Generated from original Render3D, pinned dff14f387a6d1edc89d93737f861ee91e022a5aa.
// No render-v2 source or progressive clearing profile. Regenerate with prepare_original_cover.mjs.
uniform sampler2D uForestField : filter_linear_mipmap, repeat_disable;
uniform sampler2D uForestBank : filter_linear_mipmap, repeat_disable;
uniform vec3 uForestRect=vec3(0,0,40000);
uniform uint uMaterialSeed=1905266606u;
uniform vec2 uMaterialClimate=vec2(18,1000);
uniform int uHasForestBank=0;
uniform float uForestBankDensity=1.0;
const int uForest=1;
const int uHasOccupation=0;
const int uForestBrushes=0;
uniform sampler2D uOccupation;
uniform sampler2DArray uForestBrushAtlas;
const vec3 uOccupationRect=vec3(0,0,40000);
const float uOccupationN=1.0;

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
    vec2 offset=vec2(float(i),float(j))+.5+(vec2(float(h&255u),float((h>>8u)&255u))/255.-.5);
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
struct ForestPatch{ivec2 base;vec2 g0;vec2 g1;vec2 g2;vec2 g3;vec2 g4;vec2 g5;vec2 g6;vec2 g7;vec2 g8;};
vec2 forestPatchGradient(ForestPatch q,int k){if(k==0)return q.g0;if(k==1)return q.g1;if(k==2)return q.g2;if(k==3)return q.g3;if(k==4)return q.g4;if(k==5)return q.g5;if(k==6)return q.g6;if(k==7)return q.g7;return q.g8;}
ForestPatch forestPatchAround(ivec2 cell,float s){
  ForestPatch q;q.base=ivec2(floor(vec2(cell-1)*s/FOREST_PATCH));
  q.g0=forestGradient(q.base+ivec2(0,0));q.g1=forestGradient(q.base+ivec2(1,0));q.g2=forestGradient(q.base+ivec2(2,0));q.g3=forestGradient(q.base+ivec2(0,1));q.g4=forestGradient(q.base+ivec2(1,1));q.g5=forestGradient(q.base+ivec2(2,1));q.g6=forestGradient(q.base+ivec2(0,2));q.g7=forestGradient(q.base+ivec2(1,2));q.g8=forestGradient(q.base+ivec2(2,2));
  return q;
}
float forestPatchValue(ForestPatch q,vec2 p){
  vec2 g=p/FOREST_PATCH-vec2(q.base);ivec2 c=clamp(ivec2(floor(g)),ivec2(0),ivec2(1));int k=c.y*3+c.x;
  return clamp(forestPerlin(g-vec2(c),forestPatchGradient(q,k),forestPatchGradient(q,k+1),forestPatchGradient(q,k+3),forestPatchGradient(q,k+4)).x*.6+.5,0.,1.);
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
void applyForest(inout GroundMaterial m,vec2 world,float footprint,vec3 light,vec3 renderGuideColor,vec3 renderGuideOpen,vec3 renderGuideClosed,float renderGuideWoods,out float forestResolvedCover){
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
        vec2 b=mat2(vec2(.62,-.78),vec2(.78,.62))*hit.local*15.;
        vec3 arg2=vec3(b.x,.5*b.x+.866*b.y,-.5*b.x+.866*b.y)+ph.zxy*1.3;
        vec3 sn2=sin(arg2);clump=mix(clump,.65*clump+.35*(cos(arg2.x)+cos(arg2.y)+cos(arg2.z))/3.,fine);
        dClump+=fine*.35*(-15./(3.*hit.r))*(mat2(vec2(.62,.78),vec2(-.78,.62))*vec2(sn2.x+.5*sn2.y-.5*sn2.z,.866*(sn2.y+sn2.z)));
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
