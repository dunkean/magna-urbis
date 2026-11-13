import { WATER_MATERIAL_GLSL } from '../../web/src/render/terrainWater';
import { GROUND_COVER_GLSL } from './terrainGround';

/** Cache the water lookup already consumed by V2 before its micro material. */
export const GROUND_COVER_WATER_GLSL = `
bool surfaceGroundWaterCached=false;vec2 surfaceGroundWaterPoint=vec2(0.);float surfaceGroundWaterSample=0.;
float surfaceGroundRetainWater(vec2 world,float coverage){
  surfaceGroundWaterCached=true;surfaceGroundWaterPoint=world;surfaceGroundWaterSample=coverage;return coverage;
}
`;

/** Share the forest's retained bank texel with the close ground pass. */
export function groundCoverInputsGlsl(source: string): string {
  return source.replaceAll('textureLod(uForestBank,uv,0.)','surfaceGroundBankTexel(world,uv)')+`
void surfaceGroundReadInputs(vec2 world,float fp){
  if(uQuality>0)return;
  if(uGroundCover.w<.5||uForest==0||uForestBrushes!=0||uRenderV2>1||fp>=10.)return;
  if(surfaceGroundHasInputs&&all(equal(world,surfaceGroundPoint)))return;
  vec3 occupation=groundOccupation(world);vec2 bank=fp<1.?forestBankAt(world):vec2(-1e3,0.);
  surfaceGroundWet=uRenderV2==1?forestWaterCoverage(world):0.;
  // Wide channels refer to the bank; narrow channels retain their centreline.
  float distance=bank.y>0.?bank.y-bank.x:1e9;
  surfaceGroundInputs(world,occupation,surfaceGroundWet>=.5?-max(distance,.3):distance);
}
`;
}

