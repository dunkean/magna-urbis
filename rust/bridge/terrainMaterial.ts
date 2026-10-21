import { WATER_MATERIAL_GLSL } from '../../web/src/render/terrainWater';

// Material compositor ported from Neural Earth web/terrain_renderer.js (GPL-3.0).
// Original blending, noise, coverage and palettes; local climate/substrate adapter below.
export const NEURAL_EARTH_MATERIAL_GLSL = `
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
    ${WATER_MATERIAL_GLSL}
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
#ifdef RENDER3D_FOREST
      // Render3D's canonical forest replaces this canopy (and its snow thinning).
      float woods=uForest==0?surfaceCover(clamp(trees,0.,1.),grove,.65*variation):0.;
#else
      float woods=surfaceCover(clamp(trees,0.,1.),grove,.65*variation);
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
      return surfaceOcean(height,color,now,m1,variation);
    }

vec3 earthMaterial(vec3 s,vec2 world,float fp,float tpi,float shore,float openness){
  float t=uMaterialClimate.x;
  float p=uMaterialClimate.y;
  // The bench has a regional annual climate, without Neural Earth's soil atlases.
  float arid=1.-sstep(.35,1.,p/max(20.*t+280.,120.));
  vec3 soil=mix(vec3(.34,.29,.22),vec3(.70,.50,.33),arid);
  return surfaceMaterial(s.x,s.yz,tpi,vec3(world,0.),vec2(0.),fp,soil,soil,vec3(.50,.48,.45),.5,t+6.,p*.5,.0065,t-6.,p*.5,.0065,false,shore,openness);
}
`;
