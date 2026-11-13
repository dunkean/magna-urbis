import { RENDER_V2_ENVIRONMENT_GLSL, RENDER_V2_CANOPY_MEAN_GLSL } from './terrainRenderV2Environment';
import { RENDER_V2_RELIEF_GLSL } from './terrainRenderV2Relief';
import { RENDER_V2_WINTER_GLSL } from './terrainRenderV2Winter';
import { RENDER_V2_GROUND_GLSL } from './terrainRenderV2Ground';

/** Shared environmental appearance. The local adapter has one annual climate,
 * so the north-hemisphere seasonal amplitude below is a declared proxy. */
export const RENDER_V2_GLSL = `${RENDER_V2_ENVIRONMENT_GLSL}
${RENDER_V2_CANOPY_MEAN_GLSL}
${RENDER_V2_RELIEF_GLSL}
${RENDER_V2_WINTER_GLSL}
${RENDER_V2_GROUND_GLSL}
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
  // Geomorphic units of the open ground (sand sea, gravel plain, rock pavement, pan), from this mottle and the
  // stand mosaic that e.tone carries (its valley term removed). They yield to woods and to wet ground.
  float woody=e.woody;if(uForest==0)woody*=F.x;
  v2GroundUnits(V2_ZONE_UNITS[z],V2_ZONE_GRAVEL[z].a,s,world,tpi,fp,mottle,(e.tone-.5+.06*sstep(0.,-.10,tpi))/.13,(1.-sstep(.15,.5,woody))*(1.-v2ZoneWet)*step(0.,s.x));
  vec4 G=v2GroundUnit;surfaceGroundSand=G.x;surfaceGroundStony=clamp(G.y+G.z,0.,1.);
  e.sand=clamp(e.sand+S.y*(1.-sstep(.1,.5,slope))*(1.-v2ZoneWet)+.5*G.x,0.,1.);
  // Exposed rock: steep slopes, and knobs/ridges broken by the same mottle
  // (glaciated outcrops, scree, limestone pavements). Stands open over it.
  // Real relief only: on a plain the sign of tpi is the terrain's micro-relief, and rock would freckle the whole ground.
  float knob=sstep(0.,.08,tpi)*sstep(-.1,.5,mottle)*sstep(.05,.2,slope);
  // A pavement is rock for the close-range material (joints, relief, sheen); no crown roots in a sand sea or a pan.
  float rock=clamp(S.x*max(sstep(.05,.35,slope),.75*knob)*(1.-v2ZoneWet)+.6*G.z,-e.rock,1.-e.rock);
  v2ZoneBare=clamp(max(rock,0.)+.7*v2ZoneWet+G.x+G.w,0.,1.);
  // Zone treeline: an open herbaceous belt (alpine pasture, tundra) below the
  // climatic tree limit, from the same warm-season lapse proxy as the field.
  float shift=V2_ZONE_WET[z].a;
  if(shift>0.){
    float warm=uMaterialClimate.x-.0065*max(s.x,0.)+6.+.5*max(0.,10.-uMaterialClimate.x);
    float above=1.-sstep(6.+shift,8.+shift,warm);
    v2ZoneBare=max(v2ZoneBare,above);
    e.grass=max(e.grass,above*sstep(-1.,3.,warm)*(1.-e.rock)*(1.-e.snow));
  }
  e.rock+=rock;e.grass=clamp(e.grass*S.w*(1.-max(rock,0.))*(1.-min(G.x+.7*G.y+G.z+G.w,1.)),0.,1.);
  e.organic=clamp(e.organic+S.z*(.4+.6*v2ZoneWet),0.,max(1.-e.sand-e.clay,0.));
  if(uForest==0){e.woody*=F.x;e.needle=mix(e.needle,F.y,F.z);}
}
// Zone substrate and herbaceous classes over the retained climate material.
vec3 v2ZoneOpen(vec3 c,V2Env e,vec2 world,float fp){
  int z=v2Zone();vec4 sw=V2_ZONE_SWARD[z],bare=V2_ZONE_BARE[z],can=V2_ZONE_CANOPY[z];
  float cover=e.grass*(1.-e.rock);
  // Stand tone also varies the substrate (gravel plains, pale pavements).
  c=mix(c,mix(bare.rgb*(.86+.28*e.tone)*surfaceMicroTone,sw.rgb*surfaceHerbTone*surfaceMicroTone,cover),mix(bare.a*(1.-.8*clamp(e.rock,0.,1.)),sw.a,cover));
  vec3 p=vec3(world,0.);vec4 U=v2GroundUnit;
  // One fall-line streak per fragment, on slopes only. From 10 m/px down it draws drainage on plains (a faint
  // streaking, darker greener rills that gather in hollows) and the pale threads of desert washes; under 0.7 m/px
  // on the stony ground of frost zones it becomes the stone stripes of patterned ground instead.
  float streak=0.,rill=0.,stripe=0.;
  if(uQuality==0){
    bool stripes=V2_ZONE_PAVEMENT[z].a*(U.y+U.z)>.2&&fp<.72;
    float across=stripes?2.4:30.;
    float keep=sstep(.03,.10,e.slope)*(1.-sstep(.5,.9,e.slope))*(1.-sstep(across*.12,across*.3,fp));
    if(keep>0.){
      float steepness=length(surfaceGroundGradient);
      streak=keep*v2GroundStreak(world,steepness>.0001?surfaceGroundGradient/steepness:vec2(1.,0.),across,uMaterialSeed+731u);
      if(stripes){stripe=streak;streak=0.;}
      // Lines on the zero set of the streak, minus their mean.
      else rill=keep*(exp2(-14.*streak*streak/(keep*keep))-.22);
    }
  }
  c*=vec3(1.)+(.028*streak-(.03+.05*sstep(0.,.5,-v2GroundSite.z))*cover*rill)*vec3(1.,.8,.9);
  // Scrub/grove patches (garrigue, acacia parkland): a tint in ragged patches once resolved; the unresolved
  // pattern converges to its mean. Single shrubs are crowns of the forest, never drawn here.
  float scrub=can.a*cover;
  if(scrub>.004){
    float speck=0.,crisp=0.;
    if(uQuality==0){
      for(int k=0;k<3;k++)speck+=(k==0?.45:k==1?.35:.2)*v2Pattern(p,k==0?1600.:k==1?220.:60.,fp,uMaterialSeed+(k==0?711u:k==1?713u:717u));
      crisp=1.-sstep(4.,20.,fp);
    }
    c=mix(c,vec3(.27,.30,.20)*can.rgb,scrub*(.3+.5*sstep(mix(-.4,-.02,crisp),mix(.6,.22,crisp),speck)));
  }
  // Geomorphic units of dry and cold zones, then the dunes of the sand sea (slope to v2GroundFormSlope).
  if(U.x+U.y+U.z+U.w+v2GroundSite.x+v2GroundSite.y>.003){
    c=v2GroundPaint(c,z,e,world,fp,stripe,rill);
    c*=1.+v2GroundDunes(world,fp,U.x);
  }
  // Wet low ground: reed and sedge mats, pools and channels (paddy parcels in the tropical zone).
  vec3 wet=V2_ZONE_WET[z].rgb;
  if(v2ZoneWet>.003)wet=v2GroundWetland(wet,z,world,fp);
  return mix(c,wet,.8*v2ZoneWet);
}
// Neural Earth sizes its pack for a planet; on a local map the same floes come in at ship scale.
// Rivers and lakes keep their own freeze (rendered along their outline elsewhere); the sea pack breaks into smaller cakes.
const float V2_ICE_ZOOM=5.,V2_SEA_ICE_ZOOM=8.;
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
  // The edge resolves with the zoom: four finer octaves (60, 24, 10 and 4.2 m) join as the footprint shrinks, each
  // filtered out before it aliases, and the threshold narrows by the variance they bring. From far the soft band is
  // unchanged; from near the same band is a crisp ragged edge with detached patches and bare spots, rougher over
  // rock. The octaves are zero-mean and the threshold stays centred, so the cover of the band is conserved.
  float slope=length(s.yz),steep=sstep(.35,.9,slope);
  float window=sstep(0.,.2,e.snow)*(1.-sstep(.85,1.,e.snow)),bend=0.,spread=0.;
  if(window>0.){
    float drift=0.,fine=0.;
    if(uQuality==0){
      float ragged=(.5+1.25*v2SeasonSnowPatches())*mix(.85,1.3,clamp(e.rock,0.,1.));
      // One loop for the seven octaves (one inlined pattern); an octave the footprint has filtered out is skipped.
      for(int k=0;k<7;k++){
        float scale=k==0?640.:k==1?300.:k==2?140.:k==3?60.:k==4?24.:k==5?10.:4.2;
        if(footprint<scale*.3){
          vec2 r=k==0?vec2(.80,.60):k==1?vec2(.31,-.95):k==2?vec2(-.70,.71):k==3?vec2(.54,.84):k==4?vec2(-.91,.41):k==5?vec2(.28,-.96):vec2(-.66,-.75);
          float v=v2Pattern(vec3(r.x*world.x-r.y*world.y,r.y*world.x+r.x*world.y,0.),scale,footprint,uMaterialSeed+(k<3?723u:1790u)+uint(k));
          if(k<3)drift+=(k==0?.55:k==1?.30:.15)*v;
          else{
            float a=(k==3?.044:k==4?.035:k==5?.027:.020)*ragged,keep=1.-sstep(scale*.12,scale*.3,footprint);
            fine+=a*v;spread+=a*a*keep*keep;
          }
        }
      }
    }
    float relief=mix(.16,.24,steep)*(sstep(0.,-.10,tpi)-sstep(0.,.10,tpi))-.08*s.z/max(.2,slope)*(1.-sstep(.35,.8,slope));
    bend=(mix(.12,.30,v2SeasonSnowPatches())*drift+relief+fine)*window;
  }
  // Half-width of the cover threshold: .125 from far, .02 once the fine octaves are resolved.
  float cut=sqrt(max(.015625-4.6*spread,.0004)),pack=e.snow+bend;
  e.snow=sstep(.45-cut,.45+cut,pack);
  // Just past the threshold the snow is a dusting; only resolved zooms show the ground through it.
  v2WinterThin=(1.-sstep(.45,.56,pack))*(1.-sstep(2.,12.,footprint));
  // Fresh water of this altitude freezes with the level ground around it, not with this fragment's relief or drifts.
  v2WinterFresh=v2WinterFreeze(v2WinterClimate(s.x,0.));
  if(uForest==1){vec4 f=forestField(world,0.);e.woody=f.r;e.height=f.g*50.;e.needle=f.b;e.leaf=mix(e.leaf,1.,e.needle);}
  // The zone's calendar sets leaf fall: a temperature proxy leaves oaks in leaf through a mild winter.
  if(v2Zoned())e.leaf=mix(v2SeasonLeaf(),1.,e.needle);
  v2ZoneWet=0.;v2ZoneBare=0.;if(v2Zoned())v2ZoneEnv(e,s,world,tpi,footprint);
  // Riparian fringe: the open ground along a bank is lusher and greener than the land behind it (reeds, sedge, wet
  // grass), the green ribbon of a river in a dry zone. It reuses the bank term of the gallery envelope, no new
  // search: full on gentle reaches, gone in gorges, on rock and under snow, stronger where the climate is dry.
  // Set after v2ZoneEnv, so it does not open the gallery stands as the zone's own wet ground does.
  if(v2Zoned())if(bank>0.){
    float fringe=bank*(1.-sstep(.12,.45,slope))*(1.-e.snow)*step(0.,s.x)*(1.-clamp(e.rock,0.,1.));
    e.grass=max(e.grass,.9*fringe);
    v2ZoneWet=max(v2ZoneWet,mix(.4,.8,arid)*fringe);
  }
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
  V2Env e=v2Appearance(local,footprint);v2Foliage=e.leaf;v2GroundSnow=e.snow;v2GroundFormSlope=vec2(0.);
  // Retained macro canopy is the occupation/gallery fallback. Natural stands
  // below use population-weighted open, litter and intrinsic crown responses.
  // Crown share seen from above (forestCrownShow): foliage, plus the rimed limbs of leafless crowns under snow.
  float woods=(uForest==1?macroWoods:e.woody)*forestCrownShow(e.leaf)*(1.-v2ZoneBare);
  // The zone's bare outcrops (nordic slopes) must not strip stands the crowns still draw when resolved.
  woods=max(woods,snowStands*forestCrownShow(e.leaf));
  // One retained material mean at every footprint. Resolution reveals only
  // surface detail; it must not replace the soil with another palette.
  vec3 opened=v2GroundTint(macroOpen,e);
  if(v2Zoned()){opened=v2ZoneOpen(opened,e,world,footprint);opened*=mix(vec3(1.),v2SeasonHerb(),max(e.grass,.3)*(1.-e.rock));}
  // A low alluvial plain is not necessarily exposed sediment. Potential
  // herbaceous cover recolonizes it; the physical beach remains separate.
  opened=mix(opened,renderGuideSediment*.9,renderGuideFlats*v2FlatSedimentExposure(e.grass,renderGuideShore,renderGuideOpenness));
  // Snow surface: soft isotropic undulation and fine grain, resolved in metres and faded before aliasing
  // (no stretched wind ridges: at map scale they read as parallel stripes).
  // The drift field is read a second time 1.2 m toward the sun: the difference is the slope of the wind relief
  // along the light, shaded as a normal would be (lee sides darker, low sun stronger). One loop, one inlined
  // pattern; nothing is evaluated once the footprint has filtered the pattern out.
  float snowDrift=0.,snowGrain=0.,snowLee=0.;
  if(uQuality==0&&e.snow>0.){
    vec2 sun=light.xz/max(length(light.xz),1e-3);
    for(int k=0;k<3;k++){
      float scale=k==2?3.2:11.;
      if(footprint<scale*.3){
        vec2 q=k==2?world:mat2(.80,.60,-.60,.80)*(world+(k==1?1.2*sun:vec2(0.)));
        float v=v2Pattern(vec3(q,0.),scale,footprint,uMaterialSeed+(k==2?727u:726u));
        if(k==0)snowDrift=v;else if(k==1)snowLee=v-snowDrift;else snowGrain=v;
      }
    }
  }
  float snowRelief=clamp(-.2*snowLee*min(length(light.xz)/max(light.y,.3),2.),-.1,.1);
  vec3 snowColor=vec3(.88,.91,.91)*(1.+.035*clamp(snowDrift*1.7,-1.,1.)+.018*snowGrain+snowRelief);
  // A dusting at the edge of the cover lets the ground and its texture through (v2WinterThin, resolved zooms only).
  opened=mix(opened,snowColor,e.snow*(1.-.35*v2WinterThin));
  opened=mix(opened,renderGuideSediment,clamp(renderGuideBeach/.8,0.,1.)*(1.-e.snow));
  V2Env canopyPhase=e;canopyPhase.snow=0.;
  V2Env leafOn=canopyPhase;leafOn.leaf=1.;
  // Retain Render's canopy mean. V2 supplies the seasonal change rather than
  // a second absolute palette with a different exposure in the same biome.
  vec3 closed=baseClosed*v2Canopy(canopyPhase)/max(v2Canopy(leafOn),vec3(.02));
  v2CrownGuide=closed;
  // Integrate the intrinsic normals/AO of unresolved crowns. The guide for
  // actual resolved crowns below retains its original material, not this mean.
  // Crowns carry the calendar's snow load, the mean of the resolved crowns (forestSnowLoad): laden boughs, rimed limbs.
  float frost=e.snow*forestSnowLoad(e.needle);
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
  // The map-scale gullies of rocky slopes (surfaceMaterial) join the close-range relief: past 10 m per pixel
  // they are the only rock structure, and the sun models them like the terrain.
  vec4 detail=groundField(vec3(world.x,0.,world.y),uMaterialSeed,footprint)+vec4(0.,surfaceRockSlope.x,0.,surfaceRockSlope.y);
  float gain=mix(.02+.43*e.rock+.07*(1.-e.grass),.008,e.snow);
  m.normal=normalize(vec3(-s.y-v2GroundFormSlope.x-detail.y*gain,1.,-s.z-v2GroundFormSlope.y-detail.w*gain));
  float sward=clamp(detail.x*4.,-1.,1.)*.025*e.grass*(1.-e.snow)*groundVisibility(.32,footprint);
  float form=clamp(detail.x*10.,-1.,1.);
  v2FloorModulation=1.+form*mix(mix(.04,.06,e.rock),.006,e.snow)+sward;
  v2MacroNormal=normalize(vec3(-s.y-v2GroundFormSlope.x,1.,-s.z-v2GroundFormSlope.y));
  // Inside snowy conifer stands the floor between crowns is intercepted and shaded, and the canopy keeps a
  // stand-scale grain: an unresolved taiga reads dark and textured over white clearings, not as a grey blanket.
  vec3 standFloor=mix(opened,opened*vec3(.45,.48,.50)+vec3(.03,.04,.03),snowStands*e.needle);
  float crownGrain=1.;
  if(uQuality==0)crownGrain=1.+snowStands*(.22*v2Pattern(vec3(world,0.),45.,footprint,uMaterialSeed+761u)+.14*v2Pattern(vec3(world,0.),14.,footprint,uMaterialSeed+762u));
  m.albedo=mix(forestFloorAlbedo(standFloor),groundToLinear(v2MacroCanopy)*crownGrain,woods);
  m.roughness=clamp(pow(pow(mix(.88,.54,e.rock),4.)+gain*gain*groundSlopeVariance(footprint),.25),.4,.98);
  // Gully and chute floors see less sky: the fall-line wear darkens in the ambient light, not in the albedo.
  m.occlusion=clamp(1.-(.10*max(-detail.x*12.,0.)+.09*(surfaceRockCavity.x+surfaceRockCavity.y)*(1.-e.snow))*e.rock,.8,1.);
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
    float canopy=st.cover*forestCrownShow(e.leaf)*available;share=max(share*available*forestClosure(st.cover),canopy);
    v2MeanWeights=vec3(1.-share,max(share-canopy,0.),canopy);
    v2MeanLitter.albedo=forestFloorAlbedo(forestFloor(opened,st,1.-groundSmooth(8.,16.,T+6.)));
    v2MeanLitter.occlusion*=.72;
    vec3 bareGuide=baseClosed*v2Canopy(canopyPhase)/max(v2Canopy(leafOn),vec3(.02));
    vec3 crownBare=forestCrownColor(st,bareGuide,st.needle,vec2(0.),0.);
    vec3 crownMean=crownBare*mix(vec3(1.),v2CanopyMeanRatio(crownBare,st.needle,light,light2,strength),1.-e.snow*(1.-st.needle));
    v2MeanCrown.albedo=groundToLinear(forestSnowed(crownMean,e.snow*forestSnowLoad(st.needle)));
    v2MeanCrown.normal=v2MacroNormal;v2MeanCrown.roughness=.9;v2MeanCrown.occlusion=1.;
    v2MeanEnabled=1.;
  }
  renderGuideColor=groundToDisplay(m.albedo);renderGuideOpen=opened;renderGuideClosed=closed;renderGuideWoods=woods;
  return m;
}
vec3 v2ShadeGround(GroundMaterial resolved,vec3 view,vec3 light,vec3 light2,float strength){
  // Relief light of the landform (baked sky occlusion and cast shadow, slope light) for every response of this
  // fragment; canopy, resolved or as a stand mean, takes the stronger slope light. Neutral again on return.
  groundReliefLight=v2ReliefShade(normalize(light),clamp(max(max(forestMapCover,renderGuideWoods),v2MeanWeights.z),0.,1.));
  vec3 color=shadeTerrainGround(resolved,view,light,light2,strength);
  if(v2MeanEnabled>=.5){
    vec3 openResponse=groundToLinear(shadeTerrainGround(v2MeanOpen,view,light,light2,strength));
    vec3 litterResponse=groundToLinear(shadeTerrainGround(v2MeanLitter,view,light,light2,strength));
    vec3 crownResponse=groundToLinear(shadeTerrainGround(v2MeanCrown,view,light,light2,strength));
    vec3 meanResponse=openResponse*v2MeanWeights.x+litterResponse*v2MeanWeights.y+crownResponse*v2MeanWeights.z;
    color=groundToDisplay(mix(meanResponse,groundToLinear(color),v2ForestReveal));
  }
  groundReliefLight=vec3(1.);
  return color;
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
  // Sea ice of the map and season (terrainRenderV2Winter): x concentration, y looseness. The calendar is the
  // potential, the snow of the coast decides what forms. Fresh ice is laid by the callers (v2FreshIce).
  vec2 seaIce=vec2(0.);
  if(kind<1.5)seaIce=v2WinterSeaIce(v2Zoned()?v2SeasonSeaIce():v2Freeze(kind,local));
  // Fresh water reads as the same water along its network. The caller composites the coverage, so a narrow or
  // antialiased stream is not optically thinner (coverage does not enter the colour), and the depth keeps a floor:
  // a small stream is a little lighter and clearer than its trunk, never bed-coloured beside deep blue.
  float optical=max(depth,0.),share=cover;
  if(kind>1.5){optical=max(depth,2.5);share=1.;}
  if(uQuality>0){
    // Retain the bathymetric/seasonal palette without cellular ice or shore searches.
    bool sea=kind<1.5;
    float sediment=sea?sstep(.1,.9,local.sand)*sstep(.1,1.,local.moisture):.5;
    vec3 shallow=mix(mix(v2Mineral(local)*.65,vec3(.20,.33,.24),sediment),vec3(.12,.31,.32),.60);
    vec3 deep=sea?mix(vec3(.045,.16,.27),vec3(.018,.065,.15),sstep(150.,3000.,depth)):vec3(.025,.12,.21);
    vec3 water=mix(shallow,deep,1.-exp(-optical*(sea?.035:.15)*max(.08,share*share)));
    float ice=v2ShoreIceMean(seaIce.x,clamp(min(v2ShoreIceProgress(seaIce.x,depth),v2WinterPackLimit(seaIce.x))+.65*seaIce.y,0.,1.))*sstep(.05,.25,seaIce.x);
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
  // One bed for the whole fresh network: the local sand and moisture change between a tributary's slope and the
  // trunk's valley floor, and with them the hue of the bed seen through shallow water.
  else{e.sand=.5;e.moisture=1.;}
  vec3 water=v2Water(optical,kind,share,e,vec3(world*V2_ICE_ZOOM,0.),footprint*V2_ICE_ZOOM,uMaterialSeed);
  float iceCover=0.;
  if(sea){
    float T=local.temperature,warm=sstep(17.,25.,T),cold=sstep(6.,-1.,T),arid=sstep(500.,150.,uMaterialClimate.y);
    float shelf=exp(-max(depth,0.)*.06),lagoon=exp(-max(depth,0.)*.35);
    water=mix(water,vec3(.07,.40,.46),warm*shelf*.65);
    water=mix(water,vec3(.36,.70,.66),warm*lagoon*.5);
    water=mix(water,vec3(.03,.16,.33),arid*(1.-shelf)*.35);
    water=mix(water,water*vec3(.80,.90,1.)+vec3(0.,.01,.02),cold*.6);
    float c=seaIce.x,reach=2.+24.*c*c;
    // An arctic pack takes the whole sea: its offshore progress stops at close pack (v2WinterPackLimit), so the
    // plates run to the map edge instead of opening with depth. A thawed coast holds no fast sheet: the pack starts
    // already broken, rounded and thinned (drifting floes).
    float raw=min((depth-.5*reach)/(.5*reach+40.),v2WinterPackLimit(c))+.65*seaIce.y,t=clamp(raw,0.,1.);
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
  if(uRenderV2==5)water=mix(vec3(.08,.17,.24),vec3(.85,.94,1.),iceCover);
  if(uRenderV2==4)water=vec3(0.,0.,.13);
  return water;
}
vec3 v2WaterAtEnv(V2Env local,vec3 rgb,vec2 world,float footprint,float cover,float kind,float depth){
  if(uV2WaterVisible==0||cover<=0.)return rgb;
  return mix(rgb,v2WaterColor(local,world,footprint,cover,kind,depth),cover);
}
vec3 v2WaterAt(vec3 rgb,vec3 s,vec2 world,float footprint,float cover,float kind,float depth){
  if(uV2WaterVisible==0||cover<=0.)return rgb;
  V2Env local=v2Local(s,world,0.,footprint);
  // Callers without a bank distance (material raster): fresh water is open or frozen across with the land of its
  // altitude, the same decision as the map takes at the light display tier.
  vec3 base=rgb;float wet=cover;
  if(kind>1.5){
    vec4 sheet=v2FreshIce(world,footprint,v2WinterFresh,step(v2WinterFresh,.5),0.,0.,0.);
    base=mix(rgb,sheet.rgb,cover*sheet.a);wet=cover*(1.-sheet.a);
  }
  return v2WaterAtEnv(local,base,world,footprint,wet,kind,depth);
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
