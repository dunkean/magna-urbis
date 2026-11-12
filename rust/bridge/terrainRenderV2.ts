import { RENDER_V2_ENVIRONMENT_GLSL, RENDER_V2_CANOPY_MEAN_GLSL } from './terrainRenderV2Environment';

/** Shared environmental appearance. The local adapter has one annual climate,
 * so the north-hemisphere seasonal amplitude below is a declared proxy. */
export const RENDER_V2_GLSL = `${RENDER_V2_ENVIRONMENT_GLSL}
${RENDER_V2_CANOPY_MEAN_GLSL}
GroundMaterial v2MeanOpen,v2MeanLitter,v2MeanCrown;
vec3 v2MeanWeights=vec3(1.,0.,0.);
float v2FlatSedimentExposure(float herbs,float shore,float openness){
  // Existing retained shore proxy, qualified by actual nearby seawater.
  // Keep coastal bars/islets bare; recolonize progressively inland.
  float coastal=(1.-groundSmooth(160.,400.,shore))*groundSmooth(0.,.15,openness);
  return 1.-herbs*(1.-coastal);
}
// Climate zone reweighting of the shared fields (see terrainRenderV2Zones).
// Low flat ground of wet zones holds a water table: a mottled mosaic of wet
// meadow, bog or paddy, never a uniform sheet. Diagnostics see the same fields.
// v2ZoneWet and v2ZoneBare are declared in FOREST_PRELUDE_GLSL: the forest code reads them too.
void v2ZoneEnv(inout V2Env e,vec3 s,vec2 world,float tpi,float fp){
  int z=v2Zone();vec4 F=V2_ZONE_FOREST[z],S=V2_ZONE_SOIL[z];
  float slope=length(s.yz),level=1.-sstep(.012,.06,slope);
  float low=max(sstep(0.,-.05,tpi),sstep(35.,6.,s.x));
  float mottle=v2Pattern(vec3(world,0.),900.,fp,uMaterialSeed+701u);
  v2ZoneWet=clamp(F.w*v2SeasonWet(),0.,1.)*level*low*(.35+.65*sstep(-.6,.5,mottle))*step(0.,s.x)*(1.-e.snow);
  e.moisture=clamp(e.moisture+1.6*v2ZoneWet,0.,4.);
  e.sand=clamp(e.sand+S.y*(1.-sstep(.1,.5,slope))*(1.-v2ZoneWet),0.,1.);
  // Exposed rock: steep slopes, and knobs/ridges broken by the same mottle
  // (glaciated outcrops, scree, limestone pavements). Stands open over it.
  // Real relief only: on a plain the sign of tpi is the terrain's micro-relief, and rock would freckle the whole ground.
  float knob=sstep(0.,.08,tpi)*sstep(-.1,.5,mottle)*sstep(.05,.2,slope);
  float rock=clamp(S.x*max(sstep(.05,.35,slope),.75*knob)*(1.-v2ZoneWet),-e.rock,1.-e.rock);
  v2ZoneBare=clamp(max(rock,0.)+.7*v2ZoneWet,0.,1.);
  // Zone treeline: an open herbaceous belt (alpine pasture, tundra) below the
  // climatic tree limit, from the same warm-season lapse proxy as the field.
  float shift=V2_ZONE_WET[z].a;
  if(shift>0.){
    float warm=uMaterialClimate.x-.0065*max(s.x,0.)+6.+.5*max(0.,10.-uMaterialClimate.x);
    float above=1.-sstep(6.+shift,8.+shift,warm);
    v2ZoneBare=max(v2ZoneBare,above);
    e.grass=max(e.grass,above*sstep(-1.,3.,warm)*(1.-e.rock)*(1.-e.snow));
  }
  e.rock+=rock;e.grass=clamp(e.grass*S.w*(1.-max(rock,0.)),0.,1.);
  e.organic=clamp(e.organic+S.z*(.4+.6*v2ZoneWet),0.,max(1.-e.sand-e.clay,0.));
  if(uForest==0){e.woody*=F.x;e.needle=mix(e.needle,F.y,F.z);}
}
// Zone substrate and herbaceous classes over the retained climate material.
vec3 v2ZoneOpen(vec3 c,V2Env e,vec2 world,float fp){
  int z=v2Zone();vec4 sw=V2_ZONE_SWARD[z],bare=V2_ZONE_BARE[z],can=V2_ZONE_CANOPY[z];
  float cover=e.grass*(1.-e.rock);
  // Stand tone also varies the substrate (gravel plains, pale pavements).
  c=mix(c,mix(bare.rgb*(.86+.28*e.tone)*surfaceMicroTone,sw.rgb*surfaceHerbTone*surfaceMicroTone,cover),mix(bare.a*(1.-.8*clamp(e.rock,0.,1.)),sw.a,cover));
  // Scrub/grove patches (garrigue, acacia parkland); the unresolved pattern
  // converges to its mean.
  vec3 p=vec3(world,0.);
  float speck=0.;
  if(uQuality==0)speck=.45*v2Pattern(p,1600.,fp,uMaterialSeed+711u)+.35*v2Pattern(p,220.,fp,uMaterialSeed+713u)+.2*v2Pattern(p,60.,fp,uMaterialSeed+717u);
  c=mix(c,vec3(.27,.30,.20)*can.rgb,can.a*cover*(.3+.5*sstep(-.4,.6,speck)));
  // Wet parcels (polder strips, paddies, bog pools): one hash per rotated
  // cell, faded to its mean once a parcel is below about two pixels.
  vec2 q=mat2(.94,.34,-.34,.94)*world/vec2(170.,75.);
  uint h=groundHash(ivec3(ivec2(floor(q)),709),uMaterialSeed);
  float u1=float(h&255u)/255.,u2=float((h>>8u)&255u)/255.,keep=1.-sstep(60.,170.,fp);
  vec3 wet=V2_ZONE_WET[z].rgb;
  vec3 parcel=mix(wet*(.82+.36*u1),u2>.7?vec3(.49,.46,.32):u2<.1?vec3(.20,.27,.28):wet,.55);
  wet=mix(wet,parcel,keep);
  return mix(c,wet,.8*v2ZoneWet);
}
// Neural Earth sizes its pack for a planet; on a local map the same floes come in at ship scale.
// Rivers and lakes keep their own freeze (rendered along their outline elsewhere); the sea pack breaks into smaller cakes.
const float V2_ICE_ZOOM=5.,V2_SEA_ICE_ZOOM=8.;
// Temperature follows the sun by about a month: spring is colder than autumn.
const float V2_SEASON_LAG=.08;
uniform vec4 uV2GlacierSources[8];
float v2GlacierProximity(vec2 world){
  // Light display uses the first retained source as its distance approximation.
  if(uQuality>0)return uV2GlacierSources[0].z*(1.-sstep(0.,80000.,distance(world,uV2GlacierSources[0].xy)));
  float source=0.;for(int i=0;i<8;i++)source=max(source,uV2GlacierSources[i].z*(1.-sstep(0.,80000.,distance(world,uV2GlacierSources[i].xy))));return source;
}
V2Env v2Local(vec3 s,vec2 world,float tpi,float footprint){
  float annual=uMaterialClimate.x-.0065*max(s.x,0.);
  // Same continental growing-season proxy as the canonical forest field.
  float amplitude=6.+.5*max(0.,10.-uMaterialClimate.x);
  float rain=uMaterialClimate.y;
  float arid=1.-sstep(.35,1.,rain/max(120.,20.*uMaterialClimate.x+280.));
  float bank=uForest==1?forestBankCover(world,max(1.,footprint)):0.;
  vec3 year=v2Zoned()?v2SeasonClimate():vec3(0.);
  V2Env e=v2Evaluate(vec3(world,0.),s.x,s.yz,tpi,annual+amplitude,annual-amplitude-year.y,rain*.5*(1.+year.x),rain*.5*(1.-year.x),.15+.50*arid,bank,fract(uV2Season+1.-V2_SEASON_LAG),footprint,uMaterialSeed);
  // A thawing zone raises its snow line; the perennial floor of the summits stays.
  float thaw=v2Zoned()?v2SeasonThaw():0.;
  if(thaw!=0.){
    float warmest=annual+amplitude,coldest=annual-amplitude-year.y,supply=clamp(rain/max(120.,10.*(warmest+coldest)+280.),0.,5.),slope=length(s.yz);
    e.snow=max(v2Snow(e.temperature+thaw,supply,slope,sstep(0.,-.10,tpi)),v2PerennialSnow(warmest+.65*(e.exposure-.5),supply,slope));
  }
  // Snow is a continuous coverage, not a mask: thin snow is a translucent dusting, then a full cover, with soft
  // transitions. Relief draws its large-scale pattern at the terrain's own scale: altitude and season (e.snow),
  // hollows and couloirs (300 m TPI) keep snow, ridges and spurs lose it, pole-facing slopes keep it, steep faces
  // shed it (slope retention of v2Snow). Noise only shifts the limit a little, in three rotated isotropic octaves
  // of 640, 300 and 140 m: on open flat ground partial snow reads as broad drifts, never as spots or bands.
  float slope=length(s.yz),steep=sstep(.35,.9,slope);
  float window=sstep(0.,.2,e.snow)*(1.-sstep(.85,1.,e.snow)),bend=0.;
  if(window>0.){
    float drift=0.;
    if(uQuality==0)drift=.55*v2Pattern(vec3(mat2(.80,.60,-.60,.80)*world,0.),640.,footprint,uMaterialSeed+723u)
      +.30*v2Pattern(vec3(mat2(.31,-.95,.95,.31)*world,0.),300.,footprint,uMaterialSeed+724u)
      +.15*v2Pattern(vec3(mat2(-.70,.71,-.71,-.70)*world,0.),140.,footprint,uMaterialSeed+725u);
    float relief=mix(.16,.24,steep)*(sstep(0.,-.10,tpi)-sstep(0.,.10,tpi))-.08*s.z/max(.2,slope)*(1.-sstep(.35,.8,slope));
    bend=(mix(.12,.30,v2SeasonSnowPatches())*drift+relief)*window;
  }
  e.snow=sstep(.325,.575,e.snow+bend);   // a defined drift edge, soft over the relief's own scale
  if(uForest==1){vec4 f=forestField(world,0.);e.woody=f.r;e.height=f.g*50.;e.needle=f.b;e.leaf=mix(e.leaf,1.,e.needle);}
  // The zone's calendar sets leaf fall: a temperature proxy leaves oaks in leaf through a mild winter.
  if(v2Zoned())e.leaf=mix(v2SeasonLeaf(),1.,e.needle);
  v2ZoneWet=0.;v2ZoneBare=0.;if(v2Zoned())v2ZoneEnv(e,s,world,tpi,footprint);
  // Construction excludes tree roots, not the surrounding soil/grass response: changing it made a pale pad per house.
  if(uHasOccupation==1){vec2 uv=(world-uOccupationRect.xy)/uOccupationRect.z;if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){int cls=int(groundOccupation(world).z);if(cls==8)e.woody=0.;}}
  float water=forestWaterCoverage(world);e.woody*=1.-water;e.grass*=1.-water;
  // Preserve the retained physical beach footprint at every detail level.
  // Its 0.8 factor belongs to legacy colour blending, not vegetation cover.
  float beach=clamp(renderGuideBeach/.8,0.,1.);
  e.woody*=1.-beach;e.grass*=1.-beach;e.rock*=1.-beach;
  return e;
}
// The *Env forms take an environment the caller evaluated once: D3D11 (FXC) inlines every
// call, and each v2Local copy costs it over a minute of shader compilation.
GroundMaterial v2GroundEnv(V2Env local,vec3 s,vec2 world,float footprint,vec3 light,vec3 light2,float strength,vec3 macroOpen){
  float macroWoods=renderGuideWoods*(1.-clamp(renderGuideBeach/.8,0.,1.));
  vec3 baseClosed=renderGuideBaseClosed;
  if(v2Zoned()){macroWoods=min(macroWoods*V2_ZONE_FOREST[v2Zone()].x,1.);baseClosed*=V2_ZONE_CANOPY[v2Zone()].rgb;}
  // Render's macro woods ignore the V2 stands (measured ~.05-.1 over a dense nordic taiga), and every unresolved
  // zoom shows this reference: under snow the missing canopy reads as a pale grey floor. Snowy stands take the
  // forest field's own cover, filtered to the footprint; snow-free ground keeps the reference as it was.
  vec2 woodsUv=(world-uForestRect.xy)/uForestRect.z;float snowStands=0.;
  if(uForest==1&&local.snow>0.&&all(greaterThanEqual(woodsUv,vec2(0.)))&&all(lessThanEqual(woodsUv,vec2(1.)))){
    float cell=uForestRect.z/float(textureSize(uForestField,0).x);
    float stands=forestField(world,max(log2(max(footprint,.02)/cell),0.)).r*(1.-clamp(renderGuideBeach/.8,0.,1.));
    macroWoods=mix(macroWoods,max(macroWoods,stands),local.snow);snowStands=stands*local.snow;
  }
  V2Env e=v2Appearance(local,footprint);v2Foliage=e.leaf;v2GroundSnow=e.snow;
  // Retained macro canopy is the occupation/gallery fallback. Natural stands
  // below use population-weighted open, litter and intrinsic crown responses.
  float woods=(uForest==1?macroWoods:e.woody)*e.leaf*(1.-v2ZoneBare);
  // The zone's bare outcrops (nordic slopes) must not strip stands the crowns still draw when resolved.
  woods=max(woods,snowStands*e.leaf);
  // One retained material mean at every footprint. Resolution reveals only
  // surface detail; it must not replace the soil with another palette.
  vec3 opened=v2GroundTint(macroOpen,e);
  if(v2Zoned()){opened=v2ZoneOpen(opened,e,world,footprint);opened*=mix(vec3(1.),v2SeasonHerb(),max(e.grass,.3)*(1.-e.rock));}
  // A low alluvial plain is not necessarily exposed sediment. Potential
  // herbaceous cover recolonizes it; the physical beach remains separate.
  opened=mix(opened,renderGuideSediment*.9,renderGuideFlats*v2FlatSedimentExposure(e.grass,renderGuideShore,renderGuideOpenness));
  // Snow surface: soft isotropic undulation and fine grain, resolved in metres and faded before aliasing
  // (no stretched wind ridges: at map scale they read as parallel stripes).
  float snowDrift=0.,snowGrain=0.;
  if(uQuality==0&&e.snow>0.){snowDrift=v2Pattern(vec3(mat2(.80,.60,-.60,.80)*world,0.),11.,footprint,uMaterialSeed+726u);snowGrain=v2Pattern(vec3(world,0.),3.2,footprint,uMaterialSeed+727u);}
  vec3 snowColor=vec3(.88,.91,.91)*(1.+.035*clamp(snowDrift*1.7,-1.,1.)+.018*snowGrain);
  opened=mix(opened,snowColor,e.snow);
  opened=mix(opened,renderGuideSediment,clamp(renderGuideBeach/.8,0.,1.)*(1.-e.snow));
  V2Env canopyPhase=e;canopyPhase.snow=0.;
  V2Env leafOn=canopyPhase;leafOn.leaf=1.;
  // Retain Render's canopy mean. V2 supplies the seasonal change rather than
  // a second absolute palette with a different exposure in the same biome.
  vec3 closed=baseClosed*v2Canopy(canopyPhase)/max(v2Canopy(leafOn),vec3(.02));
  v2CrownGuide=closed;
  // Integrate the intrinsic normals/AO of unresolved crowns. The guide for
  // actual resolved crowns below retains its original material, not this mean.
  // Snow frosts bare limbs heavily; conifer crowns hold a light load and stay dark over the white floor.
  float frost=e.snow*mix(.62,.22,e.needle);
  vec3 meanClosed=closed;
  if(uQuality==0)meanClosed=closed*mix(vec3(1.),v2CanopyMeanRatio(closed,e.needle,light,light2,strength),1.-e.snow*(1.-e.needle));
  closed=mix(closed,vec3(.72,.79,.77),frost);
  meanClosed=mix(meanClosed,vec3(.72,.79,.77),frost);
  // Legacy sediment is composed after the unresolved canopy. Resolved crowns
  // above those flats retain their own material when applyForest reveals them.
  v2MacroCanopy=mix(meanClosed,renderGuideSediment*.9,renderGuideFlats*(1.-e.snow));
  // Shared analytic micro-normal bands. Herbaceous sward has very low height;
  // no scaled tree crowns are used as grass blades.
  GroundMaterial m;
  vec4 detail=groundField(vec3(world.x,0.,world.y),uMaterialSeed,footprint);
  float gain=mix(.02+.43*e.rock+.07*(1.-e.grass),.008,e.snow);
  m.normal=normalize(vec3(-s.y-detail.y*gain,1.,-s.z-detail.w*gain));
  float sward=clamp(detail.x*4.,-1.,1.)*.025*e.grass*(1.-e.snow)*groundVisibility(.32,footprint);
  float form=clamp(detail.x*10.,-1.,1.);
  v2FloorModulation=1.+form*mix(mix(.04,.06,e.rock),.006,e.snow)+sward;
  v2MacroNormal=normalize(vec3(-s.y,1.,-s.z));
  // Inside snowy conifer stands the floor between crowns is intercepted and shaded, and the canopy keeps a
  // stand-scale grain: an unresolved taiga reads dark and textured over white clearings, not as a grey blanket.
  vec3 standFloor=mix(opened,opened*vec3(.45,.48,.50)+vec3(.03,.04,.03),snowStands*e.needle);
  float crownGrain=1.;
  if(uQuality==0)crownGrain=1.+snowStands*(.22*v2Pattern(vec3(world,0.),45.,footprint,uMaterialSeed+761u)+.14*v2Pattern(vec3(world,0.),14.,footprint,uMaterialSeed+762u));
  m.albedo=mix(forestFloorAlbedo(standFloor),groundToLinear(v2MacroCanopy)*crownGrain,woods);
  m.roughness=clamp(pow(pow(mix(.88,.54,e.rock),4.)+gain*gain*groundSlopeVariance(footprint),.25),.4,.98);
  m.occlusion=clamp(1.-.10*max(-detail.x*12.,0.)*e.rock,.8,1.);
  v2MeanEnabled=0.;v2ForestReveal=0.;
  v2MeanOpen=m;v2MeanOpen.albedo=forestFloorAlbedo(opened);
  v2MeanLitter=v2MeanOpen;v2MeanCrown=v2MeanOpen;v2MeanWeights=vec3(1.,0.,0.);
  vec2 forestUv=(world-uForestRect.xy)/uForestRect.z;
  // Natural stands use the population raster. Occupation and narrow bank
  // galleries retain their existing explicit contracts.
  if(uQuality==0&&uForest==1&&uHasOccupation==0&&forestBankCover(world,max(1.,footprint))<.001&&all(greaterThanEqual(forestUv,vec2(0.)))&&all(lessThanEqual(forestUv,vec2(1.)))){
    float cell=uForestRect.z/float(textureSize(uForestField,0).x);
    // The progressive population profile supplies gradual stand edges; its
    // mean needs only the physical pixel footprint, not an extra blur mip.
    vec4 f=forestField(world,max(log2(max(footprint,.02)/cell),0.));
    ForestStand st;st.orchard=false;st.rows=vec2(1.,0.);st.p=world;st.cover=f.r;st.height=f.g*50.;st.needle=f.b;st.tone=f.a;
    float T=uMaterialClimate.x,humid=uMaterialClimate.y/max(20.*T+280.,120.);
    st.trop=groundSmooth(13.,19.,T-6.);st.dry=1.-groundSmooth(.8,2.,humid);
    vec3 kind=forestKind(st.trop,st.dry);
    st.kappa=mix(.25,.78,groundSmooth(.9,1.8,humid))*mix(.55,1.,groundSmooth(3.,10.,st.height))*mix(1.,.85,st.needle)*(1.-.6*st.trop)*(1.-.5*kind.x)*(1.-.85*kind.z);
    st.open=-1e3;st.forced=-1e3;st.allow=0.;st.hedge=0.;
    float d=forestDensity(st.cover,st.kappa),share=st.cover/max(d,1e-3);
    float available=(1.-clamp(renderGuideBeach/.8,0.,1.))*(1.-forestWaterCoverage(world))*(1.-v2ZoneBare);
    float canopy=st.cover*e.leaf*available;share=max(share*available*forestClosure(st.cover),canopy);
    v2MeanWeights=vec3(1.-share,max(share-canopy,0.),canopy);
    v2MeanLitter.albedo=forestFloorAlbedo(forestFloor(opened,st,1.-groundSmooth(8.,16.,T+6.)));
    v2MeanLitter.occlusion*=.72;
    vec3 bareGuide=baseClosed*v2Canopy(canopyPhase)/max(v2Canopy(leafOn),vec3(.02));
    vec3 crownBare=forestCrownColor(st,bareGuide,st.needle,vec2(0.),0.);
    vec3 crownMean=crownBare*mix(vec3(1.),v2CanopyMeanRatio(crownBare,st.needle,light,light2,strength),1.-e.snow*(1.-st.needle));
    v2MeanCrown.albedo=groundToLinear(forestSnowed(crownMean,e.snow*mix(.62,.22,st.needle)));
    v2MeanCrown.normal=v2MacroNormal;v2MeanCrown.roughness=.9;v2MeanCrown.occlusion=1.;
    v2MeanEnabled=1.;
  }
  renderGuideColor=groundToDisplay(m.albedo);renderGuideOpen=opened;renderGuideClosed=closed;renderGuideWoods=woods;
  return m;
}
vec3 v2ShadeGround(GroundMaterial resolved,vec3 view,vec3 light,vec3 light2,float strength){
  vec3 nearColor=shadeTerrainGround(resolved,view,light,light2,strength);
  if(v2MeanEnabled<.5)return nearColor;
  vec3 openResponse=groundToLinear(shadeTerrainGround(v2MeanOpen,view,light,light2,strength));
  vec3 litterResponse=groundToLinear(shadeTerrainGround(v2MeanLitter,view,light,light2,strength));
  vec3 crownResponse=groundToLinear(shadeTerrainGround(v2MeanCrown,view,light,light2,strength));
  vec3 meanResponse=openResponse*v2MeanWeights.x+litterResponse*v2MeanWeights.y+crownResponse*v2MeanWeights.z;
  return groundToDisplay(mix(meanResponse,groundToLinear(nearColor),v2ForestReveal));
}
GroundMaterial v2Ground(vec3 s,vec2 world,float footprint,float tpi,vec3 light,vec3 light2,float strength,vec3 macroOpen){
  return v2GroundEnv(v2Local(s,world,tpi,footprint),s,world,footprint,light,light2,strength,macroOpen);
}
// Shore ice on the sea of a local map. Offshore progress t, in depth: 0 is the solid shore-fast sheet (to half the
// season's reach), 1 is open water, 40 m deeper than the reach.
float v2ShoreIceProgress(float c,float depth){float reach=2.+24.*c*c;return clamp((depth-.5*reach)/(.5*reach+40.),0.,1.);}
// Share of floes melted away at progress t (each floe decides at its own seed); a dense season keeps them longer.
float v2ShoreIceDrop(float c,float t){return sstep(mix(.15,.45,c),1.,t);}
// Area mean of the resolved pack (kept floes, minus leads and rounding) for footprints that cannot resolve floes.
float v2ShoreIceMean(float c,float t){return (1.-v2ShoreIceDrop(c,t))*(1.-.25*sstep(.3,1.,t));}
// Box-filtered share of a pixel (width pw, m) lying in a lead of half-width margin around a cell bisector.
float v2IceLead(float x,float margin,float pw){return clamp((min(x+.5*pw,margin)-max(x-.5*pw,-margin))/pw,0.,1.);}
// 2D jittered cells (9 taps): x is the metric distance to the nearest bisector, y the plate identity,
// zw the metric offset from the fragment to the plate's seed.
vec4 v2IcePlate(vec2 world,float scale,uint salt){
  vec2 q=world/scale;ivec2 cell=ivec2(floor(q));vec2 local=q-floor(q);
  float first=10.,second=10.,identity=0.;vec2 firstDelta=vec2(0.),secondDelta=vec2(0.);
  for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){
    uint h=surfaceHash(ivec3(cell+ivec2(x,y),0),salt);
    vec2 delta=vec2(float(x),float(y))+.1+.8*vec2(float(h&1023u),float((h>>10u)&1023u))/1023.-local;float d=dot(delta,delta);
    if(d<first){second=first;secondDelta=firstDelta;first=d;firstDelta=delta;identity=float(h>>20u)/4095.;}
    else if(d<second){second=d;secondDelta=delta;}
  }}
  return vec4((second-first)/max(2.*length(secondDelta-firstDelta),1e-5)*scale,identity,firstDelta*scale);
}
vec3 v2WaterColor(V2Env local,vec2 world,float footprint,float cover,float kind,float depth){
  if(uQuality>0){
    // Retain the bathymetric/seasonal palette without cellular ice or shore searches.
    bool sea=kind<1.5;
    float sediment=sstep(.1,.9,local.sand)*sstep(.1,1.,local.moisture);
    vec3 shallow=mix(mix(v2Mineral(local)*.65,vec3(.20,.33,.24),sediment),vec3(.12,.31,.32),.60);
    vec3 deep=sea?mix(vec3(.045,.16,.27),vec3(.018,.065,.15),sstep(150.,3000.,depth)):vec3(.025,.12,.21);
    vec3 water=mix(shallow,deep,1.-exp(-max(depth,0.)*(sea?.035:.15)*max(.08,cover*cover)));
    float freeze=sea?(v2Zoned()?v2SeasonSeaIce():v2Freeze(kind,local)):v2Freeze(kind,local);
    float ice=sea?v2ShoreIceMean(freeze,v2ShoreIceProgress(freeze,depth))*sstep(.05,.25,freeze):freeze;
    if(uRenderV2==5)return mix(vec3(.08,.17,.24),vec3(.85,.94,1.),ice);
    if(uRenderV2==4)return vec3(0.,0.,.13);
    return mix(water,vec3(.84,.89,.91),ice);
  }
  V2Env e=local;
  // Local terrain has no calving model. Sea ice belongs to the calendar and the shore,
  // never to a mountain-temperature proxy that scatters icebergs across a coastal city.
  e.glacier=0.;
  bool sea=kind<1.5;
  if(sea)e.temperature=10.;
  vec3 water=v2Water(depth,kind,cover,e,vec3(world*V2_ICE_ZOOM,0.),footprint*V2_ICE_ZOOM,uMaterialSeed);
  float iceCover=0.;
  if(sea){
    float T=local.temperature,warm=sstep(17.,25.,T),cold=sstep(6.,-1.,T),arid=sstep(500.,150.,uMaterialClimate.y);
    float shelf=exp(-max(depth,0.)*.06),lagoon=exp(-max(depth,0.)*.35);
    water=mix(water,vec3(.07,.40,.46),warm*shelf*.65);
    water=mix(water,vec3(.36,.70,.66),warm*lagoon*.5);
    water=mix(water,vec3(.03,.16,.33),arid*(1.-shelf)*.35);
    water=mix(water,water*vec3(.80,.90,1.)+vec3(0.,.01,.02),cold*.6);
    float c=v2Zoned()?v2SeasonSeaIce():v2Freeze(kind,local),reach=2.+24.*c*c;
    float raw=(depth-.5*reach)/(.5*reach+40.),t=clamp(raw,0.,1.);
    // Gradient of the unclamped progress on the ground (screen derivatives, both map and 3D projections), so each
    // plate reads its progress at its own seed: it shrinks evenly instead of tapering into a wedge.
    vec2 dw1=dFdx(world),dw2=dFdy(world);float dt1=dFdx(raw),dt2=dFdy(raw),det=dw1.x*dw2.y-dw1.y*dw2.x;
    vec2 gradT=abs(det)>1e-9?vec2(dw2.y*dt1-dw1.y*dt2,dw1.x*dt2-dw2.x*dt1)/det:vec2(0.);
    gradT*=min(1.,.02/max(length(gradT),1e-6));   // a coastline kink or a quad edge must not throw a plate far
    // From the coast out: one solid shore-fast sheet, then hairline leads open between big plates, plates break
    // into smaller floes, which round off and melt away whole toward open water, with slush and brash between them
    // near the sheet. Every decision (break, melt) is taken at a floe's seed, so no depth contour cuts a floe, and
    // nothing blurs the coastline (the land/water cover draws it). Leads are box-filtered: crisp, never aliased.
    if(c>.05&&raw<1.6){
      float pw=max(footprint,.3),resolved=1.-sstep(25.,60.,footprint),gate=sstep(.05,.25,c);
      vec3 g=vec3(world,0.);
      // One gentle domain bend (displacement slope below 1) for both cell sets: curved edges, no straight lattice.
      vec2 q=world;float erode=0.;
      if(resolved>0.){q+=38.*vec2(v2Pattern(g,260.,footprint,uMaterialSeed+755u),v2Pattern(g+vec3(517.,-293.,0.),260.,footprint,uMaterialSeed+756u));erode=v2Pattern(g,16.,footprint,uMaterialSeed+757u);}
      vec4 floe=v2IcePlate(q,140.,uMaterialSeed+751u);
      float tf=clamp(raw+dot(gradT,floe.zw),0.,1.),scale=140.;
      // Hairline leads whose width varies along the edge and grows a little offshore; none in the solid sheet.
      float lead=sstep(0.,.15,tf)*(.3+(.6+1.6*tf)*fract(floe.y*3.17))*max(1.+.9*erode,.15);
      float body=1.-v2IceLead(floe.x,lead,pw);
      // Past its own threshold a big plate has broken: smaller floes replace it whole (no nested outline).
      if(resolved>0.&&tf>.15+.55*floe.y){
        floe=v2IcePlate(q,52.,uMaterialSeed+754u);tf=clamp(raw+dot(gradT,floe.zw),0.,1.);scale=52.;
        lead=(.3+(.5+1.4*tf)*fract(floe.y*3.17))*max(1.+.9*erode,.15);
        body*=1.-v2IceLead(floe.x,lead,pw);
      }
      float id2=fract(floe.y*7.13),id3=fract(floe.y*3.17);
      // Offshore floes erode round: the cell is clipped by a ragged disc that shrinks with the progress.
      float radius=scale*mix(1.3,.42,sstep(.25,1.,tf))*(1.+.12*erode);
      body*=clamp((radius-length(floe.zw))/pw+.5,0.,1.)*step(v2ShoreIceDrop(c,tf),id2);
      iceCover=mix(body,v2ShoreIceMean(c,t),1.-resolved)*gate;
      // Between floes: grey slush and brash near the sheet, open dark water further out.
      float slush=(1.-sstep(.1,.8,t))*gate;
      water=mix(water,vec3(.40,.50,.56),.65*slush);
      float brash=resolved>0.?sstep(.25,.6,v2Pattern(g,22.,footprint,uMaterialSeed+758u))*slush:0.;
      // Shore-fast ice is a cooler grey-blue than the snow on land, so the coastline reads as one clean line;
      // drifting floes are brighter, each with its own tone. The grain changes the tone only.
      float grain=.008*v2Pattern(g,120.,footprint,uMaterialSeed+753u);
      vec3 iceTone=mix(vec3(.75,.82,.87),vec3(.84,.89,.91)*(.96+.07*id3*resolved),sstep(.1,.45,t))+grain;
      water=mix(water,iceTone*.92,.7*brash);
      water=mix(water,iceTone,iceCover);
    }
  }
  if(uRenderV2==5)water=mix(vec3(.08,.17,.24),vec3(.85,.94,1.),sea?iceCover:v2Ice(depth,kind,e,vec3(world*V2_ICE_ZOOM,0.),footprint*V2_ICE_ZOOM,uMaterialSeed).x);
  if(uRenderV2==4)water=vec3(0.,0.,.13);
  return water;
}
vec3 v2WaterAtEnv(V2Env local,vec3 rgb,vec2 world,float footprint,float cover,float kind,float depth){
  if(uV2WaterVisible==0||cover<=0.)return rgb;
  return mix(rgb,v2WaterColor(local,world,footprint,cover,kind,depth),cover);
}
vec3 v2WaterAt(vec3 rgb,vec3 s,vec2 world,float footprint,float cover,float kind,float depth){
  if(uV2WaterVisible==0||cover<=0.)return rgb;
  return v2WaterAtEnv(v2Local(s,world,0.,footprint),rgb,world,footprint,cover,kind,depth);
}
vec3 v2DiagnosticEnv(V2Env local,float fp){return v2Color(v2Appearance(local,fp),float(uRenderV2-1));}
vec3 v2Diagnostic(vec3 s,vec2 world,float tpi,float fp){return v2DiagnosticEnv(v2Local(s,world,tpi,fp),fp);}
`;