// Material compositor ported from Neural Earth web/terrain_renderer.js (GPL-3.0).
// Original blending, noise, coverage and palettes; local climate/substrate adapter below.
export const NEURAL_EARTH_MATERIAL_GLSL = `
// Runtime display tier only: captures and material rasters bind zero.
uniform int uQuality; // 0 full, 1 light; never a specialization constant
uniform uint uMaterialSeed;
uniform vec2 uMaterialClimate; // sea-level temperature Celsius, annual rain mm
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
      // The corners come from one loop with a data-dependent bound: the shader compilers inline every call, and this
      // noise is called ~160 times per material shader; eight inlined corners each made D3D (DXC/FXC) compile for
      // tens of seconds. Same arithmetic as eight separate corners. The map plane z=0 (u.z=0) needs the lower four only.
      vec4 a=vec4(0.),b=vec4(0.);int corners=u.z==0.?4:8;
      for(int k=0;k<corners;k++){
        float v=surfaceCorner(c,f,ivec3(k&1,(k>>1)&1,k>>2),salt);int j=k&3;
        if(k<4){if(j==0)a.x=v;else if(j==1)a.y=v;else if(j==2)a.z=v;else a.w=v;}
        else{if(j==0)b.x=v;else if(j==1)b.y=v;else if(j==2)b.z=v;else b.w=v;}
      }
      float x0=a.x+(a.y-a.x)*u.x;float x1=a.z+(a.w-a.z)*u.x;float y0=x0+(x1-x0)*u.y;
      if(u.z==0.){return y0*5.25;}
      float x2=b.x+(b.y-b.x)*u.x;float x3=b.z+(b.w-b.z)*u.x;float y1=x2+(x3-x2)*u.y;
      return (y0+(y1-y0)*u.z)*5.25;
    }
    // surfaceNoise on the plane z=0 with its gradient: (value, d/dx, d/dy).
    vec3 surfacePlane(vec2 p,uint salt){
      vec2 fl=floor(p);ivec2 c=ivec2(fl);vec2 f=p-fl;vec2 u=f*f*f*(f*(f*6.-15.)+10.);vec2 du=30.*f*f*(f*(f-2.)+1.);
      uint h0=surfaceHash(ivec3(c,0),salt);uint h1=surfaceHash(ivec3(c+ivec2(1,0),0),salt);
      uint h2=surfaceHash(ivec3(c+ivec2(0,1),0),salt);uint h3=surfaceHash(ivec3(c+ivec2(1,1),0),salt);
      vec2 g0=vec2(float(h0&1023u),float((h0>>10u)&1023u))/511.5-1.;vec2 g1=vec2(float(h1&1023u),float((h1>>10u)&1023u))/511.5-1.;
      vec2 g2=vec2(float(h2&1023u),float((h2>>10u)&1023u))/511.5-1.;vec2 g3=vec2(float(h3&1023u),float((h3>>10u)&1023u))/511.5-1.;
      float a=dot(g0,f);float b=dot(g1,f-vec2(1.,0.));float d=dot(g2,f-vec2(0.,1.));float e=dot(g3,f-vec2(1.,1.));float k=a-b-d+e;
      vec2 gradient=g0+(g1-g0)*u.x+(g2-g0)*u.y+(g0-g1-g2+g3)*u.x*u.y+du*vec2(b-a+k*u.y,d-a+k*u.x);
      return vec3(a+(b-a)*u.x+(d-a)*u.y+k*u.x*u.y,gradient)*5.25;
    }
    // Set by surfaceMaterial and surfaceMicro for the later passes of the same fragment.
    vec2 surfaceFall=vec2(1.,0.);
    vec3 surfaceRockTone=vec3(.43,.42,.39),surfaceSoilTone=vec3(.40,.32,.22),surfaceHerbTone=vec3(1.),surfaceMicroTone=vec3(1.);
    vec2 surfaceMicroSlope=vec2(0.);float surfaceRise=0.,surfaceBedded=0.;
    // Exposed rock colouring, one model for 2D and 3D. Three zero-mean parts, weighted per biome by
    // surfaceMaterial: strata of the stratigraphic height (dominant in arid ranges, weaker in temperate
    // ones), jointed blocks (every range) and fall-line streaks (the cold-range look, a minor part elsewhere).
    // These constants scale each part everywhere; 1 is the reference look.
    const float ROCK_STRATA=1.;const float ROCK_FACETS=1.;const float ROCK_STREAKS=1.;
    float surfaceStrataWeight=0.,surfaceFacetWeight=1.,surfaceStreakWeight=1.;
    vec2 surfaceGroundSlope=vec2(0.),surfaceGroundGradient=vec2(0.);
    vec4 surfaceGroundEnv=vec4(0.);float surfaceGroundHeight=0.,surfaceGroundShore=1e9,surfaceGroundBeach=0.,surfaceGroundNormalGain=1.;
#ifdef RENDER3D_FOREST
    // xyz: sun in X/up/Z, w: satellite ground with procedural-canopy.
    uniform vec4 uGroundCover;
    bool surfaceGroundHasInputs=false;vec2 surfaceGroundPoint=vec2(0.);
    vec3 surfaceGroundOccupation=vec3(0.);float surfaceGroundBank=1e9,surfaceGroundWet=0.;
    bool surfaceGroundBankCached=false;vec2 surfaceGroundBankPoint=vec2(0.);vec4 surfaceGroundBankSample=vec4(0.);
    vec4 surfaceGroundBankTexel(vec2 world,vec2 uv){
      if(surfaceGroundBankCached&&all(equal(world,surfaceGroundBankPoint)))return surfaceGroundBankSample;
      surfaceGroundBankCached=true;surfaceGroundBankPoint=world;surfaceGroundBankSample=textureLod(uForestBank,uv,0.);
      return surfaceGroundBankSample;
    }
    // Supply the existing categorical occupation and signed dry-bank distance;
    // this hook must reuse retained reads, never sample a texture for cover.
    void surfaceGroundInputs(vec2 world,vec3 occupation,float bankDistance){
      surfaceGroundHasInputs=true;surfaceGroundPoint=world;surfaceGroundOccupation=occupation;surfaceGroundBank=bankDistance;
    }
#endif
    // Zero-mean tone of the bed containing z, in beds of unit thickness.
    float surfaceBed(float z,uint salt){
      float i=floor(z);float a=float(surfaceHash(ivec3(int(i),0,0),salt)&1023u);float b=float(surfaceHash(ivec3(int(i)+1,0,0),salt)&1023u);
      return (a+(b-a)*sstep(.3,.7,z-i))/1023.-.5;
    }
    // One rotated noise band: value and world gradient.
    vec3 surfaceBand(vec2 world,float wavelength,uint salt){
      vec3 n=surfacePlane(vec2(.8*world.x+.6*world.y,.8*world.y-.6*world.x)/wavelength,salt);
      return vec3(n.x,vec2(.8*n.y-.6*n.z,.6*n.y+.8*n.z)/wavelength);
    }
    // Dark lines on the zero set of a noise of variance about 1.16. Lines widen
    // to the pixel instead of aliasing; E[exp2(-k n^2)] is subtracted at every width.
    float surfaceCrack(float n,float fp,float wavelength){
      float k=min(40.,.02*wavelength*wavelength/max(fp*fp,.0001));
      return inversesqrt(1.+1.6*k)-exp2(-k*n*n);
    }
    // Jointed blocks on a 3x3 cellular search (a 2x2 search loses the second
    // neighbour and draws straight seams along the lattice): (zero-mean block
    // tone, distance to the nearest joint, zero-mean tilt of the block face).
    vec4 surfaceFacets(vec2 q,uint salt){
      vec2 fl=floor(q);ivec2 c=ivec2(fl);vec2 f=q-fl;float first=9.;float second=9.;uint id=0u;
      for(int j=-1;j<=1;j++){for(int i=-1;i<=1;i++){
        uint h=surfaceHash(ivec3(c+ivec2(i,j),0),salt);
        vec2 d=vec2(float(i),float(j))+.1+.8*vec2(float(h&255u),float((h>>8u)&255u))/255.-f;float r=dot(d,d);
        if(r<first){second=first;first=r;id=h;}else if(r<second){second=r;}
      }}
      return vec4(float((id>>16u)&255u)/255.-.5,sqrt(second)-sqrt(first),vec2(float((id>>24u)&15u),float(id>>28u))/15.-.5);
    }
    // Cellular stones: (zero-mean stone tone, distance to the nearest joint).
    vec2 surfaceStones(vec2 q,uint salt){return surfaceFacets(q,salt).xy;}
    // Dark joint between blocks, widened to the pixel (cell units) and faded
    // before it would draw a lattice of lines.
    float surfaceJoint(float edge,float pixel){
      float a=max(pixel,.004);
      return (1.-sstep(.03-a,.03+a,edge))*(1.-sstep(.03,.07,pixel));
    }
    // Procedural rock map until real geology is wired in. Maps are 1 to 40 km wide,
    // so units vary at kilometre scale. Field a splits sedimentary from crystalline
    // cover (ranges expose their core); b selects inside each family and is bent by
    // the stratigraphic height, so contacts follow the relief instead of ignoring it.
    vec3 surfaceLithology(vec2 world,float h,float grade,float fp,float m1,float m2,float grove,float crag,uint salt){
      float a=.9*surfacePlane(world/9000.,salt+21u).x*(1.-sstep(1080.,2700.,fp))+.75*grove+.3*crag+.35*m1+.7*sstep(300.,1800.,h);
      float b=.8*surfacePlane(world/6100.,salt+22u).x*(1.-sstep(730.,1830.,fp))+.7*surfacePlane(world/1900.,salt+23u).x*(1.-sstep(230.,570.,fp))+.3*crag+.35*m2;
      float dip=float(salt&1023u)*.00613592;
      surfaceRise=h+.03*dot(world,vec2(cos(dip),sin(dip)))+70.*grove+14.*crag;
      // Once the bands are unresolved, the wider step is their area mean.
      float contact=1.-sstep(.125,.25,fp*(grade+.2)/460.);float wide=1.1-.8*contact;
      float bands=sstep(-wide,wide,b+2.2*contact*surfaceBed(surfaceRise/460.+.9*surfaceBed(surfaceRise/270.,salt+35u),salt+36u));
      float crystal=sstep(-.3,.3,a);surfaceBedded=1.-crystal;
      vec3 sedimentary=surfaceMix(vec3(.76,.72,.62),vec3(.68,.49,.31),bands); // limestone, sandstone
      vec3 crystalline=surfaceMix(vec3(.62,.54,.52),vec3(.37,.41,.46),sstep(-.35,.35,b-.6*a)); // granite, schist
      return surfaceMix(surfaceMix(sedimentary,crystalline,crystal),vec3(.21,.21,.22),sstep(1.05,1.4,.7*(b-a))); // basalt
    }
    ${GROUND_COVER_GLSL}
    // Close-range ground as a ratio over the macro mean, its relief left in
    // surfaceMicroSlope. Fills the gap between the 30 m FBM octave, already at 1/8
    // amplitude, and the first ground band near 3 m, then continues to gravel. Bands
    // step by 3.6x and fade like surfaceFbm, between 8 and 4 samples per wavelength;
    // all are zero-mean, so the colour holds when a band fades in or out.
    // Rock wears along the fall line: noise averaged down the slope gives chutes and ribs that follow the relief,
    // with no global coordinates to swirl where the slope turns.
    float surfaceChute(vec2 world,float across,float along,uint salt){
      vec2 step=surfaceFall*along;float n=0.;
      for(int i=-2;i<=2;i++)n+=surfaceNoise(vec3((world+step*float(i))/across,0.),salt);
      return n*.42;
    }
    vec3 surfaceMicro(vec2 world,float slope,float fp,float rock,float grass,uint salt){
      surfaceMicroSlope=vec2(0.);surfaceMicroTone=vec3(1.);surfaceGroundSlope=vec2(0.);surfaceGroundNormalGain=1.;
      if(uQuality>0){
        // One filtered band tints the substrate; no strata, facets or cover searches.
        if(fp<2.)surfaceMicroTone=vec3(1.)+surfaceBand(world,40.,salt+31u).x*(1.-sstep(1.,2.,fp))*(vec3(.025)+grass*vec3(.025,.01,-.015));
        return surfaceMicroTone;
      }
      if(fp>=10.){return surfaceMicroTone;}
      float fallLength=length(surfaceGroundGradient);surfaceFall=fallLength>.0001?surfaceGroundGradient/fallLength:vec2(1.,0.);
      float k1=1.-sstep(5.,10.,fp);float k2=1.-sstep(1.4,2.8,fp);float k3=1.-sstep(.38,.76,fp);float k4=1.-sstep(.1,.2,fp);
      // Each group of bands, chutes, blocks, stones and beds comes from one loop: the shader compilers inline every
      // call, and this function is inlined in every material shader (seconds of D3D compilation per copy).
      vec3 n1=vec3(0.);vec3 n2=vec3(0.);vec3 n3=vec3(0.);vec3 n4=vec3(0.);
      for(int k=0;k<4;k++){
        if(k==1&&k2<=0.||k==2&&k3<=0.||k==3&&k4<=0.)continue;
        vec3 n=surfaceBand(world,k==0?40.:k==1?11.:k==2?3.:.8,salt+31u+uint(k));
        if(k==0)n1=n;else if(k==1)n2=n;else if(k==2)n3=n;else n4=n;
      }
      surfaceMicroSlope=.1*(40.*k1*n1.yz+11.*k2*n2.yz+3.*k3*n3.yz+.8*k4*n4.yz);
      float mottle=.5*k1*n1.x+.38*k2*n2.x+.3*k3*n3.x+.22*k4*n4.x;
      float soil=(1.-rock)*(1.-grass);float herb=(1.-rock)*grass;
      float tone=1.+mottle*(.05*soil+.075*herb+.035*rock);
      vec3 hue=vec3(1.)+mottle*(soil*vec3(.012,0.,-.016)+herb*vec3(.075,.01,-.06));
      if(rock>.02){
        // Steep faces keep a moderate albedo contrast: in 3D the lit relief must still read
        // through the paint. Block faces are tilted in the normal, never shaded in the albedo.
        float relief=mix(1.,.65,sstep(.5,1.2,slope));
        // Fissures stay a close-up detail: at distance their isolines read as organic cells.
        float detail=.24*k3*surfaceCrack(n3.x+.4*k4*n4.x,fp,3.)+.16*k4*surfaceCrack(n4.x,fp,.8);
        // Fall-line wear (chutes and ribs), weighted by biome: alone it reads as threads.
        float steep=sstep(.12,.5,slope);
        if(surfaceStreakWeight>.01){
          float wear=0.;
          for(int k=0;k<3;k++){
            if(k==1&&k1<=0.||k==2&&k2<=0.)continue;
            float chute=surfaceChute(world,k==0?26.:k==1?9.:3.2,k==0?15.:k==1?5.4:1.9,salt+61u+uint(k));
            if(k==0)wear=.06*(1.-sstep(14.,30.,fp))*chute;else if(k==1)wear+=.045*k1*chute;else wear+=.04*k2*chute;
          }
          detail+=steep*surfaceStreakWeight*wear;
        }
        // Jointed blocks on outcrops and cliffs, not on rocky plains: a tone and a face tilt per
        // block, dark joints once resolved. Bands follow the 40/11/3 m fades of the mottle.
        float blocky=surfaceFacetWeight*sstep(.1,.4,slope);
        if(blocky>.01){
          float block=0.;vec2 tilt=vec2(0.);
          for(int k=0;k<3;k++){
            if(k==1&&k2<=0.||k==2&&k3<=0.)continue;
            float size=k==0?40.:k==1?11.:3.;vec4 f=surfaceFacets(world/size,salt+71u+uint(k));float joint=surfaceJoint(f.y,fp/size);
            if(k==0){block=.10*k1*f.x-.12*k1*joint;tilt=.5*k1*f.zw;}
            else if(k==1){block+=.08*k2*f.x-.12*k2*joint;tilt+=.4*k2*f.zw;}
            else{block+=.06*k3*f.x-.10*k3*joint;tilt+=.3*k3*f.zw;}
          }
          detail+=blocky*block;surfaceMicroSlope+=rock*blocky*tilt;
        }
        tone+=rock*relief*detail;
        // Bed lines on faces; the period seen on the ground is the bed thickness over the slope.
        float face=rock*sstep(.35,.9,slope)*surfaceStrataWeight;float rate=slope+.2;
        if(face>.01){
          vec3 beds=vec3(0.);
          for(int k=0;k<3;k++){float t=k==0?18.:k==1?4.5:1.1;beds[k]=surfaceBed(surfaceRise/t,salt+41u+uint(k))*(1.-sstep(.125,.25,fp*rate/t));}
          float b1=beds.x;float b2=beds.y;float b3=beds.z;
          tone+=face*relief*(.24*b1+.18*b2+.12*b3);
        }
      }
      // Scree rests at the angle of repose, between soil and cliff; gravel on open soil.
      float talus=sstep(.22,.42,slope)*(1.-sstep(.8,1.2,slope))*(1.-.85*grass);float clastic=max(talus,.55*soil);
      for(int k=0;k<3;k++){
        if(k==0&&!(talus>.01&&fp<1.3)||k==1&&!(talus>.01&&fp<1.3&&fp<.34)||k==2&&!(clastic>.01&&fp<.09))continue;
        vec2 st=surfaceStones(world/(k==0?2.9:k==1?.78:.21),salt+51u+uint(k));
        if(k==0)tone+=talus*(1.-sstep(.6,1.3,fp))*(.30*st.x-.2*(.27-st.y));
        else if(k==1)tone+=talus*(1.-sstep(.16,.34,fp))*(.26*st.x-.16*(.27-st.y));
        else tone+=clastic*(1.-sstep(.045,.09,fp))*(.22*st.x-.12*(.27-st.y));
      }
      // Add centred detail instead of multiplying correlated bands.
      surfaceMicroTone=hue*clamp(tone,.55,1.45)+surfaceGroundCover(world,slope,fp,rock,grass,salt,n1,n2);
      surfaceMicroSlope+=surfaceGroundSlope;
      return surfaceMicroTone;
    }
    // (unit-variance pattern of the resolved octaves, retained variance fraction).
    // Octaves under 8 samples per wavelength fade out, then are skipped: closer
    // to Nyquist they read as grain rather than detail.
    vec2 surfaceFbm(vec3 p,float scale,int octaves,float footprint,uint salt){
      float value=0.;float kept=0.;float total=0.;float s=scale;float a=1.;
      for(int i=0;i<octaves;i++){
        if(uQuality>0&&i>=1)break;
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
    // Beach width (m). The climate sets the sand supply: wide strands on warm coasts (about 100 m), narrow
    // fringes on cold ones (about 30 m). Noise only varies it along the coast around that mean: gating it on
    // the 20 km and 4.8 km octaves left every small map (near the world origin, where they are ~0) with a
    // 10-20 m strip that crowns covered. Height, slope and openness then shrink it to nothing on cliffs.
    // Mirrored in terrainForestBeach.ts and magna_urbis_terrain::forest_beach (crown exclusion).
    float surfaceBeachWidth(vec2 reach,vec2 grove,vec2 fine,float openness){
      float supply=40.+80.*sstep(8.,22.,uMaterialClimate.x);
      float along=sstep(-.8,.8,.65*reach.x*sqrt(reach.y)+.5*grove.x*sqrt(grove.y));
      return supply*(.4+.8*along)*sstep(.15,.4,openness)*(1.+.35*fine.x*sqrt(fine.y));
    }
    // Fixed physical reference for V2 crown roots, independent of the viewport.
    float surfaceRootBeach(vec3 s,vec2 world,float shore,float openness){
      vec3 point=vec3(world,0.);float fp=30.;
      vec2 f[3];for(int k=0;k<3;k++)f[k]=surfaceFbm(point,k==0?20000.:k==1?4800.:240.,k==0?3:4,fp,uMaterialSeed+(k==0?7u:k==1?3u:5u));
      vec2 reach=f[0];vec2 grove=f[1];vec2 fine=f[2];
      float width=surfaceBeachWidth(reach,grove,fine,openness);
      return clamp((min(width,20.*fp)-shore+fp)/fp,0.,1.)*(1.-sstep(4.,12.,s.x))*(1.-sstep(.2,.5,length(s.yz)));
    }
    float surfaceSeason(){return 1.0;}
    float surfaceSeaIce(vec3 point,float ts0,float tw0,float footprint){
      vec2 regional=surfaceFbm(point,64000.,4,footprint,uMaterialSeed+1u);float m1=regional.x*sqrt(regional.y);
      float ts=clamp(ts0,-45.,45.);float tw=clamp(tw0,-45.,45.);float now=tw+(ts-tw)*surfaceSeason();
      return clamp(sstep(-1.5,-6.,now+.4*m1)*1.,0.,1.)*.9;
    }
    ${WATER_MATERIAL_GLSL}
    vec3 surfaceOcean(float height,vec3 color,float now,float m1,float variation){
      if(height>=0.){return clamp(color,vec3(0.),vec3(1.));}
      float ice=clamp(sstep(-1.5,-6.,now+.4*m1)*1.,0.,1.)*.9;
      return clamp(surfaceWater(max(-height,0.),ice)*(1.+.04*variation*m1),vec3(0.),vec3(1.));
    }
    // Climate: sea-level seasonal temperatures/lapse and seasonal precipitation.
    // bare=true returns the substrate shown by the Soil layer.
    vec3 surfaceMaterial(float height,vec2 gradient,float tpi,vec3 point,vec2 north,float footprint,vec3 soil,vec3 pedology,float sandFraction,float ts0,float ps,float ls,float tw0,float pw,float lw,bool bare,float shore,float openness){
      surfaceGroundGradient=gradient;surfaceGroundHeight=height;surfaceGroundShore=1e9;surfaceGroundBeach=0.;surfaceGroundEnv=vec4(0.);
      float season=.5;float variation=1.;float forestAmount=1.;float rockTan=tan(radians(40.));
      float snowAmount=1.;float moisture=0.;
      uint salt=uMaterialSeed;float fp=footprint;float phase=surfaceSeason();float h=max(height,0.);
      float materialDetail=sstep(30.,60.,fp)*(1.-sstep(120.,240.,fp));
      // The seven fields from one loop (salts +1..+7), one inlined surfaceFbm instead of seven:
      // regional, regional2 (shifted), grove, crag, fine, province, and the beach reach used further down.
      vec2 fields[7];
      for(int k=0;k<7;k++){
        float scale=k==0?64000.:k==1?48000.:k==2?4800.:k==3?700.:k==4?240.:k==5?900000.:20000.;
        fields[k]=surfaceFbm(k==1?point+vec3(5101.,-2297.,3313.):point,scale,k>=5?3:4,fp,salt+1u+uint(k));
      }
      vec2 regional=fields[0];vec2 regional2=fields[1];vec2 grove=fields[2];vec2 crag=fields[3];vec2 fine=fields[4];vec2 province=fields[5];
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
      float groveTone=grove.x*sqrt(grove.y);float cragTone=crag.x*sqrt(crag.y);float fineTone=fine.x*sqrt(fine.y);
      vec3 lith=surfaceLithology(point.xy,h,grade,fp,m1,m2,groveTone,cragTone,salt);
      float lithLuma=dot(lith,vec3(.2126,.7152,.0722));float frost=1.-sstep(2.,10.,tHot);
      // Soil is the rock beneath it, weathered and darkened by moisture.
      vec3 weathered=surfaceMix(lith,vec3(lithLuma),.25)*vec3(.78,.68,.56)*(1.-.22*sstep(.8,2.2,humid));
      // Substrate: transported regional soil, zonal soils, geological provinces.
      vec3 ground=(bare?soil:surfaceMix(pedology,weathered,.45));
      vec3 sand=surfaceMix(surfaceMix(vec3(.80,.66,.46),vec3(.70,.50,.33),sstep(-.3,.5,pv)),weathered*1.25,.35);
      vec3 desert=surfaceMix(vec3(.55,.46,.36),sand,sstep(-.4,.4,m2+.6*groveTone+1.5*sandFraction-.5-.8*grade/rockTan));
      ground=surfaceMix(ground,desert,arid*(bare?.8:.6));
      ground=surfaceMix(ground,vec3(.50,.29,.17),wTrop*sstep(1.,2.,humid)*(bare?.6:.5));
      float steppe=(1.-arid)*(1.-wTrop)*(1.-wBoreal)*sstep(.8,1.2,humid)*(1.-sstep(1.6,2.4,humid));
      ground=surfaceMix(ground,vec3(.25,.21,.16),steppe*(bare?.5:.35));
      ground=surfaceMix(ground,ground*vec3(.86,.90,.96),frost*.6);
      ground=ground*(1.-.12*valley+.08*ridge);
      ground=ground*(1.+variation*(.035*m1*locality+.045*groveTone+.05*fineTone));
      // Deserts stain rock with iron or dark varnish; frost pales it to a cold grey.
      vec3 rock=surfaceMix(lith,surfaceMix(lith*vec3(.70,.66,.62),lith*vec3(1.1,.84,.64),sstep(-.2,.6,m2+.5*groveTone)),arid*.8);
      rock=surfaceMix(rock,surfaceMix(rock,vec3(lithLuma),.55)*vec3(.92,.96,1.03),frost*.7);
      rock=rock*(1.-.14*sstep(1.2,3.,humid));
      // Rock colouring weights per biome: strata dominate bare arid (sedimentary) ranges and stay
      // present in temperate ones; fall-line streaks belong to cold ranges; blocks are everywhere,
      // a little softer under frost.
      surfaceStrataWeight=ROCK_STRATA*(.3+.7*arid)*(1.-.5*frost)*(.45+.55*surfaceBedded);
      surfaceStreakWeight=ROCK_STREAKS*mix(.4,1.,frost)*(1.-.3*arid);
      surfaceFacetWeight=ROCK_FACETS*mix(1.,.6,frost);
      // Strata of the stratigraphic height (elevation, a gentle regional dip and a low-frequency
      // warp): formation tones of 280 and 70 m beds, and the fine 90 m banding of desert ranges,
      // its contrast set by the formation. Their period on the ground shortens with the slope,
      // hence the filters; the smooth banding fades later, as it cannot alias into blocks.
      float layered=0.,blocks=0.;
      if(uQuality==0){
      float bedRate=fp*(grade+.2);
      // Beds of uneven thickness and tone: a sine of the height drew evenly spaced contour
      // rings on every cone or crater wall.
      float banding=2.*surfaceBed(surfaceRise/90.+.9*surfaceBed(surfaceRise/53.,salt+28u),salt+29u)*(1.1+.8*surfaceBed(surfaceRise/280.,salt+26u))*(1.-sstep(.25,.45,bedRate/90.));
      layered=(.24*surfaceBed(surfaceRise/280.,salt+24u)*(1.-sstep(.125,.25,bedRate/280.))+.16*surfaceBed(surfaceRise/70.,salt+25u)*(1.-sstep(.125,.25,bedRate/70.))+.09*banding)*surfaceStrataWeight;
      // Jointed blocks at map scale: one tone per ~150 m block on rocky slopes, faded to the
      // zero mean below 4 samples per block. Close-range blocks continue in surfaceMicro.
      float blockKeep=(1.-sstep(19.,38.,fp))*sstep(rockTan*.2,rockTan*.6,grade)*surfaceFacetWeight;
      if(blockKeep>.01)blocks=.08*blockKeep*surfaceFacets(point.xy/150.,salt+27u).x;
      }
      // Debris and shore sediment take the rock's colour, not its beds.
      vec3 rockPlain=rock;
      rock=rock*(1.+variation*(layered+blocks+.07*cragTone))*(vec3(1.)+variation*layered*vec3(.25,0.,-.3));
      // Debris shed by the rock above reaches the soil of the talus slopes.
      ground=surfaceMix(ground,rockPlain*1.06,.4*sstep(.22,.42,grade)*(1.-sstep(.8,1.2,grade)));
      surfaceRockTone=rock;surfaceSoilTone=ground;
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
      // Hollows and shaded slopes stay lush, sunlit ones parch. A zero-mean tint:
      // green saturates in humid climates. The lit side is the one of V2 exposure.
      float slopeNow=length(gradient);float sunward=gradient.y/max(.2,slopeNow)*sstep(.03,.25,slopeNow);
      surfaceHerbTone=vec3(1.)-clamp(.75*groveTone+.7*fineTone-.7*sunward+.7*valley-.4*ridge,-1.,1.)*vec3(.19,.07,0.);
      grass=grass*surfaceHerbTone;
      float herbs=sstep(.2,.85,humid)*sstep(0.,7.,tHot)*(1.-sstep(rockTan*.8,rockTan*1.4,grade));
      // Grasses and shrubs thin out diffusely; only canopy forms crisp stands.
      vec2 sward=(fine.y>0.?fine:grove);
      color=surfaceMix(color,grass,surfaceCover(herbs*(1.-outcrop),sward,.12*variation));
      float dryForest=1.-sstep(1.3,3.,humid);
      vec3 canopy=surfaceMix(vec3(.20,.28,.14),vec3(.16,.255,.13),wTrop);
      canopy=surfaceMix(canopy,vec3(.15,.22,.16),wBoreal);
      canopy=surfaceMix(canopy,vec3(.27,.29,.17),dryForest*.75);
#ifdef RENDER3D_FOREST
      vec3 guideLeafCanopy=canopy;
#endif
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
      // Beaches: a strip along open water (none beside ponds), 30-190 m wide by
      // climate, with a ragged inner edge, as area coverage (visible at 240 m
      // samples); low flats behind it stay as wetter river/estuary bars.
      vec2 reach=fields[6];
      float width=surfaceBeachWidth(reach,grove,fine,openness);
      float beachLimit=20.*fp;
#ifdef RENDER3D_FOREST
      if(uRenderV2>0)beachLimit=20.*max(fp,30.);
#endif
      float beach=clamp((min(width,beachLimit)-shore+fp)/fp,0.,1.)*(1.-sstep(4.,12.,height))*(1.-sstep(.2,.5,grade));
      // Sediment follows the coast's geology: quartz or golden sand by province,
      // tropical coral sand, and local stone on cool or rugged coasts. Summer
      // warmth preserves sandy continental coasts despite their winter frost.
      // Reuse slope/TPI and resolved noise, with no additional samples or FBM.
      float shingle=max(1.-sstep(4.,14.,tHot),sstep(.04,.22,grade)*terrain);
      vec3 sediment=surfaceMix(vec3(.80,.75,.61),vec3(.76,.63,.43),sstep(-.2,.9,pv));
      sediment=surfaceMix(sediment,vec3(.86,.84,.76),wTrop*sstep(0.,-.8,pv)*.7);
      sediment=surfaceMix(sediment,rockPlain,shingle*.9);
      sediment=surfaceMix(sediment,surfaceMix(ground,rockPlain,.4),sstep(-.9,-1.5,m2)*.85);
      sediment=surfaceMix(sediment,vec3(.27,.26,.25),sstep(1.25,1.75,m1+.35*shingle)*.9);
      color=surfaceMix(color,sediment*.9,flats*(1.-sstep(240.,960.,fp))*.8);
      color=surfaceMix(color,sediment,beach*.8);
#ifdef RENDER3D_FOREST
      // V2 keeps the existing ground while applying its own calendar.
      renderGuideBaseOpen=guideOpen;
      renderGuideBaseClosed=guideLeafCanopy*tint*(1.-.18*highland)*(1.+variation*canopyDetail)*(1.-.06*valley);
      guideOpen=surfaceMix(surfaceMix(renderGuideBaseOpen,sediment*.9,flats*(1.-sstep(240.,960.,fp))*.8),sediment,beach*.8);
      renderGuideBeach=beach*.8;renderGuideSediment=sediment;
      renderGuideFlats=flats*(1.-sstep(240.,960.,fp))*.8;
      renderGuideShore=shore;renderGuideOpenness=openness;
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
      surfaceGroundEnv=vec4(humidNow,green,arid*sandFraction,snow);
      surfaceGroundBeach=beach;
      if(openness>.02||beach>.01)surfaceGroundShore=shore;
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
  return surfaceMaterial(s.x,s.yz,tpi,vec3(world,0.),vec2(0.),fp,soil,soil,.5,t+6.,p*.5,.0065,t-6.,p*.5,.0065,false,shore,openness);
}
`;