interface V2SourceLayer { x:number; y:number; width:number; n:number; data:Float32Array }
const glacierCache=new WeakMap<Float32Array,Map<string,Float32Array>>();
/** At most eight geographic bins of perennial-cold coastal source cells.
 * Stable source-grid proxy; no scanning or terrain sampling in fragment shaders. */
export function renderV2GlacierSources(layer:V2SourceLayer,climate:{temperature:number;precipitation:number}):Float32Array {
  const key=[layer.x,layer.y,layer.width,layer.n,climate.temperature,climate.precipitation].join('/');
  let cache=glacierCache.get(layer.data);if(!cache)glacierCache.set(layer.data,cache=new Map());
  const prior=cache.get(key);if(prior)return prior;
  const result=new Float32Array(32),sum=new Float64Array(24),n=layer.n;
  const amplitude=6+.5*Math.max(0,10-climate.temperature),step=Math.max(1,Math.floor(n/256));
  if(climate.precipitation>80)for(let y=0;y<n;y+=step)for(let x=0;x<n;x+=step){
    const h=layer.data[y*n+x];if(h<=20||climate.temperature+amplitude-.0065*h>=-1)continue;
    let coast=false;for(const [dx,dy] of [[-4,0],[4,0],[0,-4],[0,4]]){const xx=x+dx*step,yy=y+dy*step;if(xx>=0&&yy>=0&&xx<n&&yy<n&&layer.data[yy*n+xx]<0)coast=true;}
    if(!coast)continue;const bin=Math.min(3,Math.floor(x/n*4))+4*Math.min(1,Math.floor(y/n*2));
    sum[bin*3]+=layer.x+(x+.5)*layer.width/n;sum[bin*3+1]+=layer.y+(y+.5)*layer.width/n;sum[bin*3+2]++;
  }
  for(let i=0;i<8;i++)if(sum[i*3+2]){result[i*4]=sum[i*3]/sum[i*3+2];result[i*4+1]=sum[i*3+1]/sum[i*3+2];result[i*4+2]=1;}
  cache.set(key,result);return result;
}
